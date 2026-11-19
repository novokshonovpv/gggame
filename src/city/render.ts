// Top-down drawing on a 2D canvas. The ground is flat; buildings and trees rise towards a
// camera hanging above the screen centre, so their roofs slide outwards as you ride past
// (the classic look of the old top-down city games, drawn from scratch here).

import { BRIDGE, BUILD, type Building, CityMap, GRASS, LOT, ROAD, SAND, T, WALK, WATER } from "./map.ts";
import type { Ped, Vehicle, World } from "./sim.ts";

export interface Camera {
  x: number;
  y: number;
  zoom: number; // screen pixels per world unit (CSS pixels)
}

const COL = {
  water: "#2a6f97",
  road: "#45484d",
  bridge: "#55585c",
  walk: "#a5a49e",
  walkBridge: "#8c9095",
  grass: "#4f8a3c",
  lot: "#3d4045",
  sand: "#d9c38f",
  build: "#2b2b2b",
};

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, colors: string[], size: [number, number]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    const s = size[0] + Math.random() * (size[1] - size[0]);
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

function makePatterns(ctx: CanvasRenderingContext2D) {
  const mk = (px: number, units: number, paint: (g: CanvasRenderingContext2D, s: number) => void) => {
    const c = canvas(px, px);
    const g = c.getContext("2d")!;
    paint(g, px);
    const p = ctx.createPattern(c, "repeat")!;
    p.setTransform(new DOMMatrix().scale(units / px));
    return p;
  };
  return {
    grass: mk(128, 64, (g, s) => {
      g.fillStyle = COL.grass;
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 500, ["#5a9845", "#46803a", "#629f4b", "#3f7434"], [2, 4]);
    }),
    sand: mk(128, 64, (g, s) => {
      g.fillStyle = COL.sand;
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 400, ["#cdb47f", "#e3cf9f", "#c9ae78"], [1, 3]);
    }),
    road: mk(128, 64, (g, s) => {
      g.fillStyle = COL.road;
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 700, ["#4b4e53", "#3f4247", "#505357"], [1, 2.5]);
    }),
    lot: mk(128, 64, (g, s) => {
      g.fillStyle = COL.lot;
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 500, ["#44474c", "#383b40"], [1, 2.5]);
    }),
    walk: mk(64, 32, (g, s) => {
      g.fillStyle = COL.walk;
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 120, ["#adaca6", "#9b9a94"], [1, 2]);
      g.strokeStyle = "rgba(60,60,55,0.35)";
      g.lineWidth = 2;
      g.strokeRect(0, 0, s, s);
      g.beginPath();
      g.moveTo(s / 2, 0);
      g.lineTo(s / 2, s);
      g.moveTo(0, s / 2);
      g.lineTo(s, s / 2);
      g.lineWidth = 1;
      g.stroke();
    }),
    water: (() => {
      const c = canvas(128, 128);
      const g = c.getContext("2d")!;
      g.fillStyle = COL.water;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = "rgba(255,255,255,0.13)";
      g.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        g.beginPath();
        g.arc(x, y, 8 + Math.random() * 6, Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
      return ctx.createPattern(c, "repeat")!;
    })(),
  };
}

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private pat: ReturnType<typeof makePatterns>;
  private mini: HTMLCanvasElement;
  w = 0;
  h = 0;
  dpr = 1;
  view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private canvasEl: HTMLCanvasElement;
  private map: CityMap;

  constructor(canvasEl: HTMLCanvasElement, map: CityMap) {
    this.canvasEl = canvasEl;
    this.map = map;
    this.ctx = canvasEl.getContext("2d", { alpha: false })!;
    this.pat = makePatterns(this.ctx);
    this.mini = this.makeMini();
    this.resize();
  }

  resize() {
    const c = this.canvasEl;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = c.clientWidth || window.innerWidth;
    this.h = c.clientHeight || window.innerHeight;
    c.width = Math.round(this.w * this.dpr);
    c.height = Math.round(this.h * this.dpr);
  }

  private makeMini() {
    const map = this.map;
    const c = canvas(map.n, map.n);
    const g = c.getContext("2d")!;
    const img = g.createImageData(map.n, map.n);
    const rgb: Record<number, [number, number, number]> = {
      [WATER]: [42, 98, 140],
      [ROAD]: [200, 200, 200],
      [BRIDGE]: [200, 200, 200],
      [WALK]: [120, 120, 118],
      [BUILD]: [55, 55, 60],
      [GRASS]: [70, 120, 60],
      [LOT]: [90, 90, 95],
      [SAND]: [190, 170, 120],
    };
    for (let i = 0; i < map.n * map.n; i++) {
      const [r, gg, b] = rgb[map.tiles[i]] ?? [0, 0, 0];
      img.data[i * 4] = r;
      img.data[i * 4 + 1] = gg;
      img.data[i * 4 + 2] = b;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  draw(world: World, cam: Camera, t: number) {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const z = cam.zoom;
    const vw = w / z;
    const vh = h / z;
    const v = (this.view = { x0: cam.x - vw / 2, y0: cam.y - vh / 2, x1: cam.x + vw / 2, y1: cam.y + vh / 2 });
    world.view = v;
    // Camera height for the perspective of buildings: scales with the view so the lean stays the same on screen.
    const Hc = Math.max(vw, vh) * 0.95;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sea first, drifting slowly.
    this.pat.water.setTransform(new DOMMatrix().translate(((-cam.x + t * 6) * z) % 128, ((-cam.y + t * 3) * z) % 128).scale(z * 0.5));
    ctx.fillStyle = this.pat.water;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(z * dpr, 0, 0, z * dpr, (w / 2 - cam.x * z) * dpr, (h / 2 - cam.y * z) * dpr);

    this.drawGround(v);
    this.drawMarkings(v);
    this.drawPlaces(world, t);
    this.drawSkids(world);
    this.drawPickups(world, t);
    this.drawJobs(world, t);

    // Bodies on the ground, then everything with wheels.
    const p = world.player;
    for (const q of world.peds) if (q.state === "down" || q.state === "fly") this.drawPed(q, t);
    if (p.mode === "fly" || p.mode === "out") this.drawPed(p.body, t);
    const vis = (x: number, y: number, m: number) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60)) this.shadow(veh);
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60) && veh.down) this.drawVehicle(veh, world, t);
    for (const q of world.peds) if (q.state !== "down" && q.state !== "fly" && vis(q.x, q.y, 20)) this.drawPed(q, t);
    if (p.mode === "foot") {
      ctx.strokeStyle = `rgba(255,210,40,${0.5 + 0.3 * Math.sin(t * 6)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.body.x, p.body.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      this.drawPed(p.body, t);
    }
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60) && !veh.down) this.drawVehicle(veh, world, t);
    this.drawParticles(world);

    this.drawTall(world, cam, Hc);
    this.drawTarget(world, t, cam, Hc);

    // Screen space: arrow to the job and the bust warning.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawArrow(world, cam, t);
    if (p.bust > 0.05 && p.mode !== "out") {
      ctx.fillStyle = `rgba(30,60,200,${Math.min(0.35, p.bust * 0.25)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (p.health < 30 && p.mode !== "out") {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      g.addColorStop(0, "rgba(180,0,0,0)");
      g.addColorStop(1, `rgba(180,0,0,${0.25 + 0.12 * Math.sin(t * 5)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ---------- ground ----------

  private drawGround(v: { x0: number; y0: number; x1: number; y1: number }) {
    const ctx = this.ctx;
    const map = this.map;
    const tx0 = Math.max(0, Math.floor(v.x0 / T));
    const ty0 = Math.max(0, Math.floor(v.y0 / T));
    const tx1 = Math.min(map.n - 1, Math.floor(v.x1 / T));
    const ty1 = Math.min(map.n - 1, Math.floor(v.y1 / T));
    const [ry0, ry1] = map.river;
    const fill = (t: number, y: number) => {
      switch (t) {
        case ROAD:
          return this.pat.road;
        case BRIDGE:
          return COL.bridge;
        case WALK:
          return y >= ry0 && y <= ry1 ? COL.walkBridge : this.pat.walk;
        case GRASS:
          return this.pat.grass;
        case LOT:
          return this.pat.lot;
        case SAND:
          return this.pat.sand;
        default:
          return COL.build;
      }
    };
    for (let y = ty0; y <= ty1; y++) {
      let x = tx0;
      while (x <= tx1) {
        const t = map.at(x, y);
        let e = x;
        while (e + 1 <= tx1 && map.at(e + 1, y) === t) e++;
        if (t !== WATER) {
          ctx.fillStyle = fill(t, y);
          // Overlap a hair to hide seams between runs.
          ctx.fillRect(x * T, y * T, (e - x + 1) * T + 0.5, T + 0.5);
        }
        x = e + 1;
      }
    }
    // Kerbs and embankment edges.
    ctx.beginPath();
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx0; x <= tx1; x++) {
        if (map.at(x, y) !== WALK) continue;
        const r = (dx: number, dy: number) => {
          const n = map.at(x + dx, y + dy);
          return n === ROAD || n === BRIDGE;
        };
        if (r(1, 0)) ctx.rect((x + 1) * T - 2, y * T, 2, T);
        if (r(-1, 0)) ctx.rect(x * T, y * T, 2, T);
        if (r(0, 1)) ctx.rect(x * T, (y + 1) * T - 2, T, 2);
        if (r(0, -1)) ctx.rect(x * T, y * T, T, 2);
      }
    ctx.fillStyle = "#c9c8c1";
    ctx.fill();
    ctx.beginPath();
    for (let y = ty0; y <= ty1; y++)
      for (let x = tx0; x <= tx1; x++) {
        const t = map.at(x, y);
        if (t === WATER) continue;
        if (map.at(x + 1, y) === WATER) ctx.rect((x + 1) * T - 3, y * T, 3, T);
        if (map.at(x - 1, y) === WATER) ctx.rect(x * T, y * T, 3, T);
        if (map.at(x, y + 1) === WATER) ctx.rect(x * T, (y + 1) * T - 3, T, 3);
        if (map.at(x, y - 1) === WATER) ctx.rect(x * T, y * T, T, 3);
      }
    ctx.fillStyle = "rgba(40,45,50,0.55)";
    ctx.fill();
    // Bridge railings.
    for (const wl of map.walls) {
      if (wl.x1 < v.x0 || wl.x0 > v.x1 || wl.y1 < v.y0 || wl.y0 > v.y1) continue;
      ctx.fillStyle = "#d8d8d2";
      ctx.fillRect(wl.x0, wl.y0, wl.x1 - wl.x0, wl.y1 - wl.y0);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(wl.x0 + (wl.x1 - wl.x0) * 0.5, wl.y0, (wl.x1 - wl.x0) * 0.5, wl.y1 - wl.y0);
    }
    // Car-park bays.
    ctx.strokeStyle = "rgba(235,235,225,0.55)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const l of map.lots) {
      if ((l.x1 + 1) * T < v.x0 || l.x0 * T > v.x1 || (l.y1 + 1) * T < v.y0 || l.y0 * T > v.y1) continue;
      for (let x = l.x0; x <= l.x1 + 1; x++) {
        ctx.moveTo(x * T, l.y0 * T + 3);
        ctx.lineTo(x * T, l.y0 * T + T * 0.7);
        ctx.moveTo(x * T, (l.y1 + 1) * T - 3);
        ctx.lineTo(x * T, (l.y1 + 1) * T - T * 0.7);
      }
    }
    ctx.stroke();
  }

  private drawMarkings(v: { x0: number; y0: number; x1: number; y1: number }) {
    const ctx = this.ctx;
    const map = this.map;
    const V = map.vroads;
    const H = map.hroads;
    ctx.strokeStyle = "rgba(240,240,230,0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([9, 9]);
    ctx.beginPath();
    for (const hy of H) {
      const y = (hy + 1) * T;
      if (y < v.y0 - T || y > v.y1 + T) continue;
      for (let i = 0; i + 1 < V.length; i++) {
        const a = Math.max((V[i] + 3) * T, v.x0 - 20);
        const b = Math.min((V[i + 1] - 1) * T, v.x1 + 20);
        if (a >= b) continue;
        const s = a - (a % 18);
        ctx.moveTo(Math.max(s, (V[i] + 3) * T), y);
        ctx.lineTo(b, y);
      }
    }
    for (const vx of V) {
      const x = (vx + 1) * T;
      if (x < v.x0 - T || x > v.x1 + T) continue;
      for (let i = 0; i + 1 < H.length; i++) {
        const ry0 = map.river[0] * T;
        const ry1 = (map.river[1] + 1) * T;
        let a = Math.max((H[i] + 3) * T, v.y0 - 20);
        let b = Math.min((H[i + 1] - 1) * T, v.y1 + 20);
        if (a >= b) continue;
        a = Math.max(a - (a % 18), (H[i] + 3) * T);
        if (a < ry1 && b > ry0) b = Math.min(b, (H[i + 1] - 1) * T);
        ctx.moveTo(x, a);
        ctx.lineTo(x, b);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Zebra crossings and stop lines at every crossing in view.
    ctx.fillStyle = "rgba(240,240,230,0.8)";
    for (const vx of V)
      for (const hy of H) {
        const cx = (vx + 1) * T;
        const cy = (hy + 1) * T;
        if (cx < v.x0 - 3 * T || cx > v.x1 + 3 * T || cy < v.y0 - 3 * T || cy > v.y1 + 3 * T) continue;
        const zebraH = (col: number) => {
          if (map.at(col, hy) !== ROAD) return;
          for (let k = 0; k < 8; k++) ctx.fillRect(col * T + 5, hy * T + 2 + k * 8, T - 10, 4);
        };
        const zebraV = (row: number) => {
          if (map.at(vx, row) !== ROAD) return;
          for (let k = 0; k < 8; k++) ctx.fillRect(vx * T + 2 + k * 8, row * T + 5, 4, T - 10);
        };
        zebraH(vx - 1);
        zebraH(vx + 2);
        zebraV(hy - 1);
        zebraV(hy + 2);
        // Stop lines on the incoming lanes.
        if (map.at(vx - 1, hy) === ROAD) ctx.fillRect((vx - 1) * T - 3, (hy + 1) * T, 2.5, T);
        if (map.at(vx + 2, hy) === ROAD) ctx.fillRect((vx + 3) * T + 0.5, hy * T, 2.5, T);
        if (map.at(vx, hy - 1) === ROAD) ctx.fillRect(vx * T, (hy - 1) * T - 3, T, 2.5);
        if (map.at(vx, hy + 2) === ROAD) ctx.fillRect((vx + 1) * T, (hy + 3) * T + 0.5, T, 2.5);
      }
  }

  private drawPlaces(world: World, t: number) {
    const ctx = this.ctx;
    const v = this.view;
    for (const pl of world.map.places) {
      if (pl.kind !== "garage" && pl.kind !== "shop") continue;
      if (pl.x < v.x0 - 120 || pl.x > v.x1 + 120 || pl.y < v.y0 - 120 || pl.y > v.y1 + 120) continue;
      const col = pl.kind === "garage" ? "#2f8fe0" : "#b45ce6";
      ctx.save();
      ctx.translate(pl.x, pl.y);
      ctx.fillStyle = pl.kind === "garage" ? "rgba(47,143,224,0.22)" : "rgba(180,92,230,0.22)";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -t * 12;
      ctx.beginPath();
      ctx.roundRect(-30, -30, 60, 60, 6);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 7px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pl.kind === "garage" ? "МОТОСЕРВИС" : "МОТОСАЛОН", 0, 20);
      // Icon: a spanner or a price tag.
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      if (pl.kind === "garage") {
        ctx.moveTo(-8, 6);
        ctx.lineTo(5, -7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(7, -9, 5, Math.PI * 0.9, Math.PI * 2.6);
        ctx.stroke();
      } else {
        ctx.font = "bold 18px system-ui, sans-serif";
        ctx.fillText("$", 0, -3);
      }
      ctx.lineCap = "butt";
      ctx.restore();
    }
  }

  private drawSkids(world: World) {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.6;
    for (const s of world.skids) {
      ctx.strokeStyle = `rgba(20,20,20,${0.45 * Math.min(1, s.life * 1.5)})`;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  private drawPickups(world: World, t: number) {
    const ctx = this.ctx;
    const v = this.view;
    for (const k of world.pickups) {
      if (k.respawn > 0 || k.x < v.x0 - 20 || k.x > v.x1 + 20 || k.y < v.y0 - 20 || k.y > v.y1 + 20) continue;
      const bob = Math.sin(t * 3 + k.x) * 1.5;
      ctx.save();
      ctx.translate(k.x, k.y + bob);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(2, 6 - bob, 7, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      if (k.kind === "cash") {
        ctx.scale(Math.cos(t * 2.5 + k.y) * 0.4 + 0.8, 1);
        ctx.fillStyle = "#3e9a3a";
        ctx.fillRect(-8, -5, 16, 10);
        ctx.strokeStyle = "#bff0a8";
        ctx.lineWidth = 1;
        ctx.strokeRect(-6.5, -3.5, 13, 7);
        ctx.fillStyle = "#e9ffd9";
        ctx.font = "bold 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("$", 0, 0.5);
      } else {
        ctx.fillStyle = "#f4f4f4";
        ctx.fillRect(-7, -7, 14, 14);
        ctx.fillStyle = "#d32f2f";
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(-5, -2, 10, 4);
      }
      ctx.restore();
    }
  }

  private drawJobs(world: World, t: number) {
    const ctx = this.ctx;
    const v = this.view;
    if (world.job) return;
    for (const s of world.map.jobs) {
      if (s.x < v.x0 - 40 || s.x > v.x1 + 40 || s.y < v.y0 - 40 || s.y > v.y1 + 40) continue;
      const col = s.kind === "delivery" ? "#3ddc6e" : s.kind === "race" ? "#ff9f1a" : "#ff3b3b";
      const pulse = 1 + Math.sin(t * 4) * 0.12;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 18 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1.4;
      if (s.kind === "delivery") {
        ctx.strokeRect(-5, -4, 10, 8);
        ctx.beginPath();
        ctx.moveTo(-5, -1);
        ctx.lineTo(5, -1);
        ctx.moveTo(0, -4);
        ctx.lineTo(0, 4);
        ctx.stroke();
      } else if (s.kind === "race") {
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) ctx.fillRect(-4.5 + i * 3, -4.5 + j * 3, 3, 3);
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.quadraticCurveTo(6, 0, 3, 5);
        ctx.lineTo(-3, 5);
        ctx.quadraticCurveTo(-6, 0, 0, -6);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------- things that move ----------

  private shadow(v: Vehicle) {
    const ctx = this.ctx;
    if (v.sink > 0) return;
    ctx.save();
    ctx.translate(v.x + 2.5, v.y + 3.5);
    ctx.rotate(v.a);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    if (v.bike) ctx.ellipse(0, 0, v.model.len / 2, v.down ? 6 : 4, 0, 0, Math.PI * 2);
    else ctx.roundRect(-v.model.len / 2, -v.model.wid / 2, v.model.len, v.model.wid, 4);
    ctx.fill();
    ctx.restore();
  }

  private drawVehicle(v: Vehicle, world: World, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.a);
    if (v.sink > 0) {
      ctx.globalAlpha = Math.max(0, 1 - v.sink / 2.2);
      const s = Math.max(0.5, 1 - v.sink * 0.2);
      ctx.scale(s, s);
    }
    if (v.bike) this.drawBike(v, world, t);
    else this.drawCar(v, t);
    ctx.restore();
  }

  private drawCar(v: Vehicle, t: number) {
    const ctx = this.ctx;
    const L = v.model.len;
    const W = v.model.wid;
    const id = v.model.id;
    const body = v.wreck ? "#2b2724" : v.color;
    const glass = v.wreck ? "#151515" : "#1e2c38";
    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, id === "bus" ? 3 : 4.5);
    ctx.fill();
    ctx.stroke();
    if (id === "bus") {
      ctx.fillStyle = glass;
      ctx.fillRect(L / 2 - 6, -W / 2 + 2, 4, W - 4);
      ctx.fillRect(-L / 2 + 4, -W / 2 + 0.8, L - 12, 2.2);
      ctx.fillRect(-L / 2 + 4, W / 2 - 3, L - 12, 2.2);
      ctx.fillStyle = shade(body.startsWith("#") ? body : "#888888", 1.15);
      ctx.fillRect(-L / 2 + 6, -W / 2 + 4, L - 16, W - 8);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(-8, -4, 12, 8);
      ctx.fillRect(-26, -4, 10, 8);
    } else if (id === "van") {
      ctx.fillStyle = glass;
      ctx.fillRect(L * 0.24, -W / 2 + 2, L * 0.12, W - 4);
      ctx.fillStyle = shade(body.startsWith("#") ? body : "#888888", 1.08);
      ctx.fillRect(-L / 2 + 2, -W / 2 + 2, L * 0.72, W - 4);
    } else {
      // Bonnet, windscreen, roof, rear window.
      ctx.fillStyle = glass;
      ctx.beginPath();
      ctx.moveTo(L * 0.3, -W / 2 + 1.5);
      ctx.lineTo(L * 0.3, W / 2 - 1.5);
      ctx.lineTo(L * 0.1, W / 2 - 2.2);
      ctx.lineTo(L * 0.1, -W / 2 + 2.2);
      ctx.fill();
      ctx.fillRect(-L * 0.36, -W / 2 + 2.2, L * 0.1, W - 4.4);
      ctx.fillStyle = v.wreck ? "#1d1b1a" : shade(body.startsWith("#") ? body : "#888888", 1.12);
      ctx.fillRect(-L * 0.26, -W / 2 + 2, L * 0.36, W - 4);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(L * 0.32, -0.4, L * 0.16, 0.8);
    }
    if (!v.wreck) {
      ctx.fillStyle = "#fff6c8";
      ctx.fillRect(L / 2 - 2, -W / 2 + 1.5, 2, 3);
      ctx.fillRect(L / 2 - 2, W / 2 - 4.5, 2, 3);
      ctx.fillStyle = v.brk > 0 && v.speed > 5 ? "#ff3020" : "#8a1a14";
      ctx.fillRect(-L / 2, -W / 2 + 1.5, 1.6, 3);
      ctx.fillRect(-L / 2, W / 2 - 4.5, 1.6, 3);
    }
    if (id === "taxi" && !v.wreck) {
      ctx.fillStyle = "#222";
      ctx.fillRect(-4, -3, 6, 6);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-4, -3, 3, 3);
      ctx.fillRect(-1, 0, 3, 3);
    }
    if (v.police && !v.wreck) {
      ctx.fillStyle = "#1f4fb8";
      ctx.fillRect(-L / 2 + 3, -W / 2, L - 8, 1.8);
      ctx.fillRect(-L / 2 + 3, W / 2 - 1.8, L - 8, 1.8);
      ctx.fillStyle = "#111";
      ctx.fillRect(-L * 0.18, -2, L * 0.2, 4);
      const on = v.chase && Math.floor(t * 8) % 2 === 0;
      ctx.fillStyle = v.chase ? (on ? "#ff2a2a" : "#5a1010") : "#7a2020";
      ctx.fillRect(-4, -W / 2 + 2, 4, W / 2 - 2);
      ctx.fillStyle = v.chase ? (!on ? "#2a6bff" : "#10205a") : "#203070";
      ctx.fillRect(-4, 0, 4, W / 2 - 2);
      if (v.chase) {
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(-2, on ? -4 : 4, 0, -2, on ? -4 : 4, 26);
        g.addColorStop(0, on ? "rgba(255,40,40,0.45)" : "rgba(40,100,255,0.45)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(-30, -30, 60, 60);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    if (v.hit > 0) {
      ctx.fillStyle = `rgba(255,255,255,${v.hit * 1.6})`;
      ctx.beginPath();
      ctx.roundRect(-L / 2, -W / 2, L, W, 4);
      ctx.fill();
    }
  }

  private drawBike(v: Vehicle, world: World, t: number) {
    const ctx = this.ctx;
    const L = v.model.len;
    const id = v.model.id;
    const body = v.wreck ? "#2b2724" : v.color;
    if (v.down) {
      // Lying on its side: seen from above it shows its profile.
      const r = L * 0.2;
      ctx.fillStyle = "#151515";
      ctx.beginPath();
      ctx.arc(-L * 0.32, 0, r, 0, Math.PI * 2);
      ctx.arc(L * 0.32, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#777";
      ctx.beginPath();
      ctx.arc(-L * 0.32, 0, r * 0.4, 0, Math.PI * 2);
      ctx.arc(L * 0.32, 0, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#888";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-L * 0.32, 0);
      ctx.lineTo(0, -2.5);
      ctx.lineTo(L * 0.32, 0);
      ctx.moveTo(L * 0.32, 0);
      ctx.lineTo(L * 0.22, -r - 2);
      ctx.stroke();
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(-L * 0.02, -3, L * 0.22, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const W = v.model.wid;
    // Tyres.
    ctx.fillStyle = "#121212";
    ctx.fillRect(-L / 2, -1.6, L * 0.3, 3.2);
    ctx.save();
    ctx.translate(L * 0.35, 0);
    ctx.rotate(v.steer * 0.35);
    ctx.fillRect(-L * 0.15, -1.5, L * 0.3, 3);
    ctx.restore();
    // Bodywork.
    ctx.fillStyle = body;
    ctx.beginPath();
    if (id === "scooter") {
      ctx.roundRect(-L * 0.32, -W * 0.38, L * 0.62, W * 0.76, 3);
      ctx.fill();
      ctx.fillRect(L * 0.18, -W * 0.48, 3, W * 0.96);
    } else if (id === "chopper") {
      ctx.ellipse(-L * 0.05, 0, L * 0.26, W * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#bbb";
      ctx.fillRect(L * 0.2, -0.8, L * 0.18, 1.6);
    } else if (id === "sport") {
      ctx.moveTo(L * 0.45, 0);
      ctx.lineTo(L * 0.18, -W * 0.45);
      ctx.lineTo(-L * 0.38, -W * 0.25);
      ctx.lineTo(-L * 0.38, W * 0.25);
      ctx.lineTo(L * 0.18, W * 0.45);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.ellipse(0, 0, L * 0.32, W * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(L * 0.3, -1, L * 0.18, 2);
    }
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(-L * 0.3, -W * 0.18, L * 0.3, W * 0.36);
    // Handlebar.
    const bar = id === "chopper" ? W * 0.75 : W * 0.6;
    const hx = id === "sport" ? L * 0.2 : L * 0.25;
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(hx, -bar);
    ctx.lineTo(hx, bar);
    ctx.stroke();
    ctx.fillStyle = "#fff6c8";
    ctx.fillRect(L / 2 - 1.5, -1, 1.5, 2);
    if (v.brk > 0 && v.speed > 5 && !v.wreck) {
      ctx.fillStyle = "#ff3020";
      ctx.fillRect(-L / 2 - 0.5, -1, 1.5, 2);
    }
    if (v.rider) {
      const p = world.player;
      const look = v.rider === "player" ? { jacket: p.body.shirt, helmet: p.body.helmet ?? "#ff7a1a" } : v.look;
      const lean = v.lean * 2.6;
      const sx = id === "sport" ? 2 : id === "chopper" ? -3 : 0;
      ctx.save();
      ctx.translate(sx, lean);
      // Arms to the grips.
      ctx.strokeStyle = look.jacket;
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-1, -3.5);
      ctx.lineTo(hx - sx - 1, -bar + 0.6 - lean * 0.3);
      ctx.moveTo(-1, 3.5);
      ctx.lineTo(hx - sx - 1, bar - 0.6 - lean * 0.3);
      ctx.stroke();
      ctx.lineCap = "butt";
      // Back and shoulders.
      ctx.fillStyle = look.jacket;
      ctx.beginPath();
      ctx.ellipse(-2.5, 0, 4, 4.6, 0, 0, Math.PI * 2);
      ctx.fill();
      // Helmet with a visor towards the front.
      ctx.fillStyle = look.helmet;
      ctx.beginPath();
      ctx.arc(0.5, 0, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(20,25,35,0.85)";
      ctx.beginPath();
      ctx.arc(0.5, 0, 3.4, -0.9, 0.9);
      ctx.lineTo(1.6, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc(-0.4, -1.2, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    if (v.hit > 0) {
      ctx.fillStyle = `rgba(255,255,255,${v.hit * 1.6})`;
      ctx.fillRect(-L / 2, -W / 2, L, W);
    }
    void t;
  }

  private drawPed(q: Ped, t: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(q.x, q.y);
    ctx.rotate(q.a);
    if (q.state === "swim") ctx.globalAlpha = Math.max(0, q.t);
    if (q.state === "down" || q.state === "fly") {
      ctx.fillStyle = q.pants;
      ctx.beginPath();
      ctx.ellipse(-5, -1.6, 4, 1.6, 0.1, 0, Math.PI * 2);
      ctx.ellipse(-5, 1.6, 4, 1.6, -0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = q.shirt;
      ctx.beginPath();
      ctx.ellipse(0.5, 0, 4, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = q.shirt;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(1, -3);
      ctx.lineTo(4, -6.5);
      ctx.moveTo(1, 3);
      ctx.lineTo(3, 6.8);
      ctx.stroke();
      ctx.fillStyle = q.helmet ?? q.hair;
      ctx.beginPath();
      ctx.arc(6, 0, q.helmet ? 3.2 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const swing = Math.sin(q.phase) * 3.2;
    ctx.fillStyle = q.pants;
    ctx.beginPath();
    ctx.ellipse(swing, -1.8, 2.2, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(-swing, 1.8, 2.2, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = q.shirt;
    ctx.beginPath();
    ctx.ellipse(-swing * 0.6, -4.4, 1.6, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(swing * 0.6, 4.4, 1.6, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, 2.6, 4.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 0.6;
    ctx.stroke();
    if (q.helmet) {
      ctx.fillStyle = q.helmet;
      ctx.beginPath();
      ctx.arc(0.3, 0, 3.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(20,25,35,0.85)";
      ctx.beginPath();
      ctx.arc(0.3, 0, 3.1, -0.85, 0.85);
      ctx.lineTo(1.3, 0);
      ctx.fill();
    } else {
      ctx.fillStyle = q.hair;
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    void t;
  }

  private drawParticles(world: World) {
    const ctx = this.ctx;
    for (const q of world.particles) {
      const a = Math.max(0, q.life / q.max);
      if (q.kind === "fire" || q.kind === "spark") ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `${q.color}${(q.kind === "smoke" || q.kind === "dust" ? a * 0.5 : a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---------- buildings and trees ----------

  private drawTall(world: World, cam: Camera, Hc: number) {
    const ctx = this.ctx;
    const v = this.view;
    const map = world.map;
    // Trees: low, so they barely lean.
    const kt = Hc / (Hc - 30);
    for (const tr of map.trees) {
      if (tr.x < v.x0 - 30 || tr.x > v.x1 + 30 || tr.y < v.y0 - 30 || tr.y > v.y1 + 30) continue;
      const x = cam.x + (tr.x - cam.x) * kt;
      const y = cam.y + (tr.y - cam.y) * kt;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.arc(tr.x + 4, tr.y + 5, tr.r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#2f6b2a";
      ctx.beginPath();
      ctx.arc(x, y, tr.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3f8a37";
      ctx.beginPath();
      ctx.arc(x - tr.r * 0.25, y - tr.r * 0.25, tr.r * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#58a84b";
      ctx.beginPath();
      ctx.arc(x - tr.r * 0.4, y - tr.r * 0.4, tr.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    const list: Building[] = [];
    for (const b of map.buildings) {
      if ((b.x1 + 1) * T < v.x0 || b.x0 * T > v.x1 || (b.y1 + 1) * T < v.y0 || b.y0 * T > v.y1) continue;
      list.push(b);
    }
    list.sort((a, b) => a.h - b.h);
    for (const b of list) this.drawBuilding(b, cam, Hc);
  }

  private drawBuilding(b: Building, cam: Camera, Hc: number) {
    const ctx = this.ctx;
    const x0 = b.x0 * T;
    const y0 = b.y0 * T;
    const x1 = (b.x1 + 1) * T;
    const y1 = (b.y1 + 1) * T;
    const k = Hc / (Hc - Math.min(b.h, Hc * 0.42));
    const P = (x: number, y: number, kk = k): [number, number] => [cam.x + (x - cam.x) * kk, cam.y + (y - cam.y) * kk];
    const wall = (ax: number, ay: number, bx: number, by: number, light: number) => {
      const [rax, ray] = P(ax, ay);
      const [rbx, rby] = P(bx, by);
      ctx.fillStyle = shade(b.wall, light);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(rbx, rby);
      ctx.lineTo(rax, ray);
      ctx.closePath();
      ctx.fill();
      // Floors and window columns.
      ctx.strokeStyle = b.kind === "glass" ? "rgba(190,225,255,0.28)" : "rgba(0,0,0,0.18)";
      ctx.lineWidth = b.kind === "glass" ? 1.2 : 1;
      ctx.beginPath();
      for (let hh = 11; hh < Math.min(b.h, Hc * 0.42) - 4; hh += 11) {
        const kk = Hc / (Hc - hh);
        const [p1x, p1y] = P(ax, ay, kk);
        const [p2x, p2y] = P(bx, by, kk);
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
      }
      const len = Math.hypot(bx - ax, by - ay);
      const cols = Math.floor(len / 9);
      for (let i = 1; i < cols; i++) {
        const f = i / cols;
        const qx = ax + (bx - ax) * f;
        const qy = ay + (by - ay) * f;
        const [rx, ry] = P(qx, qy);
        ctx.moveTo(qx, qy);
        ctx.lineTo(rx, ry);
      }
      ctx.stroke();
    };
    if (cam.y > y1) wall(x0, y1, x1, y1, 0.62);
    if (cam.y < y0) wall(x0, y0, x1, y0, 0.9);
    if (cam.x < x0) wall(x0, y0, x0, y1, 0.8);
    if (cam.x > x1) wall(x1, y0, x1, y1, 0.7);
    // Roof, drawn in footprint coordinates scaled about the camera.
    ctx.save();
    ctx.translate(cam.x * (1 - k), cam.y * (1 - k));
    ctx.scale(k, k);
    const w = x1 - x0;
    const h = y1 - y0;
    ctx.fillStyle = b.roof;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = shade(b.roof, 1.25);
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, h - 3);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 3.2, y0 + 3.2, w - 6.4, h - 6.4);
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    if (b.kind === "hospital") {
      ctx.fillStyle = "#d32f2f";
      const s = Math.min(w, h) * 0.5;
      ctx.fillRect(cx - s * 0.17, cy - s / 2, s * 0.34, s);
      ctx.fillRect(cx - s / 2, cy - s * 0.17, s, s * 0.34);
    } else if (b.kind === "police") {
      ctx.fillStyle = "#e8eef8";
      ctx.font = `bold ${Math.min(w / 6.5, 14)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ПОЛИЦИЯ", cx, cy);
    } else {
      // Vents, air conditioners, a helipad on the tallest.
      let s = b.seed;
      const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      if (b.h > T * 6.5 && w >= 2.5 * T && h >= 2.5 * T) {
        ctx.strokeStyle = "#e9e3c8";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(w, h) * 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#e9e3c8";
        ctx.font = `bold ${Math.min(w, h) * 0.32}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("H", cx, cy + 1);
      } else {
        const n = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          const bw = 6 + rnd() * 8;
          const bh = 5 + rnd() * 7;
          const bx = x0 + 6 + rnd() * Math.max(1, w - 12 - bw);
          const by = y0 + 6 + rnd() * Math.max(1, h - 12 - bh);
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(bx + 1.5, by + 1.5, bw, bh);
          ctx.fillStyle = shade(b.roof, 1.3);
          ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = "rgba(0,0,0,0.3)";
          ctx.strokeRect(bx, by, bw, bh);
        }
        if (rnd() < 0.5) {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.beginPath();
          ctx.arc(x0 + w * (0.2 + rnd() * 0.6), y0 + h * (0.2 + rnd() * 0.6), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  // ---------- job guidance ----------

  private jobTarget(world: World) {
    const job = world.job;
    if (!job) return null;
    return job.points[job.idx];
  }

  private drawTarget(world: World, t: number, cam: Camera, Hc: number) {
    const ctx = this.ctx;
    const job = world.job;
    const p = this.jobTarget(world);
    if (!job || !p) return;
    const col = job.kind === "race" ? "#ff9f1a" : job.kind === "hot" ? "#ff3b3b" : "#3ddc6e";
    const r = job.kind === "race" ? 46 : 26;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.lineDashOffset = t * 20;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // A floating chevron above the spot (leans like a tall thing).
    const k = Hc / (Hc - 40 - Math.sin(t * 4) * 6);
    const x = cam.x + (p.x - cam.x) * k;
    const y = cam.y + (p.y - cam.y) * k;
    ctx.fillStyle = col;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x - 9, y - 4);
    ctx.lineTo(x - 3, y - 4);
    ctx.lineTo(x - 3, y - 14);
    ctx.lineTo(x + 3, y - 14);
    ctx.lineTo(x + 3, y - 4);
    ctx.lineTo(x + 9, y - 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Next race checkpoint, faint.
    const nxt = job.points[job.idx + 1];
    if (job.kind === "race" && nxt) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nxt.x, nxt.y, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawArrow(world: World, cam: Camera, t: number) {
    const ctx = this.ctx;
    const p = this.jobTarget(world);
    if (!p || world.player.mode === "out") return;
    const px = (world.px - cam.x) * cam.zoom + this.w / 2;
    const py = (world.py - cam.y) * cam.zoom + this.h / 2;
    const tx = (p.x - cam.x) * cam.zoom + this.w / 2;
    const ty = (p.y - cam.y) * cam.zoom + this.h / 2;
    const d = Math.hypot(tx - px, ty - py);
    if (d < 60) return;
    const a = Math.atan2(ty - py, tx - px);
    const col = world.job!.kind === "race" ? "#ff9f1a" : world.job!.kind === "hot" ? "#ff3b3b" : "#3ddc6e";
    const r = 54 + Math.sin(t * 6) * 3;
    ctx.save();
    ctx.translate(px + Math.cos(a) * r, py + Math.sin(a) * r);
    ctx.rotate(a);
    ctx.fillStyle = col;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-6, -11);
    ctx.lineTo(-2, 0);
    ctx.lineTo(-6, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // ---------- minimap ----------

  drawMinimap(c: HTMLCanvasElement, world: World, t: number) {
    const dpr = this.dpr;
    const size = c.clientWidth || 140;
    if (c.width !== Math.round(size * dpr)) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    const g = c.getContext("2d")!;
    const map = world.map;
    const span = 44; // tiles across
    const s = (size * dpr) / span;
    const cx = world.px / T;
    const cy = world.py / T;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#1e4a66";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(s, 0, 0, s, c.width / 2 - cx * s, c.height / 2 - cy * s);
    g.drawImage(this.mini, 0, 0);
    const dot = (x: number, y: number, col: string, r: number) => {
      // Clamp to the edge so far targets still show their direction.
      const half = span / 2 - 1;
      const dx = Math.max(-half, Math.min(half, x / T - cx));
      const dy = Math.max(-half, Math.min(half, y / T - cy));
      g.fillStyle = col;
      g.beginPath();
      g.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const pl of map.places) {
      if (pl.kind === "garage") dot(pl.x, pl.y, "#2f8fe0", 1.1);
      if (pl.kind === "shop") dot(pl.x, pl.y, "#c36cf0", 1.1);
      if (pl.kind === "hospital") dot(pl.x, pl.y, "#ff5a5a", 0.9);
    }
    if (!world.job) for (const j of map.jobs) dot(j.x, j.y, j.kind === "delivery" ? "#3ddc6e" : j.kind === "race" ? "#ff9f1a" : "#ff3b3b", 1);
    const flash = Math.floor(t * 6) % 2 === 0;
    for (const v of world.vehicles)
      if (v.police && v.chase && Math.abs(v.x / T - cx) < span / 2 && Math.abs(v.y / T - cy) < span / 2) dot(v.x, v.y, flash ? "#ff3030" : "#3060ff", 0.8);
    const target = this.jobTarget(world);
    if (target) dot(target.x, target.y, "#ffe14a", 1.3 + (flash ? 0.3 : 0));
    // The player: an arrowhead.
    const a = world.player.mode === "ride" && world.player.bike ? world.player.bike.a : world.player.body.a;
    g.save();
    g.translate(cx, cy);
    g.rotate(a);
    g.fillStyle = "#fff";
    g.strokeStyle = "#000";
    g.lineWidth = 0.25;
    g.beginPath();
    g.moveTo(1.4, 0);
    g.lineTo(-1, -0.95);
    g.lineTo(-0.5, 0);
    g.lineTo(-1, 0.95);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}
