import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// The open world: 640 × 640 m of forest. Hills and a big hill in the south-east, mountains
// around the edge, a river in the west, a forest trail looping 1.8 km through it all
// (two log bridges, kicker jumps), and an endurocross stadium in the middle with logs,
// tyres, a tabletop, a boulder garden, steps and a water pit. Everything is generated
// from fixed seeds, so every player gets the same world.

export const HALF = 320; // world spans -HALF..HALF in x and z
const STEP = 4; // terrain grid spacing, m
const N = (HALF * 2) / STEP + 1;
export const WATER_Y = -1.5;
const RIVER_BED = -3.4;
export const STADIUM = { cx: 90, cz: 70, hx: 56, hz: 36, y: 0.5 };
export const SPAWN = { x: 90, z: 14, yaw: -Math.PI / 2 }; // facing the stadium gate (+z)

// ---------- Noise ----------

function hash2(ix: number, iz: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Terrain shape ----------

export const riverX = (z: number) => -170 + 35 * Math.sin(z / 95) + 15 * Math.sin(z / 37);
const riverDist = (x: number, z: number) => Math.abs(x - riverX(z));

function stadiumDist(x: number, z: number) {
  const dx = Math.max(0, Math.abs(x - STADIUM.cx) - STADIUM.hx);
  const dz = Math.max(0, Math.abs(z - STADIUM.cz) - STADIUM.hz);
  return Math.hypot(dx, dz);
}

// Ground height before the trail is cut in.
function rawHeight(x: number, z: number) {
  let h = 16 * (noise(x / 170, z / 170, 1) - 0.5) + 6 * (noise(x / 60, z / 60, 2) - 0.5) + 1.6 * (noise(x / 18, z / 18, 3) - 0.5);
  h += 26 * Math.exp(-((x - 200) ** 2 + (z + 175) ** 2) / (2 * 55 ** 2)); // the big hill
  h += 12 * Math.exp(-((x + 60) ** 2 + (z - 150) ** 2) / (2 * 45 ** 2));
  // The river valley: flat banks, then the bed.
  const dr = riverDist(x, z);
  h *= smooth(14, 60, dr);
  // Away from the river the land stays above the water: no stray ponds to drown in.
  if (dr > 16) h = Math.max(h, WATER_Y + 0.8);
  if (dr < 14) h = RIVER_BED + (h - RIVER_BED) * smooth(5, 14, dr);
  // Stadium and the clearing in front of it are flat.
  h = STADIUM.y + (h - STADIUM.y) * smooth(0, 30, stadiumDist(x, z));
  h = STADIUM.y + (h - STADIUM.y) * smooth(18, 40, Math.hypot(x - SPAWN.x, z - SPAWN.z));
  // Mountains around the edge.
  h += smooth(255, 318, Math.max(Math.abs(x), Math.abs(z))) * 48;
  return h;
}

// ---------- Forest trail ----------

const TRAIL_POINTS: [number, number][] = [
  [60, 8], [-20, -30], [-110, -80], [-180, -140], [-255, -120], [-270, -20], [-240, 90], [-170, 160],
  [-80, 220], [20, 250], [130, 230], [220, 170], [250, 60], [230, -60], [170, -150], [80, -200], [-20, -170], [-30, -90], [20, -40],
];

export interface TrailSample {
  x: number;
  z: number;
  y: number; // trail surface height
  dx: number; // unit direction
  dz: number;
  bridge: boolean;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildTrail(): TrailSample[] {
  const P = TRAIL_POINTS;
  const dense: [number, number][] = [];
  for (let i = 0; i < P.length; i++) {
    const p0 = P[(i - 1 + P.length) % P.length];
    const p1 = P[i];
    const p2 = P[(i + 1) % P.length];
    const p3 = P[(i + 2) % P.length];
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      dense.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  // Resample every 2 m.
  const pts: [number, number][] = [dense[0]];
  let carry = 0;
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t0 = 0;
    while (carry + seg >= 2) {
      const need = 2 - carry;
      t0 += need / Math.hypot(b[0] - a[0], b[1] - a[1]);
      pts.push([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]);
      seg -= need;
      carry = 0;
    }
    carry += seg;
  }
  pts.pop();
  const raw = pts.map(([x, z]) => rawHeight(x, z));
  const n = pts.length;
  return pts.map(([x, z], i) => {
    // The trail rolls with the land but smooths out its bumps (±20 m).
    let s = 0;
    for (let k = -10; k <= 10; k++) s += raw[(i + k + n) % n];
    const bridge = riverDist(x, z) < 17;
    const [nx, nz] = pts[(i + 1) % n];
    const len = Math.hypot(nx - x, nz - z) || 1;
    return { x, z, y: bridge ? WATER_Y + 1.1 : s / 21, dx: (nx - x) / len, dz: (nz - z) / len, bridge };
  });
}

// Nearest trail sample via a bucket grid.
class TrailIndex {
  private cells = new Map<number, number[]>();
  private s: TrailSample[];
  constructor(s: TrailSample[]) {
    this.s = s;
    s.forEach((p, i) => {
      const k = this.key(Math.floor(p.x / 16), Math.floor(p.z / 16));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    });
  }
  private key(cx: number, cz: number) {
    return (cx + 100) * 1000 + (cz + 100);
  }
  nearest(x: number, z: number, range = 1): { i: number; d: number } {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    let best = -1;
    let bd = Infinity;
    for (let a = -range; a <= range; a++)
      for (let b = -range; b <= range; b++)
        for (const i of this.cells.get(this.key(cx + a, cz + b)) ?? []) {
          const d = (this.s[i].x - x) ** 2 + (this.s[i].z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
    return { i: best, d: Math.sqrt(bd) };
  }
}

// ---------- The height grid ----------

export class Ground {
  heights = new Float32Array(N * N);
  trail = buildTrail();
  index = new TrailIndex(this.trail);

  constructor() {
    for (let iz = 0; iz < N; iz++)
      for (let ix = 0; ix < N; ix++) {
        const x = -HALF + ix * STEP;
        const z = -HALF + iz * STEP;
        let h = rawHeight(x, z);
        const near = this.index.nearest(x, z);
        if (near.i >= 0 && near.d < 9) {
          const s = this.trail[near.i];
          // Cut the trail in, except over the river where the bridge carries it.
          if (!s.bridge) h = s.y + (h - s.y) * smooth(3.5, 9, near.d);
        }
        this.heights[iz * N + ix] = h;
      }
  }

  // Bilinear height at any point (what the bike drives on, give or take the triangles).
  at(x: number, z: number) {
    const fx = Math.max(0, Math.min(N - 1.001, (x + HALF) / STEP));
    const fz = Math.max(0, Math.min(N - 1.001, (z + HALF) / STEP));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const H = this.heights;
    const a = H[iz * N + ix];
    const b = H[iz * N + ix + 1];
    const c = H[(iz + 1) * N + ix];
    const d = H[(iz + 1) * N + ix + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  trailDist(x: number, z: number) {
    const n = this.index.nearest(x, z, 1);
    return n.i < 0 ? Infinity : n.d;
  }
}

// ---------- Building it ----------

type R = typeof RAPIER;

function canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(base: string, n: number, spots: string[], size = 256) {
  return canvasTex(size, size, (ctx) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const r = rng(n);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = spots[Math.floor(r() * spots.length)];
      ctx.globalAlpha = 0.25 + r() * 0.4;
      ctx.fillRect(r() * size, r() * size, 1 + r() * 3, 1 + r() * 3);
    }
    ctx.globalAlpha = 1;
  });
}

export interface Built {
  ground: Ground;
  water: THREE.Mesh;
  // Mud and water slow the bike down.
  inMud(x: number, z: number): boolean;
  startStadium: { x: number; z: number; yaw: number };
  stadiumGates: { x: number; z: number; yaw: number }[];
  trailGates: { x: number; z: number; yaw: number }[];
  startTrail: { x: number; z: number; yaw: number };
  map: HTMLCanvasElement; // top-down picture for the minimap, 1 px = 1.25 m
}

const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

export function buildWorld(R: R, world: RAPIER.World, scene: THREE.Scene): Built {
  const ground = new Ground();
  const H = ground.heights;
  const rand = rng(42);
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const add = (desc: RAPIER.ColliderDesc, friction = 0.9) => world.createCollider(desc.setFriction(friction), fixed);

  // ----- Terrain mesh and collider -----
  const verts = new Float32Array(N * N * 3);
  const colors = new Float32Array(N * N * 3);
  const uvs = new Float32Array(N * N * 2);
  const grass = new THREE.Color("#5d8a3e");
  const grass2 = new THREE.Color("#7a9a45");
  const dirt = new THREE.Color("#8a6a48");
  const mud = new THREE.Color("#5e4a36");
  const rock = new THREE.Color("#8d8a82");
  const snow = new THREE.Color("#e8eef2");
  const sand = new THREE.Color("#b49a6c");
  const col = new THREE.Color();
  for (let iz = 0; iz < N; iz++)
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      const x = -HALF + ix * STEP;
      const z = -HALF + iz * STEP;
      const h = H[i];
      verts.set([x, h, z], i * 3);
      uvs.set([x / 8, z / 8], i * 2);
      // Slope from the neighbours.
      const hx = H[iz * N + Math.min(N - 1, ix + 1)] - H[iz * N + Math.max(0, ix - 1)];
      const hz = H[Math.min(N - 1, iz + 1) * N + ix] - H[Math.max(0, iz - 1) * N + ix];
      const slope = Math.hypot(hx, hz) / (2 * STEP);
      col.copy(grass).lerp(grass2, noise(x / 30, z / 30, 9));
      const td = ground.trailDist(x, z);
      if (td < 6) col.lerp(dirt, 1 - smooth(3, 6, td));
      if (stadiumDist(x, z) < 4) col.copy(dirt).lerp(mud, 0.3);
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 22) col.lerp(dirt, 0.6);
      const dr = riverDist(x, z);
      if (dr < 18) col.lerp(dr < 12 ? sand : mud, 1 - smooth(10, 18, dr));
      if (slope > 0.55) col.lerp(rock, smooth(0.55, 0.9, slope));
      if (h > 30) col.lerp(snow, smooth(30, 40, h));
      colors.set([col.r, col.g, col.b], i * 3);
    }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < N - 1; iz++)
    for (let ix = 0; ix < N - 1; ix++) {
      const a = iz * N + ix;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], k);
      k += 6;
    }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  tg.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  tg.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const detail = speckle("#d0d0d0", 4000, ["#ffffff", "#9a9a9a", "#b8b8b8", "#707070"]);
  const terrain = new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ vertexColors: true, map: detail }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  add(R.ColliderDesc.trimesh(verts, idx), 0.95);
  // Invisible walls at the edge of the world.
  for (const [x, z, hx, hz] of [
    [HALF, 0, 1, HALF],
    [-HALF, 0, 1, HALF],
    [0, HALF, HALF, 1],
    [0, -HALF, HALF, 1],
  ])
    add(R.ColliderDesc.cuboid(hx, 80, hz).setTranslation(x, 40, z));

  // ----- Water -----
  const waterTex = canvasTex(256, 256, (ctx) => {
    ctx.fillStyle = "#3f7898";
    ctx.fillRect(0, 0, 256, 256);
    const r = rng(7);
    ctx.strokeStyle = "rgba(220,240,255,0.35)";
    for (let i = 0; i < 60; i++) {
      const x = r() * 256;
      const y = r() * 256;
      ctx.lineWidth = 1 + r();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10 + r() * 20, y);
      ctx.stroke();
    }
  });
  waterTex.repeat.set(40, 40);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.82 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // ----- Trail ribbon, bridges, kickers -----
  const trail = ground.trail;
  const dirtTex = canvasTex(64, 256, (ctx) => {
    ctx.fillStyle = "#8a6a48";
    ctx.fillRect(0, 0, 64, 256);
    const r = rng(11);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = r() < 0.5 ? "rgba(60,40,25,0.35)" : "rgba(200,170,130,0.3)";
      ctx.fillRect(r() * 64, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    for (const x of [20, 44]) {
      ctx.fillStyle = "rgba(55,38,24,0.45)"; // ruts
      ctx.fillRect(x - 3, 0, 6, 256);
    }
  });
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const ind: number[] = [];
    let dist = 0;
    trail.forEach((s, i) => {
      const px = -s.dz;
      const pz = s.dx;
      for (const side of [-1, 1]) {
        const x = s.x + px * 2.4 * side;
        const z = s.z + pz * 2.4 * side;
        pos.push(x, (s.bridge ? s.y : ground.at(x, z)) + 0.1, z);
        uv.push(side < 0 ? 0 : 1, dist / 8);
      }
      dist += 2;
      if (!s.bridge && !trail[(i + 1) % trail.length].bridge) {
        const a = i * 2;
        const b = ((i + 1) % trail.length) * 2;
        ind.push(a, b, a + 1, a + 1, b, b + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(ind);
    g.computeVertexNormals();
    const ribbon = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: dirtTex, polygonOffset: true, polygonOffsetFactor: -2 }));
    ribbon.receiveShadow = true;
    scene.add(ribbon);
  }
  const plankTex = canvasTex(128, 128, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? "#7a5634" : "#8a6440";
      ctx.fillRect(0, i * 16, 128, 15);
      ctx.fillStyle = "#4a3220";
      ctx.fillRect(0, i * 16 + 15, 128, 1);
    }
  });
  const plankMat = new THREE.MeshLambertMaterial({ map: plankTex });
  const logMat = new THREE.MeshLambertMaterial({ color: "#6b4a2e" });
  // Bridges: one deck per run of bridge samples, extended onto both banks.
  for (let i = 0; i < trail.length; i++) {
    if (!trail[i].bridge || trail[(i - 1 + trail.length) % trail.length].bridge) continue;
    let j = i;
    while (trail[(j + 1) % trail.length].bridge) j = (j + 1) % trail.length;
    const a = trail[(i - 3 + trail.length) % trail.length];
    const b = trail[(j + 3) % trail.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const cx = (a.x + b.x) / 2;
    const cz = (a.z + b.z) / 2;
    const yaw = yawOf(b.x - a.x, b.z - a.z);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const deckY = trail[i].y;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 4.6), plankMat);
    deck.position.set(cx, deckY - 0.15, cz);
    deck.quaternion.copy(q);
    deck.receiveShadow = deck.castShadow = true;
    scene.add(deck);
    const rq = { x: q.x, y: q.y, z: q.z, w: q.w };
    add(R.ColliderDesc.cuboid(len / 2, 0.15, 2.3).setTranslation(cx, deckY - 0.15, cz).setRotation(rq));
    for (const side of [-1, 1]) {
      const off = new THREE.Vector3(0, 0, 2.2 * side).applyQuaternion(q);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 8), logMat);
      rail.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(rail);
      holder.position.set(cx + off.x, deckY + 0.7, cz + off.z);
      holder.quaternion.copy(q);
      scene.add(holder);
      add(R.ColliderDesc.cuboid(len / 2, 0.5, 0.12).setTranslation(cx + off.x, deckY + 0.45, cz + off.z).setRotation(rq));
      for (let p = -len / 2; p <= len / 2; p += 3) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.6, 8), logMat);
        const pp = new THREE.Vector3(p, 0, 2.2 * side).applyQuaternion(q);
        post.position.set(cx + pp.x, deckY - 0.1, cz + pp.z);
        post.castShadow = true;
        scene.add(post);
      }
    }
  }
  // Kicker jumps along the trail: a dirt ramp and a landing.
  const kickerMat = new THREE.MeshLambertMaterial({ map: dirtTex, color: "#b59372" });
  const wedge = (x: number, z: number, yaw: number, len: number, h: number, w: number, up: boolean) => {
    const y0 = ground.at(x, z) - 0.2;
    const local: number[] = [];
    for (const zz of [-w / 2, w / 2]) {
      if (up) local.push(0, 0, zz, len, 0, zz, len, h, zz);
      else local.push(0, 0, zz, 0, h, zz, len, 0, zz);
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const pts = new Float32Array(local.length);
    for (let p = 0; p < local.length; p += 3) {
      const lx = local[p];
      const lz = local[p + 2];
      pts[p] = x + lx * c + lz * s;
      pts[p + 1] = y0 + local[p + 1];
      pts[p + 2] = z - lx * s + lz * c;
    }
    const desc = R.ColliderDesc.convexHull(pts);
    if (desc) add(desc);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    g.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, kickerMat);
    m.material.side = THREE.DoubleSide;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  for (let i = 60; i < trail.length - 40; i += 170) {
    const s = trail[i];
    if (trail.slice(i - 10, i + 20).some((p) => p.bridge)) continue;
    const yaw = yawOf(s.dx, s.dz);
    wedge(s.x, s.z, yaw, 4.5, 1.3, 3.6, true);
    // Landing: a longer slope down, a few metres on.
    const l = trail[i + 6];
    wedge(l.x, l.z, yawOf(l.dx, l.dz), 8, 1.1, 4, false);
  }

  // ----- Forest -----
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 7);
  trunkGeo.translate(0, 0.5, 0);
  const pineGeo = mergeGeometries([
    new THREE.ConeGeometry(1, 1.1, 8).translate(0, 0.55, 0),
    new THREE.ConeGeometry(0.75, 0.9, 8).translate(0, 0.95, 0),
    new THREE.ConeGeometry(0.45, 0.7, 8).translate(0, 1.3, 0),
  ])!;
  const birchCrown = new THREE.IcosahedronGeometry(1, 1);
  const pines: THREE.Matrix4[] = [];
  const pineCols: THREE.Color[] = [];
  const birches: THREE.Matrix4[] = [];
  const pineTrunks: THREE.Matrix4[] = [];
  const birchTrunks: THREE.Matrix4[] = [];
  const m4 = new THREE.Matrix4();
  const qy = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let gz = -HALF + 4; gz < HALF - 4; gz += 8)
    for (let gx = -HALF + 4; gx < HALF - 4; gx += 8) {
      const x = gx + (rand() - 0.5) * 7;
      const z = gz + (rand() - 0.5) * 7;
      const dens = noise(x / 70, z / 70, 21);
      if (rand() > 0.25 + dens * 0.75) continue; // clearings
      if (ground.trailDist(x, z) < 6 || riverDist(x, z) < 17 || stadiumDist(x, z) < 22 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 30) continue;
      const y = ground.at(x, z);
      if (y > 28) continue;
      const birch = noise(x / 40, z / 40, 33) > 0.62;
      const s = 0.8 + rand() * 0.6;
      qy.setFromAxisAngle(up, rand() * Math.PI * 2);
      if (birch) {
        const th = 6 * s;
        birchTrunks.push(m4.clone().compose(new THREE.Vector3(x, y - 0.2, z), qy, new THREE.Vector3(0.7, th, 0.7)));
        birches.push(m4.clone().compose(new THREE.Vector3(x, y + th * 0.85, z), qy, new THREE.Vector3(1.9 * s, 2.4 * s, 1.9 * s)));
      } else {
        const th = 9 * s;
        pineTrunks.push(m4.clone().compose(new THREE.Vector3(x, y - 0.2, z), qy, new THREE.Vector3(1, th * 0.45, 1)));
        pines.push(m4.clone().compose(new THREE.Vector3(x, y + th * 0.25, z), qy, new THREE.Vector3(2.4 * s, th * 0.6, 2.4 * s)));
        pineCols.push(new THREE.Color().setHSL(0.3 + rand() * 0.06, 0.35 + rand() * 0.2, 0.2 + rand() * 0.08));
      }
      add(R.ColliderDesc.cylinder(2.5, 0.28 * s).setTranslation(x, y + 2, z), 0.6);
    }
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], colors?: THREE.Color[]) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, i) => {
      im.setMatrixAt(i, mm);
      if (colors) im.setColorAt(i, colors[i]);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  };
  instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: "#5a4030" }), pineTrunks);
  instanced(pineGeo, new THREE.MeshLambertMaterial({ color: "#ffffff" }), pines, pineCols);
  const birchBark = canvasTex(32, 128, (ctx) => {
    ctx.fillStyle = "#ece8e0";
    ctx.fillRect(0, 0, 32, 128);
    const r = rng(5);
    ctx.fillStyle = "#2a2a2a";
    for (let i = 0; i < 24; i++) ctx.fillRect(r() * 32, r() * 128, 4 + r() * 10, 1 + r() * 2);
  });
  instanced(trunkGeo, new THREE.MeshLambertMaterial({ map: birchBark }), birchTrunks);
  instanced(birchCrown, new THREE.MeshLambertMaterial({ color: "#7fae4a" }), birches);

  // Boulders in the forest and along the river.
  {
    const list: THREE.Matrix4[] = [];
    for (let n = 0; n < 220; n++) {
      const x = (rand() - 0.5) * HALF * 1.8;
      const z = (rand() - 0.5) * HALF * 1.8;
      if (ground.trailDist(x, z) < 5 || stadiumDist(x, z) < 20 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 30) continue;
      const r = 0.5 + rand() * 1.4;
      const y = ground.at(x, z);
      qy.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      list.push(m4.clone().compose(new THREE.Vector3(x, y + r * 0.3, z), qy, new THREE.Vector3(r * 1.2, r, r)));
      add(R.ColliderDesc.ball(r * 0.85).setTranslation(x, y + r * 0.3, z), 0.8);
    }
    instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: "#8a8780" }), list);
  }

  // ----- Endurocross stadium -----
  const S = STADIUM;
  const y0 = S.y;
  const boardsTex = canvasTex(1024, 64, (ctx) => {
    const words = ["MOTO TRIALS", "ЭНДУРО-КРОСС", "ENDURO ZONE", "BSE", "СТАРТ"];
    const colors = ["#1f5fbf", "#f2a516", "#c8372d", "#2fa84f", "#1b1b1d"];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = colors[i];
      ctx.fillRect(i * 205, 0, 205, 64);
      ctx.fillStyle = "#fff";
      ctx.font = "italic 900 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(words[i], i * 205 + 102, 34, 190);
    }
  });
  const boardMat = new THREE.MeshLambertMaterial({ map: boardsTex });
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material, yaw = 0, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (collide) {
      const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
      add(R.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2).setTranslation(x, y, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    }
    return m;
  };
  // Boards round the arena, with the gate gap on the south side.
  const bh = 1.1;
  for (const side of [-1, 1]) {
    box(S.cx + side * S.hx, y0 + bh / 2, S.cz, 0.3, bh, S.hz * 2, boardMat);
    box(S.cx, y0 + bh / 2, S.cz + S.hz, S.hx * 2, bh, 0.3, boardMat);
    const gx = side < 0 ? (S.cx - S.hx + S.cx - 10) / 2 : (S.cx + 10 + S.cx + S.hx) / 2;
    box(gx, y0 + bh / 2, S.cz - S.hz, S.hx - 10, bh, 0.3, boardMat);
  }
  // Stands with a crowd on the long sides and behind the north boards.
  const crowdTex = canvasTex(512, 128, (ctx) => {
    ctx.fillStyle = "#3a4256";
    ctx.fillRect(0, 0, 512, 128);
    const r = rng(19);
    const cols = ["#e8e2d0", "#d94a3a", "#3a7bd9", "#f2c94c", "#5bbf6a", "#ffffff", "#9b59b6", "#1b1b1d"];
    for (let row = 0; row < 8; row++) {
      ctx.fillStyle = "#2a3040";
      ctx.fillRect(0, row * 16 + 13, 512, 3);
      for (let x = 0; x < 512; x += 7) {
        if (r() < 0.2) continue;
        ctx.fillStyle = cols[Math.floor(r() * cols.length)];
        ctx.fillRect(x + r() * 2, row * 16 + 3, 4, 9);
      }
    }
  });
  crowdTex.repeat.set(6, 1);
  const crowdMat = new THREE.MeshLambertMaterial({ map: crowdTex });
  for (let tier = 0; tier < 4; tier++) {
    const d = 3 + tier * 2.2;
    const hgt = 1.2 + tier * 1.1;
    box(S.cx - S.hx - d, y0 + hgt / 2, S.cz, 2.2, hgt, S.hz * 2 + d * 2, crowdMat);
    box(S.cx + S.hx + d, y0 + hgt / 2, S.cz, 2.2, hgt, S.hz * 2 + d * 2, crowdMat);
    box(S.cx, y0 + hgt / 2, S.cz + S.hz + d, S.hx * 2 + d * 2, hgt, 2.2, crowdMat);
  }
  // Floodlight masts.
  const mastMat = new THREE.MeshLambertMaterial({ color: "#9aa0a8" });
  const lampMat = new THREE.MeshBasicMaterial({ color: "#fffbe0" });
  for (const [x, z] of [
    [S.cx - S.hx - 12, S.cz - S.hz - 4],
    [S.cx + S.hx + 12, S.cz - S.hz - 4],
    [S.cx - S.hx - 12, S.cz + S.hz + 12],
    [S.cx + S.hx + 12, S.cz + S.hz + 12],
  ]) {
    box(x, y0 + 9, z, 0.5, 18, 0.5, mastMat);
    box(x, y0 + 18.5, z, 3.2, 1.2, 0.6, lampMat, Math.atan2(S.cx - x, S.cz - z), false);
  }

  // Obstacles on the loop course (clockwise from the start on the south straight).
  const zS = S.cz - S.hz + 12; // south straight, ridden towards +x
  const zN = S.cz + S.hz - 12; // north straight, towards -x
  // Logs.
  for (let i = 0; i < 5; i++) {
    const x = S.cx - 30 + i * 4.5;
    const r = 0.18 + (i % 2) * 0.06;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 8, 10), logMat);
    log.rotation.x = Math.PI / 2;
    log.position.set(x, y0 + r * 0.85, zS);
    log.castShadow = log.receiveShadow = true;
    scene.add(log);
    add(R.ColliderDesc.cylinder(4, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(x, y0 + r * 0.85, zS));
  }
  // Tyres, flat in two staggered rows.
  const tyreMat = new THREE.MeshLambertMaterial({ color: "#1a1a1c" });
  for (let i = 0; i < 7; i++)
    for (const row of [-1, 1]) {
      const x = S.cx - 2 + i * 1.6 + (row > 0 ? 0.8 : 0);
      const z = zS + row * 1.4;
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.22, 8, 18), tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.set(x, y0 + 0.2, z);
      tyre.castShadow = true;
      scene.add(tyre);
      add(R.ColliderDesc.cylinder(0.2, 0.8).setTranslation(x, y0 + 0.2, z));
    }
  // Tabletop: up, flat, down.
  {
    const x0 = S.cx + 18;
    wedgeAt(x0, zS, 4, 1.4, 5, true);
    box(x0 + 4 + 3, y0 + 0.6, zS, 6, 1.6, 5, kickerMat);
    wedgeAt(x0 + 10, zS, 6, 1.4, 5, false);
  }
  function wedgeAt(x: number, z: number, len: number, h: number, w: number, upRamp: boolean) {
    // A ramp on the flat stadium floor along +x.
    const pts: number[] = [];
    for (const zz of [z - w / 2, z + w / 2]) {
      if (upRamp) pts.push(x, y0 - 0.1, zz, x + len, y0 - 0.1, zz, x + len, y0 + h, zz);
      else pts.push(x, y0 - 0.1, zz, x, y0 + h, zz, x + len, y0 - 0.1, zz);
    }
    const arr = new Float32Array(pts);
    const desc = R.ColliderDesc.convexHull(arr);
    if (desc) add(desc);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    g.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, kickerMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  // Boulder garden on the north straight.
  {
    const rockMat = new THREE.MeshLambertMaterial({ color: "#9a968c" });
    const r2 = rng(77);
    for (let n = 0; n < 26; n++) {
      const x = S.cx + 30 - r2() * 18;
      const z = zN + (r2() - 0.5) * 7;
      const r = 0.25 + r2() * 0.35;
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
      m.position.set(x, y0 + r * 0.4, z);
      m.rotation.set(r2() * 3, r2() * 3, r2() * 3);
      m.castShadow = true;
      scene.add(m);
      add(R.ColliderDesc.ball(r * 0.9).setTranslation(x, y0 + r * 0.4, z));
    }
  }
  // Steps up and down (ridden towards -x).
  const stepMat = new THREE.MeshLambertMaterial({ color: "#a89a86" });
  for (let i = 0; i < 3; i++) {
    const hgt = 0.3 * (i + 1);
    box(S.cx + 2 - i * 1.6, y0 + hgt / 2, zN, 1.6, hgt, 6, stepMat);
    box(S.cx - 12 + i * 1.6, y0 + hgt / 2, zN, 1.6, hgt, 6, stepMat);
  }
  box(S.cx - 5, y0 + 0.45, zN, 8.4, 0.9, 6, stepMat);
  // Water pit (shallow, it just slows you down).
  const pitX = S.cx - 28;
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.85 }));
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(pitX, y0 + 0.06, zN);
  scene.add(pit);
  // Start / finish line.
  const lineTex = canvasTex(64, 256, (ctx) => {
    for (let r = 0; r < 16; r++)
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = (r + c) % 2 ? "#f4f4f4" : "#151515";
        ctx.fillRect(c * 16, r * 16, 16, 16);
      }
  }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 9), new THREE.MeshLambertMaterial({ map: lineTex }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(S.cx - 40, y0 + 0.05, zS);
  scene.add(line);

  const stadiumGates = [
    { x: S.cx - 40, z: zS, yaw: 0 },
    { x: S.cx - 6, z: zS, yaw: 0 },
    { x: S.cx + 36, z: zS, yaw: 0 },
    { x: S.cx + S.hx - 8, z: S.cz, yaw: -Math.PI / 2 }, // turning north (+z)
    { x: S.cx + 36, z: zN, yaw: Math.PI },
    { x: S.cx - 5, z: zN, yaw: Math.PI },
    { x: S.cx - 40, z: zN, yaw: Math.PI },
    { x: S.cx - S.hx + 8, z: S.cz, yaw: Math.PI / 2 }, // turning south (-z)
  ];
  const trailGates: { x: number; z: number; yaw: number }[] = [];
  for (let i = 45; i < trail.length; i += 45) {
    const s = trail[i];
    if (s.bridge) continue;
    trailGates.push({ x: s.x, z: s.z, yaw: yawOf(s.dx, s.dz) });
  }
  const t0 = trail[0];
  trailGates.push({ x: t0.x, z: t0.z, yaw: yawOf(t0.dx, t0.dz) });

  // ----- Minimap picture: 512 px for 640 m -----
  const map = document.createElement("canvas");
  map.width = map.height = 512;
  {
    const ctx = map.getContext("2d")!;
    const img = ctx.createImageData(512, 512);
    for (let py = 0; py < 512; py++)
      for (let px = 0; px < 512; px++) {
        const x = -HALF + (px + 0.5) * 1.25;
        const z = -HALF + (py + 0.5) * 1.25;
        const h = ground.at(x, z);
        let c: [number, number, number] = [70, 110, 55];
        if (h > 22) c = [140, 135, 125];
        if (h < WATER_Y) c = [70, 125, 160];
        const shade = 0.85 + Math.max(-0.15, Math.min(0.15, (ground.at(x + 2, z) - h) * 0.1));
        const o = (py * 512 + px) * 4;
        img.data[o] = c[0] * shade;
        img.data[o + 1] = c[1] * shade;
        img.data[o + 2] = c[2] * shade;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    const toPx = (x: number, z: number) => [(x + HALF) / 1.25, (z + HALF) / 1.25] as const;
    ctx.strokeStyle = "#d8b98a";
    ctx.lineWidth = 3;
    ctx.beginPath();
    trail.forEach((s, i) => {
      const [px, py] = toPx(s.x, s.z);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
    const [sx, sy] = toPx(S.cx - S.hx, S.cz - S.hz);
    ctx.fillStyle = "#b89a72";
    ctx.fillRect(sx, sy, (S.hx * 2) / 1.25, (S.hz * 2) / 1.25);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx, sy, (S.hx * 2) / 1.25, (S.hz * 2) / 1.25);
  }

  return {
    ground,
    water,
    inMud: (x, z) => Math.abs(x - pitX) < 6 && Math.abs(z - zN) < 4,
    startStadium: { x: S.cx - 46, z: zS, yaw: 0 },
    stadiumGates,
    trailGates,
    startTrail: { x: t0.x, z: t0.z, yaw: yawOf(t0.dx, t0.dz) },
    map,
  };
}
