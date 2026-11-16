import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Earcut } from "three/src/extras/Earcut.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Edge, World } from "planck";
import { Bike, type BikePose } from "./bike.ts";
import { POINTS, PANELS, type Role, T, TUBES, WHEEL_R } from "./bikeShape.ts";
import type { Look } from "./race.ts";
import { Dust } from "./dust.ts";
import { type Camera, type RiderView, riderPose } from "./render.ts";
import { FOREGROUND, type Layer, STRIP, THEMES, type Theme, groundColor, paintForeground, paintLayer } from "./scenery.ts";
import { type Track, groundY, rng } from "./track.ts";

// 3D renderer: same physics and camera as the 2D one, drawn MSM3-style as a 2.5D scene.
// World axes: x along the track, y up, z towards the viewer. Bikes ride at z = lane.

const TRACK_W = 4; // track width across (z), meters
const FOV = 30;
const TAN = Math.tan(((FOV / 2) * Math.PI) / 180);
const REF_D = 24; // typical camera distance, used to place the backdrop layers
const LANES = [0.7, -0.15, -0.85, -1.45]; // player in front, rivals behind
const GHOST_LANE = 0.3; // just behind the player
const NEAR_PLAYER = 3; // m: closer than this, rivals fade further and hide their tags
const BIKE_WHEEL_R = 0.34;
const { w: LAYER_W, h: LAYER_H, base: LAYER_BASE, amp: LAYER_AMP } = STRIP; // painted strip size
const FG_DIST = 9; // foreground strip: meters in front of the camera

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
  group.add(sign, line);
}

// ---------- Dust ----------

