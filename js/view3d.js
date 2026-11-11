// 3D replay of a play: same play data as the 2D board, drawn with Three.js.
// Loaded only when someone presses "3D", so the 2D board stays fast.
//
// World units are metres. The court is centred on the origin: x along the court (Blue end −9 … Red end +9),
// z across it (−4.5 … +4.5), y up. 2D board units are 30 per metre with (0,0) at Blue's end-line corner.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const U = 340 / 15;             // drawing units per metre (same as js/core.js)
const RIM_H = 3.05;
const BALL_R = 0.12;
// Court: centre of the drawn half court at the origin; x across (−7.5 … 7.5), z towards the baseline (+6.4).
const toWorld = (p) => new THREE.Vector3((p[0] - 190) / U, 0, (p[1] - 165) / U);
const RIM = toWorld([190, 292]).setY(RIM_H);
const BOARD_Z = (300 - 165) / U;
const TEAM = { O: 0x534ab7, X: 0xd85a30 };
const KEYS = ['O1', 'O2', 'O3', 'O4', 'O5', 'X1', 'X2', 'X3', 'X4', 'X5'];

const CAMERAS = {
  tv: { pos: [0, 6.5, -13.5], target: [0, 1.2, 2.2] },
  corner: { pos: [-11, 6.5, -7], target: [0, 1, 2.5] },
  side: { pos: [13.5, 5, 1.5], target: [0, 1.2, 2] },
  base: { pos: [4.6, 4.4, 11.5], target: [0, 1.3, -1] },
  top: { pos: [0, 21, 0.6], target: [0, 0, 0.6] },
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function numberTexture(num, color, round) {
  return canvasTexture(128, 128, (g, w, h) => {
    if (round) {
      g.fillStyle = '#' + color.toString(16).padStart(6, '0');
      g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
      g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    }
    g.fillStyle = '#fff';
    g.font = `bold ${round ? 72 : 96}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), w / 2, h / 2 + 4);
  });
}

// ---------- Court ----------
function buildCourt(scene) {
  const wood = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#d9a86c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) {
      g.fillStyle = `hsl(32, ${45 + (i * 37) % 15}%, ${58 + ((i * 53) % 9) - 4}%)`;
      g.fillRect(i * (w / 32), 0, w / 32 - 1, h);
      for (let j = 0; j < 4; j++) { g.fillStyle = 'rgba(80,45,10,.18)'; g.fillRect(i * (w / 32), ((i * 97 + j * 131) % h), w / 32 - 1, 1.5); }
    }
  });
  wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
  wood.repeat.set(4, 4);
  const surround = new THREE.Mesh(new THREE.PlaneGeometry(40, 34), new THREE.MeshStandardMaterial({ color: 0x2f4f6f, roughness: 0.9 }));
  surround.rotation.x = -Math.PI / 2;
  surround.position.z = 2;
  surround.receiveShadow = true;
  scene.add(surround);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(15, 12.8), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  scene.add(floor);
  // Painted key
  const key = new THREE.Mesh(new THREE.PlaneGeometry(100 / U, 120 / U), new THREE.MeshStandardMaterial({ color: 0xb8673a, roughness: 0.6 }));
  key.rotation.x = -Math.PI / 2;
  key.position.set(0, 0.003, (250 - 165) / U);
  key.receiveShadow = true;
  scene.add(key);

  // Lines: a ribbon through points given in drawing units
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const W = 0.05;
  const ribbon = (pts, dashed = false) => {
    for (let i = 1; i < pts.length; i++) {
      if (dashed && i % 2) continue;
      const a = toWorld(pts[i - 1]), b = toWorld(pts[i]), len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.BoxGeometry(W, 0.004, len + W * 0.6), lineMat);
      m.position.copy(a).add(b).multiplyScalar(0.5).setY(0.005);
      m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      m.receiveShadow = true;
      scene.add(m);
    }
  };
  const arc = (cx, cy, r, a0, a1, n = 28) => Array.from({ length: n + 1 }, (_, i) => { const t = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; });
  const quad = (p0, c, p2, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n, u = 1 - t; return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p2[1]]; });
  ribbon([[20, 20], [360, 20], [360, 310], [20, 310], [20, 20]]);          // sidelines, baseline, centre line
  ribbon([[140, 310], [140, 190], [240, 190], [240, 310]]);                 // key
  ribbon(arc(190, 190, 50, Math.PI, 2 * Math.PI));                          // free-throw circle (top half)
  ribbon(arc(190, 190, 50, 0, Math.PI, 16), true);                          // … dashed inside the key
  ribbon([[40, 310], [40, 250], ...quad([40, 250], [190, 60], [340, 250]).slice(1), [340, 310]]);   // three-point line
  ribbon(arc(190, 20, 30, 0, Math.PI));                                     // centre circle

  // Basket: pole behind the baseline, arm, backboard, rim and net
  const pad = new THREE.MeshStandardMaterial({ color: 0x1f3b5c, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.5, roughness: 0.4 });
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.4, 0.22), pad);
  pole.position.set(0, 1.7, BOARD_Z + 1.3);
  pole.castShadow = true;
  scene.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.3), steel);
  arm.position.set(0, 3.3, BOARD_Z + 0.65);
  arm.castShadow = true;
  scene.add(arm);
  const boardTex = canvasTexture(360, 210, (g, w, h) => {
    g.fillStyle = 'rgba(235,242,248,0.55)'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.strokeStyle = '#d23b2a'; g.lineWidth = 8; g.strokeRect(w / 2 - 59 / 2 * 2, h - 30 - 90, 118, 90);
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.05, 0.03), new THREE.MeshStandardMaterial({ map: boardTex, transparent: true, roughness: 0.2 }));
  board.position.set(0, 2.9 + 0.525, BOARD_Z);
  board.castShadow = true;
  scene.add(board);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.017, 10, 40), new THREE.MeshStandardMaterial({ color: 0xe0561b, metalness: 0.3, roughness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.copy(RIM);
  rim.castShadow = true;
  scene.add(rim);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, BOARD_Z - RIM.z - 0.2), rim.material);
  bracket.position.set(0, RIM_H - 0.01, (BOARD_Z + RIM.z + 0.2) / 2 + 0.01);
  scene.add(bracket);
  const netTex = canvasTexture(128, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2;
    for (let x = -h; x < w + h; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h, h); g.stroke(); g.beginPath(); g.moveTo(x + h, 0); g.lineTo(x, h); g.stroke(); }
  });
  netTex.wrapS = THREE.RepeatWrapping;
  netTex.repeat.set(3, 1);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.15, 0.42, 20, 1, true),
    new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide }));
  net.position.set(RIM.x, RIM_H - 0.21, RIM.z);
  scene.add(net);
}

// ---------- Players ----------
// Articulated figures built in code: hips, knees, spine, shoulders, elbows and head all bend, so the motions
// below (ready stance, running, passes, overhand throws, spikes, rainbow lobs, catches) are made for catchball.
// Local axes: +Z is where the player faces, +Y is up.

const LOOKS = [
  { skin: 0xf1c7a3, hair: 0x2b1d14, style: 'short' }, { skin: 0xd9a77f, hair: 0x111111, style: 'short' },
  { skin: 0x8d5a3b, hair: 0x0d0d0d, style: 'short' }, { skin: 0xe8b98f, hair: 0x7a4a24, style: 'short' },
  { skin: 0xc68b62, hair: 0x1a1a1a, style: 'short' }, { skin: 0xf3d2b5, hair: 0xb98a3e, style: 'short' },
];

function capsule(r, len, mat) { return new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 5, 12), mat); }

function buildPlayer(key) {
  const color = TEAM[key[0]], num = key.slice(1);
  const look = LOOKS[(Number(num) + (key[0] === 'X' ? 3 : 0)) % LOOKS.length];
  const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.75 });
  const shirt = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 });
  const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.9 });
  const put = (mesh, parent, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

  const root = new THREE.Group();
  const pelvis = joint(root, 0, 0.95, 0);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.19, 0.24, 14), dark), pelvis, 0, -0.04, 0);   // shorts

  const hips = [], knees = [];
  for (const side of [-1, 1]) {
    const hip = joint(pelvis, 0.095 * side, -0.05, 0);
    put(capsule(0.07, 0.3, skin), hip, 0, -0.21, 0);                       // thigh
    const knee = joint(hip, 0, -0.43, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.11, 12), dark), knee, 0, -0.02, 0.012); // knee pad
    put(capsule(0.055, 0.3, skin), knee, 0, -0.2, 0);                      // shin
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.12, 10), white), knee, 0, -0.36, 0); // sock
    const shoe = put(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.25), white), knee, 0, -0.45, 0.05);
    shoe.material = white;
    hips.push(hip); knees.push(knee);
  }

  const spine = joint(pelvis, 0, 0.06, 0);
  const torso = put(capsule(0.165, 0.3, shirt), spine, 0, 0.27, 0);
  torso.scale.set(1.15, 1, 0.72);
  put(new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 10), skin), spine, 0, 0.6, 0); // neck
  const head = joint(spine, 0, 0.72, 0);
  const skull = put(new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin), head);
  skull.scale.set(0.95, 1.12, 1);
  const hair = put(new THREE.Mesh(new THREE.SphereGeometry(0.117, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat), head, 0, 0.012, -0.008);
  hair.scale.set(0.97, 1.12, 1.03);
  if (look.style === 'pony') { const t = put(capsule(0.035, 0.16, hairMat), head, 0, -0.03, -0.12); t.rotation.x = 0.35; }
  if (look.style === 'bun') put(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), hairMat), head, 0, 0.08, -0.1);
  for (const side of [-1, 1]) put(new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), dark), head, 0.038 * side, 0.02, 0.1); // eyes

  const shoulders = [], elbows = [], hands = [];
  for (const side of [-1, 1]) {
    const sh = joint(spine, 0.215 * side, 0.5, 0);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.058, 0.13, 10), shirt), sh, 0, -0.05, 0); // sleeve
    put(capsule(0.046, 0.2, skin), sh, 0, -0.15, 0);                        // upper arm
    const el = joint(sh, 0, -0.29, 0);
    put(capsule(0.04, 0.19, skin), el, 0, -0.13, 0);                        // forearm
    put(new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), skin), el, 0, -0.27, 0.01); // hand
    const hand = joint(el, 0, -0.29, 0.03);
    shoulders.push(sh); elbows.push(el); hands.push(hand);
  }

  const jersey = numberTexture(num, color, false);
  for (const [z, ry] of [[0.125, 0], [-0.125, Math.PI]]) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), new THREE.MeshBasicMaterial({ map: jersey, transparent: true }));
    plate.position.set(0, 0.3, z);
    plate.rotation.y = ry;
    spine.add(plate);
  }
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(num, color, true), depthTest: false }));
  label.scale.set(0.42, 0.42, 1);
  label.position.y = 2.4;
  label.renderOrder = 10;
  root.add(label);

  return {
    group: root, pelvis, spine, head, hips, knees, shoulders, elbows, hands, label,
    // body = what jumps (kept for the camera code)
    body: pelvis,
    yaw: key[0] === 'O' ? 0 : Math.PI, phase: Math.random() * 6, last: null, speed: 0, pose: null,
  };
}

// A pose is a set of joint angles (radians) plus how far the hips drop (crouch) or rise (jump).
const POSE_KEYS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shL', 'shR', 'abL', 'abR', 'elL', 'elR', 'spine', 'neck', 'drop', 'lift'];
const pose = (o) => Object.assign(Object.fromEntries(POSE_KEYS.map((k) => [k, 0])), o);
const mix = (a, b, w) => { const o = {}; for (const k of POSE_KEYS) o[k] = a[k] + (b[k] - a[k]) * w; return o; };
const both = (o, sh, el, ab = 0.12) => Object.assign(o, { shL: sh, shR: sh, elL: el, elR: el, abL: ab, abR: ab });

function readyPose(t) {
  const b = Math.sin(t * 2.2) * 0.03;
  return pose({ hipL: -0.45, hipR: -0.4, kneeL: 0.8 + b, kneeR: 0.75 + b, spine: 0.3, neck: -0.25, drop: 0.13 + b * 0.2,
    shL: -0.75, shR: -0.75, elL: -1.2, elR: -1.2, abL: 0.25, abR: 0.25 });
}
function runPose(ph, k) {
  const s = Math.sin(ph), c = Math.cos(ph);
  return pose({
    hipL: -s * 0.8 * k - 0.15, hipR: s * 0.8 * k - 0.15,
    kneeL: (0.35 + Math.max(0, c) * 1.1) * k + 0.2, kneeR: (0.35 + Math.max(0, -c) * 1.1) * k + 0.2,
    shL: s * 0.7 * k, shR: -s * 0.7 * k, elL: -1.4, elR: -1.4, abL: 0.12, abR: 0.12,
    spine: 0.15 + 0.15 * k, neck: -0.1, drop: 0.05 + Math.abs(c) * 0.04 * k,
  });
}
const holdPose = (p) => both(Object.assign({}, p), -0.95, -1.35, 0.2);
const catchHigh = (p) => both(Object.assign({}, p, { neck: -0.45 }), -2.85, -0.25, 0.25);
const catchMid = (p) => both(Object.assign({}, p, { neck: -0.15 }), -1.35, -0.5, 0.22);
function overhandThrow(p, u) {          // right arm; u: 0 wind-up … 0.45 cocked … 0.6 release (arm straight up) … 1 follow-through
  const o = Object.assign({}, p);
  if (u < 0.45) { const w = smooth(u / 0.45); o.shR = -1.0 - 2.1 * w; o.elR = -0.6 - 1.3 * w; o.shL = -1.2 - 1.2 * w; o.elL = -0.3; o.spine = 0.1 - 0.35 * w; }
  else if (u < 0.6) { const w = smooth((u - 0.45) / 0.15); o.shR = -3.1 + 0.25 * w; o.elR = -1.9 + 1.9 * w; o.shL = -2.4 + 0.6 * w; o.elL = -0.3; o.spine = -0.25 + 0.15 * w; }
  else { const w = (u - 0.6) / 0.4; o.shR = -2.85 + 2.15 * w; o.elR = 0; o.shL = -1.8 + 1.0 * w; o.elL = -0.3; o.spine = -0.1 + 0.6 * w; }
  o.abL = 0.15; o.abR = 0.06;
  return o;
}
function chestPass(p, u) {               // two hands from the chest, pushed out
  const w = smooth(Math.min(1, u / 0.7));
  return both(Object.assign({}, p), -0.9 - 0.6 * w, -1.5 + 1.4 * w, 0.2);
}
function rainbowLob(p, u) {              // two hands swung from the hips up over the head, legs extending
  const w = smooth(Math.min(1, u / 0.75));
  const o = both(Object.assign({}, p), -0.4 - 2.4 * w, -0.5 + 0.4 * w, 0.18);
  o.kneeL = o.kneeR = 0.9 * (1 - w) + 0.1; o.hipL = o.hipR = -0.5 * (1 - w); o.drop = 0.18 * (1 - w); o.spine = 0.35 - 0.45 * w;
  return o;
}
const blockPose = (p) => both(Object.assign({}, p, { neck: -0.2, spine: 0.05 }), -2.95, -0.1, 0.12);
function jumpLegs(o, h) { o.kneeL = o.kneeR = 0.3 + h * 0.9; o.hipL = o.hipR = -0.2 - h * 0.6; o.lift = h * 0.6; o.drop = 0; return o; }

function applyPose(p, q, dt, exact) {
  // Ease towards the target pose so changes look natural (throws follow their timing exactly)
  p.pose = p.pose && !exact ? mix(p.pose, q, Math.min(1, dt * 16)) : q;
  const o = p.pose;
  p.hips[0].rotation.x = o.hipL; p.hips[1].rotation.x = o.hipR;
  p.knees[0].rotation.x = o.kneeL; p.knees[1].rotation.x = o.kneeR;
  p.shoulders[0].rotation.set(o.shL, 0, -o.abL); p.shoulders[1].rotation.set(o.shR, 0, o.abR);
  p.elbows[0].rotation.x = o.elL; p.elbows[1].rotation.x = o.elR;
  p.spine.rotation.x = o.spine; p.head.rotation.x = o.neck;
  p.pelvis.position.y = 0.95 - o.drop + o.lift;
}

const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- Kits (uniforms) ----------
// Basketball kit painted in a shader from each point's rest-pose position: body part (from the skeleton) +
// height decide skin / tank top / long shorts / socks, with white trim down the sides. Skin keeps the model's
// own texture (face, hands), tinted per player.

const DEFAULT_KITS = {
  O: { jersey: '#534AB7', trim: '#ffffff', number: '#ffffff', label: '#534AB7', shoes: '#f4f4f4', accent: '#534AB7' },
  X: { jersey: '#D85A30', trim: '#ffffff', number: '#ffffff', label: '#D85A30', shoes: '#1d1d1f', accent: '#D85A30' },
};
const SKIN_TONES = ['#e9bc98', '#8d5a3b', '#c68b62', '#f1c7a3', '#5e3a24', '#d29a73', '#a8704a', '#f5d6bd', '#7a4a2e', '#e0ac85'];
// Average colour of the skin texture (linear), used to tint it to each player's tone
const TEX_SKIN = [0.378, 0.177, 0.083];
// Hair meshes in player.glb: hair_buzz, hair_short (a short parted cut), beard
const HAIR = [
  { color: '#1c1714', style: 'buzz', beard: false }, { color: '#3b2616', style: 'short', beard: true },
  { color: '#0f0e0d', style: 'buzz', beard: true }, { color: '#6b4a2b', style: 'short', beard: false },
  { color: '#141210', style: 'short', beard: false }, { color: '#2a1d14', style: 'buzz', beard: false },
  { color: '#8a5a2a', style: 'short', beard: true }, { color: '#111111', style: 'buzz', beard: false },
  { color: '#4a3220', style: 'short', beard: false }, { color: '#1a1512', style: 'buzz', beard: true },
];
// Body parts by bone: 0 head/neck, 1 torso, 2 arm/hand, 3 thigh, 4 calf, 5 foot
function partOf(bone) {
  if (/^(Head|neck)/.test(bone)) return 0;
  if (/^(spine|clavicle|pelvis|root)/.test(bone)) return 1;
  if (/^(thigh)/.test(bone)) return 3;
  if (/^(calf)/.test(bone)) return 4;
  if (/^(foot|ball)/.test(bone)) return 5;
  return 2;
}
// Rest-pose heights on the model (metres, before scaling): shoulders, waistband, shorts hem (above the knee), socks
const Y = { jerseyTop: 1.52, jerseyBottom: 1.0, shortsCut: 0.6, sock: 0.24 };

/** Adds an `aPart` attribute (body part per vertex) to each skinned geometry, once. */
function tagParts(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isSkinnedMesh || o.geometry.getAttribute('aPart')) return;
    const J = o.geometry.getAttribute('skinIndex'), W = o.geometry.getAttribute('skinWeight');
    const parts = new Float32Array(J.count);
    for (let i = 0; i < J.count; i++) {
      let best = 0, bw = -1;
      for (let c = 0; c < 4; c++) { const w = W.getComponent(i, c); if (w > bw) { bw = w; best = J.getComponent(i, c); } }
      parts[i] = partOf(o.skeleton.bones[best].name);
    }
    o.geometry.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
  });
}

function kitMaterial(kit, skin, seed, map) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, map });
  const C = (c) => ({ value: new THREE.Color(c) });
  const tone = new THREE.Color(skin);
  const u = {
    uTop: C(kit.jersey), uTrim: C(kit.trim || '#ffffff'), uSock: C('#f2f2f0'),
    uSkin: { value: new THREE.Color(tone.r / TEX_SKIN[0], tone.g / TEX_SKIN[1], tone.b / TEX_SKIN[2]) }, uSeed: { value: seed },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nflat varying float vPart;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;\nvRest = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTop, uTrim, uSock, uSkin; uniform float uSeed;
flat varying float vPart; varying vec3 vRest;
// Kit colour with a white stripe down each side (and a band at the jersey hem)
vec3 kitColor(vec3 p, bool shorts) {
  float a = abs(atan(p.x, p.z));                       // 0 = front, pi = back, pi/2 = sides
  if (abs(a - 1.5708) < (shorts ? 0.16 : 0.12)) return uTrim;
  if (!shorts && p.y < ${Y.jerseyBottom.toFixed(2)} + 0.035) return uTrim;
  if (shorts && p.y < ${Y.shortsCut.toFixed(2)} + 0.03) return mix(uTop, uTrim, 0.85);
  return uTop;
}`)
      .replace('#include <map_fragment>', `
float part = floor(vPart + 0.5);
vec3 kc = vec3(0.0);   // (0,0,0) = skin
if (part < 0.5) kc = vec3(0.0);
else if (part < 1.5) kc = kitColor(vRest, vRest.y < ${Y.jerseyBottom.toFixed(2)});
else if (part < 2.5) kc = vec3(0.0);
else if (part < 3.5) kc = vRest.y > ${Y.shortsCut.toFixed(2)} ? kitColor(vRest, true) : vec3(0.0);
else if (part < 4.5) kc = vRest.y < ${Y.sock.toFixed(2)} ? uSock : vec3(0.0);
else kc = uSock;
vec4 sampledDiffuseColor = texture2D( map, vMapUv );
diffuseColor.rgb = dot(kc, vec3(1.0)) > 0.0 ? kc : sampledDiffuseColor.rgb * uSkin;`);
  };
  m.customProgramCacheKey = () => 'bkit-v1';
  return m;
}

function numberTex(num, fill, outline) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 200px system-ui, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (outline) { g.lineWidth = 14; g.strokeStyle = outline; g.lineJoin = 'round'; g.strokeText(num, w / 2, h / 2 + 10); }
    g.fillStyle = fill; g.fillText(num, w / 2, h / 2 + 10);
  });
}
function decal(tex, w, h) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: tex, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2,
  }));
}

