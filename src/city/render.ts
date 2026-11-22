// Top-down drawing on a 2D canvas. The ground is flat; buildings and trees rise towards a
// camera hanging above the screen centre, so their roofs slide outwards as you ride past
// (the classic look of the old top-down city games, drawn from scratch here).

import { BRIDGE, BUILD, type Building, type Chunk, CityMap, DIRT, type Lamp, GRASS, LOT, type Obstacle, ROAD, SAND, T, WALK, WATER } from "./map.ts";
import { BRAND_BY_ID, BRANDS, type Brand } from "./brands.ts";
import { type Ped, type Vehicle, type World, darkness } from "./sim.ts";

// The 67MOTO logo for the showroom and the rooftop billboards.
const LOGO = new Image();
LOGO.src = new URL("../assets/67moto/logo-512.png", import.meta.url).href;
const BRAND = "#d9b778";

// Brand logos for the billboards (files from the 67moto.ru site, in public/brands).
const LOGOS: Record<string, HTMLImageElement> = {};
for (const b of BRANDS) {
  const img = new Image();
  img.src = new URL(`brands/${b.id}.webp`, document.baseURI).href;
  LOGOS[b.id] = img;
}

// Where each billboard ended up on screen this frame (CSS pixels), for clicks.
export interface AdHit {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  brand: Brand;
}

const BRAND_FONT = "Unbounded, system-ui, sans-serif";

