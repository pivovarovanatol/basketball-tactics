// Court geometry, play model helpers and drawing. No app state lives here.
//
// Coordinates are the same as in the diagrams (tools/make_diagrams.py): a half court drawn in a
// 380 × 330 box. Floor x 20–360 (15 m wide), y 20 (centre line) … 310 (baseline). Ring at (190, 292).
// Offense O1–O5, defense X1–X5.

export const NS = 'http://www.w3.org/2000/svg';
export const U = 340 / 15;                       // drawing units per metre
export const COLORS = { O: '#534AB7', X: '#D85A30' };
export const PASS_COLOR = '#55544e';
export const KEYS = ['O1', 'O2', 'O3', 'O4', 'O5', 'X1', 'X2', 'X3', 'X4', 'X5'];
export const BASKET = [190, 292];
export const FLOOR = { x0: 20, y0: 20, x1: 360, y1: 310 };

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const keyName = (k) => k;

// ---------- Free board set-ups ----------
const OFFENSE = { O1: [190, 95], O2: [322, 160], O3: [58, 160], O4: [140, 262], O5: [240, 262] };
const ZONES = {
  z23: { X1: [155, 160], X2: [225, 160], X3: [118, 250], X5: [190, 262], X4: [262, 250] },
  z32: { X1: [190, 140], X2: [108, 172], X3: [272, 172], X4: [150, 252], X5: [230, 252] },
};
/** A defender a step from his man, towards the ring. */
const guard = (p, d = 24) => {
  const dx = BASKET[0] - p[0], dy = BASKET[1] - p[1], n = Math.hypot(dx, dy) || 1;
  return [Math.round(p[0] + (dx / n) * d), Math.round(p[1] + (dy / n) * d)];
};

export function lineup(defense = 'man') {
  const pos = clone(OFFENSE);
  for (let n = 1; n <= 5; n++) pos['X' + n] = defense === 'man' ? guard(OFFENSE['O' + n]) : ZONES[defense]['X' + n].slice();
  return { pos, ball: { holder: 'O1' } };
}

/** Positions and ball at the start and after each step. */
export function buildSnaps(play) {
  const snaps = [{ pos: clone(play.start.pos), ball: clone(play.start.ball) }];
  for (const s of play.steps) {
    const prev = snaps[snaps.length - 1];
    const pos = clone(prev.pos);
    for (const k in s.moves) pos[k] = s.moves[k].slice();
    snaps.push({ pos, ball: s.ball ? clone(s.ball) : clone(prev.ball) });
  }
  return snaps;
}

/** Where player k is at eased progress e of a step from snap a to b (curved runs use step.via). */
export function posAt(a, b, step, k, e) {
  const p0 = a.pos[k], p2 = b.pos[k], c = step && step.via && step.via[k];
  if (!c) return [p0[0] + (p2[0] - p0[0]) * e, p0[1] + (p2[1] - p0[1]) * e];
  const u = 1 - e;
  return [u * u * p0[0] + 2 * u * e * c[0] + e * e * p2[0], u * u * p0[1] + 2 * u * e * c[1] + e * e * p2[1]];
}

export const ballPos = (s, pos) => (s.ball.holder ? [pos[s.ball.holder][0] + 10, pos[s.ball.holder][1] - 10] : s.ball.point);
export const sameBall = (a, b) => (a.holder ? a.holder === b.holder : !!b.point && dist(a.point, b.point) < 1);
/** Who dribbles in a step: the ball stays with a player who moves. */
export const dribbler = (a, b) => (a.ball.holder && sameBall(a.ball, b.ball) && dist(a.pos[a.ball.holder], b.pos[a.ball.holder]) > 3 ? a.ball.holder : null);

// Kinds of ball movement. "pass" is the default.
export const SHOTS = {
  pass: { label: 'Пас', icon: '', hint: 'обычная передача' },
  lob: { label: 'Навес', icon: '⤴', hint: 'высокая передача над защитой (лоб, скип)' },
  shot: { label: 'Бросок', icon: '🏀', hint: 'бросок в кольцо: мяч летит в кольцо' },
};

/** Duration (ms) and 2D arc for a step, from how far the ball and players travel. */
export function timing(a, b, shot) {
  const ballMoved = !sameBall(a.ball, b.ball);
  const d = ballMoved ? dist(ballPos(a, a.pos), ballPos(b, b.pos)) : 0;
  let run = 0;
  for (const k of KEYS) run = Math.max(run, dist(a.pos[k], b.pos[k]));
  const runMs = 450 + run * 8.5;                 // about 4.5 m/s
  let ballMs = 0, arc = 0;
  if (ballMoved) {
    if (shot === 'shot') { ballMs = 1100 + d * 2; arc = clamp(d * 0.35, 40, 80); }
    else if (shot === 'lob') { ballMs = 900 + d * 4; arc = clamp(d * 0.3, 35, 70); }
    else { ballMs = 450 + d * 3.2; arc = clamp(d * 0.1, 6, 18); }
  }
  return { arc: Math.round(arc), dur: Math.round(clamp(Math.max(ballMs, runMs), 700, 3000)) };
}