/** Put the kit, hair, numbers and sneakers on a freshly cloned player (still in its rest pose). */
function dressRig(model, bones, key, kits, scale) {
  const team = key[0], num = key.slice(1), kit = kits[team] || DEFAULT_KITS[team];
  const idx = Number(num) - 1 + (team === 'X' ? 5 : 0);
  const hair = HAIR[idx % HAIR.length];
  let body = null;
  const hairMeshes = {};
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (/^SuperHero/i.test(o.name)) body = o;
    else if (/^hair_|^beard$/.test(o.name)) hairMeshes[o.name] = o;
  });
  body.material = kitMaterial(kit, SKIN_TONES[idx % SKIN_TONES.length], team === 'O' ? 1.3 : 4.7, body.material.map);
  const hc = new THREE.Color(hair.color);
  const hairMat = (src) => new THREE.MeshStandardMaterial({ map: src.map, color: hc.clone().multiplyScalar(3.2), roughness: 0.8, side: THREE.DoubleSide });
  for (const [name, m] of Object.entries(hairMeshes)) {
    m.visible = name === 'hair_' + hair.style || (name === 'beard' && hair.beard);
    if (m.visible) m.material = hairMat(m.material);
  }
  model.traverse((o) => { if (o.isSkinnedMesh && o.name === 'Eyebrows') o.material = hairMat(o.material); });
  model.updateMatrixWorld(true);

  // Chest / back surface near the centre line at a given rest-pose height
  const P = body.geometry.getAttribute('position');
  const surface = (y0, y1) => {
    let back = 0, front = 0;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (Math.abs(x) < 0.06 && y > y0 && y < y1) { back = Math.min(back, z); front = Math.max(front, z); }
    }
    return { back, front };
  };
  const attachAt = (obj, bone, x, y, z, ry = 0, rx = 0) => {
    const wp = body.localToWorld(new THREE.Vector3(x, y, z));
    model.add(obj);
    obj.position.copy(model.worldToLocal(wp));
    obj.rotation.set(rx, ry, 0);
    obj.updateMatrixWorld(true);
    bone.attach(obj);   // keep the placement, then follow the bone
  };
  const spine = bones.spine_03 || bones.spine_02;
  if (spine) {
    attachAt(decal(numberTex(num, kit.number, null), 0.26 / scale, 0.26 / scale), spine, 0, 1.28, surface(1.18, 1.38).back - 0.01, Math.PI);
    attachAt(decal(numberTex(num, kit.number, null), 0.16 / scale, 0.16 / scale), spine, 0, 1.2, surface(1.12, 1.28).front + 0.008, 0, -0.06);
  }
  // Sneakers: the back half follows the foot bone, the toe box the toe bone (so it bends when running)
  if (bones.foot_l && bones.ball_l) {
    const upper = new THREE.MeshStandardMaterial({ color: kit.shoes || '#f1f1f1', roughness: 0.55 });
    const sole = new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: kit.accent || kit.label || '#333', roughness: 0.5 });
    const box = (w, h, l, r, mat) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 3, r), mat); m.castShadow = true; return m; };
    for (const side of [1, -1]) {
      const sfx = side > 0 ? '_l' : '_r', x = 0.134 * side;
      attachAt(box(0.13, 0.032, 0.21, 0.012, sole), bones['foot' + sfx], x, 0.004, -0.055);
      attachAt(box(0.126, 0.115, 0.195, 0.036, upper), bones['foot' + sfx], x, 0.068, -0.055);    // high-top
      attachAt(box(0.132, 0.05, 0.07, 0.02, accent), bones['foot' + sfx], x, 0.06, -0.12);         // heel counter
      attachAt(box(0.006, 0.035, 0.1, 0.003, accent), bones['foot' + sfx], x + 0.064 * side, 0.055, -0.03);   // side stripe
      attachAt(box(0.124, 0.032, 0.125, 0.012, sole), bones['ball' + sfx], x - 0.004 * side, 0.004, 0.08);
      attachAt(box(0.118, 0.06, 0.125, 0.028, upper), bones['ball' + sfx], x - 0.004 * side, 0.036, 0.076);
    }
  }
  return kit;
}

