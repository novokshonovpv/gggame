import type RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Surface } from "./bike3d.ts";
import { adTexture, barkTexture, branchTexture, dirtTexture, flagAtlas, grassTexture, leafTexture, rockTexture, rng, sandTexture, tex, waterNormals } from "./textures.ts";

// The open world: 640 × 640 m of forest. Hills and a big hill in the south-east, mountains
// around the edge, a river in the west, a forest trail looping 1.8 km through it all
// (two log bridges, kicker jumps), and an endurocross stadium in the middle with logs,
// tyres, a tabletop, a boulder garden, steps and a water pit, ringed by advertising
// boards, billboards and flags. Everything is generated from fixed seeds, so every player
// gets the same world.

export { rng };
export const HALF = 320; // world spans -HALF..HALF in x and z
export const STEP = 4; // terrain grid spacing, m
export const N = (HALF * 2) / STEP + 1;
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
  // Mountains around the edge, with crags.
  const edge = smooth(255, 318, Math.max(Math.abs(x), Math.abs(z)));
  h += edge * (44 + 14 * (noise(x / 25, z / 25, 5) - 0.5));
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
  heights = new Float32Array(N * N); // [iz * N + ix]
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

  // Height at any point, on the same triangles the physics heightfield uses (bilinear is
  // within a few cm).
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

export interface Built {
  ground: Ground;
  water: THREE.Mesh;
  surface(x: number, z: number): Surface;
  inMud(x: number, z: number): boolean;
  startStadium: { x: number; z: number; yaw: number };
  stadiumGates: { x: number; z: number; yaw: number }[];
  trailGates: { x: number; z: number; yaw: number }[];
  startTrail: { x: number; z: number; yaw: number };
  map: HTMLCanvasElement; // top-down picture for the minimap, 1 px = 1.25 m
  grassMask: Uint8Array; // 256 × 256 over the world
  flags: THREE.IUniform; // time for the waving flags
  waterMats: THREE.MeshStandardMaterial[];
}

const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx);

// Small helpers for standard materials.
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
// Foliage cards are double-sided: light both faces with the same (outward) normal.
const foliage = (o: THREE.MeshStandardMaterialParameters) => {
  const m = std({ side: THREE.DoubleSide, ...o });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
  };
  return m;
};

