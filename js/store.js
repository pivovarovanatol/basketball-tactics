// Where plays live:
//   1. In the repo: plays/<id>.json, listed in plays/index.json. Everyone reads these.
//   2. On this device: drafts in localStorage (plays not yet published to the repo).
// Coaches publish to the repo through the GitHub API with their own token (see Settings).

const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------- Settings ----------

function guessRepo() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const first = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: first || `${owner}.github.io` };
  }
  return {};
}

export function getSettings() {
  const s = LS.get('bb-settings') || {};
  const g = guessRepo();
  return {
    owner: s.owner || g.owner || '',
    repo: s.repo || g.repo || '',
    branch: s.branch || 'main',
    token: s.token || '',
  };
}
export function saveSettings(s) { LS.set('bb-settings', s); }
export const canPublish = () => { const s = getSettings(); return !!(s.owner && s.repo && s.token); };

// ---------- Reading plays from the site ----------

/** Loads plays/index.json and every play in it. Returns { plays, folders }; each play gets .folder from the index. */
export async function loadRepo() {
  const r = await fetch('plays/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error(`plays/index.json: ${r.status}`);
  const idx = await r.json();
  const plays = await Promise.all((idx.plays || []).map(async (e) => {
    try {
      const pr = await fetch(`plays/${e.file}`, { cache: 'no-cache' });
      if (!pr.ok) return null;
      const p = await pr.json();
      p.folder = normFolder(e.folder ?? p.folder);
      return p;
    } catch { return null; }
  }));
  return { plays: plays.filter(Boolean), folders: (idx.folders || []).map(normFolder).filter(Boolean) };
}

/** "a/b/c" → ["a", "a/b", "a/b/c"] */
export const ancestors = (f) => { const parts = normFolder(f).split('/').filter(Boolean); return parts.map((_, i) => parts.slice(0, i + 1).join('/')); };
const addFolders = (idx, list) => {
  const set = new Set((idx.folders || []).map(normFolder).filter(Boolean));
  for (const f of list) for (const a of ancestors(f)) set.add(a);
  idx.folders = [...set].sort((a, b) => a.localeCompare(b));
};

// ---------- Local drafts ----------

export const getLocal = () => LS.get('bb-local-plays') || [];
export function putLocal(play) {
  const list = getLocal().filter((p) => p.id !== play.id);
  list.push({ ...clean(play), folder: normFolder(play.folder) }); // drafts keep their folder locally
  LS.set('bb-local-plays', list);
}
export function removeLocal(id) { LS.set('bb-local-plays', getLocal().filter((p) => p.id !== id)); }

// ---------- File format ----------

const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? Math.round(v) : v);
function roundPositions(obj) {
  const out = {};
  for (const k in obj) out[k] = round(obj[k]);
  return out;
}

/** The exact shape written to plays/<id>.json (see docs/PLAY_FORMAT.md). */
export function clean(play) {
  return {
    format: 1,
    id: play.id,
    name: play.name,
    serving: play.serving,
    intro: play.intro || '',
    updated: play.updated || new Date().toISOString(),
    start: { pos: roundPositions(play.start.pos), ball: play.start.ball.point ? { point: round(play.start.ball.point) } : { holder: play.start.ball.holder } },
    steps: play.steps.map((s) => ({
      cap: s.cap || '',
      dur: s.dur,
      arc: Math.round(s.arc || 0),
      moves: roundPositions(s.moves || {}),
      ball: s.ball ? (s.ball.point ? { point: round(s.ball.point) } : { holder: s.ball.holder }) : null,
      ...(s.shot && s.shot !== 'normal' ? { shot: s.shot } : {}),
    })),
  };
}

/** "  Serve receive / Rotation 1 " → "Serve receive/Rotation 1" */
export const normFolder = (f) => (f || '').split('/').map((x) => x.trim()).filter(Boolean).join('/');