// ---------- Rigged players ----------
// Character: Quaternius "Universal Base Characters" (female body + hairstyles, CC0); motion-captured clips:
// Quaternius "Universal Animation Library" (CC0), retargeted onto the same skeleton in assets/player.glb.
// Legs and body come from the clips (idle, jog, sprint, jump); the arms are aimed in code for holding,
// passing, throwing, spiking and catching, because the library has no ball-handling animations.

// Arm directions in the player's own space (+Z forward, +X = the player's left, +Y up), for the LEFT arm.
// The right arm mirrors X. `up` = upper arm (shoulder → elbow), `fore` = forearm (elbow → wrist).
const ARM = {
  hold: { up: [0.25, -0.75, 0.6], fore: [-0.45, 0.15, 0.88] },
  // Waiting stance: elbows low by the body, forearms forward, hands in front of the chest (ready to catch)
  // (with the body leaning forward: upper arms forward-down, forearms reaching out, hands at waist height)
  // elbows bent ~90°: upper arms forward-down, forearms forward-up and turned in, palms open towards the ball
  // and tilted in towards each other
  ready: { up: [0.16, -0.8, 0.58], fore: [-0.14, 0.45, 0.88], palm: [-0.6, 0.6, 0.3] },
  // Block: both arms straight up and slightly forward over the net
  block: { up: [0.16, 0.95, 0.27], fore: [0.04, 0.95, 0.32] },
  high: { up: [0.3, 0.9, 0.3], fore: [0.15, 0.95, 0.25] },
  mid: { up: [0.2, -0.25, 0.95], fore: [-0.15, 0.15, 1], palm: [-0.2, 0.6, 0.77] },
  passEnd: { up: [0.12, -0.05, 1], fore: [0, 0, 1] },
  lobLow: { up: [0.15, -0.95, 0.3], fore: [-0.25, -0.6, 0.75] },
  lobUp: { up: [0.15, 0.97, 0.25], fore: [0.05, 1, 0.15] },
  cocked: { up: [0.5, 0.8, -0.15], fore: [0.1, 0.6, -0.8] },
  reach: { up: [0.1, 0.97, 0.2], fore: [0.05, 0.97, 0.25] },
  follow: { up: [0.1, -0.5, 0.85], fore: [0, -0.8, 0.6] },
  // Free arm during a one-handed throw: points forward at the target, then drops
  guideUp: { up: [0.32, 0.2, 0.93], fore: [0.08, 0.3, 0.95] },
  guideDown: { up: [0.25, -0.85, 0.45], fore: [0.05, -0.6, 0.8] },
  // Carrying the ball in one hand before a serve or spike (right arm), free arm relaxed in front
  carry: { up: [0.35, -0.55, 0.75], fore: [0.1, 0.6, 0.8] },
  relaxed: { up: [0.3, -0.75, 0.6], fore: [0.0, -0.2, 1] },
  // Basketball
  dribble: { up: [0.3, -0.88, 0.37], fore: [0.12, -0.72, 0.68], palm: [0, -1, 0] },     // right arm pushes the ball down
  shield: { up: [0.45, -0.55, 0.7], fore: [0.05, 0.1, 1] },                           // free arm out front
  setR: { up: [0.12, 0.55, 0.83], fore: [-0.05, 0.98, -0.15] },                        // shooting hand under the ball, above the eyes
  setL: { up: [0.4, 0.45, 0.8], fore: [-0.45, 0.8, 0.4] },                             // guide hand on the side of the ball
  flick: { up: [0.08, 0.88, 0.47], fore: [0.0, 0.7, 0.72] },                           // release and follow-through
  screen: { up: [0.2, -0.9, 0.38], fore: [-0.78, 0.42, 0.46] },                        // arms crossed over the chest
  defense: { up: [0.82, -0.3, 0.48], fore: [0.42, 0.62, 0.66], palm: [0.2, 0.2, 1] },  // wide, active hands
  contest: { up: [0.12, 0.96, 0.25], fore: [0.05, 0.98, 0.2] },
};
const nlerp = (a, b, t) => { const v = a.map((x, i) => x + (b[i] - x) * t); const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const armMix = (a, b, t) => ({ up: nlerp(a.up, b.up, t), fore: nlerp(a.fore, b.fore, t) });

const _n = new THREE.Vector3(), _m = new THREE.Vector3(), _c = new THREE.Vector3(), _fa = new THREE.Vector3();
/** Turn the forearm and wrist about the forearm's own axis so the palm faces `want` (world). side: 1 left, −1 right. */
function turnPalm(B, sfx, side, want, w) {
  const low = B['lowerarm' + sfx], hand = B['hand' + sfx], mid = B['middle_01' + sfx], ix = B['index_01' + sfx], pk = B['pinky_01' + sfx];
  if (!low || !hand || !mid || !ix || !pk) return;
  low.getWorldPosition(_a); hand.getWorldPosition(_b);
  _fa.copy(_b).sub(_a).normalize();                                   // forearm axis
  mid.getWorldPosition(_m).sub(_b);                                   // along the hand
  ix.getWorldPosition(_c); pk.getWorldPosition(_n); _c.sub(_n);       // across, towards the thumb
  _n.crossVectors(_m, _c).multiplyScalar(side);                       // palm normal (rest pose: palms down)
  _n.addScaledVector(_fa, -_n.dot(_fa)).normalize();
  _m.copy(want).addScaledVector(_fa, -want.dot(_fa)).normalize();
  const ang = Math.atan2(_fa.dot(_c.crossVectors(_n, _m)), _n.dot(_m));
  rotateWorld(low, _fa, ang * 0.6 * w);    // most of the turn in the forearm, the rest at the wrist
  rotateWorld(hand, _fa, ang * 0.4 * w);
}

/** Which way each arm should point for an action ({ hold, throwKind, a, catchHigh, catchW }). */
function armTargets(act) {
  if (act.throwKind === 'shot') {
    const a = act.a;   // 0 … 0.6 ball raised to the set point, 0.6 … 1 release and follow-through
    const R = a < 0.6 ? armMix(ARM.hold, ARM.setR, smooth(a / 0.6)) : armMix(ARM.setR, ARM.flick, smooth(Math.min(1, (a - 0.6) / 0.25)));
    const L = a < 0.6 ? armMix(ARM.hold, ARM.setL, smooth(a / 0.6)) : armMix(ARM.setL, ARM.relaxed, smooth(Math.min(1, (a - 0.65) / 0.35)));
    return { L, R, w: 1 };
  }
  if (act.throwKind === 'lob') {
    const a = act.a;
    const arm = a < 0.25 ? armMix(ARM.hold, ARM.lobUp, smooth(a / 0.25)) : armMix(ARM.lobUp, ARM.passEnd, smooth(Math.min(1, (a - 0.6) / 0.4)));
    return { L: arm, R: arm, w: 1 };
  }
  if (act.throwKind === 'pass') { const arm = armMix(ARM.hold, ARM.passEnd, smooth(Math.min(1, act.a / 0.7))); return { L: arm, R: arm, w: 1 }; }
  if (act.blockW > 0.01) return { L: ARM.contest, R: ARM.contest, w: act.blockW };
  if (act.catchW > 0) { const arm = act.catchHigh ? ARM.high : ARM.mid; return { L: arm, R: arm, w: act.catchW }; }
  if (act.dribble) return { L: ARM.shield, R: ARM.dribble, w: 1 };
  if (act.hold) return { L: ARM.hold, R: ARM.hold, w: 1 };
  if (act.role === 'screen') return { L: ARM.screen, R: ARM.screen, w: act.standW };
  if (act.role === 'def') return { L: ARM.defense, R: ARM.defense, w: act.standW };
  return null;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
/** Rotate `bone` so that the direction bone → child points along `dirWorld`, blended by w. */
function aimBone(bone, child, dirWorld, w) {
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q1.setFromUnitVectors(cur, dirWorld);
  bone.getWorldQuaternion(_q2);
  const targetWorld = _q1.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3);
  const local = _q3.invert().multiply(targetWorld);
  bone.quaternion.slerp(local, w);
  bone.updateMatrixWorld(true);
}

function numberLabelTexture(num, color) {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = color;
    g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2); g.fill();
    g.lineWidth = 8; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.font = `bold ${String(num).length > 1 ? 52 : 72}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(num), w / 2, h / 2 + 4);
  });
}

const RIG_CLIPS = ['Idle_Loop', 'Crouch_Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop'];

function buildRig(gltf, key, label, kits) {
  const model = SkeletonUtils.clone(gltf.scene);
  const bones = {};
  model.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  // Heights vary a little: guards smaller, bigs taller
  const sc = 1.0 + ([0, -0.03, 0.0, 0.01, 0.04, 0.05][Number(key[1])] || 0);
  model.scale.setScalar(sc);
  const kit = dressRig(model, bones, key, kits, sc);
  // Number label above the head in the kit's colour
  label.material.map = numberLabelTexture(key, kit.label || '#333');
  label.material.needsUpdate = true;
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(model);
  group.add(inner);
  // Make the model face +Z (its left hand on +X), whatever way it was exported
  model.updateMatrixWorld(true);
  if (bones.hand_l && bones.hand_l.getWorldPosition(new THREE.Vector3()).x < 0) model.rotation.y = Math.PI;
  group.add(label);
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const name of RIG_CLIPS) {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) continue;
    const act = mixer.clipAction(clip);
    act.play();
    act.setEffectiveWeight(name === 'Idle_Loop' ? 1 : 0);
    act.time = Math.random() * clip.duration;   // players don't move in sync
    actions[name] = act;
  }
  return { group, inner, model, bones, mixer, actions, weights: {}, armW: 0 };
}

// Waiting stance (as catchball players stand): hips back and low, chest well forward over the knees,
// feet wider than the shoulders, head up. Built on top of the idle clip: the hips are lowered and pushed
// back, the back hinges forward, the head looks up again, and the legs are re-solved so the feet stay put.
const STANCES = {
  idle: { drop: 0.03, back: 0.02, pelvis: 0.1, spine: 0.04, neck: -0.07, head: -0.08, wide: -0.03 },   // offense without the ball
  hold: { drop: 0.09, back: 0.05, pelvis: 0.26, spine: 0.08, neck: -0.16, head: -0.2, wide: 0.02 },    // triple threat
  def: { drop: 0.16, back: 0.08, pelvis: 0.32, spine: 0.08, neck: -0.2, head: -0.24, wide: 0.13 },     // low, wide defensive stance
  screen: { drop: 0.07, back: 0.0, pelvis: 0.08, spine: 0.0, neck: -0.04, head: -0.04, wide: 0.1 },     // set, wide base
};
const _ax = new THREE.Vector3(), _fw = new THREE.Vector3(), _h = new THREE.Vector3(), _k = new THREE.Vector3(), _t = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function rotateWorld(bone, axis, angle) {
  _qa.setFromAxisAngle(axis, angle);
  bone.getWorldQuaternion(_qp);
  _qp.premultiply(_qa);
  bone.parent.getWorldQuaternion(_q3);
  bone.quaternion.copy(_q3.invert().multiply(_qp));
  bone.updateMatrixWorld(true);
}
/** Two-bone leg: hip → knee → ankle reaching `target`, knee pointing along `fwd`. */
function solveLeg(thigh, calf, foot, target, fwd, side, w) {
  thigh.getWorldPosition(_h); calf.getWorldPosition(_k); foot.getWorldPosition(_t);
  const l1 = _h.distanceTo(_k), l2 = _k.distanceTo(_t);
  const toT = target.clone().sub(_h); const d = Math.min(toT.length(), l1 + l2 - 1e-4); toT.normalize();
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // bend direction: forward and a little out, made perpendicular to the hip → ankle line
  const bend = fwd.clone().addScaledVector(_ax, 0.2 * side).addScaledVector(toT, -fwd.dot(toT)).normalize();
  const knee = _h.clone().addScaledVector(toT, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const ankle = _h.clone().addScaledVector(toT, d);
  aimBone(thigh, calf, knee.clone().sub(_h).normalize(), w);
  calf.getWorldPosition(_k);
  aimBone(calf, foot, ankle.sub(_k).normalize(), w);
}

function updateRig(p, act, dt) {
  const r = p.rig;
  // Clip weights: athletic stance (idle + a little crouch) → jog → sprint, or in the air
  const s = p.speed;
  const run = smooth(Math.min(1, Math.max(0, (s - 0.5) / 1.5)));
  const sprint = smooth(Math.min(1, Math.max(0, (s - 4) / 1.5)));
  const air = act.jumpH > 0.05 ? 1 : 0;
  act.standW = (1 - run) * (1 - air);   // stance arms while standing, natural swing while running
  const target = {
    Idle_Loop: (1 - run) * 0.88 * (1 - air), Crouch_Idle_Loop: (1 - run) * 0.12 * (1 - air),
    Jog_Fwd_Loop: run * (1 - sprint) * (1 - air), Sprint_Loop: run * sprint * (1 - air), Jump_Loop: air,
  };
  for (const name in r.actions) {
    r.weights[name] = approach(r.weights[name] ?? (name === 'Idle_Loop' ? 1 : 0), target[name] || 0, 10, dt);
    r.actions[name].setEffectiveWeight(r.weights[name]);
  }
  if (r.actions.Jog_Fwd_Loop) r.actions.Jog_Fwd_Loop.timeScale = Math.max(0.6, s / 3.2);
  if (r.actions.Sprint_Loop) r.actions.Sprint_Loop.timeScale = Math.max(0.8, s / 5.5);
  r.mixer.update(dt);
  r.inner.position.set(0, act.jumpH * 0.6, 0);
  p.group.updateMatrixWorld(true);

  // Stance by role, faded out when running, jumping, throwing or reaching high
  const busy = act.throwKind || act.blockW > 0.01 || (act.catchW > 0 && act.catchHigh);
  const role = act.hold && !act.dribble ? 'hold' : act.role;
  r.stanceW = approach(r.stanceW || 0, (1 - run) * (1 - air) * (busy ? 0.15 : 1), busy ? 9 : 5, dt);
  r.stance = r.stance || { ...STANCES.idle };
  for (const k in STANCES.idle) r.stance[k] = approach(r.stance[k], STANCES[role][k], 6, dt);
  const STANCE = r.stance;
  const w = r.stanceW, RB = r.bones;
  if (w > 0.01 && RB.pelvis && RB.spine_01 && RB.thigh_l) {
    const feet = [['_l', 1], ['_r', -1]].map(([sfx, side]) => {
      const f = RB['foot' + sfx];
      return { sfx, side, pos: f.getWorldPosition(new THREE.Vector3()), q: f.getWorldQuaternion(new THREE.Quaternion()) };
    });
    _ax.set(1, 0, 0).applyQuaternion(p.group.quaternion);    // player's left
    _fw.set(0, 0, 1).applyQuaternion(p.group.quaternion);    // player's forward
    r.inner.position.y -= STANCE.drop * w;
    r.inner.position.z -= STANCE.back * w;
    r.inner.updateMatrixWorld(true);
    rotateWorld(RB.pelvis, _ax, STANCE.pelvis * w);
    rotateWorld(RB.spine_01, _ax, STANCE.spine * w);
    if (RB.neck_01) rotateWorld(RB.neck_01, _ax, STANCE.neck * w);
    if (RB.Head) rotateWorld(RB.Head, _ax, STANCE.head * w);
    for (const f of feet) {
      const target = f.pos.clone().addScaledVector(_ax, STANCE.wide * w * f.side);
      solveLeg(RB['thigh' + f.sfx], RB['calf' + f.sfx], RB['foot' + f.sfx], target, _fw, f.side, 1);
      const foot = RB['foot' + f.sfx];                         // keep the foot flat as it was
      foot.parent.getWorldQuaternion(_q3);
      foot.quaternion.copy(_q3.invert().multiply(f.q));
      foot.updateMatrixWorld(true);
    }
  }

  // Arms on top of the animation
  const tgt = armTargets(act);
  r.armW = approach(r.armW, tgt ? tgt.w : 0, act.throwKind || act.blockW ? 40 : 12, dt);
  if (r.armW < 0.01 || !tgt) return;
  const B = r.bones;
  for (const [side, arm, up, low, hand] of [[1, tgt.L, B.upperarm_l, B.lowerarm_l, B.hand_l], [-1, tgt.R, B.upperarm_r, B.lowerarm_r, B.hand_r]]) {
    if (!arm || !up || !low || !hand) continue;
    _d.set(arm.up[0] * side, arm.up[1], arm.up[2]).applyQuaternion(p.group.quaternion).normalize();
    aimBone(up, low, _d.clone(), r.armW);
    _d.set(arm.fore[0] * side, arm.fore[1], arm.fore[2]).applyQuaternion(p.group.quaternion).normalize();
    aimBone(low, hand, _d.clone(), r.armW);
    if (arm.palm) turnPalm(B, side > 0 ? '_l' : '_r', side, new THREE.Vector3(arm.palm[0] * side, arm.palm[1], arm.palm[2]).applyQuaternion(p.group.quaternion), r.armW);
  }
}

// ---------- Public API ----------
export function create(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18212c);
  scene.fog = new THREE.Fog(0x18212c, 30, 60);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-6, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 9, bottom: -9, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  buildCourt(scene);

  const players = {};
  for (const k of KEYS) { players[k] = buildPlayer(k); scene.add(players[k].group); }

  // Swap in the mannequin players once their model has loaded (the simple figures stay if it fails)
  const modelUrl = new URL('../assets/player.glb' + new URL(import.meta.url).search, import.meta.url);
  const kitsUrl = new URL('../assets/kits.json' + new URL(import.meta.url).search, import.meta.url);
  const kitsReady = fetch(kitsUrl).then((r) => (r.ok ? r.json() : DEFAULT_KITS)).catch(() => DEFAULT_KITS);
  new GLTFLoader().load(modelUrl.href, async (gltf) => {
    const kits = await kitsReady;
    tagParts(gltf);
    for (const k of KEYS) {
      const old = players[k];
      const rig = buildRig(gltf, k, old.label, kits);
      rig.group.position.copy(old.group.position);
      scene.remove(old.group);
      scene.add(rig.group);
      Object.assign(old, { group: rig.group, rig });
      old.group.visible = !(camMode === 'p:' + k);
    }
  }, undefined, (err) => console.warn('3D players: using simple figures', err));

  const ballTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#d9772b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2); }
    g.strokeStyle = '#1a1210'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    for (const x of [w / 4, (3 * w) / 4]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (const x of [0, w / 2]) { g.beginPath(); g.ellipse(x + w / 4, h / 2, w / 6, h / 2, 0, 0, Math.PI * 2); g.stroke(); }
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 28, 18), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.7 }));
  ball.castShadow = true;
  scene.add(ball);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.position.y = 0.008;
  scene.add(ballShadow);

  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 120);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 3;
  controls.maxDistance = 45;
  let camMode = 'tv', camAnim = null;

  function setCamera(name) {
    camMode = name;
    const isPlayer = name.startsWith('p:');
    controls.enabled = !isPlayer;
    for (const k of KEYS) { players[k].group.visible = true; players[k].label.visible = true; players[k].label.scale.set(0.42, 0.42, 1); }
    if (isPlayer) { players[name.slice(2)].group.visible = false; camAnim = null; return; } // hide your own body
    const c = CAMERAS[name] || CAMERAS.tv;
    camAnim = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: new THREE.Vector3(...c.pos), toTarget: new THREE.Vector3(...c.target) };
  }
  camera.position.set(...CAMERAS.tv.pos);
  controls.target.set(...CAMERAS.tv.target);

  // Latest frame from the app:
  // { pos, holder, step, screens: [keys], dribble: key|null, flight: { from, to, t, arc, shot } | null, rest: [x,y] | null }
  let frame = null;
  let release = null;            // where the ball left the passer's hands, per step

  const fwd = (p, d) => new THREE.Vector3(Math.sin(p.yaw) * d, 0, Math.cos(p.yaw) * d);
  const right = (p, d) => new THREE.Vector3(-Math.cos(p.yaw) * d, 0, Math.sin(p.yaw) * d);
  const handsMid = (p) => {
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    if (p.rig) { p.rig.bones.hand_l.getWorldPosition(a); p.rig.bones.hand_r.getWorldPosition(b); return a.add(b).multiplyScalar(0.5).add(fwd(p, 0.1)); }
    p.hands[0].getWorldPosition(a); p.hands[1].getWorldPosition(b);
    return a.add(b).multiplyScalar(0.5);
  };
  const rightHand = (p) => {
    const v = new THREE.Vector3();
    if (p.rig) { p.rig.bones.hand_r.getWorldPosition(v); return v; }
    p.hands[1].getWorldPosition(v); return v;
  };
  /** Ball above the shooter's head, resting on the shooting hand. */
  const shotBall = (p) => rightHand(p).add(fwd(p, 0.02)).add(right(p, 0.06)).setY(rightHand(p).y + 0.13);

  // What kind of throw a flight is
  function throwKind(f) {
    if (!f.from.holder) return null;
    if (f.shot === 'shot') {
      const d = toWorld(frame.pos[f.from.holder]).distanceTo(RIM.clone().setY(0));
      return { kind: 'shot', wind: 0.32, jump: d > 1.2, layup: d < 2.2 };
    }
    if (f.shot === 'lob') return { kind: 'lob', wind: 0.22, jump: false };
    return { kind: 'pass', wind: 0.14, jump: false };
  }

  function applyFrame(dt, now) {
    if (!frame) return;
    const f = frame.flight;
    const tk = f ? throwKind(f) : null;
    const wind = tk ? tk.wind : 0;
    const u = f ? (tk ? Math.max(0, (f.t - wind) / (1 - wind)) : f.t) : 0;   // ball's own progress after release
    if (!f || frame.step !== (release && release.step)) release = null;
    const screens = new Set(frame.screens || []);

    // A shot is contested by the nearest defender within 2.5 m: he jumps with his arms up
    let contest = null;
    if (f && tk && tk.kind === 'shot') {
      const sp = toWorld(frame.pos[f.from.holder]);
      let best = 2.5;
      for (const k of KEYS) if (k[0] === 'X') { const d = toWorld(frame.pos[k]).distanceTo(sp); if (d < best) { best = d; contest = k; } }
    }

    for (const k of KEYS) {
      const p = players[k];
      const w = toWorld(frame.pos[k]);
      if (!p.last) p.last = w.clone();
      const vel = w.clone().sub(p.last).divideScalar(Math.max(dt, 1e-3));
      p.last.copy(w);
      p.group.position.copy(w);
      p.speed = approach(p.speed, vel.length(), 10, dt);
      const holding = frame.holder === k;
      const dribbling = holding && (frame.dribble === k || p.speed > 0.6);

      // Facing: passer/shooter faces the target; runners face where they go; the ball handler faces the basket;
      // everyone else watches the ball
      let target = p.yaw;
      if (f && f.from.holder === k && u === 0) target = angleTo(w, f.to.holder ? toWorld(frame.pos[f.to.holder]) : RIM);
      else if (k === contest) target = angleTo(w, toWorld(frame.pos[f.from.holder]));
      else if (p.speed > 0.6) target = Math.atan2(vel.x, vel.z);
      else if (holding) target = angleTo(w, RIM);
      else if (k[0] === 'X' || ball.position.distanceTo(w) > 0.6) target = angleTo(w, ball.position);
      p.yaw += wrap(target - p.yaw) * Math.min(1, dt * 7);
      p.group.rotation.y = p.yaw;

      // What this player is doing right now
      const act = {
        hold: holding, dribble: dribbling, throwKind: null, a: 0, jumpH: 0, catchW: 0, catchHigh: false, blockW: 0,
        role: k[0] === 'X' ? 'def' : screens.has(k) ? 'screen' : 'idle',
      };
      if (k === contest) {
        const v = (f.t - (wind - 0.15)) / 0.5;
        act.jumpH = v > 0 && v < 1 ? Math.sin(Math.PI * v) * 0.8 : 0;
        act.blockW = v > -0.3 && v < 1.2 ? 1 : 0;
      }
      if (f && f.from.holder === k) {
        act.throwKind = tk.kind;
        act.a = f.t < wind ? 0.6 * (f.t / Math.max(0.01, wind)) : Math.min(1, 0.6 + 0.4 * (f.t - wind) / 0.2);
        if (tk.jump) act.jumpH = Math.max(0, Math.sin(Math.PI * Math.min(1, f.t / (1.6 * wind)))) * (tk.layup ? 1.1 : 0.75);
      }
      if (f && f.to.holder === k && u > 0.35) {
        act.catchHigh = f.shot === 'lob';
        act.catchW = smooth(Math.min(1, (u - 0.35) / 0.4));
      }
      if (p.rig) { updateRig(p, act, dt); continue; }

      // Simple figure (while the model loads, or if it fails)
      p.phase += dt * (3 + p.speed * 2.4);
      const k1 = Math.min(1, p.speed / 3.5);
      let q = mix(readyPose(now / 1000 + p.phase * 0.1), runPose(p.phase, Math.max(0.35, k1)), smooth(Math.min(1, p.speed / 1.2)));
      if (holding) q = holdPose(q);
      if (f && f.from.holder === k) q = tk.kind === 'pass' ? chestPass(q, act.a) : rainbowLob(q, act.a);
      if (act.jumpH > 0) q = jumpLegs(q, act.jumpH);
      applyPose(p, q, dt, !!(f && f.from.holder === k));
    }
    for (const k of KEYS) players[k].group.updateMatrixWorld(true);

    let ballPos = null;
    if (f) {
      const thrower = f.from.holder && players[f.from.holder];
      if (thrower && u === 0) {
        ballPos = tk.kind === 'shot' && f.t > wind * 0.5 ? shotBall(thrower) : handsMid(thrower);
      } else {
        if (!release) {
          const start = thrower ? (tk.kind === 'shot' ? shotBall(thrower) : handsMid(thrower)) : toWorld(f.from.point).setY(BALL_R);
          release = { step: frame.step, start };
        }
        const start = release.start;
        if (f.shot === 'shot') {
          // Up and over into the ring, then down through the net to the floor
          const top = RIM.clone().setY(RIM_H + 0.08), u1 = 0.8;
          if (u < u1) {
            const s1 = u / u1, d = Math.hypot(start.x - top.x, start.z - top.z);
            const peak = Math.max(0.35, Math.min(1.6, d * 0.22)) + Math.max(0, top.y - start.y) * 0.5;
            ballPos = start.clone().lerp(top, s1);
            ballPos.y += 4 * peak * s1 * (1 - s1);
          } else {
            const s2 = (u - u1) / (1 - u1);
            ballPos = RIM.clone();
            ballPos.y = RIM_H + 0.08 - (RIM_H + 0.08 - BALL_R) * s2 * s2;
            ballPos.z -= 0.15 * s2;
          }
        } else {
          const end = f.to.holder ? handsMid(players[f.to.holder]) : toWorld(f.to.point).setY(BALL_R);
          const peak = f.shot === 'lob' ? Math.max(1.3, ((f.arc || 40) / U) * 1.4) : Math.max(0.12, ((f.arc || 10) / U) * 0.6);
          ballPos = start.clone().lerp(end, u);
          ballPos.y += 4 * peak * u * (1 - u);
        }
        ball.rotation.x -= dt * 9;
      }
    } else if (frame.holder) {
      const hp = players[frame.holder];
      if (hp.speed > 0.6 || frame.dribble === frame.holder) {
        // Dribble: the ball bounces between the right hand and the floor, beside and ahead of the feet
        const period = 0.46, ph = ((now / 1000) % period) / period;
        const hand = rightHand(hp);
        const base = hp.group.position.clone().add(fwd(hp, 0.38)).add(right(hp, 0.24));
        const top = Math.max(0.75, Math.min(1.0, hand.y - 0.06));
        ballPos = base.setY(BALL_R + (top - BALL_R) * Math.pow(2 * ph - 1, 2));
        ball.rotation.x -= dt * 6;
      } else ballPos = handsMid(hp);
    } else if (frame.rest) {
      ballPos = toWorld(frame.rest).setY(BALL_R);
      if (Math.hypot(frame.rest[0] - 190, frame.rest[1] - 292) < 4) ballPos.z -= 0.15;   // under the ring after a shot
    }
    if (ballPos) {
      ball.position.copy(ballPos);
      ballShadow.position.set(ballPos.x, 0.008, ballPos.z);
      const sc = 1 / (1 + ballPos.y * 0.25);
      ballShadow.scale.set(sc, sc, sc);
    }
  }

  function updateCamera(dt) {
    if (camMode.startsWith('p:')) {
      const p = players[camMode.slice(2)];
      const eye = new THREE.Vector3(); (p.rig ? p.rig.bones.Head : p.head).getWorldPosition(eye); eye.y += p.rig ? 0.1 : 0.03;
      const look = ball.position.clone();
      if (look.distanceTo(eye) < 1.2) look.copy(RIM); // ball in own hands: look at the basket
      // Turn the head smoothly instead of snapping to the ball
      if (!p.look) p.look = look.clone();
      p.look.lerp(look, Math.min(1, dt * 6));
      camera.position.copy(eye);
      camera.lookAt(p.look);
      // Labels of players right in front of you would fill the screen: shrink them with distance
      for (const k of KEYS) {
        const d = players[k].group.position.distanceTo(eye);
        players[k].label.visible = players[k].group.visible && d > 2;
        const sc = Math.min(0.42, 0.12 + d * 0.03);
        players[k].label.scale.set(sc, sc, 1);
      }
      return;
    }
    if (camAnim) {
      camAnim.t = Math.min(1, camAnim.t + dt / 0.7);
      const u = smooth(camAnim.t);
      camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, u);
      controls.target.lerpVectors(camAnim.fromTarget, camAnim.toTarget, u);
      if (camAnim.t >= 1) camAnim = null;
    }
    controls.update();
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  let raf = 0, last = 0, running = false;
  function loop(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    applyFrame(dt, now);
    updateCamera(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }

  return {
    update(f) { frame = f; },
    setCamera,
    start() { if (running) return; running = true; last = 0; resize(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    snapPlayers() { for (const k of KEYS) players[k].last = null; },
    ballPosition() { return ball.position.toArray(); },
    /** Test hook: look at a player from (dx, dy, dz) metres away. */
    peek(k, dx, dy, dz, ty = 1.1) { const q = players[k].group.position; camMode = 'free'; camAnim = null; controls.target.set(q.x, ty, q.z); camera.position.set(q.x + dx, dy, q.z + dz); controls.update(); },
    bodyHeights(k) { const p = players[k]; if (!p.rig) return null; const v = new THREE.Vector3(); const o = {};
      for (const b of ['hand_l', 'hand_r', 'Head']) { p.rig.bones[b].getWorldPosition(v); o[b] = +v.y.toFixed(2); } return o; },
  };
}