export function buildWorld(R: R, world: RAPIER.World, scene: THREE.Scene, opts: { mobile: boolean }): Built {
  const ground = new Ground();
  const H = ground.heights;
  const rand = rng(42);
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  const add = (desc: RAPIER.ColliderDesc, friction = 0.9) => world.createCollider(desc.setFriction(friction), fixed);
  const up = new THREE.Vector3(0, 1, 0);
  const S = STADIUM;
  const zS = S.cz - S.hz + 12; // stadium south straight, ridden towards +x
  const zN = S.cz + S.hz - 12; // north straight, towards -x
  const pitX = S.cx - 28;
  const inMud = (x: number, z: number) => Math.abs(x - pitX) < 6 && Math.abs(z - zN) < 4;

  // ----- Textures -----
  const tGrass = grassTexture();
  const tDirt = dirtTexture();
  const tMud = dirtTexture(true);
  const tRock = rockTexture();
  const tSand = sandTexture();

  // ----- Terrain mesh (texture splatting) and heightfield collider -----
  const verts = new Float32Array(N * N * 3);
  const splat = new Float32Array(N * N * 4);
  const misc = new Float32Array(N * N * 2); // snow, darkening
  for (let iz = 0; iz < N; iz++)
    for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix;
      const x = -HALF + ix * STEP;
      const z = -HALF + iz * STEP;
      const h = H[i];
      verts.set([x, h, z], i * 3);
      const hx = H[iz * N + Math.min(N - 1, ix + 1)] - H[iz * N + Math.max(0, ix - 1)];
      const hz = H[Math.min(N - 1, iz + 1) * N + ix] - H[Math.max(0, iz - 1) * N + ix];
      const slope = Math.hypot(hx, hz) / (2 * STEP);
      let g = 1;
      let d = 0;
      let r = 0;
      let s = 0;
      const td = ground.trailDist(x, z);
      d = Math.max(d, 1 - smooth(3, 7, td));
      d = Math.max(d, 1 - smooth(1, 6, stadiumDist(x, z)));
      d = Math.max(d, 0.85 * (1 - smooth(14, 24, Math.hypot(x - SPAWN.x, z - SPAWN.z))));
      d = Math.max(d, 0.35 * smooth(0.55, 0.85, noise(x / 23, z / 23, 7))); // worn patches
      const dr = riverDist(x, z);
      s = 1 - smooth(10, 19, dr);
      r = smooth(0.5, 0.85, slope) + smooth(24, 34, h) * 0.8;
      g = Math.max(0, 1 - d - s - r);
      splat.set([g, d * (1 - s), Math.min(1, r), s], i * 4);
      misc.set([smooth(34, 46, h), 0.85 + 0.15 * noise(x / 9, z / 9, 8)], i * 2);
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
  tg.setAttribute("aSplat", new THREE.BufferAttribute(splat, 4));
  tg.setAttribute("aMisc", new THREE.BufferAttribute(misc, 2));
  tg.setIndex(new THREE.BufferAttribute(idx, 1));
  tg.computeVertexNormals();
  const terrainMat = std({ color: "#ffffff", roughness: 0.96 });
  terrainMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tGrass: { value: tGrass }, tDirt: { value: tDirt }, tRock: { value: tRock }, tSand: { value: tSand } });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aSplat; attribute vec2 aMisc; varying vec4 vSplat; varying vec2 vMisc; varying vec3 vW;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSplat = aSplat; vMisc = aMisc; vW = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tGrass, tDirt, tRock, tSand;
        varying vec4 vSplat; varying vec2 vMisc; varying vec3 vW;
        vec3 two(sampler2D t, vec2 p) { return mix(texture2D(t, p * 0.27).rgb, texture2D(t, p * 0.061 + 0.37).rgb, 0.4); }`,
      )
      .replace(
        "#include <map_fragment>",
        `vec2 p = vW.xz;
        vec3 cg = two(tGrass, p), cd = two(tDirt, p), cr = two(tRock, p * 0.7), cs = two(tSand, p);
        // Height-aware blend: dirt shows first in the grass's darker gaps.
        vec4 w = vSplat;
        w.y *= 1.0 + 0.8 * (0.5 - dot(cg, vec3(0.33)));
        w = pow(max(w, 0.0), vec4(1.6));
        w /= max(1e-3, dot(w, vec4(1.0)));
        vec3 col = cg * w.x + cd * w.y + cr * w.z + cs * w.w;
        float macro = texture2D(tGrass, p * 0.0071).g * 1.6 + texture2D(tDirt, p * 0.013 + 0.2).r * 0.6;
        col *= 0.72 + 0.32 * macro;
        col = mix(col, vec3(0.86, 0.9, 0.95), vMisc.x);
        diffuseColor.rgb *= col * vMisc.y;`,
      );
  };
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);
  {
    // Heightfield: rows run along z, columns along x, stored column by column.
    const hf = new Float32Array(N * N);
    for (let ix = 0; ix < N; ix++) for (let iz = 0; iz < N; iz++) hf[iz + ix * N] = H[iz * N + ix];
    add(R.ColliderDesc.heightfield(N - 1, N - 1, hf, { x: HALF * 2, y: 1, z: HALF * 2 }), 0.95);
  }
  // Invisible walls at the edge of the world.
  for (const [x, z, hx, hz] of [
    [HALF, 0, 1, HALF],
    [-HALF, 0, 1, HALF],
    [0, HALF, HALF, 1],
    [0, -HALF, HALF, 1],
  ])
    add(R.ColliderDesc.cuboid(hx, 80, hz).setTranslation(x, 40, z));

  // ----- Water -----
  const nrm = waterNormals();
  nrm.repeat.set(60, 60);
  const waterMat = std({ color: "#20414a", roughness: 0.06, metalness: 0.1, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9, envMapIntensity: 1.3 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);

  // ----- Trail ribbon, bridges, kickers -----
  const trail = ground.trail;
  // Dirt with ruts, fading out at the edges into the terrain.
  const trailTex = (() => {
    const W = 256;
    const Hh = 512;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = Hh;
    const ctx = c.getContext("2d")!;
    const img = tDirt.image as HTMLCanvasElement;
    ctx.drawImage(img, 0, 0, W, Hh / 2);
    ctx.drawImage(img, 0, Hh / 2, W, Hh / 2);
    const r = rng(17);
    for (const x0 of [W * 0.3, W * 0.7]) {
      // Ruts: dark, damp grooves with lighter ridges.
      for (let y = 0; y < Hh; y += 2) {
        const x = x0 + Math.sin((y / Hh) * Math.PI * 4) * 6 + (r() - 0.5) * 2;
        ctx.fillStyle = "rgba(40,26,14,0.28)";
        ctx.fillRect(x - 9, y, 18, 2);
        ctx.fillStyle = "rgba(190,160,120,0.12)";
        ctx.fillRect(x + 10, y, 4, 2);
      }
    }
    const fade = ctx.getImageData(0, 0, W, Hh);
    for (let y = 0; y < Hh; y++)
      for (let x = 0; x < W; x++) {
        const e = Math.min(x, W - 1 - x) / (W * 0.18);
        fade.data[(y * W + x) * 4 + 3] = 255 * Math.min(1, e) * (0.85 + 0.15 * Math.sin(y * 0.37 + x));
      }
    ctx.putImageData(fade, 0, 0);
    return tex(c);
  })();
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const ind: number[] = [];
    let dist = 0;
    const W = 3.2;
    trail.forEach((s, i) => {
      const px = -s.dz;
      const pz = s.dx;
      for (const side of [-1, 1]) {
        const x = s.x + px * W * side;
        const z = s.z + pz * W * side;
        pos.push(x, (s.bridge ? s.y : ground.at(x, z)) + 0.06, z);
        uv.push(side < 0 ? 0 : 1, dist / 10);
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
    const ribbon = new THREE.Mesh(g, std({ map: trailTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.95 }));
    ribbon.receiveShadow = true;
    ribbon.renderOrder = 1;
    scene.add(ribbon);
  }
  const plankTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!;
    const r = rng(9);
    for (let i = 0; i < 8; i++) {
      const g = 0.8 + r() * 0.35;
      ctx.fillStyle = `rgb(${120 * g},${88 * g},${58 * g})`;
      ctx.fillRect(0, i * 32, 256, 31);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `rgba(60,40,24,${0.15 + r() * 0.2})`;
        ctx.fillRect(r() * 256, i * 32 + r() * 30, 20 + r() * 80, 1);
      }
      ctx.fillStyle = "#2e1f13";
      ctx.fillRect(0, i * 32 + 31, 256, 1);
      ctx.fillStyle = "#555";
      ctx.fillRect(20, i * 32 + 14, 4, 4);
      ctx.fillRect(232, i * 32 + 14, 4, 4);
    }
    return tex(c);
  })();
  const barkPine = barkTexture(false);
  const logMat = std({ map: barkPine, roughness: 0.95 });
  // Bridges: one deck per run of bridge samples, extended onto both banks.
  const bridgeRuns: { cx: number; cz: number; len: number; yaw: number }[] = [];
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
    bridgeRuns.push({ cx, cz, len, yaw });
    const q = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    const deckY = trail[i].y;
    const dtex = plankTex.clone();
    dtex.repeat.set(len / 4, 1);
    dtex.needsUpdate = true;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, 4.6), std({ map: dtex, roughness: 0.85 }));
    deck.position.set(cx, deckY - 0.15, cz);
    deck.quaternion.copy(q);
    deck.receiveShadow = deck.castShadow = true;
    scene.add(deck);
    const rq = { x: q.x, y: q.y, z: q.z, w: q.w };
    add(R.ColliderDesc.cuboid(len / 2, 0.15, 2.3).setTranslation(cx, deckY - 0.15, cz).setRotation(rq));
    for (const side of [-1, 1]) {
      const off = new THREE.Vector3(0, 0, 2.2 * side).applyQuaternion(q);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, len, 10), logMat);
      rail.rotation.z = Math.PI / 2;
      rail.castShadow = true;
      const holder = new THREE.Group();
      holder.add(rail);
      holder.position.set(cx + off.x, deckY + 0.7, cz + off.z);
      holder.quaternion.copy(q);
      scene.add(holder);
      add(R.ColliderDesc.cuboid(len / 2, 0.5, 0.12).setTranslation(cx + off.x, deckY + 0.45, cz + off.z).setRotation(rq));
      for (let p = -len / 2; p <= len / 2; p += 3) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.6, 10), logMat);
        const pp = new THREE.Vector3(p, 0, 2.2 * side).applyQuaternion(q);
        post.position.set(cx + pp.x, deckY - 0.6, cz + pp.z);
        post.castShadow = true;
        scene.add(post);
      }
    }
  }
  // Kicker jumps along the trail: a dirt ramp and a landing.
  const kickerMat = std({ map: tDirt, roughness: 0.95 });
  const wedgeMesh = (pts: Float32Array) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    g.setIndex([0, 2, 1, 3, 4, 5, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 0, 3, 5, 0, 5, 2]);
    const ni = g.toNonIndexed();
    ni.computeVertexNormals();
    // Planar uvs from world xz so the dirt matches the ground.
    const p = ni.getAttribute("position");
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      uv[i * 2] = p.getX(i) * 0.27 + p.getY(i) * 0.2;
      uv[i * 2 + 1] = p.getZ(i) * 0.27;
    }
    ni.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(ni, kickerMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  const wedge = (x: number, z: number, yaw: number, len: number, h: number, w: number, upRamp: boolean) => {
    const y0 = ground.at(x, z) - 0.2;
    const local: number[] = [];
    for (const zz of [-w / 2, w / 2]) {
      if (upRamp) local.push(0, 0, zz, len, 0, zz, len, h, zz);
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
    wedgeMesh(pts);
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
  // Spruce: a trunk and tiers of drooping branch cards round a dark core.
  const pineGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const tiers = 8;
    for (let t = 0; t < tiers; t++) {
      const y = 0.2 + (t / tiers) * 0.78;
      const rad = 0.06 + 0.4 * Math.pow(1 - (y - 0.2) / 0.85, 0.9);
      const cards = t < tiers - 2 ? 9 : 6;
      for (let c = 0; c < cards; c++) {
        const a = (c / cards) * Math.PI * 2 + t * 0.7;
        const w = rad * 0.75;
        const droop = rad * 0.55;
        // Quad from the trunk out and down, branch texture along its length.
        const g = new THREE.BufferGeometry();
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const px = -sa;
        const pz = ca;
        const p0 = [ca * 0.01, y + 0.04, sa * 0.01];
        const p1 = [ca * rad, y - droop, sa * rad];
        const v = [
          p0[0] - px * w * 0.25, p0[1], p0[2] - pz * w * 0.25,
          p1[0] - px * w, p1[1], p1[2] - pz * w,
          p1[0] + px * w, p1[1], p1[2] + pz * w,
          p0[0] + px * w * 0.25, p0[1], p0[2] + pz * w * 0.25,
        ];
        g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
        g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0.3, 1, 0, 1, 1, 0, 0.7], 2));
        // Normals bent outwards and up: the crown shades like a volume.
        const nx = ca * 0.6;
        const nz = sa * 0.6;
        g.setAttribute("normal", new THREE.Float32BufferAttribute([nx, 0.8, nz, nx, 0.8, nz, nx, 0.8, nz, nx, 0.8, nz], 3));
        const shade = 0.55 + 0.45 * (t / tiers);
        g.setAttribute("color", new THREE.Float32BufferAttribute(Array(4).fill([shade, shade, shade]).flat(), 3));
        g.setIndex([0, 1, 2, 0, 2, 3]);
        parts.push(g);
      }
    }
    return mergeGeometries(parts)!;
  })();
  const coreGeo = new THREE.ConeGeometry(0.17, 0.72, 8, 1, true).translate(0, 0.6, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.2, 1, 8, 1, true).translate(0, 0.5, 0);
  // Birch crown: leaf cards scattered through an egg shape.
  const birchCrownGeo = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const r = rng(303);
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2;
      const e = Math.acos(1 - 2 * r());
      const d = 0.35 + r() * 0.6;
      const x = Math.sin(e) * Math.cos(a) * d;
      const y = Math.cos(e) * d * 1.25;
      const z = Math.sin(e) * Math.sin(a) * d;
      const g = new THREE.PlaneGeometry(0.85, 0.85);
      g.rotateX(r() * Math.PI);
      g.rotateY(r() * Math.PI);
      g.translate(x, y, z);
      const n = new THREE.Vector3(x, y * 0.8 + 0.3, z).normalize();
      g.setAttribute("normal", new THREE.Float32BufferAttribute(Array(4).fill([n.x, n.y, n.z]).flat(), 3));
      const shade = 0.6 + 0.4 * (y / 1.25 + 0.5);
      g.setAttribute("color", new THREE.Float32BufferAttribute(Array(4).fill([shade, shade, shade]).flat(), 3));
      parts.push(g);
    }
    return mergeGeometries(parts)!;
  })();
  const branchTex = branchTexture();
  const leafTex = leafTexture();
  const pineMat = foliage({ map: branchTex, alphaTest: 0.5, vertexColors: true, roughness: 0.85 });
  const coreMat = std({ color: "#1d3016", roughness: 1 });
  const trunkMat = std({ map: barkPine, roughness: 0.95 });
  const birchBark = std({ map: barkTexture(true), roughness: 0.8 });
  const leafMat = foliage({ map: leafTex, alphaTest: 0.5, vertexColors: true, roughness: 0.75 });

  // Trees go into 4 × 4 chunks so far-off ones are culled (and skipped in the shadow pass).
  type Inst = { m: THREE.Matrix4; c?: THREE.Color };
  const CH = 4;
  const chunks = new Map<string, Inst[]>();
  const put = (kind: string, x: number, z: number, inst: Inst) => {
    const cx = Math.min(CH - 1, Math.max(0, Math.floor(((x + HALF) / (HALF * 2)) * CH)));
    const cz = Math.min(CH - 1, Math.max(0, Math.floor(((z + HALF) / (HALF * 2)) * CH)));
    const key = `${kind}:${cx}:${cz}`;
    let l = chunks.get(key);
    if (!l) chunks.set(key, (l = []));
    l.push(inst);
  };
  const m4 = new THREE.Matrix4();
  const qy = new THREE.Quaternion();
  const spacing = opts.mobile ? 9 : 7.5;
  for (let gz = -HALF + 4; gz < HALF - 4; gz += spacing)
    for (let gx = -HALF + 4; gx < HALF - 4; gx += spacing) {
      const x = gx + (rand() - 0.5) * spacing * 0.9;
      const z = gz + (rand() - 0.5) * spacing * 0.9;
      const dens = noise(x / 70, z / 70, 21);
      if (rand() > 0.22 + dens * 0.78) continue; // clearings
      if (ground.trailDist(x, z) < 5.5 || riverDist(x, z) < 17 || stadiumDist(x, z) < 24 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 30) continue;
      const y = ground.at(x, z);
      if (y > 30) continue;
      const birch = noise(x / 40, z / 40, 33) > 0.62;
      const s = 0.75 + rand() * 0.65;
      qy.setFromAxisAngle(up, rand() * Math.PI * 2);
      const tint = new THREE.Color().setHSL(birch ? 0.22 + rand() * 0.05 : 0.27 + rand() * 0.06, 0.35 + rand() * 0.25, 0.42 + rand() * 0.16);
      if (birch) {
        const th = 7.5 * s;
        put("btrunk", x, z, { m: m4.clone().compose(new THREE.Vector3(x, y - 0.2, z), qy, new THREE.Vector3(0.75, th, 0.75)) });
        put("bcrown", x, z, { m: m4.clone().compose(new THREE.Vector3(x, y + th * 0.8, z), qy, new THREE.Vector3(2.1 * s, 2.3 * s, 2.1 * s)), c: tint });
      } else {
        const th = 14 * s;
        put("ptrunk", x, z, { m: m4.clone().compose(new THREE.Vector3(x, y - 0.3, z), qy, new THREE.Vector3(s, th * 0.7, s)) });
        put("pine", x, z, { m: m4.clone().compose(new THREE.Vector3(x, y - 0.3, z), qy, new THREE.Vector3(th * 0.52, th, th * 0.52)), c: tint });
        put("core", x, z, { m: m4.clone().compose(new THREE.Vector3(x, y - 0.3, z), qy, new THREE.Vector3(th * 0.52, th, th * 0.52)) });
      }
      add(R.ColliderDesc.cylinder(2.5, 0.25 * s).setTranslation(x, y + 2, z), 0.6);
    }
  const kinds: Record<string, [THREE.BufferGeometry, THREE.Material, boolean]> = {
    ptrunk: [trunkGeo, trunkMat, true],
    pine: [pineGeo, pineMat, true],
    core: [coreGeo, coreMat, false],
    btrunk: [trunkGeo, birchBark, true],
    bcrown: [birchCrownGeo, leafMat, true],
  };
  for (const [key, list] of chunks) {
    const [geo, mat, shadow] = kinds[key.split(":")[0]];
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      im.setMatrixAt(i, it.m);
      if (it.c) im.setColorAt(i, it.c);
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    scene.add(im);
  }

  // Boulders: a few lumpy shapes, instanced.
  const rockMat = std({ map: tRock, roughness: 0.9 });
  const rockGeos = [0, 1, 2].map((v) => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = 0.72 + 0.4 * noise(x * 1.7 + v * 10, z * 1.7 + y * 1.3, 61 + v) + 0.12 * noise(x * 5 + v, y * 5, 62);
      p.setXYZ(i, x * n, y * n * (y < 0 ? 0.6 : 0.85), z * n);
    }
    g.computeVertexNormals();
    return g;
  });
  {
    const lists: THREE.Matrix4[][] = [[], [], []];
    for (let n = 0; n < 260; n++) {
      const x = (rand() - 0.5) * HALF * 1.8;
      const z = (rand() - 0.5) * HALF * 1.8;
      if (ground.trailDist(x, z) < 5 || stadiumDist(x, z) < 22 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 30) continue;
      const r = 0.4 + rand() * rand() * 1.8;
      const y = ground.at(x, z);
      qy.setFromAxisAngle(up, rand() * Math.PI * 2);
      lists[n % 3].push(m4.clone().compose(new THREE.Vector3(x, y + r * 0.1, z), qy, new THREE.Vector3(r * 1.25, r, r * 1.05)));
      add(R.ColliderDesc.ball(r * 0.8).setTranslation(x, y + r * 0.1, z), 0.8);
    }
    lists.forEach((l, i) => {
      const im = new THREE.InstancedMesh(rockGeos[i], rockMat, l.length);
      l.forEach((mm, j) => im.setMatrixAt(j, mm));
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      scene.add(im);
    });
  }

  // ----- Endurocross stadium -----
  const y0 = S.y;
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, mat: THREE.Material | THREE.Material[], yaw = 0, collide = true) => {
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
  // Barrier boards round the arena, a strip of sponsors, with the gate on the south side.
  const stripTex = (() => {
    const c = document.createElement("canvas");
    c.width = 2048;
    c.height = 192;
    const ctx = c.getContext("2d")!;
    for (let i = 0; i < 4; i++) ctx.drawImage(adTexture(i * 2 + 1, 512, 192).image as HTMLCanvasElement, i * 512, 0);
    return tex(c);
  })();
  const boardMat = (len: number) => {
    const t = stripTex.clone();
    t.repeat.set(len / 11, 1);
    t.needsUpdate = true;
    return std({ map: t, roughness: 0.6 });
  };
  const frameMat = std({ color: "#e9e9ea", roughness: 0.5 });
  const bh = 1.1;
  const boardBox = (x: number, z: number, len: number, alongX: boolean) => {
    const face = boardMat(len);
    // Ads on both long faces; plain edges.
    const mats = alongX ? [frameMat, frameMat, frameMat, frameMat, face, face] : [face, face, frameMat, frameMat, frameMat, frameMat];
    box(x, y0 + bh / 2, z, alongX ? len : 0.3, bh, alongX ? 0.3 : len, mats);
  };
  for (const side of [-1, 1]) {
    boardBox(S.cx + side * S.hx, S.cz, S.hz * 2, false);
    boardBox(S.cx, S.cz + S.hz, S.hx * 2, true);
    const gx = side < 0 ? (S.cx - S.hx + S.cx - 10) / 2 : (S.cx + 10 + S.cx + S.hx) / 2;
    boardBox(gx, S.cz - S.hz, S.hx - 10, true);
  }
  // Billboards on steel legs outside the boards, facing the track.
  const steel = std({ color: "#8a9099", metalness: 0.6, roughness: 0.4 });
  const billboard = (x: number, z: number, yaw: number, ad: number) => {
    const g = new THREE.Group();
    const w = 8;
    const h = 3;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.18), [steel, steel, steel, steel, std({ map: adTexture(ad), roughness: 0.55 }), std({ color: "#3a3f46", roughness: 0.7 })]);
    panel.position.y = 2.6 + h / 2;
    panel.castShadow = true;
    g.add(panel);
    for (const lx of [-w * 0.35, w * 0.35]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.8, 10), steel);
      leg.position.set(lx, 1.4, -0.12);
      leg.castShadow = true;
      g.add(leg);
      const v = new THREE.Vector3(lx, 0, 0).applyAxisAngle(up, yaw);
      add(R.ColliderDesc.cylinder(1.4, 0.12).setTranslation(x + v.x, y0 + 1.4, z + v.z));
    }
    g.position.set(x, y0, z);
    g.rotation.y = yaw;
    scene.add(g);
  };
  let ad = 0;
  for (let i = -2; i <= 2; i++) billboard(S.cx + i * 21, S.cz + S.hz + 6, Math.PI, ad++);
  for (let i = -1; i <= 1; i++) {
    billboard(S.cx + S.hx + 6, S.cz + i * 22, -Math.PI / 2, ad++);
    billboard(S.cx - S.hx - 6, S.cz + i * 22, Math.PI / 2, ad++);
  }
  billboard(S.cx - 34, S.cz - S.hz - 6, 0, ad++);
  billboard(S.cx + 34, S.cz - S.hz - 6, 0, ad++);
  // Flags on poles round the boards, waving in the shader.
  const flagTime = { value: 0 };
  {
    const atlas = flagAtlas();
    const poles: THREE.Matrix4[] = [];
    const fpos: number[] = [];
    const fuv: number[] = [];
    const fwave: number[] = [];
    const findex: number[] = [];
    const flagAt = (x: number, z: number, i: number) => {
      const y = y0;
      poles.push(new THREE.Matrix4().makeTranslation(x, y + 2.75, z));
      add(R.ColliderDesc.cylinder(2.75, 0.06).setTranslation(x, y + 2.75, z));
      // The flag hangs off the pole towards +x (the wind blows that way), 1.5 × 0.95 m.
      const u0 = (i % 4) / 4;
      const v0 = Math.floor((i % 8) / 4) / 2;
      const cols = 8;
      const base = fpos.length / 3;
      for (let r = 0; r <= 1; r++)
        for (let c = 0; c <= cols; c++) {
          const t = c / cols;
          fpos.push(x + 0.05 + t * 1.5, y + 4.4 + r * 0.95, z);
          fuv.push(u0 + t * 0.25, 1 - (v0 + (1 - r) * 0.5));
          fwave.push(t, i * 1.7);
        }
      for (let c = 0; c < cols; c++) {
        const a = base + c;
        const b = base + c + 1;
        const d = base + cols + 1 + c;
        const e = d + 1;
        findex.push(a, b, e, a, e, d);
      }
    };
    let i = 0;
    for (let x = S.cx - S.hx; x <= S.cx + S.hx; x += 14) {
      flagAt(x, S.cz + S.hz + 1.2, i++);
      if (Math.abs(x - S.cx) > 12) flagAt(x, S.cz - S.hz - 1.2, i++);
    }
    for (let z = S.cz - S.hz + 12; z <= S.cz + S.hz - 6; z += 14) {
      flagAt(S.cx - S.hx - 1.2, z, i++);
      flagAt(S.cx + S.hx + 1.2, z, i++);
    }
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.06, 5.5, 8), steel, poles.length);
    poles.forEach((m, j) => pm.setMatrixAt(j, m));
    pm.castShadow = true;
    scene.add(pm);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute("position", new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute("uv", new THREE.Float32BufferAttribute(fuv, 2));
    fg.setAttribute("aWave", new THREE.Float32BufferAttribute(fwave, 2));
    fg.setIndex(findex);
    fg.computeVertexNormals();
    const fm = std({ map: atlas, side: THREE.DoubleSide, roughness: 0.8 });
    fm.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = flagTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aWave; uniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float t = aWave.x;
          float ph = uTime * 4.2 - t * 5.0 + aWave.y;
          transformed.z += sin(ph) * 0.22 * t + sin(ph * 1.7) * 0.06 * t;
          transformed.y -= t * t * 0.12;
          transformed.x -= (1.0 - cos(sin(ph) * 0.3)) * t * 0.5;`,
        )
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = normalize(vec3(0.0, 0.0, 1.0) + vec3(0.0, 0.0, 0.0));");
    };
    const flags = new THREE.Mesh(fg, fm);
    flags.castShadow = true;
    scene.add(flags);
  }
  // Start / finish arch over the line on the south straight.
  {
    const lx = S.cx - 40;
    const bannerTex = (() => {
      const c = document.createElement("canvas");
      c.width = 1024;
      c.height = 160;
      const ctx = c.getContext("2d")!;
      for (let i = 0; i < 32; i++)
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = (i + j) % 2 ? "#111" : "#f4f4f4";
          ctx.fillRect(i * 32, j * 16 + (j ? 128 : 0) - (j ? 16 : 0), 32, 16);
        }
      ctx.fillStyle = "#11161f";
      ctx.fillRect(0, 32, 1024, 96);
      ctx.fillStyle = "#ffb21a";
      ctx.font = "italic 900 78px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("СТАРТ  ·  ФИНИШ", 512, 82);
      return tex(c, false);
    })();
    for (const side of [-1, 1]) box(lx, y0 + 2.4, zS + side * 5.6, 0.6, 4.8, 0.6, std({ color: "#ffb21a", roughness: 0.5 }));
    const banner = std({ map: bannerTex });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 11.8), [banner, banner, steel, steel, steel, steel]);
    beam.position.set(lx, y0 + 4.6, zS);
    beam.castShadow = true;
    scene.add(beam);
  }

  // Obstacles on the loop course (clockwise from the start on the south straight).
  const endTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#c9a473";
    ctx.fillRect(0, 0, 128, 128);
    for (let r = 4; r < 64; r += 5) {
      ctx.strokeStyle = `rgba(110,72,40,${0.3 + (r % 3) * 0.1})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(64, 64, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = "#4a3220";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.stroke();
    return tex(c, false);
  })();
  const logEnd = std({ map: endTex, roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const x = S.cx - 31 + i * 5.5;
    const r = 0.1 + (i % 2) * 0.03;
    const t = barkPine.clone();
    t.repeat.set(2, 6);
    t.needsUpdate = true;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, 8, 16), [std({ map: t }), logEnd, logEnd]);
    log.rotation.x = Math.PI / 2;
    log.position.set(x, y0 + r * 0.85, zS);
    log.castShadow = log.receiveShadow = true;
    scene.add(log);
    add(R.ColliderDesc.cylinder(4, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(x, y0 + r * 0.85, zS));
  }
  // Tractor tyres lying flat in two staggered rows.
  const treadTex = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1c1c1e";
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = "#0c0c0d";
    for (let x = 0; x < 512; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 10, 0);
      ctx.lineTo(x + 22, 32);
      ctx.lineTo(x + 10, 64);
      ctx.lineTo(x, 64);
      ctx.lineTo(x + 12, 32);
      ctx.fill();
    }
    return tex(c);
  })();
  const tyreMat = std({ map: treadTex, roughness: 0.85 });
  {
    const g = new THREE.TorusGeometry(0.62, 0.24, 12, 28);
    const list: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    for (let i = 0; i < 7; i++)
      for (const row of [-1, 1]) {
        const x = S.cx - 2 + i * 1.6 + (row > 0 ? 0.8 : 0);
        const z = zS + row * 1.4;
        list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y0 + 0.2, z), q, new THREE.Vector3(1, 1, 0.85)));
        add(R.ColliderDesc.cylinder(0.2, 0.84).setTranslation(x, y0 + 0.2, z));
      }
    const im = new THREE.InstancedMesh(g, tyreMat, list.length);
    list.forEach((m, j) => im.setMatrixAt(j, m));
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  }
  // Tabletop: up, flat, down.
  function wedgeAt(x: number, z: number, len: number, h: number, w: number, upRamp: boolean) {
    const pts: number[] = [];
    for (const zz of [z - w / 2, z + w / 2]) {
      if (upRamp) pts.push(x, y0 - 0.1, zz, x + len, y0 - 0.1, zz, x + len, y0 + h, zz);
      else pts.push(x, y0 - 0.1, zz, x, y0 + h, zz, x + len, y0 - 0.1, zz);
    }
    const arr = new Float32Array(pts);
    const desc = R.ColliderDesc.convexHull(arr);
    if (desc) add(desc);
    wedgeMesh(arr);
  }
  {
    const x0 = S.cx + 18;
    wedgeAt(x0, zS, 4, 1.4, 5, true);
    const top = box(x0 + 4 + 3, y0 + 0.6, zS, 6, 1.6, 5, kickerMat);
    top.receiveShadow = true;
    wedgeAt(x0 + 10, zS, 6, 1.4, 5, false);
  }
  // Boulder garden on the north straight.
  {
    const r2 = rng(77);
    for (let n = 0; n < 34; n++) {
      const x = S.cx + 30 - r2() * 18;
      const z = zN + (r2() - 0.5) * 7;
      const r = 0.15 + r2() * 0.2;
      const m = new THREE.Mesh(rockGeos[n % 3], rockMat);
      m.scale.set(r * 1.3, r, r * 1.15);
      m.position.set(x, y0 + r * 0.1, z);
      m.rotation.set(0, r2() * 6, 0);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      add(R.ColliderDesc.ball(r * 0.85).setTranslation(x, y0 + r * 0.1, z));
    }
  }
  // Steps of railway sleepers up and down (ridden towards -x).
  const sleeperTex = plankTex.clone();
  sleeperTex.repeat.set(1, 0.5);
  sleeperTex.needsUpdate = true;
  const stepMat = std({ map: sleeperTex, color: "#9a8f80", roughness: 0.9 });
  for (let i = 0; i < 3; i++) {
    const hgt = 0.2 * (i + 1);
    box(S.cx + 2 - i * 1.6, y0 + hgt / 2, zN, 1.6, hgt, 6, stepMat);
    box(S.cx - 12 + i * 1.6, y0 + hgt / 2, zN, 1.6, hgt, 6, stepMat);
  }
  box(S.cx - 5, y0 + 0.3, zN, 8.4, 0.6, 6, stepMat);
  // Water pit (shallow, it just slows you down): mud round a muddy pond.
  const mudMat = std({ map: tMud, roughness: 0.55 });
  const mudFloor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), mudMat);
  mudFloor.rotation.x = -Math.PI / 2;
  mudFloor.position.set(pitX, y0 + 0.03, zN);
  mudFloor.receiveShadow = true;
  scene.add(mudFloor);
  const pitNrm = waterNormals();
  pitNrm.repeat.set(3, 2);
  const pitMat = std({ color: "#4a3a26", roughness: 0.05, normalMap: pitNrm, normalScale: new THREE.Vector2(0.25, 0.25), transparent: true, opacity: 0.88 });
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), pitMat);
  pit.rotation.x = -Math.PI / 2;
  pit.position.set(pitX, y0 + 0.07, zN);
  scene.add(pit);

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

  // ----- Grass density mask: 256 px for 640 m -----
  const MS = 256;
  const grassMask = new Uint8Array(MS * MS);
  for (let py = 0; py < MS; py++)
    for (let px = 0; px < MS; px++) {
      const x = -HALF + (px + 0.5) * 2.5;
      const z = -HALF + (py + 0.5) * 2.5;
      let m = 0.75 + 0.25 * noise(x / 12, z / 12, 99);
      m *= smooth(4, 7, ground.trailDist(x, z));
      m *= smooth(2, 6, stadiumDist(x, z));
      m *= smooth(12, 20, riverDist(x, z));
      m *= smooth(12, 22, Math.hypot(x - SPAWN.x, z - SPAWN.z));
      m *= 1 - smooth(22, 30, ground.at(x, z));
      for (const b of bridgeRuns) if (Math.hypot(x - b.cx, z - b.cz) < b.len / 2 + 3) m = 0;
      grassMask[py * MS + px] = Math.round(255 * Math.max(0, Math.min(1, m)));
    }

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

  // Tyre grip and rolling drag under the bike.
  const surface = (x: number, z: number): Surface => {
    if (inMud(x, z)) return { mu: 0.55, roll: 0.14 };
    for (const b of bridgeRuns) if (Math.hypot(x - b.cx, z - b.cz) < b.len / 2) return { mu: 0.85, roll: 0.015 };
    if (stadiumDist(x, z) < 1) return { mu: 1.05, roll: 0.025 };
    const td = ground.trailDist(x, z);
    if (td < 3.2) return { mu: 1.0, roll: 0.025 };
    const dr = riverDist(x, z);
    if (dr < 17) return { mu: 0.75, roll: 0.07 };
    return { mu: 0.85, roll: 0.045 }; // grass and forest floor
  };

  return {
    ground,
    water,
    surface,
    inMud,
    startStadium: { x: S.cx - 46, z: zS, yaw: 0 },
    stadiumGates,
    trailGates,
    startTrail: { x: t0.x, z: t0.z, yaw: yawOf(t0.dx, t0.dz) },
    map,
    grassMask,
    flags: flagTime,
    waterMats: [waterMat, pitMat],
  };
}