const hash = (...n: number[]) => {
  let h = 2166136261;
  for (const v of n) h = Math.imul(h ^ (v | 0), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

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
    dirt: mk(128, 64, (g, s) => {
      g.fillStyle = "#8a6a44";
      g.fillRect(0, 0, s, s);
      noise(g, s, s, 700, ["#7d5f3c", "#96764e", "#6e5232", "#a08058"], [1.5, 4]);
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
  private light = canvas(1, 1);
  private lg = this.light.getContext("2d")!;
  private dark = 0;
  adHits: AdHit[] = [];
  private chunks: Chunk[] = [];
  private lampsInView: Lamp[] = [];
  lightsT = 0; // game minutes, to switch windows on and off now and then

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
      [DIRT]: [150, 110, 70],
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
    this.adHits.length = 0;
    this.chunks = this.map.inView(v.x0, v.y0, v.x1, v.y1);
    this.lampsInView = this.chunks.flatMap((c) => c.lamps);
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
    this.drawLamps(v);
    this.drawPlaces(world, t);
    this.drawSkids(world);
    this.drawStadium(world, t);
    this.drawObstacles();
    this.drawPickups(world, t);
    this.drawPhones(world, t);
    this.drawPackages(world, t);
    this.drawJobs(world, t);

    // Bodies on the ground, then everything with wheels.
    const p = world.player;
    for (const q of world.peds) if (q.state === "down" || q.state === "fly") this.drawPed(q, t, false);
    if (p.mode === "fly" || p.mode === "out") this.drawPed(p.body, t, false);
    const vis = (x: number, y: number, m: number) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60)) this.shadow(veh);
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60) && veh.down) this.drawVehicle(veh, world, t);
    for (const q of world.peds) if (q.state !== "down" && q.state !== "fly" && vis(q.x, q.y, 20)) this.drawPed(q, t, false);
    if (p.mode === "foot") {
      ctx.strokeStyle = `rgba(255,210,40,${0.5 + 0.3 * Math.sin(t * 6)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.body.x, p.body.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      this.drawPed(p.body, t, !!world.weapon);
    }
    for (const veh of world.vehicles) if (vis(veh.x, veh.y, 60) && !veh.down) this.drawVehicle(veh, world, t);
    this.drawParticles(world);
    this.drawBullets(world);

    this.dark = darkness(world.clock);
    if (this.dark > 0.01) this.drawNight(world, cam, this.dark, t);
    this.drawTall(cam, Hc);
    // Bikes in the air fly over the low roofs' shadows; drawn again on top while high.
    for (const veh of world.vehicles) if (veh.z > 14 && vis(veh.x, veh.y, 60)) this.drawVehicle(veh, world, t);
    this.drawHeli(world, t);
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
    const fill = (t: number, y: number) => {
      switch (t) {
        case ROAD:
          return this.pat.road;
        case BRIDGE:
          return COL.bridge;
        case WALK:
          return map.inRiver(y) ? COL.walkBridge : this.pat.walk;
        case GRASS:
          return this.pat.grass;
        case LOT:
          return this.pat.lot;
        case DIRT:
          return this.pat.dirt;
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
        let a = Math.max((H[i] + 3) * T, v.y0 - 20);
        const b = Math.min((H[i + 1] - 1) * T, v.y1 + 20);
        if (a >= b) continue;
        a = Math.max(a - (a % 18), (H[i] + 3) * T);
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
      const col = pl.kind === "garage" ? "#2f8fe0" : BRAND;
      ctx.save();
      ctx.translate(pl.x, pl.y);
      ctx.fillStyle = pl.kind === "garage" ? "rgba(47,143,224,0.22)" : "rgba(28,26,23,0.75)";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -t * 12;
      ctx.beginPath();
      ctx.roundRect(-30, -30, 60, 60, 6);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pl.kind === "garage" ? "#fff" : BRAND;
      ctx.font = `800 6px ${BRAND_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pl.kind === "garage" ? "СЕРВИС 67МОТО" : "САЛОН 67МОТО", 0, 22, 56);
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
      } else if (LOGO.complete && LOGO.naturalWidth) ctx.drawImage(LOGO, -17, -21, 34, 34);
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
        ctx.fillText("₽", 0, 0.5);
      } else if (k.kind === "surprise") {
        // Mystery crate: wood with a glowing question mark.
        const glow = 0.55 + 0.45 * Math.sin(t * 5 + k.x);
        ctx.fillStyle = `rgba(255,210,60,${0.25 * glow})`;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(Math.sin(t * 1.5 + k.y) * 0.15);
        ctx.fillStyle = "#8a5a2b";
        ctx.fillRect(-8, -8, 16, 16);
        ctx.strokeStyle = "#c48a4a";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(-7, -7, 14, 14);
        ctx.beginPath();
        ctx.moveTo(-7, -7);
        ctx.lineTo(7, 7);
        ctx.stroke();
        ctx.fillStyle = "#ffd23a";
        ctx.strokeStyle = "#3a2410";
        ctx.lineWidth = 1.6;
        ctx.font = "900 13px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.strokeText("?", 0, 1);
        ctx.fillText("?", 0, 1);
      } else if (k.kind === "coin") {
        ctx.scale(Math.cos(t * 4 + k.x) * 0.5 + 0.6, 1);
        ctx.fillStyle = "#f2c230";
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#a87a10";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#7a5508";
        ctx.font = "bold 8px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("₽", 0, 0.5);
      } else if (k.kind !== "health") {
        // Weapon crate with the gun's outline on the lid.
        ctx.fillStyle = "#6b4a2b";
        ctx.fillRect(-8, -7, 16, 14);
        ctx.strokeStyle = "#a8794a";
        ctx.lineWidth = 1.2;
        ctx.strokeRect(-7, -6, 14, 12);
        ctx.fillStyle = "#f2e6cf";
        const len = k.kind === "pistol" ? 7 : k.kind === "smg" ? 10 : k.kind === "rocket" ? 13 : 12;
        ctx.fillRect(-len / 2, -2.2, len, 2.4);
        ctx.fillRect(-len / 2 + (k.kind === "pistol" ? 0 : 1.5), -0.5, 2, 4);
        if (k.kind === "smg") ctx.fillRect(1, 0, 1.6, 3.5);
        if (k.kind === "shotgun") ctx.fillRect(-len / 2 - 1.5, -2.2, 3, 3.2);
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

  // A billboard: the brand's logo and a "see it at 67MOTO" strip. Clickable.
  private adBoard(bx: number, by: number, bw: number, bh: number, brand: Brand) {
    const ctx = this.ctx;
    const dark = this.dark;
    const img = LOGOS[brand.id];
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(bx + 3, by + 3, bw, bh);
    // Frame and legs-free board.
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
    const strip = bh * 0.2;
    const lh = bh - strip;
    ctx.fillStyle = brand.dark ? "#13151c" : "#ffffff";
    ctx.fillRect(bx, by, bw, lh);
    if (img.complete && img.naturalWidth) {
      // Contain the 2:1 logo in the board.
      const s = Math.min(bw / img.naturalWidth, lh / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.drawImage(img, bx + (bw - w) / 2, by + (lh - h) / 2, w, h);
    }
    ctx.fillStyle = BRAND;
    ctx.fillRect(bx, by + lh, bw, strip);
    ctx.fillStyle = "#1c1a17";
    ctx.font = `800 ${strip * 0.62}px Manrope, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("смотреть в 67МОТО ↗", bx + bw / 2, by + lh + strip * 0.55, bw - 4);
    if (dark > 0.05) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(255,240,210,${0.12 * dark})`;
      ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
      ctx.globalCompositeOperation = "source-over";
    }
    // Remember where it is on screen.
    const m = ctx.getTransform();
    const d = this.dpr;
    const x0 = (m.a * bx + m.c * by + m.e) / d;
    const y0 = (m.b * bx + m.d * by + m.f) / d;
    const x1 = (m.a * (bx + bw) + m.c * (by + bh) + m.e) / d;
    const y1 = (m.b * (bx + bw) + m.d * (by + bh) + m.f) / d;
    this.adHits.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), brand });
  }

  // The billboard under a point on the screen (CSS pixels), if any.
  adAt(x: number, y: number) {
    for (let i = this.adHits.length - 1; i >= 0; i--) {
      const h = this.adHits[i];
      if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h.brand;
    }
    return null;
  }

  // ---------- stadium, obstacles, phones, packages ----------

  private drawStadium(world: World, t: number) {
    const st = world.map.stadium;
    const v = this.view;
    if (!st || st.rect.x1 < v.x0 || st.rect.x0 > v.x1 || st.rect.y1 < v.y0 || st.rect.y0 > v.y1) return;
    const ctx = this.ctx;
    const P = st.path;
    // The racing line: packed darker dirt with tyre tracks.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(60,40,22,0.35)";
    ctx.lineWidth = 92;
    ctx.beginPath();
    P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "rgba(40,26,14,0.35)";
    ctx.lineWidth = 2;
    for (const off of [-16, -6, 8, 18]) {
      ctx.setLineDash([22, 9]);
      ctx.beginPath();
      P.forEach((q, i) => (i ? ctx.lineTo(q.x + off * 0.3, q.y + off) : ctx.moveTo(q.x + off * 0.3, q.y + off)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Gates: a flag each side; start/finish chequered.
    const job = world.job?.kind === "stadium" ? world.job : null;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      const n = P[(i + 1) % P.length];
      const a = Math.atan2(n.y - q.y, n.x - q.x) + Math.PI / 2;
      const next = job && (job.idx + 1) % P.length === i;
      for (const sgn of [-1, 1]) {
        const fx = q.x + Math.cos(a) * 50 * sgn;
        const fy = q.y + Math.sin(a) * 50 * sgn;
        ctx.fillStyle = "#3a2a1a";
        ctx.fillRect(fx - 1, fy - 1, 2, 2);
        ctx.fillStyle = next ? "#ffd23a" : i === 0 ? "#fff" : sgn < 0 ? "#e53935" : "#1e88e5";
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + 9 + Math.sin(t * 6 + i) * 1.5, fy - 4);
        ctx.lineTo(fx, fy - 8);
        ctx.fill();
      }
      if (i === 0) {
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(a);
        for (let k = -5; k < 5; k++)
          for (let j = 0; j < 2; j++) {
            ctx.fillStyle = (k + j) % 2 === 0 ? "#111" : "#f4f4f4";
            ctx.fillRect(k * 9, -9 + j * 9, 9, 9);
          }
        ctx.restore();
      }
    }
    // Sponsor banners along the fence, clear of the gates.
    const R = st.rect;
    const bw = 120;
    const bh = 72;
    const banners: [number, number, string][] = [
      [R.x0 + (R.x1 - R.x0) * 0.2, R.y0 + 8, "bse"],
      [R.x0 + (R.x1 - R.x0) * 0.8, R.y0 + 8, "kayo"],
      [R.x0 + (R.x1 - R.x0) * 0.2, R.y1 - 8 - bh, "leatt"],
      [R.x0 + (R.x1 - R.x0) * 0.8, R.y1 - 8 - bh, "bse"],
    ];
    for (const [x, y, k] of banners) this.adBoard(x - bw / 2, y, bw, bh, BRAND_BY_ID[k]);
    // Name on the infield.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#f3ead8";
    ctx.font = `900 34px ${BRAND_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lx = st.rect.x0 + (st.rect.x1 - st.rect.x0) * 0.47;
    const ly = st.rect.y0 + (st.rect.y1 - st.rect.y0) * 0.27;
    ctx.fillText("ЭНДУРО-АРЕНА", lx, ly);
    ctx.font = `700 14px ${BRAND_FONT}`;
    ctx.fillText(world.bestLap ? `рекорд круга ${world.bestLap.toFixed(2)} с` : "въезжай на старт — круг на время", lx, ly + 28);
    ctx.restore();
  }

  private drawObstacles() {
    const ctx = this.ctx;
    const v = this.view;
    const list: Obstacle[] = this.chunks.flatMap((c) => c.obstacles);
    // Mud first: it is part of the ground.
    list.sort((a, b) => (a.kind === "mud" ? -1 : 0) - (b.kind === "mud" ? -1 : 0));
    for (const o of list) {
      if (o.x < v.x0 - 60 || o.x > v.x1 + 60 || o.y < v.y0 - 60 || o.y > v.y1 + 60) continue;
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.a);
      const L = o.len;
      const W = o.wid;
      switch (o.kind) {
        case "mud": {
          ctx.fillStyle = "#4a3420";
          ctx.beginPath();
          ctx.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(120,150,170,0.25)";
          ctx.beginPath();
          ctx.ellipse(-L * 0.12, -W * 0.1, L * 0.28, W * 0.2, 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "log": {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.fillRect(-L / 2 + 3, -W / 2 + 4, L, W);
          const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
          g.addColorStop(0, "#a0784c");
          g.addColorStop(0.5, "#7a5530");
          g.addColorStop(1, "#4e351c");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(-L / 2, -W / 2, L, W, W / 2);
          ctx.fill();
          ctx.fillStyle = "#c9a77a";
          ctx.beginPath();
          ctx.ellipse(L / 2 - 2, 0, 2.5, W / 2 - 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "whoop": {
          const g = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
          g.addColorStop(0, "rgba(170,130,85,0.9)");
          g.addColorStop(1, "rgba(70,48,26,0.9)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.ellipse(0, 0, L / 2, W / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "tire": {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.beginPath();
          ctx.arc(3, 4, L / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#1b1b1b";
          ctx.beginPath();
          ctx.arc(0, 0, L / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 2;
          for (let k = 0; k < 10; k++) {
            ctx.beginPath();
            ctx.moveTo(Math.cos(k * 0.63) * L * 0.32, Math.sin(k * 0.63) * L * 0.32);
            ctx.lineTo(Math.cos(k * 0.63) * L * 0.49, Math.sin(k * 0.63) * L * 0.49);
            ctx.stroke();
          }
          ctx.fillStyle = "#6e5232";
          ctx.beginPath();
          ctx.arc(0, 0, L * 0.22, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "rock": {
          ctx.fillStyle = "rgba(0,0,0,0.3)";
          ctx.beginPath();
          ctx.arc(2, 3, L / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#8d8a84";
          ctx.beginPath();
          for (let k = 0; k < 7; k++) {
            const rr = (L / 2) * (0.8 + 0.2 * Math.sin(k * 2.3 + o.x));
            const a = (k / 7) * Math.PI * 2;
            if (k) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#b3b0a8";
          ctx.beginPath();
          ctx.arc(-L * 0.12, -L * 0.12, L * 0.18, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case "ramp": {
          // A wooden kicker rising towards the launch edge.
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(-L / 2 + 4, -W / 2 + 5, L + 4, W);
          const g = ctx.createLinearGradient(-L / 2, 0, L / 2, 0);
          g.addColorStop(0, "#7a5a36");
          g.addColorStop(1, "#c89a5a");
          ctx.fillStyle = g;
          ctx.fillRect(-L / 2, -W / 2, L, W);
          ctx.strokeStyle = "rgba(60,40,20,0.6)";
          ctx.lineWidth = 1;
          for (let k = 1; k < 5; k++) {
            ctx.beginPath();
            ctx.moveTo(-L / 2 + (k * L) / 5, -W / 2);
            ctx.lineTo(-L / 2 + (k * L) / 5, W / 2);
            ctx.stroke();
          }
          ctx.fillStyle = o.power ? "#ff9f1a" : "#ffd23a";
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            ctx.moveTo(L * 0.3, k * W * 0.28);
            ctx.lineTo(L * 0.05, k * W * 0.28 - 6);
            ctx.lineTo(L * 0.05, k * W * 0.28 + 6);
            ctx.fill();
          }
          ctx.fillStyle = "#e8e0d0";
          ctx.fillRect(L / 2 - 2, -W / 2, 2, W);
          break;
        }
      }
      ctx.restore();
    }
  }

  private drawPhones(world: World, t: number) {
    const ctx = this.ctx;
    const v = this.view;
    world.map.phones.forEach((ph, i) => {
      if (ph.x < v.x0 - 40 || ph.x > v.x1 + 40 || ph.y < v.y0 - 40 || ph.y > v.y1 + 40) return;
      const ring = world.ringing === i;
      ctx.save();
      ctx.translate(ph.x, ph.y);
      if (ring) {
        const k = (t * 1.5) % 1;
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + k * 26, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(-5, -5, 12, 12);
      ctx.fillStyle = ring && Math.floor(t * 6) % 2 ? "#ffd23a" : "#1f5fa8";
      ctx.fillRect(-7, -7, 12, 12);
      ctx.fillStyle = "#e8eef8";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("☎", -1, -0.5);
      ctx.restore();
    });
  }

  private drawPackages(world: World, t: number) {
    const ctx = this.ctx;
    const v = this.view;
    world.map.packages.forEach((pk, i) => {
      if (world.packagesGot.has(i)) return;
      if (pk.x < v.x0 - 20 || pk.x > v.x1 + 20 || pk.y < v.y0 - 20 || pk.y > v.y1 + 20) return;
      ctx.save();
      ctx.translate(pk.x, pk.y + Math.sin(t * 2 + i) * 1.5);
      ctx.rotate(Math.sin(t + i) * 0.2);
      ctx.fillStyle = `rgba(255,240,150,${0.25 + 0.15 * Math.sin(t * 4)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b07a3c";
      ctx.fillRect(-6, -6, 12, 12);
      ctx.strokeStyle = "#5a3a18";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
      ctx.moveTo(-6, 0);
      ctx.lineTo(6, 0);
      ctx.stroke();
      ctx.restore();
    });
  }

  private drawHeli(world: World, t: number) {
    const h = world.heli;
    if (!h) return;
    const ctx = this.ctx;
    // Shadow far below, then the machine.
    ctx.save();
    ctx.translate(h.x + 50, h.y + 70);
    ctx.rotate(h.a);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-46, -2, 26, 4);
    ctx.restore();
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.a);
    ctx.fillStyle = "#1b2a4a";
    ctx.fillRect(-48, -2.5, 30, 5);
    ctx.fillRect(-50, -8, 5, 16);
    ctx.fillStyle = "#24407a";
    ctx.beginPath();
    ctx.ellipse(0, 0, 22, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e8eef8";
    ctx.fillRect(-14, -11, 20, 3);
    ctx.fillRect(-14, 8, 20, 3);
    ctx.fillStyle = "rgba(140,200,255,0.8)";
    ctx.beginPath();
    ctx.ellipse(12, 0, 8, 8, 0, -1.2, 1.2);
    ctx.fill();
    ctx.fillStyle = Math.floor(t * 4) % 2 ? "#ff3030" : "#3060ff";
    ctx.fillRect(-4, -2, 4, 4);
    // Rotor: a blurred disc and two blades.
    ctx.fillStyle = "rgba(30,30,30,0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(20,20,20,0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const k of [0, Math.PI / 2]) {
      const a = h.rotor + k;
      ctx.moveTo(Math.cos(a) * 40, Math.sin(a) * 40);
      ctx.lineTo(-Math.cos(a) * 40, -Math.sin(a) * 40);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- things that move ----------

  private shadow(v: Vehicle) {
    const ctx = this.ctx;
    if (v.sink > 0) return;
    ctx.save();
    ctx.translate(v.x + 2.5 + v.z * 0.6, v.y + 3.5 + v.z * 0.8);
    ctx.rotate(v.a);
    ctx.fillStyle = `rgba(0,0,0,${0.3 / (1 + v.z / 60)})`;
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
    if (v.z > 0) {
      const s = 1 + v.z / 90;
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

  private drawPed(q: Ped, t: number, gun: boolean) {
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
    if (gun) {
      // Arm out with the gun.
      ctx.strokeStyle = q.shirt;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 3.2);
      ctx.lineTo(5, 2.2);
      ctx.stroke();
      ctx.fillStyle = "#151515";
      ctx.fillRect(4.5, 1.2, 4.5, 1.8);
    }
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

  private drawBullets(world: World) {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = "rgba(255,225,140,0.9)";
    ctx.beginPath();
    for (const b of world.bullets) {
      if (b.rocket) continue;
      ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.lineCap = "butt";
    for (const b of world.bullets) {
      if (!b.rocket) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = "rgba(255,170,60,0.9)";
      ctx.beginPath();
      ctx.moveTo(-5, -2);
      ctx.lineTo(-12 - Math.random() * 4, 0);
      ctx.lineTo(-5, 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#4a5a3a";
      ctx.fillRect(-5, -1.6, 9, 3.2);
      ctx.fillStyle = "#c62828";
      ctx.fillRect(4, -1.6, 2, 3.2);
      ctx.globalCompositeOperation = "lighter";
      ctx.restore();
    }
    for (const f of world.flashes) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.a);
      ctx.fillStyle = "rgba(255,210,90,0.95)";
      ctx.beginPath();
      ctx.moveTo(0, -2.5);
      ctx.lineTo(9, 0);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(2, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(255,250,220,0.9)";
      ctx.beginPath();
      ctx.arc(1, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawLamps(v: { x0: number; y0: number; x1: number; y1: number }) {
    const ctx = this.ctx;
    ctx.strokeStyle = "#3a3d42";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const l of this.lampsInView) {
      if (l.x < v.x0 - 10 || l.x > v.x1 + 10 || l.y < v.y0 - 10 || l.y > v.y1 + 10) continue;
      ctx.moveTo(l.x - Math.cos(l.a) * 4, l.y - Math.sin(l.a) * 4);
      ctx.lineTo(l.x + Math.cos(l.a) * 5, l.y + Math.sin(l.a) * 5);
    }
    ctx.stroke();
    ctx.fillStyle = "#2b2e33";
    ctx.beginPath();
    for (const l of this.lampsInView) {
      if (l.x < v.x0 - 10 || l.x > v.x1 + 10 || l.y < v.y0 - 10 || l.y > v.y1 + 10) continue;
      ctx.moveTo(l.x - Math.cos(l.a) * 4 + 2, l.y - Math.sin(l.a) * 4);
      ctx.arc(l.x - Math.cos(l.a) * 4, l.y - Math.sin(l.a) * 4, 2, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Night: a dark layer with holes cut where there is light, then warm glows on top.
  private drawNight(world: World, cam: Camera, dark: number, t: number) {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    const z = cam.zoom;
    const L = this.light;
    // Light is soft anyway: half resolution is plenty and much cheaper.
    const q = 0.5;
    const cw = Math.ceil(this.canvasEl.width * q);
    const ch = Math.ceil(this.canvasEl.height * q);
    if (L.width !== cw || L.height !== ch) {
      L.width = cw;
      L.height = ch;
    }
    const g = this.lg;
    const v = this.view;
    g.globalCompositeOperation = "source-over";
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    // Dusk is warm, night is deep blue.
    const mix = (a: number, b: number) => Math.round(a + (b - a) * dark);
    g.fillStyle = `rgba(${mix(70, 6)},${mix(38, 10)},${mix(60, 34)},${0.84 * dark})`;
    g.fillRect(0, 0, cw, ch);
    g.setTransform(z * dpr * q, 0, 0, z * dpr * q, (w / 2 - cam.x * z) * dpr * q, (h / 2 - cam.y * z) * dpr * q);
    g.globalCompositeOperation = "destination-out";
    const inView = (x: number, y: number, m: number) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;
    const glow = (x: number, y: number, r: number, a: number) => {
      if (!inView(x, y, r)) return;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${a})`);
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const l of this.lampsInView) glow(l.x + Math.cos(l.a) * 6, l.y + Math.sin(l.a) * 6, 80, 0.85);
    const beams: Vehicle[] = [];
    for (const veh of world.vehicles) {
      if (!inView(veh.x, veh.y, 140)) continue;
      if (veh.burn > 0) glow(veh.x, veh.y, 90, 0.9);
      if (!veh.alive || veh.down || (!veh.rider && !veh.chase)) continue;
      beams.push(veh);
      const fx = Math.cos(veh.a);
      const fy = Math.sin(veh.a);
      const ox = veh.x + fx * veh.model.len * 0.5;
      const oy = veh.y + fy * veh.model.len * 0.5;
      const R = veh.bike ? 95 : 120;
      const gr = g.createRadialGradient(ox, oy, 0, ox, oy, R);
      gr.addColorStop(0, "rgba(0,0,0,0.95)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(ox, oy);
      g.arc(ox, oy, R, veh.a - 0.42, veh.a + 0.42);
      g.closePath();
      g.fill();
      glow(veh.x, veh.y, veh.model.len * 0.75, 0.45);
      if (veh.police && veh.chase) glow(veh.x, veh.y, 75, 0.6);
    }
    glow(world.px, world.py, 120, 0.45);
    if (world.heli && Math.hypot(world.heli.x - world.px, world.heli.y - world.py) < 260) glow(world.px, world.py, 80, 0.95);
    if (world.ringing >= 0) glow(world.map.phones[world.ringing].x, world.map.phones[world.ringing].y, 60, 0.8);
    let fires = 0;
    for (const q of world.particles) if (q.kind === "fire" && fires++ < 50) glow(q.x, q.y, 34, 0.55 * (q.life / q.max));
    for (const f of world.flashes) glow(f.x, f.y, 70, 0.9);
    const job = world.job;
    if (job) glow(job.points[job.idx].x, job.points[job.idx].y, 80, 0.75);
    else for (const s of this.map.jobs) glow(s.x, s.y, 45, 0.7);
    for (const pl of this.map.places) glow(pl.x, pl.y, 70, 0.7);
    for (const k of world.pickups) if (k.respawn <= 0) glow(k.x, k.y, 20, 0.6);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(L, 0, 0, this.canvasEl.width, this.canvasEl.height);
    ctx.restore();

    // Warm light on top: lamp heads, headlight beams, tail lights, the police flashers.
    ctx.globalCompositeOperation = "lighter";
    for (const l of this.lampsInView) {
      if (!inView(l.x, l.y, 30)) continue;
      const x = l.x + Math.cos(l.a) * 5;
      const y = l.y + Math.sin(l.a) * 5;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 30);
      gr.addColorStop(0, `rgba(255,205,120,${0.55 * dark})`);
      gr.addColorStop(1, "rgba(255,205,120,0)");
      ctx.fillStyle = gr;
      ctx.fillRect(x - 30, y - 30, 60, 60);
    }
    for (const veh of beams) {
      const fx = Math.cos(veh.a);
      const fy = Math.sin(veh.a);
      const ox = veh.x + fx * veh.model.len * 0.5;
      const oy = veh.y + fy * veh.model.len * 0.5;
      const R = veh.bike ? 90 : 110;
      const gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, R);
      gr.addColorStop(0, `rgba(255,240,200,${0.22 * dark})`);
      gr.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, R, veh.a - 0.38, veh.a + 0.38);
      ctx.closePath();
      ctx.fill();
      const bx = veh.x - fx * veh.model.len * 0.5;
      const by = veh.y - fy * veh.model.len * 0.5;
      const tr = ctx.createRadialGradient(bx, by, 0, bx, by, 12);
      tr.addColorStop(0, `rgba(255,40,30,${(veh.brk > 0 ? 0.7 : 0.35) * dark})`);
      tr.addColorStop(1, "rgba(255,40,30,0)");
      ctx.fillStyle = tr;
      ctx.fillRect(bx - 12, by - 12, 24, 24);
      if (veh.police && veh.chase) {
        const on = Math.floor(t * 8) % 2 === 0;
        const pg = ctx.createRadialGradient(veh.x, veh.y, 0, veh.x, veh.y, 60);
        pg.addColorStop(0, on ? `rgba(255,40,40,${0.5 * dark})` : `rgba(40,90,255,${0.5 * dark})`);
        pg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = pg;
        ctx.fillRect(veh.x - 60, veh.y - 60, 120, 120);
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---------- buildings and trees ----------

  private drawTall(cam: Camera, Hc: number) {
    const ctx = this.ctx;
    const v = this.view;
    // Trees: low, so they barely lean.
    const kt = Hc / (Hc - 30);
    for (const tr of this.chunks.flatMap((c) => c.trees)) {
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
      if (this.dark > 0.01) {
        ctx.fillStyle = `rgba(6,10,34,${0.78 * this.dark})`;
        ctx.beginPath();
        ctx.arc(x, y, tr.r + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const list: Building[] = [];
    for (const b of this.chunks.flatMap((c) => c.buildings)) {
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
    const dark = this.dark;
    const night = `rgba(6,10,34,${0.78 * dark})`;
    const top = Math.min(b.h, Hc * 0.42);
    const wall = (ax: number, ay: number, bx: number, by: number, light: number, side: number) => {
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
      if (dark > 0.01) {
        ctx.fillStyle = night;
        ctx.fill();
      }
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
      // Lit windows after dark.
      if (dark > 0.15) {
        const nc = Math.max(1, cols);
        ctx.fillStyle = `rgba(255,208,120,${0.9 * Math.min(1, dark * 1.4)})`;
        ctx.beginPath();
        for (let hh = 0, fl = 0; hh + 9 < top; hh += 11, fl++) {
          const k0 = Hc / (Hc - (hh + 3));
          const k1 = Hc / (Hc - (hh + 8.5));
          for (let i = 0; i < nc; i++) {
            if (hash(b.seed, side, fl, i, Math.floor(this.lightsT / 40)) > 0.32) continue;
            const f0 = (i + 0.22) / nc;
            const f1 = (i + 0.78) / nc;
            const q0x = ax + (bx - ax) * f0;
            const q0y = ay + (by - ay) * f0;
            const q1x = ax + (bx - ax) * f1;
            const q1y = ay + (by - ay) * f1;
            const a = P(q0x, q0y, k0);
            const c = P(q1x, q1y, k0);
            const d = P(q1x, q1y, k1);
            const e = P(q0x, q0y, k1);
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(c[0], c[1]);
            ctx.lineTo(d[0], d[1]);
            ctx.lineTo(e[0], e[1]);
            ctx.closePath();
          }
        }
        ctx.fill();
      }
    };
    if (cam.y > y1) wall(x0, y1, x1, y1, 0.62, 0);
    if (cam.y < y0) wall(x0, y0, x1, y0, 0.9, 1);
    if (cam.x < x0) wall(x0, y0, x0, y1, 0.8, 2);
    if (cam.x > x1) wall(x1, y0, x1, y1, 0.7, 3);
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
    let s = b.seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    if (b.kind !== "hospital" && b.kind !== "police" && !b.ad && !b.helipad) {
      // Vents and air conditioners.
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
    if (dark > 0.01) {
      ctx.fillStyle = night;
      ctx.fillRect(x0, y0, w, h);
    }
    // What glows: signs, the hospital cross, the helipad, the billboards.
    if (b.ad && BRAND_BY_ID[b.ad]) this.billboard(cx, cy, w, h, BRAND_BY_ID[b.ad]);
    else if (b.kind === "hospital") {
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
    } else if (b.helipad) {
      {
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
        if (dark > 0.2) {
          ctx.fillStyle = Math.floor(performance.now() / 600) % 2 ? "#ff5040" : "#40ff70";
          const r = Math.min(w, h) * 0.38;
          for (let i = 0; i < 4; i++) ctx.fillRect(cx + Math.cos(i * 1.57 + 0.78) * r - 1.5, cy + Math.sin(i * 1.57 + 0.78) * r - 1.5, 3, 3);
        }
      }
    }
    ctx.restore();
  }

  // A lit 67MOTO billboard, in roof coordinates.
  private billboard(cx: number, cy: number, w: number, h: number, brand: Brand) {
    const ctx = this.ctx;
    const dark = this.dark;
    // A 2:1 logo plus the strip: about 1.67:1.
    let bw = Math.min(w * 0.86, 130);
    let bh = bw * 0.6;
    if (bh > h * 0.86) {
      bh = h * 0.86;
      bw = bh / 0.6;
    }
    const bx = cx - bw / 2;
    const by = cy - bh / 2;
    this.adBoard(bx, by, bw, bh, brand);
    if (dark > 0.05) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `rgba(217,183,120,${0.12 * dark})`;
      ctx.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
      ctx.globalCompositeOperation = "source-over";
    }
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
    const col = job.kind === "race" || job.kind === "stadium" ? "#ff9f1a" : job.kind === "hot" || job.kind === "phone" ? "#ff3b3b" : "#3ddc6e";
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

  // ---------- full city map ----------

  drawFullMap(c: HTMLCanvasElement, world: World, t: number) {
    const map = this.map;
    const dpr = this.dpr;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext("2d")!;
    const L = map.land;
    const lw = L.x1 - L.x0 + 1;
    const lh = L.y1 - L.y0 + 1;
    const s = Math.min((w * dpr) / lw, (h * dpr) / lh);
    const ox = (w * dpr - lw * s) / 2 - L.x0 * s;
    const oy = (h * dpr - lh * s) / 2 - L.y0 * s;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#1e4a66";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.setTransform(s, 0, 0, s, ox, oy);
    g.drawImage(this.mini, 0, 0);
    // Markers stay the same size on screen.
    const px = (x: number) => x / T;
    const r = (k: number) => (k * dpr) / s;
    const dot = (x: number, y: number, col: string, k: number, ring = false) => {
      g.fillStyle = col;
      g.beginPath();
      g.arc(px(x), px(y), r(k), 0, Math.PI * 2);
      g.fill();
      if (ring) {
        g.strokeStyle = "#111";
        g.lineWidth = r(1.5);
        g.stroke();
      }
    };
    for (const j of map.jobs) if (!world.job) dot(j.x, j.y, j.kind === "delivery" ? "#3ddc6e" : j.kind === "race" ? "#ff9f1a" : "#ff3b3b", 3.5, true);
    for (const pl of map.places) {
      const col = { garage: "#2f8fe0", shop: "#d9b778", hospital: "#ff5a5a", police: "#5b8dff" }[pl.kind];
      dot(pl.x, pl.y, col, 6, true);
      g.fillStyle = "#fff";
      g.font = `900 ${r(8)}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText({ garage: "С", shop: "₽", hospital: "+", police: "П" }[pl.kind], px(pl.x), px(pl.y) + r(0.5));
    }
    const flash = Math.floor(t * 4) % 2 === 0;
    map.phones.forEach((ph, i) => dot(ph.x, ph.y, world.ringing === i ? (flash ? "#ffffff" : "#ffd23a") : "#9fb3c8", world.ringing === i ? 6 : 3, true));
    const st = map.stadium;
    if (st) {
      g.fillStyle = "#f3ead8";
      g.font = `900 ${r(11)}px system-ui, sans-serif`;
      g.textAlign = "center";
      g.fillText("СТАДИОН", (st.rect.x0 + st.rect.x1) / 2 / T, (st.rect.y0 + st.rect.y1) / 2 / T);
    }
    for (const v of world.vehicles) if (v.police && v.chase) dot(v.x, v.y, flash ? "#ff3030" : "#3060ff", 3);
    if (world.heli) dot(world.heli.x, world.heli.y, flash ? "#ff3030" : "#3060ff", 5, true);
    const target = this.jobTarget(world);
    if (target) dot(target.x, target.y, "#ffe14a", 7 + (flash ? 2 : 0), true);
    const a = world.player.mode === "ride" && world.player.bike ? world.player.bike.a : world.player.body.a;
    g.save();
    g.translate(px(world.px), px(world.py));
    g.rotate(a);
    g.scale(r(1), r(1));
    g.fillStyle = "#fff";
    g.strokeStyle = "#000";
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(11, 0);
    g.lineTo(-7, -7);
    g.lineTo(-3, 0);
    g.lineTo(-7, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
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
      if (pl.kind === "shop") dot(pl.x, pl.y, "#d9b778", 1.2);
      if (pl.kind === "hospital") dot(pl.x, pl.y, "#ff5a5a", 0.9);
    }
    if (!world.job) for (const j of map.jobs) dot(j.x, j.y, j.kind === "delivery" ? "#3ddc6e" : j.kind === "race" ? "#ff9f1a" : "#ff3b3b", 1);
    const flash = Math.floor(t * 6) % 2 === 0;
    for (const v of world.vehicles)
      if (v.police && v.chase && Math.abs(v.x / T - cx) < span / 2 && Math.abs(v.y / T - cy) < span / 2) dot(v.x, v.y, flash ? "#ff3030" : "#3060ff", 0.8);
    if (world.ringing >= 0) {
      const ph = map.phones[world.ringing];
      dot(ph.x, ph.y, flash ? "#ffffff" : "#ffd23a", 1.2);
    }
    if (world.heli) dot(world.heli.x, world.heli.y, flash ? "#ff3030" : "#3060ff", 1.1);
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