export function stepArrows(a, b, step, opacity) {
  const list = [];
  const shot = (step && step.shot) || 'pass';
  const drib = dribbler(a, b);
  const screens = new Set((step && step.screens) || []);
  for (const k of KEYS) {
    if (dist(a.pos[k], b.pos[k]) <= 3) continue;
    const kind = k[0] === 'X' ? 'def' : screens.has(k) ? 'screen' : k === drib ? 'dribble' : 'cut';
    list.push({ from: a.pos[k], to: b.pos[k], via: step && step.via && step.via[k], kind, team: k[0], opacity });
  }
  if (!sameBall(a.ball, b.ball)) {
    const s = ballPos(a, a.pos), e = ballPos(b, b.pos);
    const side = e[0] > s[0] ? -1 : 1;
    const bend = shot === 'pass' ? 0 : side * (step.arc || 40) * 0.7;
    list.push({ from: s, to: e, kind: shot, bend, opacity });
  }
  return list;
}

/** Ball height (drawing units) at progress t of a step, for the 2D ball's "lift". */
export const ballLift = (t, arc) => Math.sin(Math.PI * t) * (arc || 10);

export function describeStep(step) {
  const parts = [];
  if (step.ball) {
    if (step.shot === 'shot') parts.push('🏀 бросок');
    else parts.push((step.shot === 'lob' ? '⤴ навес' : 'пас') + (step.ball.holder ? ' → ' + step.ball.holder : ' на пол'));
  }
  const runs = Object.keys(step.moves || {});
  const scr = (step.screens || []).filter((k) => runs.includes(k));
  if (scr.length) parts.push('заслон: ' + scr.join(', '));
  const rest = runs.filter((k) => !scr.includes(k));
  if (rest.length) parts.push('движение: ' + rest.join(', '));
  return parts.join(' · ');
}

// ---------- Drawing ----------

function el(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  for (const a in attrs) e.setAttribute(a, attrs[a]);
  return e;
}

/** Point and unit tangent at the end of a straight or curved path, trimmed by `s1` at the start and `s2` at the end. */
function trimmed(from, to, via, s1, s2) {
  if (!via) {
    const dx = to[0] - from[0], dy = to[1] - from[1], d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
    return { p0: [from[0] + ux * s1, from[1] + uy * s1], p2: [to[0] - ux * s2, to[1] - uy * s2], c: null, end: [ux, uy] };
  }
  const n0 = Math.hypot(via[0] - from[0], via[1] - from[1]) || 1, n2 = Math.hypot(to[0] - via[0], to[1] - via[1]) || 1;
  const t0 = [(via[0] - from[0]) / n0, (via[1] - from[1]) / n0], t2 = [(to[0] - via[0]) / n2, (to[1] - via[1]) / n2];
  return { p0: [from[0] + t0[0] * s1, from[1] + t0[1] * s1], p2: [to[0] - t2[0] * s2, to[1] - t2[1] * s2], c: via, end: t2 };
}
const pathD = (g) => (g.c ? `M${g.p0[0]} ${g.p0[1]} Q${g.c[0]} ${g.c[1]} ${g.p2[0]} ${g.p2[1]}` : `M${g.p0[0]} ${g.p0[1]} L${g.p2[0]} ${g.p2[1]}`);

/** Zig-zag along a straight or curved path (dribble). */
function zigzag(g) {
  const pts = [], n = 40;
  const at = (t) => {
    if (!g.c) return [g.p0[0] + (g.p2[0] - g.p0[0]) * t, g.p0[1] + (g.p2[1] - g.p0[1]) * t];
    const u = 1 - t;
    return [u * u * g.p0[0] + 2 * u * t * g.c[0] + t * t * g.p2[0], u * u * g.p0[1] + 2 * u * t * g.c[1] + t * t * g.p2[1]];
  };
  let len = 0;
  for (let i = 1; i <= n; i++) len += dist(at((i - 1) / n), at(i / n));
  const waves = Math.max(2, Math.round(len / 11));
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = at(t), q = at(Math.min(1, t + 0.01)), r = at(Math.max(0, t - 0.01));
    const dx = q[0] - r[0], dy = q[1] - r[1], d = Math.hypot(dx, dy) || 1;
    const amp = t > 0.88 ? 0 : 3.2 * Math.sin(t * waves * Math.PI * 2);
    pts.push(`${(p[0] - (dy / d) * amp).toFixed(1)} ${(p[1] + (dx / d) * amp).toFixed(1)}`);
  }
  return 'M' + pts.join(' L');
}

/**
 * Draw one frame.
 * scene = { pos, holder?, ballDraw?: {x,y,lift}, arrows?: [...], landing?: [x,y] }
 */