// Soft round sprites sized in meters, with per-particle opacity and shade.
function dustPoints(dust: Dust) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(dust.max * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(dust.max), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(dust.max), 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aShade", new THREE.BufferAttribute(new Float32Array(dust.max), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uScale: { value: 1 } },
    vertexShader: `
      attribute float aSize;
      attribute float aAlpha;
      attribute float aShade;
      uniform float uScale;
      varying float vAlpha;
      varying float vShade;
      void main() {
        vAlpha = aAlpha;
        vShade = aShade;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aAlpha > 0.0 ? aSize * uScale / -mv.z : 0.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vAlpha;
      varying float vShade;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        gl_FragColor = vec4(uColor * vShade, vAlpha * smoothstep(0.5, 0.12, d));
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
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
    const z = -Math.min(820, Math.max(REF_D / L.parallax - REF_D, 34 + i * 6));
    const dist = REF_D - z;
    const viewH = 12 * (dist / REF_D); // world height of the screen at that depth
    const amp = L.amp * viewH;
    const baseY = midY - (L.base - 0.5) * viewH;
    const mPerPx = amp / LAYER_AMP;
    const period = LAYER_W * mPerPx;
    const halfW = dist * TAN * 2.4;
    const width = x1 - x0 + halfW * 2;
    const h = LAYER_H * mPerPx;

    const tex = texture(paintLayer(L, theme), false);
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(width / period, 1);
    // The strips carry their own aerial haze, so scene fog stays off them.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(width, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
    );
    const cx = (x0 + x1) / 2;
    plane.position.set(cx, baseY + (LAYER_BASE - LAYER_H / 2) * mPerPx, z);
    if (L.drift) plane.userData.drift = (L.drift * viewH) / period; // texture repeats per second
    group.add(plane);
    if (L.kind === "clouds") return;
    // Solid ground below the strip so nothing shows through underneath.
    const fillH = 400;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, fillH), new THREE.MeshBasicMaterial({ color: groundColor(L, theme), fog: false }));
    fill.position.set(cx, baseY - (LAYER_H - LAYER_BASE) * mPerPx - fillH / 2 + 0.05, z - 0.01);
    group.add(fill);
  });
}

// Halo around the sun with faint rays, drawn additively (black = no change).
function sunGlow(color: string, rays: boolean) {
  return canvas(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, color);
    g.addColorStop(0.25, color.replace(/[\d.]+\)$/, (a) => `${parseFloat(a) * 0.45})`));
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; rays && k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + (k % 3) * 0.07;
      const len = 70 + (k % 4) * 14;
      const rg = ctx.createRadialGradient(128, 128, 10, 128, 128, len);
      rg.addColorStop(0, "rgba(255,240,210,0.12)");
      rg.addColorStop(1, "rgba(255,240,210,0)");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.arc(128, 128, len, a - 0.05, a + 0.05);
      ctx.fill();
    }
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
  // Rounded edges, like moulded plastic.
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.016,
    bevelSegments: 3,
  });
  g.translate(0, 0, -depth / 2);
  return new THREE.Mesh(g, mat(color));
}

// ---------- Moulded plastics ----------
// The bike's panels are traced from a side photo. Instead of extruding them straight
// across (flat slabs), each becomes a rounded shell: its two faces bulge out from the outline
// like moulded plastic, and the half-width can vary along the bike (the tank narrows towards
// the seat, the shrouds flare at the front, the fender tapers to the tail). Graphics panels
// lie on the surface of the panel under them.

type ZFn = (x: number, y: number) => number;

function polyDist(px: number, py: number, p: number[]) {
  let best = Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i];
    const ay = p[i + 1];
    const bx = p[(i + 2) % p.length];
    const by = p[(i + 3) % p.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - ax - dx * t, py - ay - dy * t));
  }
  return best;
}

// half: half-width of the panel at a point; round: how far in from the edge the surface
// reaches full width; host: lie on another panel's surface instead (graphics).
function pillow(pts: number[], half: ZFn, round: number, host?: ZFn) {
  const p = pts.slice();
  let area = 0;
  for (let i = 0; i < p.length; i += 2) area += p[i] * p[(i + 3) % p.length] - p[(i + 2) % p.length] * p[i + 1];
  if (area < 0) {
    const r: number[] = [];
    for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
    p.splice(0, p.length, ...r);
  }
  // Outline every ~4 cm, earcut, then split every triangle in four, three times over: the
  // surface gets evenly spread vertices to bulge, and the outline gets 8x finer.
  const LEVELS = 3;
  const outline: THREE.Vector2[] = [];
  for (let i = 0; i < p.length; i += 2) {
    const ax = p[i];
    const ay = p[i + 1];
    const bx = p[(i + 2) % p.length];
    const by = p[(i + 3) % p.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.04));
    for (let k = 0; k < n; k++) outline.push(new THREE.Vector2(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  const all = outline.slice();
  let tris: number[] = Earcut.triangulate(
    outline.flatMap((v) => [v.x, v.y]),
    [],
    2,
  );
  for (let lv = 0; lv < LEVELS; lv++) {
    const mids = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 100000 + b : b * 100000 + a;
      let m = mids.get(key);
      if (m === undefined) {
        m = all.length;
        all.push(all[a].clone().add(all[b]).multiplyScalar(0.5));
        mids.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    tris = next;
  }
  // Counter-clockwise in the xy plane (faces +z).
  for (let t = 0; t < tris.length; t += 3) {
    const [a, b, c] = [all[tris[t]], all[tris[t + 1]], all[tris[t + 2]]];
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [tris[t + 1], tris[t + 2]] = [tris[t + 2], tris[t + 1]];
  }
  const edge = 0.3;
  const zAt: ZFn = (x, y) => {
    if (host) return host(x, y) + 0.005;
    const t = Math.min(1, polyDist(x, y, p) / round);
    return half(x, y) * (edge + (1 - edge) * Math.sqrt(1 - (1 - t) * (1 - t)));
  };
  const zs = all.map((v) => zAt(v.x, v.y));
  const sheet = (side: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(all.flatMap((v, i) => [v.x, v.y, zs[i] * side]), 3));
    const idx = side > 0 ? tris : tris.map((_, k) => tris[k - (k % 3) + [0, 2, 1][k % 3]]);
    g.setIndex(idx);
    g.computeVertexNormals(); // shared vertices: smooth shading
    return g.toNonIndexed();
  };
  const parts = [sheet(1), sheet(-1)];
  if (!host) {
    // The rim between the two faces, along the outline at the subdivided spacing.
    const rim: THREE.Vector2[] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      for (let k = 0; k < 1 << LEVELS; k++) rim.push(a.clone().lerp(b, k / (1 << LEVELS)));
    }
    const pos: number[] = [];
    for (let i = 0; i < rim.length; i++) {
      const a = rim[i];
      const b = rim[(i + 1) % rim.length];
      const za = zAt(a.x, a.y);
      const zb = zAt(b.x, b.y);
      // Outline is counter-clockwise, so outward is to the right of a->b.
      pos.push(a.x, a.y, za, a.x, a.y, -za, b.x, b.y, -zb, a.x, a.y, za, b.x, b.y, -zb, b.x, b.y, zb);
    }
    const w = new THREE.BufferGeometry();
    w.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    w.computeVertexNormals();
    parts.push(w);
  }
  const geo = mergeGeometries(parts)!;
  return { geo, zAt };
}
// How wide each traced panel is along the bike (fraction of its depth), by index in PANELS.
function panelShape(i: number, pts: number[]): { width: ZFn; round: number; host?: number } {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let k = 0; k < pts.length; k += 2) {
    x0 = Math.min(x0, pts[k]);
    x1 = Math.max(x1, pts[k]);
    y0 = Math.min(y0, pts[k + 1]);
    y1 = Math.max(y1, pts[k + 1]);
  }
  const fx = (x: number) => Math.max(0, Math.min(1, (x - x0) / (x1 - x0))); // 0 rear .. 1 front
  const fy = (y: number) => Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); // 0 bottom .. 1 top
  switch (i) {
    case 0: // engine cases
      return { width: () => 1, round: 0.07 };
    case 2: // skid plate
      return { width: () => 1, round: 0.03 };
    case 3: // rear fender: narrow tail
      return { width: (x) => 0.4 + 0.6 * fx(x), round: 0.03 };
    case 4: // side panel
      return { width: (x) => 0.7 + 0.3 * fx(x), round: 0.05 };
    case 5: // side panel graphic
      return { width: () => 1, round: 0.05, host: 4 };
    case 6: // tank and shrouds: slim at the seat, flaring at the radiators
      return { width: (x, y) => 0.55 + 0.45 * Math.max(fx(x) ** 1.4, (1 - fy(y)) * 0.7), round: 0.09 };
    case 7: // shroud graphic
      return { width: () => 1, round: 0.09, host: 6 };
    case 8: // seat: narrow at the tank, wider under the rider
      return { width: (x) => 0.62 + 0.38 * Math.sin(Math.PI * (0.15 + 0.7 * (1 - fx(x)))), round: 0.05 };
    case 9: // front fender
      return { width: (x) => 0.75 + 0.25 * Math.sin(Math.PI * fx(x)), round: 0.05 };
    case 10: // headlight mask
      return { width: () => 1, round: 0.05 };
    default:
      return { width: () => 1, round: 0.04 };
  }
}

// A rod along its local Y axis, length 1 (scale.y sets the real length).
const rodGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
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
const knobGeo = new THREE.BoxGeometry(0.036, 0.026, 0.044);
const spokeGeo = new THREE.CylinderGeometry(0.0024, 0.0024, 1, 5);
// Toothed sprocket in the xy plane, with lightening holes when it is big enough.
function sprocketGeo(r: number, teeth: number) {
  const s = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 ? r : r * 0.9;
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.moveTo(rr, 0);
  }
  if (r > 0.06)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56, r * 0.17, 0, Math.PI * 2, true);
      s.holes.push(hole);
    }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
  g.translate(0, 0, -0.004);
  return g;
}

// The chain runs on the camera side; the rear brake disc sits on the other side.
const CHAIN_Z = 0.14; // outside the swingarm
const FRONT_SPROCKET: P2 = [POINTS.pivot[0] + 0.06, POINTS.pivot[1] + 0.01]; // countershaft

// Physically based materials for the bike and rider (the scenery keeps its flat look).
const pbrCache = new Map<string, THREE.MeshStandardMaterial>();
function pbr(color: string, roughness: number, metalness = 0, clearcoat = 0) {
  const key = `${color}|${roughness}|${metalness}|${clearcoat}`;
  let m = pbrCache.get(key);
  if (!m) {
    m = clearcoat
      ? new THREE.MeshPhysicalMaterial({ color, roughness, metalness, clearcoat, clearcoatRoughness: 0.18 })
      : new THREE.MeshStandardMaterial({ color, roughness, metalness });
    pbrCache.set(key, m);
  }
  return m;
}

// A tapered capsule along y (like CapsuleGeometry(r, len)): radius r0 at the near end, r1 at
// the far one, a slight swell in between. uv: u round, v from the near end (0) to the far (1).
function taper(r0: number, r1: number, len: number, swell = 1.05, seg = 18) {
  const pts: THREE.Vector2[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r0, -len / 2 + Math.sin(a) * r0));
  }
  for (const t of [0.3, 0.55]) pts.push(new THREE.Vector2((r0 + (r1 - r0) * t) * swell, -len / 2 + len * t));
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.cos(a) * r1, len / 2 + Math.sin(a) * r1));
  }
  return new THREE.LatheGeometry(pts, seg);
}

// A lathe about z (the wheel axle) from (radius, z) pairs.
function axleLathe(pairs: number[][], seg = 48) {
  const g = new THREE.LatheGeometry(
    pairs.map(([r, z]) => new THREE.Vector2(r, z)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  return g;
}

// A cylinder of length 1 along y placed between two 3D points.
function span3(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  const d = b.clone().sub(a);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.scale.y = d.length();
}

// Wave brake rotor with drilled holes.
function discGeo(r: number) {
  const s = new THREE.Shape();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    const rr = r * (1 + 0.045 * Math.sin(a * 12));
    if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else s.moveTo(rr, 0);
  }
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, r * 0.045, 0, Math.PI * 2, true);
    s.holes.push(hole);
  }
  const inner = new THREE.Path();
  inner.absarc(0, 0, r * 0.62, 0, Math.PI * 2, true);
  s.holes.push(inner);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.005, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.0025);
  return g;
}

// Wheel: knobby tyre (profiled carcass with three rows of knobs), anodised rim, 36 spokes
// laced from the hub flanges, wave disc on its carrier; the rear also carries the sprocket.
function wheelModel(r: number, rear = false) {
  const g = new THREE.Group();
  const rubber = pbr("#1b1b1c", 0.93);
  const W = rear ? 0.064 : 0.052; // tyre half-width
  const rimR = r - 0.115;
  const tire = new THREE.Mesh(
    axleLathe([
      [rimR + 0.01, -W * 0.7],
      [rimR + 0.03, -W * 0.98],
      [r - 0.055, -W * 1.06],
      [r - 0.03, -W * 0.98],
      [r - 0.018, -W * 0.7],
      [r - 0.014, -W * 0.3],
      [r - 0.013, 0],
      [r - 0.014, W * 0.3],
      [r - 0.018, W * 0.7],
      [r - 0.03, W * 0.98],
      [r - 0.055, W * 1.06],
      [rimR + 0.03, W * 0.98],
      [rimR + 0.01, W * 0.7],
    ]),
    rubber,
  );
  // Knobs: a centre row and two staggered shoulder rows, tilted outwards.
  const N = 34;
  const knobs = new THREE.InstancedMesh(knobGeo, rubber, N * 3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  let k = 0;
  for (let i = 0; i < N; i++)
    for (const row of [-1, 0, 1]) {
      const a = ((i + (row ? 0.5 : 0)) / N) * Math.PI * 2;
      const rr = row ? r - 0.026 : r - 0.017;
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a + Math.PI / 2);
      tilt.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -row * 0.5);
      m.compose(new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, row * W * 0.78), q.clone().multiply(tilt), new THREE.Vector3(1, 1, row ? 0.8 : 1));
      knobs.setMatrixAt(k++, m);
    }
  const rim = new THREE.Mesh(
    axleLathe([
      [rimR - 0.012, -0.026],
      [rimR + 0.012, -0.03],
      [rimR + 0.016, -0.024],
      [rimR + 0.004, -0.018],
      [rimR + 0.004, 0.018],
      [rimR + 0.016, 0.024],
      [rimR + 0.012, 0.03],
      [rimR - 0.012, 0.026],
      [rimR - 0.012, -0.026],
    ]),
    pbr("#232428", 0.32, 0.75),
  );
  g.add(tire, knobs, rim);
  // Spokes: alternate flanges, each leaning ahead or behind (crossed lacing).
  const spokeMat = pbr("#c5cad1", 0.22, 1);
  const flange = 0.05;
  const fz = rear ? 0.045 : 0.038;
  for (let i = 0; i < 36; i++) {
    const side = i % 2 ? 1 : -1;
    const a = (i / 36) * Math.PI * 2;
    const lead = (Math.floor(i / 2) % 2 ? 1 : -1) * 0.42;
    const s = new THREE.Mesh(spokeGeo, spokeMat);
    span3(s, new THREE.Vector3(Math.cos(a) * flange, Math.sin(a) * flange, side * fz), new THREE.Vector3(Math.cos(a + lead) * (rimR - 0.008), Math.sin(a + lead) * (rimR - 0.008), side * 0.012));
    g.add(s);
  }
  const hubMat = pbr("#8f959d", 0.35, 0.85);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 16), hubMat);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  for (const z of [-fz, fz]) {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.008, 20), hubMat);
    fl.rotation.x = Math.PI / 2;
    fl.position.z = z;
    g.add(fl);
  }
  const dz = rear ? -0.085 : 0.085;
  const disc = new THREE.Mesh(discGeo(rear ? 0.11 : 0.13), pbr("#c9cdd2", 0.28, 1));
  disc.position.z = dz;
  const carrier = new THREE.Mesh(new THREE.CylinderGeometry(rear ? 0.06 : 0.07, rear ? 0.06 : 0.07, 0.007, 24), pbr("#2b2c30", 0.35, 0.7));
  carrier.rotation.x = Math.PI / 2;
  carrier.position.z = dz;
  g.add(disc, carrier);
  if (rear) {
    const sprocket = new THREE.Mesh(sprocketGeo(0.105, 48), pbr("#e8641e", 0.32, 0.7));
    sprocket.position.z = CHAIN_Z;
    g.add(sprocket);
  }
  const wheel = new THREE.Group();
  wheel.add(mergeStatic(g)); // spokes, rim, hub and disc as a few meshes
  return shadowed(wheel);
}

// After a bike is built from flat colours, give each part what it is made of: glossy
// plastics, painted or bare metal, rubber, the seat cover.
function realMaterials(root: THREE.Object3D, look: Look) {
  const hex = (c: string | undefined) => (c ? new THREE.Color(c).getHexString() : "");
  const plastics = new Set([hex(look.plastic), hex(look.plasticDark), hex(look.accent), hex(look.helmet)]);
  const metal: Record<string, [number, number]> = {
    c9cdd2: [1, 0.16], // header pipes
    b4b9bf: [0.9, 0.3], // silencer
    b8bcc2: [0.85, 0.28], // clamps, levers, guards
    "9aa0a8": [0.85, 0.32],
    c3c8cf: [0.9, 0.3],
    "7f868f": [0.8, 0.35],
    d6c48a: [0.8, 0.22], // gold fork tubes
    "1c1c20": [0.6, 0.3], // fork outer tubes
    "3a3a3f": [0.75, 0.45], // chain
    "1f1f22": [0.55, 0.38], // swingarm
    "2c2d31": [0.6, 0.35], // engine covers
    "1e1f22": [0.6, 0.35],
    e8641e: [0.6, 0.3],
    "232326": [0.45, 0.48], // engine
    "2a2b2e": [0.5, 0.42], // fins
    "45474c": [0.5, 0.42],
    "2b2c30": [0.7, 0.3], // shock body
    d9a514: [0.55, 0.32], // shock spring
  };
  const conv = new Map<THREE.Material, THREE.Material>();
  root.traverse((n) => {
    const mesh = n as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (m: THREE.Material) => {
      const l = m as THREE.MeshLambertMaterial;
      if (!l.isMeshLambertMaterial || l.map) return m;
      let out = conv.get(m);
      if (!out) {
        const h = l.color.getHexString();
        const c = "#" + h;
        if (h === hex(look.visor)) out = pbr(c, 0.06, 0.9); // mirrored goggle lens
        else if (plastics.has(h)) out = pbr(c, 0.38, 0, 0.5);
        else if (h === hex(look.frame ?? "#202022")) out = pbr(c, 0.3, 0.35, 0.5);
        else if (metal[h]) out = pbr(c, metal[h][1], metal[h][0]);
        else if (h === "18181a") out = pbr(c, 0.8); // seat cover
        else if (["1a1a1a", "222222", "141416"].includes(h)) out = pbr(c, 0.9); // rubber
        else out = pbr(c, 0.55, 0.05);
        conv.set(m, out);
      }
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
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

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

export class BikeModel {
  root = new THREE.Group();
  body = new THREE.Group();
  rear = wheelModel(WHEEL_R.rear, true);
  front = wheelModel(WHEEL_R.front);
  forkUpper: THREE.Mesh[] = [];
  forkLower: THREE.Mesh[] = [];
  forkGuard: THREE.Mesh[] = [];
  swing: THREE.Mesh[] = [];
  chain: THREE.Mesh[] = [];
  caliper = new THREE.Mesh(boxGeo, mat("#c9a227"));
  thighs: THREE.Mesh[];
  shins: THREE.Mesh[];
  uppers: THREE.Mesh[];
  fores: THREE.Mesh[];
  torso: THREE.Mesh;
  helmet = new THREE.Group();
  neck = new THREE.Group();
  pelvis = new THREE.Group();
  boots: THREE.Mesh[];
  bootShafts: THREE.Mesh[];
  braces: THREE.Mesh[];
  gloves: THREE.Mesh[];
  shoulders: THREE.Mesh[];
  tag: THREE.Sprite | null = null;
  marker: THREE.Sprite | null = null;
  halo: THREE.Mesh | null = null;
  fadeMats: THREE.Material[] = [];
  fadeBase = 1;

  constructor(look: Look, isPlayer: boolean, ghost = false) {
    const b = this.body;
    const st = new THREE.Group(); // static bike parts, merged by material below
    // BSE T5 body: plastics, seat, air-cooled engine, frame, exhaust (see bikeShape.ts).
    // Plastics, seat, engine cases and skid plate as moulded shells; the fins stay a block,
    // the lamp lens lies on the mask.
    const panelZ: ZFn[] = [];
    PANELS.forEach((p, i) => {
      const color = partColor(p.role, look);
      if (p.role === "fins") {
        st.add(extrude(p.pts, p.depth, color));
        panelZ[i] = () => p.depth / 2;
        return;
      }
      const sh = p.role === "light" ? { width: () => 1, round: 0.03, host: 10 } : panelShape(i, p.pts);
      const { geo, zAt } = pillow(p.pts, (x, y) => (p.depth / 2 + 0.012) * sh.width(x, y), sh.round, sh.host !== undefined ? panelZ[sh.host] : undefined);
      panelZ[i] = zAt;
      const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geo, mat(color));
      if (p.role === "light") mesh.material = new THREE.MeshPhysicalMaterial({ color: "#eef3f8", roughness: 0.05, metalness: 0.6, clearcoat: 1, emissive: "#ffffff", emissiveIntensity: 0.15 });
      st.add(mesh);
    });
    // Decals on both sides, lying on the panel under them.
    const onPanel = (make: () => THREE.Mesh, i: number, at: P2, w: number, h: number, rz: number) => {
      for (const side of [1, -1]) {
        const m = make();
        let z = 0;
        for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-h / 2, 0, h / 2]) z = Math.max(z, panelZ[i](at[0] + dx, at[1] + dy));
        m.position.set(at[0], at[1], side * (z + 0.006));
        m.rotation.set(0, side > 0 ? 0 : Math.PI, side > 0 ? rz : -rz);
        st.add(m);
      }
    };
    // Cooling fins across the cylinder.
    const [c0, c1] = [T(840, 490), T(1000, 600)];
    for (let k = 0; k < 6; k++) {
      const fin = new THREE.Mesh(boxGeo, mat("#2a2b2e"));
      const y = c0[1] + ((c1[1] - c0[1]) * k) / 5;
      fin.position.set((c0[0] + c1[0]) / 2 + (k - 2.5) * 0.008, y, 0);
      fin.scale.set(0.2, 0.008, 0.27);
      fin.rotation.z = -0.12;
      st.add(fin);
    }
    for (const t of TUBES) {
      for (const z of t.z) {
        if (t.role === "shock") {
          // Rear shock: a dark damper body inside a coil spring, with a piggyback reservoir.
          const body = rod(t.r * 0.62, "#2b2c30");
          span(body, t.a, t.b, z);
          const len = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]);
          const turns = 8;
          const coil = new THREE.CatmullRomCurve3(
            Array.from({ length: turns * 12 + 1 }, (_, i) => {
              const u = i / (turns * 12);
              const a = u * turns * Math.PI * 2;
              return new THREE.Vector3(Math.cos(a) * t.r * 1.45, (u - 0.5) * len * 0.7, Math.sin(a) * t.r * 1.45);
            }),
          );
          const spring = new THREE.Mesh(new THREE.TubeGeometry(coil, turns * 14, 0.0075, 6, false), mat(TUBE_COLORS.shock));
          span(spring, [t.a[0] + (t.b[0] - t.a[0]) * 0.08, t.a[1] + (t.b[1] - t.a[1]) * 0.08], [t.b[0] - (t.b[0] - t.a[0]) * 0.08, t.b[1] - (t.b[1] - t.a[1]) * 0.08], z, false);
          const res = rod(0.022, "#2b2c30");
          span(res, [t.a[0] + 0.03, t.a[1] - 0.01], [t.a[0] + 0.1, t.a[1] - 0.06], z + 0.05);
          st.add(body, spring, res);
          continue;
        }
        const color = t.role === "frame" ? (look.frame ?? "#202022") : TUBE_COLORS[t.role];
        const m = rod(t.r, color);
        span(m, t.a, t.b, z);
        st.add(m);
      }
    }
    // Crossbar pad on the handlebar.
    const pad = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.14, 4, 10), mat(look.accent ?? look.plasticDark));
    pad.rotation.x = Math.PI / 2;
    pad.position.set(POINTS.bar[0] - 0.015, POINTS.bar[1] + 0.035, 0);
    st.add(pad);
    // Triple clamps, handlebar with hand guards.
    for (const [pt, w] of [
      [POINTS.crown, 0.09],
      [POINTS.lowerClamp, 0.07],
    ] as const) {
      const clamp = new THREE.Mesh(boxGeo, mat("#b8bcc2"));
      clamp.position.set(pt[0], pt[1], 0);
      clamp.scale.set(w, 0.045, 0.3);
      clamp.rotation.z = -0.44;
      st.add(clamp);
    }
    const bar = rod(0.017, "#26262a");
    bar.rotation.x = Math.PI / 2;
    bar.scale.y = 0.8;
    bar.position.set(POINTS.bar[0], POINTS.bar[1], 0);
    st.add(bar);
    // Hand guards: a plastic shell curving forward round each grip on an alloy spar.
    const [bx, by] = POINTS.bar;
    for (const side of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(bx - 0.01, by + 0.005, side * 0.24),
        new THREE.Vector3(bx + 0.07, by + 0.035, side * 0.3),
        new THREE.Vector3(bx + 0.095, by + 0.03, side * 0.37),
        new THREE.Vector3(bx + 0.06, by + 0.0, side * 0.425),
        new THREE.Vector3(bx + 0.0, by - 0.01, side * 0.43),
      ]);
      const shell = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 8, false), mat(look.plasticDark));
      shell.scale.y = 1;
      const spar = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.009, 6, false), mat("#b8bcc2"));
      spar.position.y = -0.03;
      st.add(shell, spar);
    }
    // Brake hose and throttle cables from the bars down to the frame (follow the steering
    // head, simplified as fixed), the brake pedal and the gear lever by the footpegs.
    const cable = (pts: P2[], z: number[], r: number, color: string) => {
      const c = new THREE.CatmullRomCurve3(pts.map(([x, y], k) => new THREE.Vector3(x, y, z[k])));
      st.add(new THREE.Mesh(new THREE.TubeGeometry(c, 30, r, 6, false), mat(color)));
    };
    const [lx, ly] = POINTS.lowerClamp;
    cable([[bx + 0.03, by - 0.01], [bx + 0.12, by - 0.06], [lx + 0.04, ly + 0.02], [lx + 0.06, ly - 0.12]], [0.2, 0.17, 0.12, 0.11], 0.006, "#141416");
    cable([[bx + 0.02, by - 0.01], [bx + 0.09, by - 0.08], [lx - 0.02, ly + 0.03], [lx - 0.12, ly - 0.06], T(1000, 470)], [-0.22, -0.17, -0.12, -0.1, -0.08], 0.005, "#141416");
    const [px, py] = POINTS.peg;
    const pedal = rod(0.011, "#9aa0a8");
    span(pedal, [px - 0.02, py + 0.02], [px + 0.2, py + 0.03], 0.13);
    const lever = rod(0.011, "#9aa0a8");
    span(lever, [px + 0.03, py + 0.07], [px + 0.2, py + 0.05], -0.14);
    st.add(pedal, lever);
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
    // Chain: two runs between the sprockets that follow the swingarm; the front brake caliper
    // rides on the fork leg. See update().
    for (let k = 0; k < 2; k++) {
      const run = rod(0.011, "#3a3a3f");
      this.chain.push(run);
      b.add(run);
    }
    this.caliper.scale.set(0.05, 0.1, 0.035);
    b.add(this.caliper);
    const cs = new THREE.Mesh(sprocketGeo(0.042, 13), mat("#9aa0a8"));
    cs.position.set(FRONT_SPROCKET[0], FRONT_SPROCKET[1], CHAIN_Z);
    st.add(cs);
    // Muffler end cap and bar-end grips.
    const cap0 = rod(0.052, "#2c2c30");
    span(cap0, T(262, 428), T(214, 407), 0.16);
    st.add(cap0);
    for (const z of [-0.34, 0.34]) {
      const grip = rod(0.024, "#141416");
      grip.rotation.x = Math.PI / 2;
      grip.scale.y = 0.12;
      grip.position.set(POINTS.bar[0], POINTS.bar[1], z);
      st.add(grip);
    }

    // Rider: capsules with fixed bone lengths, posed by the same IK as in 2D.
    // Kit after the Leatt 3.5 Ride Kit (67moto catalogue): solid jersey with the white LEATT
    // logo and sleeve piping, matching pants with black knee panels, tall boots, gloves,
    // C-frame knee braces, a 5.5 neck brace and a Moto 7.5 helmet with Velocity goggles.
    const kit = kitTextures(look);
    // Kit fabric is matte; boots, guards and the helmet are moulded plastic.
    const kitMat = (map: THREE.Texture) => new THREE.MeshStandardMaterial({ map, roughness: 0.88, normalMap: FABRIC_NORMAL(), normalScale: new THREE.Vector2(0.55, 0.55) });
    const jerseyM = kitMat(kit.jersey);
    const sleeveM = kitMat(kit.sleeve);
    const pantsM = kitMat(kit.pants);
    const bootM = pbr(look.boots ?? "#ececec", 0.45, 0, 0.3);
    const blackM = pbr("#1b1b1d", 0.6);
    const two = <T>(f: () => T) => [f(), f()];
    // Limbs taper from the near joint to the far one (thigh: hip to knee, etc.).
    this.thighs = two(() => new THREE.Mesh(taper(0.096, 0.074, 0.44, 1.07), pantsM));
    this.shins = two(() => new THREE.Mesh(taper(0.072, 0.058, 0.42, 1.06), pbr(look.pants, 0.9)));
    this.bootShafts = two(() => new THREE.Mesh(taper(0.084, 0.09, 0.22, 1), bootM));
    // Boots: a moulded foot with a toe cap and a black sole.
    const bootGeo = (() => {
      const s = new THREE.Shape();
      const p = [-0.135, -0.04, 0.115, -0.04, 0.16, -0.022, 0.165, 0.0, 0.125, 0.032, 0.03, 0.05, -0.12, 0.06, -0.142, 0.02];
      s.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) s.lineTo(p[i], p[i + 1]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 3 });
      g.translate(0, 0, -0.045);
      return g;
    })();
    this.boots = two(() => {
      const foot = new THREE.Mesh(bootGeo, bootM);
      const sole = new THREE.Mesh(boxGeo, blackM);
      sole.position.set(0.012, -0.055, 0);
      sole.scale.set(0.31, 0.024, 0.12);
      const heel = new THREE.Mesh(boxGeo, pbr("#7f868f", 0.35, 0.8));
      heel.position.set(-0.05, 0.0, 0.064);
      heel.scale.set(0.12, 0.04, 0.006);
      foot.add(sole, heel);
      return foot;
    });
    this.braces = two(() => {
      const brace = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.18, 4, 8), pbr("#2a2a2e", 0.4, 0.4));
      brace.scale.z = 0.6;
      return brace;
    });
    this.uppers = two(() => new THREE.Mesh(taper(0.079, 0.061, 0.3, 1.12), sleeveM));
    this.fores = two(() => new THREE.Mesh(taper(0.069, 0.052, 0.3, 1.12), sleeveM));
    // Shoulders: rounded caps where the sleeves meet the jersey.
    this.shoulders = two(() => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.096, 20, 14), sleeveM);
      m.scale.set(1, 0.9, 0.95);
      // Shoulder cup of the chest protector.
      const cupM = pbr("#1c1c1f", 0.45, 0, 0.35).clone();
      cupM.side = THREE.DoubleSide;
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.112, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.42), cupM);
      cup.position.y = -0.004;
      m.add(cup);
      return m;
    });
    // Gloves closed round the grips, with a hard knuckle guard.
    this.gloves = two(() => {
      const fist = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pbr(look.jerseyDark, 0.8));
      fist.scale.set(0.058, 0.05, 0.068);
      const knuckle = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), blackM);
      knuckle.position.set(0.55, 0.45, 0);
      knuckle.scale.set(0.35, 0.3, 0.7);
      fist.add(knuckle);
      return fist;
    });
    // Torso: a man's build - broad chest and shoulders over a narrower waist, flatter front
    // to back than side to side.
    const torsoProfile = [
      [0, -0.335],
      [0.1, -0.315],
      [0.135, -0.27],
      [0.136, -0.16],
      [0.13, -0.06],
      [0.152, 0.05],
      [0.176, 0.15],
      [0.188, 0.22],
      [0.172, 0.28],
      [0.12, 0.325],
      [0.06, 0.345],
      [0, 0.35],
    ];
    const torsoGeo = new THREE.LatheGeometry(
      torsoProfile.map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    );
    this.torso = new THREE.Mesh(torsoGeo, jerseyM);
    this.torso.scale.set(0.84, 1, 1.24);
    // Chest protector over the jersey: front and back shells following the chest, a strap
    // round the waist; shoulder cups on the shoulders (below). Children of the torso, so
    // they share its shape.
    {
      const rAt = (y: number) => {
        for (let k = 1; k < torsoProfile.length; k++) {
          const [r0, y0] = torsoProfile[k - 1];
          const [r1, y1] = torsoProfile[k];
          if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
        }
        return 0;
      };
      const plate = (y0: number, y1: number, phi0: number, len: number, grow: number) => {
        const pts: THREE.Vector2[] = [];
        for (let k = 0; k <= 10; k++) {
          const y = y0 + ((y1 - y0) * k) / 10;
          pts.push(new THREE.Vector2(rAt(y) * grow + 0.012, y));
        }
        return new THREE.LatheGeometry(pts, 16, phi0, len);
      };
      const armour = pbr("#1c1c1f", 0.45, 0, 0.35).clone();
      armour.side = THREE.DoubleSide;
      const front = new THREE.Mesh(plate(-0.12, 0.31, Math.PI / 2 - 1.05, 2.1, 1.06), armour);
      const back = new THREE.Mesh(plate(-0.2, 0.31, (3 * Math.PI) / 2 - 1.15, 2.3, 1.06), armour);
      // Two light panels on the chest, like the moulded plates of a real roost guard.
      const panelM = pbr("#d9dadc", 0.4, 0, 0.3).clone();
      panelM.side = THREE.DoubleSide;
      const pecs = [-1, 1].map((side) => new THREE.Mesh(plate(0.06, 0.25, Math.PI / 2 + (side < 0 ? -0.82 : 0.12), 0.7, 1.075), panelM));
      const strap = new THREE.Mesh(plate(-0.13, -0.09, 0, Math.PI * 2, 1.04), pbr("#151517", 0.7));
      this.torso.add(front, back, ...pecs, strap);
    }
    // Hips: the pants round the seat, joining the thighs; narrower than the shoulders.
    this.pelvis.add(new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), pantsM));
    this.pelvis.children[0].scale.set(0.135, 0.12, 0.195);
    // Hard elbow guards on the outside of the elbows and three alloy buckles on each boot.
    this.uppers.forEach((u, i) => {
      const guard = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), blackM);
      guard.position.set(-0.012, 0.13, i ? 0.022 : -0.022);
      guard.scale.set(0.75, 1.4, 0.8);
      u.add(guard);
    });
    this.bootShafts.forEach((s, i) => {
      for (const y of [-0.08, -0.01, 0.06]) {
        const buckle = new THREE.Mesh(boxGeo, pbr("#7f868f", 0.35, 0.8));
        buckle.position.set(0.035, y, i ? 0.085 : -0.085);
        buckle.scale.set(0.1, 0.02, 0.025);
        s.add(buckle);
      }
    });

    // Neck: a strong neck in the jersey collar, up into the helmet.
    const neckMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.07, 4, 14), pbr(look.jerseyDark, 0.85));
    neckMesh.position.set(0.01, 0.02, 0);
    this.neck.add(neckMesh);

    // Helmet after the JUST1 J22 / J40 sold at 67MOTO: a long shell; a long, angular chin
    // bar with a flat vent panel on its nose; a tall eye port, dark inside; the lower edge
    // sweeping up from the chin to the nape; and a big peak with real thickness, rising
    // forward and narrowing to its tip. x forward, y up, z to the side; R = shell radius.
    const R = 0.168;
    const sm = (a: number, b: number, v: number) => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const shellGeo = new THREE.SphereGeometry(1, 64, 44);
    {
      const pos = shellGeo.getAttribute("position");
      const col = new Float32Array(pos.count * 3);
      const lining = new THREE.Color("#141416");
      const c = new THREE.Color();
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        const y = pos.getY(k);
        const z = pos.getZ(k);
        let px = x * 1.06;
        let py = y;
        let pz = z * 0.88;
        // Chin bar: the lower front pulled far forward and down, narrowing...
        const chinK = sm(0.0, 0.75, x) * sm(0.1, -0.55, y);
        px += 0.78 * chinK;
        py -= 0.18 * chinK;
        pz *= 1 - 0.4 * chinK;
        // ...with a flat nose.
        if (px > 1.52) px = 1.52 + (px - 1.52) * 0.12;
        // Lower edge: low under the chin, rising to the back of the neck.
        const cut = -0.62 - 0.4 * sm(-0.3, 0.9, x);
        if (py < cut) py = cut + (py - cut) * 0.12;
        // A brow ridge over the eye port, and a crisp spoiler line at the back.
        px += 0.06 * sm(0.35, 0.8, x) * sm(0.38, 0.5, y) * sm(0.75, 0.6, y);
        px -= 0.04 * sm(-0.6, -0.9, x) * sm(0.1, -0.2, y);
        // Eye port: a tall recess between the brow and the chin bar, dark lining inside.
        const port = sm(0.3, 0.6, x) * sm(-0.3, -0.17, y) * sm(0.45, 0.32, y) * sm(0.8, 0.62, Math.abs(z));
        px -= 0.34 * port;
        pos.setXYZ(k, px * R, py * R, pz * R);
        c.setRGB(1, 1, 1).lerp(lining, sm(0.3, 0.65, port));
        col.set([c.r, c.g, c.b], k * 3);
      }
      shellGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      shellGeo.computeVertexNormals();
    }
    const shell = new THREE.Mesh(shellGeo, new THREE.MeshPhysicalMaterial({ map: kit.helmet, vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }));
    // Peak: a solid visor (top, underside and edge) on the brow, long and wide, rising
    // forward, narrowing to a slightly pointed tip.
    const peak = (() => {
      const nu = 24;
      const nv = 10;
      const T = 0.008; // thickness
      const top: THREE.Vector3[] = [];
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const u = -1 + (2 * i) / nu;
          const v = j / nv;
          const phi = u * 0.85;
          const ring = 0.84; // shell radius at the brow height
          const bx = Math.cos(phi) * ring * 1.06 * R;
          const bz = Math.sin(phi) * ring * 0.88 * R;
          const reach = 0.165 * (1 - 0.5 * u * u) * (1 + 0.06 * (1 - Math.abs(u)));
          const x = bx + v * reach * Math.cos(phi * 0.35);
          const zz = bz * (1 - 0.35 * v) + v * reach * Math.sin(phi * 0.35) * 0.25;
          // Rises about 16 degrees, a soft crest along the middle, the tip edge dipping.
          const y = 0.55 * R + v * 0.05 + 0.012 * (1 - u * u) * v - 0.01 * v ** 5;
          top.push(new THREE.Vector3(x, y, zz));
        }
      const pos: number[] = [];
      const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
      const at = (i: number, j: number, under = false) => {
        const p = top[j * (nu + 1) + i];
        return under ? new THREE.Vector3(p.x, p.y - T, p.z) : p;
      };
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
          quad(at(i, j, true), at(i + 1, j, true), at(i + 1, j + 1, true), at(i, j + 1, true));
        }
      // Edges: the tip and the two sides.
      for (let i = 0; i < nu; i++) quad(at(i, nv), at(i, nv, true), at(i + 1, nv, true), at(i + 1, nv));
      for (let j = 0; j < nv; j++) {
        quad(at(0, j), at(0, j, true), at(0, j + 1, true), at(0, j + 1));
        quad(at(nu, j), at(nu, j + 1), at(nu, j + 1, true), at(nu, j, true));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = pbr(look.helmet, 0.42, 0, 0.6).clone();
      m.side = THREE.DoubleSide;
      return new THREE.Mesh(g, m);
    })();
    // Vent panel on the nose of the chin bar, and a vent slot on the top of the peak.
    const ventM = pbr("#151517", 0.6);
    const vent = new THREE.Mesh(boxGeo, ventM);
    vent.position.set(1.53 * R, -0.6 * R, 0);
    vent.scale.set(0.01, 0.075, 0.06);
    vent.rotation.z = 0.12;
    const chin = new THREE.Group();
    const slot = new THREE.Mesh(boxGeo, ventM);
    slot.position.set(0.17, 0.112, 0);
    slot.scale.set(0.05, 0.004, 0.025);
    slot.rotation.z = 0.3;
    chin.add(slot);    // Goggles in the eye port: frame, mirrored lens, a glint.
    const goggles = new THREE.Group();
    const band = (r: number, h: number, arc: number, m: THREE.Material) => {
      const g = new THREE.CylinderGeometry(r, r, h, 24, 1, true, Math.PI / 2 - arc / 2, arc);
      return new THREE.Mesh(g, m);
    };
    const frameM = pbr("#1b1b1d", 0.5);
    const frame = band(0.162, 0.064, 1.75, frameM.clone());
    (frame.material as THREE.Material).side = THREE.DoubleSide;
    const lens = band(0.166, 0.044, 1.35, pbr(look.visor, 0.06, 0.9));
    goggles.add(frame, lens);
    goggles.position.y = 0.012;
    goggles.scale.set(1.08, 1, 0.9);
    // Strap round the back of the helmet only.
    const strapGeo = new THREE.TorusGeometry(0.171, 0.013, 6, 40, Math.PI * 1.35);
    strapGeo.rotateZ(Math.PI - Math.PI * 0.675);
    strapGeo.rotateX(Math.PI / 2);
    const strap = new THREE.Mesh(strapGeo, pbr(look.jersey, 0.8));
    strap.position.y = 0.012;
    strap.scale.set(1.08, 1, 0.9);
    const glint = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 }));
    glint.position.set(0.181, 0.022, 0.035);
    glint.scale.set(0.004, 0.01, 0.06);
    glint.rotation.x = 0.45;
    this.helmet.add(shell, peak, chin, vent, goggles, strap, glint);
    b.add(
      ...this.thighs,
      ...this.shins,
      ...this.bootShafts,
      ...this.boots,
      ...this.braces,
      ...this.uppers,
      ...this.fores,
      ...this.gloves,
      ...this.shoulders,
      this.torso,
      this.pelvis,
      this.neck,
      this.helmet,
    );

    // Bike details: BSE / T5 decals, footpegs, levers, engine covers.
    onPanel(() => decal(look, look.brand ?? "BSE", 0.42, 0.11), 6, T(925, 432), 0.42, 0.11, 0.06);
    const model = look.model ?? "T5";
    onPanel(() => decal(look, model, 0.06 * Math.max(2, model.length), 0.07), 6, T(1020, 478), 0.06 * Math.max(2, model.length), 0.07, 0);
    if (look.number) {
      // On the plain plastic below the side panel graphic, clear of the rider's leg.
      const num = look.number;
      onPanel(() => numberPlate(num, 0.17, 0.1), 4, T(515, 458), 0.17, 0.1, -0.2);
    } else onPanel(() => decal(look, look.brand ?? "BSE", 0.22, 0.06), 4, T(470, 400), 0.22, 0.06, 0.03);
    for (const z of [-0.17, 0.17]) {
      const peg = new THREE.Mesh(boxGeo, mat("#9aa0a8"));
      peg.position.set(POINTS.peg[0], POINTS.peg[1], z);
      peg.scale.set(0.09, 0.025, 0.07);
      st.add(peg);
    }
    for (const z of [-0.3, 0.3]) {
      const lever = rod(0.008, "#b8bcc2");
      span(lever, [POINTS.bar[0] + 0.02, POINTS.bar[1] - 0.005], [POINTS.bar[0] + 0.15, POINTS.bar[1] - 0.05], z);
      st.add(lever);
    }
    for (const [pt, r, color] of [
      [T(905, 705), 0.085, "#2c2d31"],
      [T(765, 725), 0.07, "#1e1f22"],
      [T(905, 705), 0.03, "#e8641e"],
    ] as const) {
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.02, 18), mat(color));
      cover.rotation.x = Math.PI / 2;
      cover.position.set(pt[0], pt[1], color === "#e8641e" ? 0.155 : 0.142);
      st.add(cover);
    }

    b.add(mergeStatic(st));
    this.root.add(b, this.rear, this.front);
    realMaterials(this.root, look);
    if (!isPlayer) {
      // Ghost and rivals are see-through and cast no shadow, so they never hide the player.
      const kind = ghost ? "ghost" : "rival";
      // Each rival owns its faded materials so it can fade further near the player.
      const own = new Map<THREE.Material, THREE.Material>();
      this.root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (!mesh.isMesh) return;
        const m = mesh.material as THREE.MeshLambertMaterial;
        let c = own.get(m);
        if (!c) {
          // Textured kit and decals keep their artwork, just faded.
          c = m.map ? m.clone() : fadedMat(m.color, kind).clone();
          c.transparent = true;
          c.opacity = FADE[kind].opacity;
          c.depthWrite = false;
          own.set(m, c);
          this.fadeMats.push(c);
        }
        mesh.material = c;
      });
      this.fadeBase = FADE[kind].opacity;
      this.tag = nameTag(look);
      this.root.add(this.tag);
    } else {
      shadowed(this.root);
      this.marker = playerMarker();
      this.halo = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.25, 48),
        new THREE.MeshBasicMaterial({ color: "#ffd21f", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      this.halo.rotation.x = -Math.PI / 2;
      this.root.add(this.marker, this.halo);
    }
  }

  // Rivals and the ghost: 1 = their normal see-through look, lower = fainter.
  setFade(k: number) {
    for (const m of this.fadeMats) m.opacity = this.fadeBase * k;
  }

  // Just the bike (a showroom display).
  hideRider() {
    for (const m of [...this.thighs, ...this.shins, ...this.bootShafts, ...this.boots, ...this.braces, ...this.uppers, ...this.fores, ...this.gloves, ...this.shoulders, this.torso, this.pelvis, this.neck, this.helmet]) m.visible = false;
  }

  update(bike: BikePose, time = 0, highlight = 0) {
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
    // Chain runs: lines between the tops and bottoms of the two sprockets.
    const [sx, sy] = FRONT_SPROCKET;
    const ul = Math.hypot(rl.x - sx, rl.y - sy);
    const [nx, ny] = [-(rl.y - sy) / ul, (rl.x - sx) / ul];
    span(this.chain[0], [sx + nx * 0.042, sy + ny * 0.042], [rl.x + nx * 0.1, rl.y + ny * 0.1], CHAIN_Z);
    span(this.chain[1], [sx - nx * 0.042, sy - ny * 0.042], [rl.x - nx * 0.1, rl.y - ny * 0.1], CHAIN_Z);
    // The caliper trails the fork leg just above the axle.
    this.caliper.position.set(fl.x + dx * 0.11 - dy * 0.06, fl.y + dy * 0.11 + dx * 0.06, 0.1);
    this.caliper.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;

    const pose = riderPose(bike.lean);
    const { hip, knee, foot, shoulder, elbow, hand, head, tilt } = pose;
    // Boot shaft covers the lower part of the shin; knee brace hinges on the outside.
    const bootTop: P2 = [foot[0] + (knee[0] - foot[0]) * 0.58, foot[1] + (knee[1] - foot[1]) * 0.58];
    [-0.16, 0.16].forEach((z, i) => {
      span(this.thighs[i], hip, knee, z, false);
      span(this.shins[i], knee, foot, z, false);
      span(this.bootShafts[i], [foot[0] + (knee[0] - foot[0]) * 0.12, foot[1] + (knee[1] - foot[1]) * 0.12], bootTop, z, false);
      span(this.braces[i], [knee[0] + (hip[0] - knee[0]) * 0.25, knee[1] + (hip[1] - knee[1]) * 0.25], [knee[0] + (foot[0] - knee[0]) * 0.25, knee[1] + (foot[1] - knee[1]) * 0.25], z + Math.sign(z) * 0.09, false);
      span(this.uppers[i], shoulder, elbow, z * 1.42, false);
      this.shoulders[i].position.set(shoulder[0], shoulder[1] - 0.01, z * 1.3);
      span(this.fores[i], elbow, hand, z * 1.35, false);
      this.boots[i].position.set(foot[0] + 0.05, foot[1] - 0.02, z);
      this.gloves[i].position.set(hand[0], hand[1], z * 1.35);
    });
    span(this.torso, hip, shoulder, 0, false);
    this.pelvis.position.set(hip[0], hip[1], 0);
    this.pelvis.rotation.z = this.torso.rotation.z;
    this.neck.position.set(shoulder[0] + Math.sin(tilt) * 0.09, shoulder[1] + Math.cos(tilt) * 0.09, 0);
    this.neck.rotation.z = -tilt;
    this.helmet.position.set(head[0], head[1], 0);
    this.helmet.rotation.z = 0.5 - tilt;

    if (this.tag) {
      const head = ch.getWorldPoint({ x: pose.head[0], y: pose.head[1] });
      this.tag.position.set(head.x, head.y + 0.55, 0);
    }
    if (this.marker) {
      // Bobbing arrow over the player's helmet, upright whatever the bike does; bigger at the start.
      const head = ch.getWorldPoint({ x: pose.head[0], y: pose.head[1] });
      const s = 1 + 0.6 * highlight;
      this.marker.scale.set(s, s, 1);
      this.marker.position.set(head.x, head.y + 0.85 + 0.3 * highlight + Math.sin(time * 5) * 0.06, 0);
    }
    if (this.halo) {
      // Pulsing ring on the ground under the player while the grid is crowded.
      const mat = this.halo.material as THREE.MeshBasicMaterial;
      mat.opacity = highlight * (0.45 + 0.25 * Math.sin(time * 6));
      this.halo.visible = highlight > 0.01;
      const ground = Math.min(bike.rear.getPosition().y, bike.front.getPosition().y) - BIKE_WHEEL_R + 0.02;
      this.halo.position.set(p.x, ground, 0);
      const r = 1 + 0.08 * Math.sin(time * 6);
      this.halo.scale.set(r, r, r);
    }
  }
}

// Bakes a bike's static parts into one mesh per material (dozens of draw calls -> a few).
// Textured parts (decals) stay separate.
function mergeStatic(group: THREE.Group) {
  const out = new THREE.Group();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const child of [...group.children]) {
    const mesh = child as THREE.Mesh;
    const material = mesh.material as THREE.MeshLambertMaterial;
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material) || material.map) {
      out.add(mesh);
      continue;
    }
    mesh.updateMatrix();
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    g.applyMatrix4(mesh.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    g.clearGroups();
    const list = buckets.get(material) ?? [];
    list.push(g);
    buckets.set(material, list);
  }
  for (const [material, geos] of buckets) {
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (merged) out.add(new THREE.Mesh(merged, material));
  }
  return out;
}

function luminance(hex: string) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

// Bike lettering: heavy italic text with an outline that contrasts with the plastics.
function decal(look: Look, text: string, w: number, h: number) {
  const dark = luminance(look.plastic) < 0.35;
  const fill = dark ? "#ffffff" : (look.accent ?? "#111111");
  const edge = dark ? (look.accent ?? "#111111") : "#ffffff";
  const tex = texture(
    canvas(512, Math.round((512 * h) / w), (ctx) => {
      const H = ctx.canvas.height;
      ctx.font = `italic 900 ${Math.round(H * 0.95)}px 'Arial Black', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = H * 0.12;
      ctx.strokeStyle = edge;
      ctx.strokeText(text, 256, H / 2, 500);
      ctx.fillStyle = fill;
      ctx.fillText(text, 256, H / 2, 500);
    }),
    false,
  );
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
}

