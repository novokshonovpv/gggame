import * as THREE from "three";
import type { BikePose } from "./bike.ts";
import { POINTS, PANELS, type Role, T, TUBES, WHEEL_R } from "./bikeShape.ts";
import type { Look } from "./race.ts";
import { type Camera, type RiderView, riderPose } from "./render.ts";
import { type Layer, THEMES, type Theme, paintLayer } from "./scenery.ts";
import { type Track, groundY, rng } from "./track.ts";

// 3D renderer: same physics and camera as the 2D one, drawn MSM3-style as a 2.5D scene.
// World axes: x along the track, y up, z towards the viewer. Bikes ride at z = lane.

const TRACK_W = 4; // track width across (z), meters
const FOV = 30;
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const REF_D = 24; // typical camera distance, used to place the backdrop layers
const LANES = [0.7, -0.15, -0.85, -1.45]; // player in front, rivals behind
const GHOST_LANE = 0.3; // just behind the player
const NEAR_PLAYER = 2.2; // m: rival tags hide this close to the player
const LAYER_W = 4096;
const LAYER_H = 512;
const LAYER_BASE = 400; // baseline row in the layer canvas
const LAYER_AMP = 360; // tallest feature in px

type P2 = [number, number];

function texture(c: HTMLCanvasElement, repeat: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function canvas(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  return c;
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

// ---------- Track ----------

function surfaceTexture(theme: Theme) {
  const t = theme.track;
  const W = 512;
  const H = 256;
  const rand = rng(7);
  return texture(
    canvas(W, H, (ctx) => {
      ctx.fillStyle = t.top;
      ctx.fillRect(0, 0, W, H);
      // Grain.
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.08)";
        ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 1 + rand() * 2);
      }
      // Ruts along the riding lanes (canvas row = 1 - v; v = 0 at the far edge).
      ctx.strokeStyle = t.rut;
      for (const v of [0.3, 0.4, 0.52, 0.62, 0.72, 0.82]) {
        ctx.lineWidth = 3 + rand() * 4;
        ctx.beginPath();
        for (let x = 0; x <= W; x += 16) {
          const y = (1 - v) * H + Math.sin((x / W) * Math.PI * 4 + v * 9) * 3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.fillStyle = t.berm;
      ctx.fillRect(0, H * 0.93, W, H * 0.07);
      ctx.fillStyle = t.lip;
      ctx.fillRect(0, 0, W, H * 0.035);
    }),
    true,
  );
}

function faceTexture(theme: Theme) {
  const W = 256;
  const H = 512;
  const rand = rng(11);
  return texture(
    canvas(W, H, (ctx) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      // Soft sediment bands (multiplied with the face's vertex colors).
      for (const [y, h] of [
        [60, 10],
        [150, 18],
        [260, 12],
        [380, 24],
        [470, 8],
      ]) {
        const g = ctx.createLinearGradient(0, y - h, 0, y + h * 2);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.5, theme.track.strata);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y - h, W, h * 3);
      }
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rand() * 0.1})`;
        const r = 1 + rand() * 4;
        ctx.beginPath();
        ctx.arc(rand() * W, rand() * H, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
    true,
  );
}

function smoothY(track: Track, x: number) {
  let s = 0;
  for (let k = -4; k <= 4; k++) s += groundY(track, x + k * 3);
  return s / 9;
}

function buildTrack(track: Track, theme: Theme, group: THREE.Group) {
  const pts = track.points;
  const half = TRACK_W / 2;
  let minY = Infinity;
  for (const p of pts) minY = Math.min(minY, p.y);
  const bottom = minY - 40;

  // Riding surface.
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let s = 0;
    pts.forEach((p, i) => {
      if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
      pos.push(p.x, p.y, -half, p.x, p.y, half);
      uv.push(s / 7, 0, s / 7, 1);
      if (i > 0) {
        const a = 2 * (i - 1);
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: surfaceTexture(theme) }));
    m.receiveShadow = true;
    group.add(m);
  }

  // Dirt cross-section facing the camera, strata parallel to the surface.
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c0 = new THREE.Color(theme.track.face[0]);
    const c1 = new THREE.Color(theme.track.face[1]);
    pts.forEach((p, i) => {
      pos.push(p.x, p.y, half, p.x, bottom, half);
      uv.push(p.x / 9, 0, p.x / 9, -(p.y - bottom) / 7);
      const k = Math.min(1, (p.y - bottom) / 20);
      const top = c0.clone().lerp(c1, 0.1);
      const low = c1.clone().lerp(c0, 1 - k);
      col.push(top.r, top.g, top.b, low.r, low.g, low.b);
      if (i > 0) {
        const a = 2 * (i - 1);
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: faceTexture(theme), vertexColors: true })));
  }

  // Ground behind the track sloping away to the backdrop.
  const depth = 26;
  const xs: number[] = [];
  for (let x = pts[1].x; x <= pts[pts.length - 2].x; x += 1.5) xs.push(x);
  {
    const pos: number[] = [];
    const idx: number[] = [];
    xs.forEach((x, i) => {
      pos.push(x, groundY(track, x), -half, x, smoothY(track, x) - 3, -half - depth);
      if (i > 0) {
        const a = 2 * (i - 1);
        idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: theme.world.apron, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    group.add(m);
  }

  addFence(track, theme, group);
  addProps(track, theme, group, depth);
  addGate(group, track.startX - 1, groundY(track, track.startX - 1), "start");
  addGate(group, track.finishX, groundY(track, track.finishX), "finish");
}

function addFence(track: Track, theme: Theme, group: THREE.Group) {
  const z = -TRACK_W / 2 - 0.25;
  const posts: THREE.Matrix4[] = [];
  const rails: THREE.Matrix4[] = [];
  let prev: THREE.Vector3 | null = null;
  const m = new THREE.Matrix4();
  for (let x = track.startX - 4; x <= track.finishX + 40; x += 3.5) {
    const y = groundY(track, x);
    const steep = Math.abs(groundY(track, x + 0.6) - groundY(track, x - 0.6)) > 0.7;
    if (steep) {
      prev = null;
      continue;
    }
    posts.push(new THREE.Matrix4().makeTranslation(x, y + 0.5, z));
    const cur = new THREE.Vector3(x, y, z);
    if (prev) {
      const len = cur.distanceTo(prev);
      const ang = Math.atan2(cur.y - prev.y, cur.x - prev.x);
      for (const h of [0.45, 0.85]) {
        m.compose(
          new THREE.Vector3((cur.x + prev.x) / 2, (cur.y + prev.y) / 2 + h, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang),
          new THREE.Vector3(len, 1, 1),
        );
        rails.push(m.clone());
      }
    }
    prev = cur;
  }
  const mat = new THREE.MeshLambertMaterial({ color: theme.track.fence });
  const add = (geo: THREE.BufferGeometry, list: THREE.Matrix4[]) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.count = list.length;
    im.castShadow = true;
    group.add(im);
  };
  add(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), posts);
  add(new THREE.BoxGeometry(1, 0.05, 0.05), rails);
}

// Stadium floodlight masts along the far side of the track.
function addLamps(track: Track, theme: Theme, group: THREE.Group) {
  const poleMat = new THREE.MeshLambertMaterial({ color: theme.world.propColor });
  const lampMat = new THREE.MeshBasicMaterial({ color: theme.world.propColor2 });
  const z = -TRACK_W / 2 - 8;
  for (let x = track.startX + 10; x <= track.finishX + 60; x += 32) {
    const y = smoothY(track, x) - 1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 13, 8), poleMat);
    pole.position.set(x, y + 6.5, z);
    pole.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1, 0.3), lampMat);
    head.position.set(x, y + 13.2, z + 0.2);
    head.rotation.x = 0.35;
    group.add(pole, head);
  }
}

function addProps(track: Track, theme: Theme, group: THREE.Group, depth: number) {
  const rand = rng(track.id.length * 101 + 7);
  const w = theme.world;
  if (w.props === "lamps") return addLamps(track, theme, group);
  const placements: { x: number; z: number; y: number; s: number }[] = [];
  const density = w.props === "rocks" ? 0.5 : w.props === "trees" ? 0.2 : 0.3;
  const near = w.props === "rocks" ? 0.1 : 0.3; // tall props stay away from the fence
  for (let x = track.startX - 40; x <= track.finishX + 80; x += 2.2) {
    if (rand() > density) continue;
    const t = near + rand() * (1 - near); // 0 = at the fence, 1 = far edge of the ground
    const z = -TRACK_W / 2 - 1.5 - t * (depth - 3);
    const y = groundY(track, x) * (1 - t) + (smoothY(track, x) - 3) * t;
    placements.push({ x, z, y, s: 0.7 + rand() * 0.9 });
  }
  const mA = new THREE.MeshLambertMaterial({ color: w.propColor });
  const mB = new THREE.MeshLambertMaterial({ color: w.propColor2 });
  const trunkMat = new THREE.MeshLambertMaterial({ color: "#4a3426" });
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) => {
    if (!mats.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const listA: THREE.Matrix4[] = [];
  const listB: THREE.Matrix4[] = [];
  const trunks: THREE.Matrix4[] = [];
  for (const p of placements) {
    const target = rand() < 0.5 ? listA : listB;
    q.setFromAxisAngle(up, rand() * Math.PI);
    if (w.props === "rocks") {
      const sx = 1.2 * p.s * (0.8 + rand());
      target.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.2, p.z), q, new THREE.Vector3(sx, p.s * (0.6 + rand() * 0.7), sx * 0.8)));
    } else if (w.props === "pines") {
      const hgt = 2.4 + p.s * 2.6;
      target.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.6 + hgt / 2, p.z), q, new THREE.Vector3(hgt * 0.32, hgt, hgt * 0.32)));
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.4, p.z), q, new THREE.Vector3(0.25, 1.2, 0.25)));
    } else if (w.props === "cacti") {
      // Saguaro: a trunk plus up to two elbowed arms, all from one cylinder.
      const hgt = 1.6 + p.s * 1.6;
      const seg = (x: number, y: number, r: number, len: number, rotZ: number) =>
        target.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, p.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ),
            new THREE.Vector3(r, len, r),
          ),
        );
      seg(p.x, p.y + hgt / 2, 0.28, hgt, 0);
      for (const side of [-1, 1]) {
        if (rand() > 0.7) continue;
        const ah = hgt * (0.4 + rand() * 0.2);
        seg(p.x + side * 0.32, p.y + ah, 0.15, 0.5, Math.PI / 2);
        seg(p.x + side * 0.55, p.y + ah + 0.38, 0.17, 0.8, 0);
      }
    } else {
      const r = 0.7 + p.s * 0.6;
      target.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 1.2 + r, p.z), q, new THREE.Vector3(r, r * 0.9, r)));
      trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + 0.8, p.z), q, new THREE.Vector3(0.18, 1.8, 0.18)));
    }
  }
  const geo =
    w.props === "rocks"
      ? new THREE.DodecahedronGeometry(1, 0)
      : w.props === "pines"
        ? new THREE.ConeGeometry(1, 1, 7)
        : w.props === "cacti"
          ? new THREE.CylinderGeometry(1, 1, 1, 8)
          : new THREE.IcosahedronGeometry(1, 1);
  inst(geo, mA, listA);
  inst(geo, mB, listB);
  inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 6), trunkMat, trunks);
}

function addGate(group: THREE.Group, x: number, y: number, kind: "start" | "finish") {
  const half = TRACK_W / 2 + 0.4;
  const poleMat = new THREE.MeshLambertMaterial({ color: "#2a2a2e" });
  for (const z of [-half, half]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), poleMat);
    pole.position.set(x, y + 2, z);
    pole.castShadow = true;
    group.add(pole);
  }
  const tex = texture(
    canvas(512, 64, (ctx) => {
      if (kind === "finish") {
        for (let r = 0; r < 2; r++)
          for (let c = 0; c < 16; c++) {
            ctx.fillStyle = (r + c) % 2 ? "#111" : "#fff";
            ctx.fillRect(c * 32, r * 32, 32, 32);
          }
      } else {
        ctx.fillStyle = "#2fa84f";
        ctx.fillRect(0, 0, 512, 64);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 40px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("СТАРТ", 256, 34);
      }
    }),
    false,
  );
  // Overhead bar across the track, a sign facing the camera behind it, and a line on the dirt.
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, half * 2), poleMat);
  bar.position.set(x, y + 3.95, 0);
  bar.castShadow = true;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.75), new THREE.MeshLambertMaterial({ map: tex }));
  sign.position.set(x, y + 3.45, -half - 0.02);
  tex.repeat.set(1, 1);
  const lineTex = texture(
    canvas(64, 256, (ctx) => {
      for (let r = 0; r < 16; r++)
        for (let c = 0; c < 4; c++) {
          ctx.fillStyle = kind === "start" || (r + c) % 2 ? "#f4f4f4" : "#151515";
          ctx.fillRect(c * 16, r * 16, 16, 16);
        }
    }),
    false,
  );
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.6, TRACK_W), new THREE.MeshLambertMaterial({ map: lineTex, polygonOffset: true, polygonOffsetFactor: -2 }));
  line.rotation.x = -Math.PI / 2;
  line.position.set(x, y + 0.01, 0);
  line.receiveShadow = true;
  group.add(bar, sign, line);
}

// ---------- Backdrop ----------

function buildBackdrop(track: Track, theme: Theme, group: THREE.Group) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of track.points.slice(2, -1)) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const midY = (minY + maxY) / 2 + 1.2;
  const x0 = -60;
  const x1 = track.finishX + 120;
  theme.layers.forEach((L: Layer, i) => {
    // Parallax p means the layer scrolls p times as fast as the track: at distance REF_D / p.
    // Near layers are pushed back behind the ground strip.
    const z = -Math.max(REF_D / L.parallax - REF_D, 34 + i * 6);
    const dist = REF_D - z;
    const viewH = 12 * (dist / REF_D); // world height of the screen at that depth
    const amp = L.amp * viewH;
    const baseY = midY - (L.base - 0.5) * viewH;
    const mPerPx = amp / LAYER_AMP;
    const period = LAYER_W * mPerPx;
    const halfW = dist * TAN * 2.4;
    const width = x1 - x0 + halfW * 2;
    const h = LAYER_H * mPerPx;

    const tex = texture(paintLayer(L, LAYER_W, LAYER_H, LAYER_BASE, LAYER_AMP), false);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(width / period, 1);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    const cx = (x0 + x1) / 2;
    plane.position.set(cx, baseY + (LAYER_BASE - LAYER_H / 2) * mPerPx, z);
    group.add(plane);
    // Solid ground below the strip so nothing shows through underneath.
    const fillH = 400;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, fillH), new THREE.MeshBasicMaterial({ color: L.color }));
    fill.position.set(cx, baseY - (LAYER_H - LAYER_BASE) * mPerPx - fillH / 2 + 0.05, z - 0.01);
    group.add(fill);
  });
}

function skyTexture(theme: Theme) {
  return texture(
    canvas(4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, theme.sky[0]);
      g.addColorStop(0.5, theme.sky[1]);
      g.addColorStop(1, theme.sky[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    }),
    false,
  );
}

// ---------- Bike and rider ----------

const mats = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = mats.get(color);
  if (!m) mats.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

// See-through variants of a color: the ghost (pale, faint) and rivals (muted, half
// transparent), so the player's bike is the only solid, saturated one on screen.
const FADE = {
  ghost: { tint: "#cfe2ff", mix: 0.4, opacity: 0.35 },
  rival: { tint: "#8f99a8", mix: 0.3, opacity: 0.5 },
} as const;
const fadedMats = new Map<string, THREE.MeshLambertMaterial>();
function fadedMat(color: THREE.Color, kind: keyof typeof FADE) {
  const k = kind + color.getHexString();
  let m = fadedMats.get(k);
  if (!m) {
    const f = FADE[kind];
    m = new THREE.MeshLambertMaterial({ color: color.clone().lerp(new THREE.Color(f.tint), f.mix), transparent: true, opacity: f.opacity, depthWrite: false });
    fadedMats.set(k, m);
  }
  return m;
}

function shadowed<T extends THREE.Object3D>(o: T) {
  o.traverse((n) => {
    n.castShadow = true;
  });
  return o;
}

function extrude(poly: number[], depth: number, color: string) {
  const shape = new THREE.Shape();
  for (let i = 0; i < poly.length; i += 2) {
    if (i === 0) shape.moveTo(poly[0], poly[1]);
    else shape.lineTo(poly[i], poly[i + 1]);
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, mat(color));
}

// A rod along its local Y axis, length 1 (scale.y sets the real length).
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
function rod(radius: number, color: string) {
  const m = new THREE.Mesh(rodGeo, mat(color));
  m.scale.set(radius, 1, radius);
  return m;
}

// Places a rod or capsule between two points in its parent's xy plane.
function span(m: THREE.Object3D, a: P2, b: P2, z: number, stretch = true) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
  m.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2);
  if (stretch) m.scale.y = Math.hypot(dx, dy);
}

// Spoked wheel with a knobby tyre: black rim, 16 spokes, wave brake disc on the camera side.
const knobGeo = new THREE.BoxGeometry(0.05, 0.028, 0.12);
const spokeGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4);
function wheelModel(r: number) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - 0.07, 0.066, 10, 32), mat("#1a1a1a"));
  const knobs = new THREE.InstancedMesh(knobGeo, mat("#222222"), 30);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    m.compose(
      new THREE.Vector3(Math.cos(a) * (r - 0.012), Math.sin(a) * (r - 0.012), 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2),
      new THREE.Vector3(1, 1, 1),
    );
    knobs.setMatrixAt(i, m);
  }
  const rimR = r - 0.13;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.016, 6, 32), mat("#1f1f22"));
  g.add(tire, knobs, rim);
  for (let i = 0; i < 16; i++) {
    const s = new THREE.Mesh(spokeGeo, mat("#b8bec6"));
    const a = (i / 16) * Math.PI * 2;
    // Alternate sides of the hub, like a real laced wheel.
    s.position.set((Math.cos(a) * rimR) / 2, (Math.sin(a) * rimR) / 2, i % 2 ? 0.035 : -0.035);
    s.rotation.z = a - Math.PI / 2;
    s.scale.y = rimR;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), mat("#9a9ea4"));
  hub.rotation.x = Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.006, 10), mat("#c8ccd2"));
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.085;
  g.add(hub, disc);
  return shadowed(g);
}

function partColor(role: Role, look: Look) {
  switch (role) {
    case "plastic":
      return look.plastic;
    case "plasticDark":
    case "mask":
      return look.plasticDark;
    case "accent":
      return look.accent ?? look.plasticDark;
    case "seat":
      return "#18181a";
    case "engine":
      return "#232326";
    case "fins":
      return "#45474c";
    case "skid":
      return "#141416";
    case "light":
      return "#f4f8ff";
  }
}

const TUBE_COLORS = { chrome: "#c9cdd2", muffler: "#b4b9bf", shock: "#d9a514" } as const;

function capsule(radius: number, length: number, color: string) {
  return new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), mat(color));
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

class BikeModel {
  root = new THREE.Group();
  body = new THREE.Group();
  rear = wheelModel(WHEEL_R.rear);
  front = wheelModel(WHEEL_R.front);
  forkUpper: THREE.Mesh[] = [];
  forkLower: THREE.Mesh[] = [];
  forkGuard: THREE.Mesh[] = [];
  swing: THREE.Mesh[] = [];
  thighs: THREE.Mesh[];
  shins: THREE.Mesh[];
  uppers: THREE.Mesh[];
  fores: THREE.Mesh[];
  torso: THREE.Mesh;
  helmet = new THREE.Group();
  boots: THREE.Mesh[];
  tag: THREE.Sprite | null = null;
  marker: THREE.Sprite | null = null;

  constructor(look: Look, isPlayer: boolean, ghost = false) {
    const b = this.body;
    // BSE T5 body: plastics, seat, air-cooled engine, frame, exhaust (see bikeShape.ts).
    for (const p of PANELS) {
      const mesh = extrude(p.pts, p.depth, partColor(p.role, look));
      if (p.role === "light") (mesh as THREE.Mesh).material = new THREE.MeshBasicMaterial({ color: "#f4f8ff" });
      b.add(mesh);
    }
    // Cooling fins across the cylinder.
    const [c0, c1] = [T(840, 490), T(1000, 600)];
    for (let k = 0; k < 6; k++) {
      const fin = new THREE.Mesh(boxGeo, mat("#2a2b2e"));
      const y = c0[1] + ((c1[1] - c0[1]) * k) / 5;
      fin.position.set((c0[0] + c1[0]) / 2 + (k - 2.5) * 0.008, y, 0);
      fin.scale.set(0.2, 0.008, 0.27);
      fin.rotation.z = -0.12;
      b.add(fin);
    }
    for (const t of TUBES) {
      for (const z of t.z) {
        const color = t.role === "frame" ? (look.frame ?? "#202022") : TUBE_COLORS[t.role];
        const m = rod(t.r, color);
        span(m, t.a, t.b, z);
        b.add(m);
      }
    }
    // Triple clamps, handlebar with hand guards.
    for (const [pt, w] of [
      [POINTS.crown, 0.09],
      [POINTS.lowerClamp, 0.07],
    ] as const) {
      const clamp = new THREE.Mesh(boxGeo, mat("#b8bcc2"));
      clamp.position.set(pt[0], pt[1], 0);
      clamp.scale.set(w, 0.045, 0.3);
      clamp.rotation.z = -0.44;
      b.add(clamp);
    }
    const bar = rod(0.017, "#26262a");
    bar.rotation.x = Math.PI / 2;
    bar.scale.y = 0.8;
    bar.position.set(POINTS.bar[0], POINTS.bar[1], 0);
    b.add(bar);
    for (const z of [-0.36, 0.36]) {
      const guard = new THREE.Mesh(boxGeo, mat("#b8bcc2"));
      guard.position.set(POINTS.bar[0] + 0.07, POINTS.bar[1] + 0.02, z);
      guard.scale.set(0.16, 0.02, 0.05);
      guard.rotation.z = -0.25;
      b.add(guard);
    }
    // Upside-down fork (thick outer tubes on top), fork guards and the swingarm move
    // with the suspension, see update().
    for (let side = 0; side < 2; side++) {
      const up = rod(0.034, "#1c1c20");
      const low = rod(0.022, "#d6c48a");
      const guard = new THREE.Mesh(boxGeo, mat(look.plasticDark));
      guard.scale.set(0.07, 0.26, 0.03);
      const sw = new THREE.Mesh(boxGeo, mat("#1f1f22"));
      sw.scale.set(0.075, 1, 0.035);
      this.forkUpper.push(up);
      this.forkLower.push(low);
      this.forkGuard.push(guard);
      this.swing.push(sw);
      b.add(up, low, guard, sw);
    }

    // Rider: capsules with fixed bone lengths, posed by the same IK as in 2D.
    const pair = (r: number, len: number, color: string) => [capsule(r, len, color), capsule(r, len, color)];
    this.thighs = pair(0.085, 0.45, look.pants);
    this.shins = pair(0.07, 0.45, look.pants);
    this.uppers = pair(0.06, 0.32, look.jersey);
    this.fores = pair(0.055, 0.32, look.jerseyDark);
    this.boots = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.13), mat("#1d1d1d")));
    this.torso = capsule(0.15, 0.4, look.jersey);
    this.torso.scale.z = 0.85;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat(look.helmet));
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.26), mat(look.visor));
    peak.position.set(0.12, 0.13, 0);
    peak.rotation.z = -0.25;
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), mat("#1a1a1a"));
    goggles.position.set(0.13, 0.03, 0);
    const chin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.16), mat(look.helmet));
    chin.position.set(0.13, -0.09, 0);
    this.helmet.add(shell, peak, goggles, chin);
    b.add(...this.thighs, ...this.shins, ...this.uppers, ...this.fores, ...this.boots, this.torso, this.helmet);

    this.root.add(b, this.rear, this.front);
    if (!isPlayer) {
      // Ghost and rivals are see-through and cast no shadow, so they never hide the player.
      const kind = ghost ? "ghost" : "rival";
      this.root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) mesh.material = fadedMat((mesh.material as THREE.MeshLambertMaterial).color, kind);
      });
      this.tag = nameTag(look);
      this.root.add(this.tag);
    } else {
      shadowed(this.root);
      this.marker = playerMarker();
      this.root.add(this.marker);
    }
  }

  update(bike: BikePose, time = 0) {
    const ch = bike.chassis;
    const p = ch.getPosition();
    this.body.position.set(p.x, p.y, 0);
    this.body.rotation.z = ch.getAngle();
    for (const [model, body] of [
      [this.rear, bike.rear],
      [this.front, bike.front],
    ] as const) {
      const wp = body.getPosition();
      model.position.set(wp.x, wp.y, 0);
      model.rotation.z = body.getAngle();
    }
    const fl = ch.getLocalPoint(bike.front.getPosition());
    const rl = ch.getLocalPoint(bike.rear.getPosition());
    // Fork: outer tubes hang from the crown, inner tubes rise from the axle and slide inside.
    const crown = POINTS.crown;
    const fx = crown[0] - fl.x;
    const fy = crown[1] - fl.y;
    const flen = Math.hypot(fx, fy);
    const [dx, dy] = [fx / flen, fy / flen];
    const axle: P2 = [fl.x, fl.y];
    [-0.12, 0.12].forEach((z, i) => {
      span(this.forkUpper[i], crown, [crown[0] - dx * 0.46, crown[1] - dy * 0.46], z);
      span(this.forkLower[i], axle, [fl.x + dx * 0.44, fl.y + dy * 0.44], z);
      span(this.forkGuard[i], [fl.x + dx * 0.06, fl.y + dy * 0.06], [fl.x + dx * 0.32, fl.y + dy * 0.32], z * 1.15, false);
      span(this.swing[i], POINTS.pivot, [rl.x, rl.y], z * 0.95);
    });

    const pose = riderPose(bike.lean);
    [-0.16, 0.16].forEach((z, i) => {
      span(this.thighs[i], pose.hip, pose.knee, z, false);
      span(this.shins[i], pose.knee, pose.foot, z, false);
      span(this.uppers[i], pose.shoulder, pose.elbow, z * 1.35, false);
      span(this.fores[i], pose.elbow, pose.hand, z * 1.35, false);
      this.boots[i].position.set(pose.foot[0] + 0.04, pose.foot[1] - 0.02, z);
    });
    span(this.torso, pose.hip, pose.shoulder, 0, false);
    this.helmet.position.set(pose.head[0], pose.head[1], 0);
    this.helmet.rotation.z = 0.5 - pose.tilt;

    if (this.tag) {
      const head = ch.getWorldPoint({ x: pose.head[0], y: pose.head[1] });
      this.tag.position.set(head.x, head.y + 0.55, 0);
    }
    if (this.marker) {
      // Bobbing arrow over the player's helmet, upright whatever the bike does.
      const head = ch.getWorldPoint({ x: pose.head[0], y: pose.head[1] });
      this.marker.position.set(head.x, head.y + 0.85 + Math.sin(time * 5) * 0.06, 0);
    }
  }
}

function playerMarker() {
  const tex = texture(
    canvas(128, 128, (ctx) => {
      ctx.fillStyle = "#ffd21f";
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 6;
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.roundRect(14, 6, 100, 54, 14);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(40, 58);
      ctx.lineTo(64, 104);
      ctx.lineTo(88, 58);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(40, 50, 48, 12); // hide the seam between label and arrow
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "900 38px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ТЫ", 64, 35);
    }),
    false,
  );
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1, 1, 1);
  s.renderOrder = 11;
  return s;
}

function nameTag(look: Look) {
  const tex = texture(
    canvas(256, 64, (ctx) => {
      ctx.fillStyle = "rgba(10,16,28,0.65)";
      ctx.beginPath();
      ctx.roundRect(4, 8, 248, 48, 10);
      ctx.fill();
      ctx.fillStyle = look.plastic;
      ctx.fillRect(16, 20, 8, 24);
      ctx.fillStyle = "#fff";
      ctx.font = "600 30px system-ui, -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(look.name, 136, 33);
    }),
    false,
  );
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.renderOrder = 10;
  s.castShadow = false;
  return s;
}

// ---------- Renderer ----------

export class Renderer3D {
  w = 0;
  h = 0;
  gl: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
  hemi = new THREE.HemisphereLight();
  sun = new THREE.DirectionalLight();
  world = new THREE.Group();
  sky = new THREE.Group();
  trackId = "";
  bikes = new Map<BikePose, BikeModel>();

  constructor(canvasEl: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world, this.sky);
    this.resize();
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.gl.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  basePpm() {
    return Math.min(this.h / 12, this.w / 22);
  }

  private load(track: Track) {
    disposeTree(this.world);
    disposeTree(this.sky);
    this.world.clear();
    this.sky.clear();
    const theme = THEMES[track.theme];
    const w = theme.world;
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.scene.background = skyTexture(theme);
    this.scene.fog = new THREE.Fog(theme.sky[2], w.fogNear, w.fogFar);
    this.hemi.color.set(w.hemiSky);
    this.hemi.groundColor.set(w.hemiGround);
    this.hemi.intensity = w.hemi;
    this.sun.color.set(w.sun);
    this.sun.intensity = w.sunI;
    buildTrack(track, theme, this.world);
    buildBackdrop(track, theme, this.world);

    if (theme.sun) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: theme.sun.color, fog: false }));
      disc.name = "sun";
      this.sky.add(disc);
    }
    if (theme.stars) {
      const rand = rng(5);
      const pos: number[] = [];
      for (let i = 0; i < 260; i++) pos.push((rand() - 0.5) * 900, rand() * 260 - 20, 0);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75 }));
      stars.name = "stars";
      this.sky.add(stars);
    }
    this.trackId = track.id;
  }

  draw(cam: Camera, track: Track, riders: RiderView[], time: number) {
    if (track.id !== this.trackId) this.load(track);
    const theme = THEMES[track.theme];

    // Same framing as 2D: cam.ppm sets how many meters of track fit the screen height.
    const H = this.h / cam.ppm;
    const D = H / 2 / TAN;
    this.camera.position.set(cam.x, cam.y + D * 0.14, D);
    this.camera.lookAt(cam.x, cam.y + 0.2, 0);

    this.sun.position.set(cam.x + 14, cam.y + 30, 22);
    this.sun.target.position.set(cam.x, cam.y - 2, 0);

    // Sun and stars stay put on screen, far behind everything.
    const far = 600;
    const halfH = (D + far) * TAN;
    const sun = this.sky.getObjectByName("sun");
    if (sun && theme.sun) {
      sun.position.set(cam.x + (theme.sun.x * 2 - 1) * halfH * this.camera.aspect, cam.y + (1 - theme.sun.y * 2) * halfH, -far);
      sun.scale.setScalar(theme.sun.r * 2 * halfH);
    }
    const stars = this.sky.getObjectByName("stars");
    if (stars) stars.position.set(cam.x, cam.y, -far + 20);

    const live = new Set<BikePose>();
    const playerX = riders.find((r) => r.isPlayer)?.bike.chassis.getPosition().x ?? Infinity;
    riders.forEach((r, i) => {
      live.add(r.bike);
      let m = this.bikes.get(r.bike);
      if (!m) {
        m = new BikeModel(r.look, r.isPlayer, r.ghost);
        m.root.position.z = r.ghost ? GHOST_LANE : (LANES[i] ?? -1.6);
        this.bikes.set(r.bike, m);
        this.scene.add(m.root);
      }
      m.update(r.bike, time);
      // Rival name tags hide while they ride on top of the player, so only "ТЫ" shows there.
      if (m.tag) m.tag.visible = Math.abs(r.bike.chassis.getPosition().x - playerX) > NEAR_PLAYER;
    });
    for (const [bike, m] of this.bikes)
      if (!live.has(bike)) {
        this.scene.remove(m.root);
        // Materials and the rod geometry are shared between bikes; free the rest.
        m.root.traverse((n) => {
          const mesh = n as THREE.Mesh;
          if (mesh.geometry && mesh.geometry !== rodGeo) mesh.geometry.dispose();
        });
        if (m.tag) disposeTree(m.tag);
        this.bikes.delete(bike);
      }

    this.gl.render(this.scene, this.camera);
  }
}