export function newId(name) {
  const slug = (name || 'play').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'play';
  return `${slug}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- GitHub API ----------

const b64 = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)));

async function gh(path, opts = {}) {
  const s = getSettings();
  const r = await fetch(`https://api.github.com/repos/${s.owner}/${s.repo}${path}`, {
    ...opts,
    cache: 'no-store', // GitHub lets browsers cache API reads for 60 s; a stale file version makes the next save fail
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${s.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).message || msg; } catch { /* not JSON */ }
    const err = new Error(`GitHub ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

async function getFile(path) {
  try {
    // A unique URL per read: browsers may cache GitHub API reads for 60 s, and a stale file version makes the save fail.
    return await gh(`/contents/${path}?ref=${encodeURIComponent(getSettings().branch)}&t=${Date.now()}${Math.random().toString(36).slice(2, 6)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

async function putFile(path, text, message, sha) {
  const put = (s) => gh(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64(text), branch: getSettings().branch, ...(s ? { sha: s } : {}) }),
  });
  try {
    return await put(sha);
  } catch (e) {
    // The file changed since we read it (another save, another device): re-read its version once and retry.
    if (e.status !== 409 && e.status !== 422) throw e;
    const cur = await getFile(path);
    return put(cur && cur.sha);
  }
}

async function updateIndex(mutate, message) {
  const cur = await getFile('plays/index.json');
  const idx = cur ? JSON.parse(unb64(cur.content)) : { plays: [] };
  idx.plays = idx.plays || [];
  idx.folders = idx.folders || [];
  mutate(idx);
  idx.folders = [...new Set(idx.folders.map(normFolder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  await putFile('plays/index.json', JSON.stringify(idx, null, 2) + '\n', message, cur && cur.sha);
}

/** Checks the token and returns { ok, push, fullName }. */
export async function testConnection() {
  const r = await gh('');
  return { ok: true, push: !!(r.permissions && r.permissions.push), fullName: r.full_name };
}

const label = (list) => (list.length === 1 ? list[0].name : `${list.length} plays`);

/** Commit plays/<id>.json for each play, then update plays/index.json once. */
export async function publishPlays(list) {
  const datas = list.map(clean);
  for (const data of datas) {
    const path = `plays/${data.id}.json`;
    const cur = await getFile(path);
    await putFile(path, JSON.stringify(data, null, 2) + '\n', `${cur ? 'Update' : 'Add'} play: ${data.name}`, cur && cur.sha);
  }
  await updateIndex((idx) => {
    for (const [i, data] of datas.entries()) {
      const folder = normFolder(list[i].folder);
      addFolders(idx, [folder]);
      const entry = { id: data.id, name: data.name, folder, file: `${data.id}.json`, updated: data.updated };
      const at = idx.plays.findIndex((e) => e.id === data.id);
      if (at >= 0) idx.plays[at] = entry; else idx.plays.push(entry);
    }
  }, `Index: ${label(datas)}`);
}
export const publishPlay = (play) => publishPlays([play]);

/** Delete plays/<id>.json for each play, then update plays/index.json once. */
export async function unpublishPlays(list) {
  for (const play of list) {
    const path = `plays/${play.id}.json`;
    const cur = await getFile(path);
    if (cur) {
      await gh(`/contents/${path}`, {
        method: 'DELETE',
        body: JSON.stringify({ message: `Delete play: ${play.name}`, sha: cur.sha, branch: getSettings().branch }),
      });
    }
  }
  const ids = new Set(list.map((p) => p.id));
  await updateIndex((idx) => { idx.plays = idx.plays.filter((e) => !ids.has(e.id)); }, `Index: remove ${label(list)}`);
}

/** Save the folder tree: the full folder list and which folder each play is in. One commit to plays/index.json. */
export async function saveLayout(folders, folderOf, message) {
  await updateIndex((idx) => {
    idx.folders = [...folders];
    for (const e of idx.plays) if (folderOf.has(e.id)) e.folder = normFolder(folderOf.get(e.id));
    addFolders(idx, idx.plays.map((e) => e.folder || ''));
  }, message || 'Reorganize plays');
}