export function render(scene) {
  const al = document.getElementById('arrows');
  al.innerHTML = '';
  for (const ar of scene.arrows || []) {
    if (dist(ar.from, ar.to) < 6) continue;
    const op = ar.opacity ?? 1;
    const isBall = ar.kind === 'pass' || ar.kind === 'lob' || ar.kind === 'shot';
    if (isBall) {
      const dx = ar.to[0] - ar.from[0], dy = ar.to[1] - ar.from[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
      const via = ar.bend ? [(ar.from[0] + ar.to[0]) / 2 - uy * ar.bend, (ar.from[1] + ar.to[1]) / 2 + ux * ar.bend] : null;
      const g = trimmed(ar.from, ar.to, via, 7, ar.kind === 'shot' ? 4 : 9);
      const color = ar.kind === 'shot' ? '#d9881b' : PASS_COLOR;
      al.appendChild(el('path', {
        d: pathD(g), fill: 'none', stroke: color, 'stroke-width': ar.kind === 'shot' ? 2.4 : 1.7, 'stroke-linecap': 'round', opacity: op,
        'stroke-dasharray': ar.kind === 'pass' ? '5 4' : ar.kind === 'lob' ? '1.5 4' : 'none', 'marker-end': `url(#${ar.kind === 'shot' ? 'mShot' : 'mPass'})`,
      }));
      continue;
    }
    const g = trimmed(ar.from, ar.to, ar.via, 13, ar.kind === 'screen' ? 13 : 15);
    const color = COLORS[ar.team];
    if (ar.kind === 'screen') {
      al.appendChild(el('path', { d: pathD(g), fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round', opacity: op }));
      const [ux, uy] = g.end, px = -uy, py = ux, e = g.p2;
      al.appendChild(el('line', { x1: e[0] + px * 9, y1: e[1] + py * 9, x2: e[0] - px * 9, y2: e[1] - py * 9, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: op }));
    } else if (ar.kind === 'dribble') {
      al.appendChild(el('path', { d: zigzag(g), fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round', opacity: op, 'marker-end': 'url(#mO)' }));
    } else {
      const def = ar.kind === 'def';
      al.appendChild(el('path', {
        d: pathD(g), fill: 'none', stroke: color, 'stroke-width': def ? 1.5 : 1.9, 'stroke-linecap': 'round', opacity: op,
        ...(def ? { 'stroke-dasharray': '5 3.5' } : {}), 'marker-end': `url(#m${ar.team})`,
      }));
    }
  }

  // Players
  const pl = document.getElementById('players');
  pl.innerHTML = '';
  for (const key of KEYS) {
    const [x, y] = scene.pos[key];
    const g = el('g', { class: 'player', 'data-key': key, transform: `translate(${x} ${y})` });
    const c = COLORS[key[0]];
    if (scene.holder === key) g.appendChild(el('circle', { r: 17, fill: 'none', stroke: '#EF9F27', 'stroke-width': 2.6 }));
    g.appendChild(el('circle', { r: 13, fill: c, stroke: '#fff', 'stroke-width': 1.8, filter: 'url(#shadow)' }));
    const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': 11.5, 'font-weight': 700 });
    t.textContent = key;
    g.appendChild(t);
    pl.appendChild(g);
  }

  // Ball
  const bl = document.getElementById('ballLayer');
  bl.innerHTML = '';
  let bd = scene.ballDraw;
  if (!bd && scene.holder) { const [x, y] = scene.pos[scene.holder]; bd = { x: x + 10, y: y - 10, lift: 0 }; }
  if (bd) {
    const lift = bd.lift || 0, s = 1 + lift / 70;
    if (lift > 2) bl.appendChild(el('ellipse', { cx: bd.x, cy: bd.y, rx: 5, ry: 2.5, fill: '#000', opacity: 0.25 }));
    const g = el('g', { transform: `translate(${bd.x} ${bd.y - lift}) scale(${s})` });
    g.appendChild(el('circle', { r: 5.5, fill: '#EF9F27', stroke: '#854F0B', 'stroke-width': 0.9 }));
    g.appendChild(el('path', { d: 'M-5.5 0 L5.5 0 M0 -5.5 L0 5.5 M-3.6 -4 Q0 0 -3.6 4 M3.6 -4 Q0 0 3.6 4', stroke: '#854F0B', 'stroke-width': 0.6, fill: 'none' }));
    bl.appendChild(g);
  }

  // Ball lying on the floor (or in the ring after a shot)
  const fx = document.getElementById('fx');
  fx.innerHTML = '';
  if (scene.landing && dist(scene.landing, BASKET) < 4) {
    const g = el('g', { transform: `translate(${BASKET[0]} ${BASKET[1]})` });
    for (let i = 0; i < 8; i++) {
      const an = (i * Math.PI) / 4;
      g.appendChild(el('line', { x1: Math.cos(an) * 10, y1: Math.sin(an) * 10, x2: Math.cos(an) * 16, y2: Math.sin(an) * 16, stroke: '#d9881b', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    }
    fx.appendChild(g);
  }
}