// Side number plate: white rounded plate with a black outline and a heavy italic number.
function numberPlate(num: string, w: number, h: number) {
  const tex = texture(
    canvas(256, Math.round((256 * h) / w), (ctx) => {
      const H = ctx.canvas.height;
      ctx.fillStyle = "#f4f4f2";
      ctx.strokeStyle = "#1b1b1d";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.roundRect(6, 6, 244, H - 12, H * 0.22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#141416";
      ctx.font = `italic 900 ${Math.round(H * 0.74)}px 'Arial Black', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(num, 128, H * 0.54, 210);
    }),
    false,
  );
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false }));
}

// Fabric relief for the kit: a fine weave and soft folds, as a normal map (shared).
let fabricNormal: THREE.Texture | null = null;
function FABRIC_NORMAL() {
  if (fabricNormal) return fabricNormal;
  const S = 256;
  const h = new Float32Array(S * S);
  const r = rng(31);
  const waves = Array.from({ length: 7 }, () => ({ a: r() * Math.PI, f: 2 + Math.floor(r() * 4), p: r() * 6.3, k: 0.4 + r() * 0.6 }));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x / S) * Math.PI * 2;
      const v = (y / S) * Math.PI * 2;
      // Weave.
      let z = 0.08 * Math.sin(u * 48) * Math.sin(v * 48);
      // Folds: a few long soft creases running round the limb, bent a little.
      for (const w of waves) z += w.k * 0.35 * Math.pow(Math.abs(Math.sin(v * w.f + Math.sin(u * 2 + w.p) * 0.6 + w.p)), 6);
      h[y * S + x] = z;
    }
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const l = Math.hypot(dx * 3, dy * 3, 1);
      const o = (y * S + x) * 4;
      img.data[o] = ((-dx * 3) / l) * 127 + 128;
      img.data[o + 1] = ((-dy * 3) / l) * 127 + 128;
      img.data[o + 2] = (1 / l) * 127 + 128;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 2);
  fabricNormal = t;
  return t;
}

// Leatt-style kit textures. Capsules map u around and v along the bone (v = 1 at the far
// joint: shoulder, knee, hand), so collars, knee panels and cuffs sit at the top rows.
function kitTextures(look: Look) {
  const lighter = (hex: string, k: number) => "#" + new THREE.Color(hex).lerp(new THREE.Color("#ffffff"), k).getHexString();
  const logo = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, angle = 0) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.transform(1, 0, -0.25, 1, 0, 0);
    ctx.fillStyle = color;
    ctx.font = `900 ${size}px 'Arial Black', system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LEATT", 0, 0);
    ctx.restore();
  };
  const jersey = texture(
    canvas(256, 256, (ctx) => {
      ctx.fillStyle = look.jersey;
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = look.jerseyDark;
      ctx.fillRect(0, 0, 256, 16); // collar
      ctx.fillRect(0, 238, 256, 18); // hem
      // u = 0 faces the camera (the rider's side), so the logo sits there and opposite.
      for (const cx of [0, 128, 256]) {
        logo(ctx, cx, 78, 24, "#ffffff");
        ctx.fillStyle = "#ffffff";
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * 40, 70);
          ctx.lineTo(cx + s * 56, 64);
          ctx.lineTo(cx + s * 52, 90);
          ctx.lineTo(cx + s * 44, 88);
          ctx.closePath();
          ctx.fill();
        }
      }
    }),
    true,
  );
  const sleeve = texture(
    canvas(128, 128, (ctx) => {
      ctx.fillStyle = look.jersey;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(28, 0, 5, 128); // piping along the arm
      ctx.fillRect(92, 0, 5, 128);
      ctx.fillStyle = look.jerseyDark;
      ctx.fillRect(0, 0, 128, 12); // cuff / seam
    }),
    true,
  );
  const pants = texture(
    canvas(128, 256, (ctx) => {
      ctx.fillStyle = look.pants;
      ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = lighter(look.pants, 0.25);
      ctx.fillRect(36, 60, 56, 196); // lighter thigh panel
      ctx.fillStyle = "#18181a";
      ctx.fillRect(0, 0, 128, 58); // knee panel
      logo(ctx, 100, 170, 15, "#ffffff", -Math.PI / 2);
    }),
    true,
  );
  // Helmet graphics after the JUST1 J22: angular slashes sweeping back from the eye port,
  // big lettering low on each side, a thin accent line. Sphere uv: u = 0 at the back,
  // 0.25 on the right side, 0.5 at the front, 0.75 on the left; v = 1 at the crown.
  const helmet = texture(
    canvas(1024, 512, (ctx) => {
      const W = 1024;
      const H = 512;
      ctx.fillStyle = look.helmet;
      ctx.fillRect(0, 0, W, H);
      const light = luminance(look.helmet) < 0.45;
      const ink = light ? "#f2f2f0" : "#141416";
      for (const [cx, dir] of [
        [W * 0.25, 1],
        [W * 0.75, -1],
      ] as const) {
        // Slashes from the brow back over the crown and down the side.
        ctx.fillStyle = ink;
        for (const [y0, h, len] of [
          [0.18, 0.05, 0.3],
          [0.27, 0.035, 0.22],
        ]) {
          ctx.beginPath();
          ctx.moveTo(cx + dir * W * 0.2, H * y0);
          ctx.lineTo(cx + dir * W * (0.2 - len), H * (y0 + 0.06));
          ctx.lineTo(cx + dir * W * (0.2 - len - 0.02), H * (y0 + 0.06 + h));
          ctx.lineTo(cx + dir * W * 0.2, H * (y0 + h));
          ctx.closePath();
          ctx.fill();
        }
        // Accent line in the kit colour.
        ctx.fillStyle = look.jersey;
        ctx.beginPath();
        ctx.moveTo(cx + dir * W * 0.18, H * 0.4);
        ctx.lineTo(cx - dir * W * 0.16, H * 0.5);
        ctx.lineTo(cx - dir * W * 0.16, H * 0.52);
        ctx.lineTo(cx + dir * W * 0.18, H * 0.42);
        ctx.closePath();
        ctx.fill();
        // Big lettering low on the side, reading front to back on both sides.
        ctx.save();
        ctx.translate(cx + dir * W * 0.03, H * 0.66);
        ctx.transform(1, 0, -0.2, 1, 0, 0);
        ctx.font = `italic 900 ${H * 0.16}px 'Arial Black', system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = H * 0.018;
        ctx.strokeStyle = light ? "#141416" : "#f2f2f0";
        ctx.strokeText("JUST1", 0, 0, W * 0.3);
        ctx.fillStyle = ink;
        ctx.fillText("JUST1", 0, 0, W * 0.3);
        ctx.restore();
      }
      // A small logo on the brow, under the peak.
      ctx.fillStyle = ink;
      ctx.font = `900 ${H * 0.05}px 'Arial Black', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("J1", W * 0.5, H * 0.28);
    }),
    true,
  );  return { jersey, sleeve, pants, helmet };
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

// ---------- Garage showroom (main menu) ----------

// The bike at rest on flat ground: a real physics bike settled on its suspension.
export function restingPose(): BikePose {
  const world = new World({ gravity: { x: 0, y: -11 } });
  world.createBody().createFixture(new Edge({ x: -20, y: 0 }, { x: 20, y: 0 }), { friction: 0.9 });
  const bike = new Bike(world, { x: 0, y: 0 });
  for (let i = 0; i < 360; i++) {
    bike.apply({ gas: false, brake: true, lean: 0 }, 1 / 120);
    world.step(1 / 120, 8, 3);
  }
  return bike;
}

// The garage behind the main menu, after the 67MOTO showroom in Smolensk: a glossy floor of
// cream and white tiles, light walls with the big BSE sign, a dark stone wall with the
// 67MOTO logo, lightboxes with photos from the shop, ceiling light panels and a row of
// bikes along the wall. The player's bike stands on a blue mat in the middle.
function photoTex(url: string) {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A logo on white: load it and make the white see-through, so it sits on the wall like
// cut-out lettering.
function cutoutTex(url: string) {
  const c = document.createElement("canvas");
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.min(d.data[i], d.data[i + 1], d.data[i + 2]);
      if (v > 238) d.data[i + 3] = 0;
    }
    ctx.putImageData(d, 0, 0);
    t.dispose(); // the canvas changed size: allocate the GPU texture afresh
    t.needsUpdate = true;
  };
  img.src = url;
  return t;
}

// Background bikes in the showroom: different colourways of the same model, no rider.
const SHOWROOM_BIKES: { plastic: string; plasticDark: string; accent: string; x: number; z: number; yaw: number }[] = [
  { plastic: "#f2f2f2", plasticDark: "#1b1b1d", accent: "#ef7d1a", x: 2.4, z: -3.1, yaw: -0.6 },
  { plastic: "#ef7d1a", plasticDark: "#1b1b1d", accent: "#f2f2f2", x: 3.6, z: -3.0, yaw: -0.6 },
  { plastic: "#1f4fbf", plasticDark: "#f2f2f2", accent: "#f2f2f2", x: 4.8, z: -2.9, yaw: -0.6 },
  { plastic: "#d4202a", plasticDark: "#1b1b1d", accent: "#f2f2f2", x: 6.0, z: -2.8, yaw: -0.6 },
  { plastic: "#1b1b1d", plasticDark: "#1b1b1d", accent: "#e6e21c", x: -6.0, z: -1.2, yaw: 1.0 },
  { plastic: "#e6e21c", plasticDark: "#1b1b1d", accent: "#1b1b1d", x: -6.1, z: 0.3, yaw: 1.0 },
  { plastic: "#2fa84f", plasticDark: "#f2f2f2", accent: "#1b1b1d", x: -6.2, z: 1.8, yaw: 1.0 },
];

class Showroom {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
  bike: BikeModel | null = null;
  key = "";
  pose = restingPose();
  holder = new THREE.Group();
  private extras = false;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color("#d9dbdc");
    s.fog = new THREE.Fog("#d9dbdc", 11, 26);
    // Floor: 60 cm porcelain tiles, cream and white in a chequer, polished.
    const tiles = texture(
      canvas(1024, 1024, (ctx) => {
        const r = rng(5);
        for (let y = 0; y < 2; y++)
          for (let x = 0; x < 2; x++) {
            const cream = (x + y) % 2 === 0;
            ctx.fillStyle = cream ? "#d8c39c" : "#e9e7e2";
            ctx.fillRect(x * 512, y * 512, 512, 512);
            // Faint stone grain.
            for (let k = 0; k < 900; k++) {
              ctx.fillStyle = `rgba(${cream ? "120,90,50" : "150,150,150"},${0.03 + r() * 0.05})`;
              ctx.fillRect(x * 512 + r() * 512, y * 512 + r() * 512, 2 + r() * 6, 1 + r() * 3);
            }
          }
        ctx.strokeStyle = "#b9b2a6";
        ctx.lineWidth = 5;
        for (const p of [0, 512, 1024]) {
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, 1024);
          ctx.moveTo(0, p);
          ctx.lineTo(1024, p);
          ctx.stroke();
        }
      }),
      true,
    );
    tiles.repeat.set(40 / 1.2, 40 / 1.2);
    tiles.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.22, metalness: 0, envMapIntensity: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    // The blue display mat under the player's bike, with the shop's name.
    const matTex = texture(
      canvas(1024, 448, (ctx) => {
        ctx.fillStyle = "#1c2f86";
        ctx.fillRect(0, 0, 1024, 448);
        ctx.strokeStyle = "#e9e7e2";
        ctx.lineWidth = 10;
        ctx.strokeRect(22, 22, 980, 404);
        ctx.fillStyle = "#e9e7e2";
        ctx.font = "italic 900 78px system-ui, Arial, sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText("67МОТО", 970, 380);
      }),
      false,
    );
    const mat67 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.5), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }));
    mat67.rotation.x = -Math.PI / 2;
    mat67.position.set(-0.1, 0.006, 0);
    mat67.receiveShadow = true;
    s.add(floor, mat67);

    // Walls: light painted back wall, a dark stone feature wall on the left.
    const wall = new THREE.MeshStandardMaterial({ color: "#b9bcbd", roughness: 0.85 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), wall);
    back.position.set(0, 4, -4);
    back.receiveShadow = true;
    const stoneTex = texture(
      canvas(512, 512, (ctx) => {
        ctx.fillStyle = "#2a2722";
        ctx.fillRect(0, 0, 512, 512);
        const r = rng(9);
        for (let k = 0; k < 2600; k++) {
          const g = 25 + r() * 45;
          ctx.fillStyle = `rgba(${g + 12},${g + 8},${g},${0.25 + r() * 0.4})`;
          ctx.beginPath();
          ctx.ellipse(r() * 512, r() * 512, 2 + r() * 14, 1 + r() * 6, r() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let k = 0; k < 40; k++) {
          ctx.strokeStyle = `rgba(200,180,140,${0.05 + r() * 0.06})`;
          ctx.lineWidth = 1 + r() * 2;
          ctx.beginPath();
          let x = r() * 512;
          let y = r() * 512;
          ctx.moveTo(x, y);
          for (let q = 0; q < 6; q++) ctx.lineTo((x += (r() - 0.5) * 80), (y += (r() - 0.3) * 60));
          ctx.stroke();
        }
      }),
      true,
    );
    stoneTex.repeat.set(4, 2);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(16, 8), new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.6 }));
    left.rotation.y = Math.PI / 2;
    left.position.set(-7, 4, 2);
    left.receiveShadow = true;
    // A white pillar where the walls meet, and a skirting line.
    const pillar = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: "#eeeeec", roughness: 0.7 }));
    pillar.scale.set(0.7, 8, 0.7);
    pillar.position.set(-6.7, 4, -3.7);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.MeshStandardMaterial({ color: "#e4e4e2", roughness: 0.9 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.7, 4);
    s.add(back, left, pillar, ceiling);

    // Signs: the big BSE lettering on the back wall, the 67MOTO logo on the stone.
    const bse = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshBasicMaterial({ map: cutoutTex(new URL("./assets/67moto/bse-logo.png", import.meta.url).href), transparent: true, toneMapped: false }));
    bse.position.set(-0.9, 2.95, -3.97);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.85, 48), new THREE.MeshBasicMaterial({ map: photoTex(new URL("./assets/67moto/logo-512.png", import.meta.url).href), transparent: true, toneMapped: false }));
    logo.rotation.y = Math.PI / 2;
    logo.position.set(-6.97, 2.55, -1.2);
    s.add(bse, logo);

    // Lightboxes with photos from the shop: a slim aluminium frame round a glowing print.
    const frameMat = new THREE.MeshStandardMaterial({ color: "#9ea3a9", roughness: 0.3, metalness: 0.9 });
    const lightbox = (url: string, w: number, h: number, pos: [number, number, number], yaw: number) => {
      const g = new THREE.Group();
      const frame = new THREE.Mesh(boxGeo, frameMat);
      frame.scale.set(w + 0.08, h + 0.08, 0.05);
      const photo = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: photoTex(url), toneMapped: false, color: "#f2f2f2" }));
      photo.position.z = 0.027;
      g.add(frame, photo);
      g.position.set(...pos);
      g.rotation.y = yaw;
      s.add(g);
    };
    lightbox(new URL("./assets/67moto/showroom.jpg", import.meta.url).href, 2.6, 1.12, [-4.5, 2.1, -3.96], 0);
    lightbox(new URL("./assets/67moto/bse-t5.webp", import.meta.url).href, 1.25, 1.29, [1.9, 2.05, -3.96], 0);
    lightbox(new URL("./assets/67moto/showroom-3.jpg", import.meta.url).href, 1.9, 1.42, [-6.96, 2.3, 1.6], Math.PI / 2);
    lightbox(new URL("./assets/67moto/showroom-2.jpg", import.meta.url).href, 1.45, 1.3, [-6.96, 2.3, 3.8], Math.PI / 2);
    lightbox(new URL("./assets/67moto/service.jpg", import.meta.url).href, 1.7, 1.27, [4.2, 2.05, -3.96], 0);

    // Ceiling light panels (and the light they give).
    const panelMat = new THREE.MeshBasicMaterial({ color: "#fbfbf6", toneMapped: false });
    for (const x of [-4.5, -1.5, 1.5, 4.5])
      for (const z of [-2, 1.5, 5]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), panelMat);
        p.rotation.x = Math.PI / 2;
        p.position.set(x, 3.69, z);
        s.add(p);
      }
    s.add(new THREE.HemisphereLight("#ffffff", "#b9a98b", 0.75));
    for (const [x, z] of [
      [-3, -1],
      [2.5, -1],
      [0, 3],
    ]) {
      const l = new THREE.PointLight("#fff7ea", 3.2, 10, 1.4);
      l.position.set(x, 3.4, z);
      s.add(l);
    }
    const spot = new THREE.SpotLight("#fff6e6", 26, 14, 0.55, 0.5, 1.2);
    spot.position.set(1.2, 6, 3);
    spot.target.position.set(0, 0.6, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(2048, 2048);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.025;
    s.add(spot, spot.target, this.holder);
  }

  // The row of bikes along the walls (built once, from the first look, without riders).
  private addRow(look: Look) {
    for (const b of SHOWROOM_BIKES) {
      const m = new BikeModel({ ...look, plastic: b.plastic, plasticDark: b.plasticDark, accent: b.accent, number: undefined }, true);
      if (m.marker) m.marker.visible = false;
      if (m.halo) m.halo.visible = false;
      m.update(this.pose, 0, 0);
      m.hideRider();
      const c = this.pose.chassis.getPosition();
      const inner = new THREE.Group();
      inner.add(m.root);
      m.root.position.set(-c.x, -this.groundOffset(), 0);
      inner.position.set(b.x, 0, b.z);
      inner.rotation.y = b.yaw;
      this.scene.add(inner);
    }
  }
  setLook(look: Look) {
    const key = JSON.stringify(look);
    if (key === this.key) return;
    this.key = key;
    if (this.bike) {
      this.holder.remove(this.bike.root);
      this.bike.root.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.geometry && mesh.geometry !== rodGeo && mesh.geometry !== boxGeo) mesh.geometry.dispose();
      });
    }
    if (!this.extras) {
      this.extras = true;
      this.addRow(look);
    }
    this.bike = new BikeModel(look, true);
    if (this.bike.marker) this.bike.marker.visible = false;
    if (this.bike.halo) this.bike.halo.visible = false;
    this.bike.update(this.pose, 0, 0);
    // Center the bike on the turntable.
    const c = this.pose.chassis.getPosition();
    this.bike.root.position.set(-c.x - 0.15, -this.groundOffset(), 0);
    this.holder.add(this.bike.root);
  }

  // Height of the tyres' contact patch in the pose (the ground line of the physics world).
  private groundOffset() {
    return Math.min(this.pose.rear.getPosition().y - WHEEL_R.rear, this.pose.front.getPosition().y - WHEEL_R.front);
  }
}

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
  env: THREE.Texture;
  dust = new Dust();
  dustPts = dustPoints(this.dust);
  drifting: THREE.Mesh[] = []; // cloud strips
  // Blurred grass along the bottom of the screen, riding with the camera (see draw()).
  fg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, fog: false, depthWrite: false }));

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
    this.sun.shadow.normalBias = 0.03;
    this.fg.renderOrder = 10;
    this.camera.add(this.fg);
    // A soft studio environment for reflections on the bikes' paint, metal and helmets
    // (the scenery uses flat materials and ignores it).
    const pm = new THREE.PMREMGenerator(this.gl);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.8;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world, this.sky, this.dustPts, this.camera);
    this.resize();
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.gl.setSize(this.w, this.h, false);
    // Point size in pixels = meters * uScale / depth.
    (this.dustPts.material as THREE.ShaderMaterial).uniforms.uScale.value = (this.h * this.gl.getPixelRatio()) / 2 / TAN;
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
    this.drifting = this.world.children.filter((n): n is THREE.Mesh => !!n.userData.drift);
    this.dust.reset();
    // Dust takes the color of the dirt, dimmed at night.
    (this.dustPts.material as THREE.ShaderMaterial).uniforms.uColor.value.set(theme.track.lip).lerp(new THREE.Color("#fff4e0"), 0.35).multiplyScalar(theme.stars ? 0.65 : 1);

    if (theme.sun) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: theme.sun.color, fog: false }));
      disc.name = "sun";
      // Glow with soft rays around the sun, added on top of the sky.
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: texture(sunGlow(theme.sun.glow, !theme.stars), false), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      glow.name = "glow";
      this.sky.add(glow, disc);
    }
    const fgMat = this.fg.material as THREE.MeshBasicMaterial;
    fgMat.map?.dispose();
    fgMat.map = texture(paintForeground(theme), false);
    fgMat.map.wrapS = THREE.RepeatWrapping;
    fgMat.needsUpdate = true;
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

  private showroom: Showroom | null = null;
  showroomYaw = 0; // extra turn from dragging, radians

  // Main menu: the player's bike in the garage, the camera drifting around it.
  drawShowroom(look: Look, time: number) {
    if (!this.showroom) {
      this.showroom = new Showroom();
      this.showroom.scene.environment = this.env;
      this.showroom.scene.environmentIntensity = 0.55;
    }
    const sr = this.showroom;
    sr.setLook(look);
    const cam = sr.camera;
    if (cam.aspect !== this.w / this.h) {
      cam.aspect = this.w / this.h;
      cam.updateProjectionMatrix();
    }
    const yaw = 0.62 + Math.sin(time * 0.18) * 0.22 + this.showroomYaw;
    // Wide screens: frame the bike a little right of center, where the menu leaves room.
    const r = this.w / this.h > 1.5 ? 5.8 : 6.8;
    cam.position.set(Math.sin(yaw) * r, 1.7, Math.cos(yaw) * r);
    cam.lookAt(0, 1.0, 0);
    cam.setViewOffset(this.w, this.h, -this.w * 0.05, 0, this.w, this.h);
    this.gl.render(sr.scene, cam);
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
    const glow = this.sky.getObjectByName("glow");
    if (glow && sun) {
      glow.position.copy(sun.position).setZ(-far + 1);
      glow.scale.setScalar(sun.scale.x * 9);
    }
    const stars = this.sky.getObjectByName("stars");
    if (stars) stars.position.set(cam.x, cam.y, -far + 20);
    // Clouds drift; the foreground strip hugs the bottom of the view and scrolls faster
    // than the track (by the stable base scale, so zooming does not slide it).
    for (const m of this.drifting) (m.material as THREE.MeshBasicMaterial).map!.offset.x = (time * m.userData.drift) % 1;
    const fgH = 2 * FG_DIST * TAN; // view height at that distance
    const fgW = fgH * this.camera.aspect;
    const fh = fgH * FOREGROUND.height;
    this.fg.scale.set(fgW, fh, 1);
    this.fg.position.set(0, -fgH / 2 + fh / 2, -FG_DIST);
    const fgMap = (this.fg.material as THREE.MeshBasicMaterial).map;
    if (fgMap) {
      const img = fgMap.image as HTMLCanvasElement;
      const tilePx = (img.width * (this.h * FOREGROUND.height)) / img.height; // one tile on screen
      fgMap.repeat.set(this.w / tilePx, 1);
      fgMap.offset.x = ((cam.x * this.basePpm() * FOREGROUND.parallax) / tilePx) % 1;
    }

    const live = new Set<BikePose>();
    const playerView = riders.find((r) => r.isPlayer);
    const playerX = playerView?.bike.chassis.getPosition().x ?? Infinity;
    const startPhase = playerView?.highlight ?? 0;
    riders.forEach((r, i) => {
      live.add(r.bike);
      let m = this.bikes.get(r.bike);
      if (!m) {
        m = new BikeModel(r.look, r.isPlayer, r.ghost);
        m.root.position.z = r.ghost ? GHOST_LANE : (LANES[i] ?? -1.6);
        this.bikes.set(r.bike, m);
        this.scene.add(m.root);
      }
      m.update(r.bike, time, r.highlight ?? 0);
      if (!r.isPlayer) {
        // Near the player (and on the start grid) rivals and the ghost fade out further and
        // drop their name tags, so the only solid, labelled rider there is the player.
        const near = Math.abs(r.bike.chassis.getPosition().x - playerX) < NEAR_PLAYER;
        m.setFade((1 - 0.6 * startPhase) * (near ? 0.5 : 1));
        if (m.tag) m.tag.visible = !near && startPhase < 0.5;
      }
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
        m.fadeMats.forEach((mat) => mat.dispose());
        this.bikes.delete(bike);
      }

    const d = this.dust;
    d.update(riders, track, time, (i) => (riders[i].ghost ? GHOST_LANE : (LANES[i] ?? -1.6)));
    const g = this.dustPts.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const size = g.getAttribute("aSize") as THREE.BufferAttribute;
    const alpha = g.getAttribute("aAlpha") as THREE.BufferAttribute;
    const shade = g.getAttribute("aShade") as THREE.BufferAttribute;
    for (let i = 0; i < d.max; i++) {
      const [s, a] = d.look(i);
      pos.setXYZ(i, d.x[i], d.y[i], d.z[i]);
      size.setX(i, s);
      alpha.setX(i, a);
      shade.setX(i, d.shade[i]);
    }
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = shade.needsUpdate = true;

    this.gl.render(this.scene, this.camera);
  }
}
