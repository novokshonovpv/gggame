import { BILLBOARDS } from "./brands.ts";

// The city: a tile map generated from a seed. Roads form a grid (two lanes each, right-hand
// traffic), blocks between them are ringed with pavement and split into lots: buildings of
// different heights (taller downtown), parks with trees and car parks. A river crosses the
// city with bridges on every avenue; the whole city is an island in the sea.

export const T = 32; // tile size in world units (8 units ≈ 1 m)

export const WATER = 0;
export const ROAD = 1;
export const WALK = 2;
export const BUILD = 3;
export const GRASS = 4;
export const LOT = 5;
export const BRIDGE = 6;
export const SAND = 7;
export const DIRT = 8; // the enduro stadium floor

export type Dir = 0 | 1 | 2 | 3; // east, south, west, north (y grows down)
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BuildingKind = "plain" | "glass" | "brick" | "hospital" | "police";

export interface Building extends Rect {
  h: number; // height in world units
  wall: string;
  roof: string;
  kind: BuildingKind;
  seed: number;
  ad?: string; // a billboard on the roof: brand id (brands.ts)
  helipad?: boolean;
}

export interface Tree {
  x: number;
  y: number;
  r: number; // canopy radius
}

export type PlaceKind = "hospital" | "police" | "garage" | "shop";
export interface Place {
  kind: PlaceKind;
  x: number;
  y: number;
  a: number; // facing for respawn
}

export type JobKind = "delivery" | "race" | "hot" | "stadium" | "phone";
export interface JobSpot {
  kind: JobKind;
  x: number;
  y: number;
}

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const H_NAMES = [
  "Садовая", "Речная", "Лесная", "Заводская", "Почтовая", "Солнечная", "Морская", "Кленовая",
  "Новая", "Портовая", "Цветочная", "Вишнёвая", "Берёзовая", "Тихая",
];
const V_NAMES = [
  "Космонавтов", "Строителей", "Механиков", "Северный", "Центральный", "Мотористов", "Звёздный",
  "Ветров", "Рыбаков", "Южный", "Байкеров", "Маячный",
];

const WALLS = {
  plain: ["#c9b79c", "#b8a88f", "#d4c6ae", "#a99f92", "#c2b5a3", "#bfae8f"],
  brick: ["#9c5a45", "#8a4d3c", "#a8654b", "#7d4a3d"],
  glass: ["#5d7f96", "#4f6f86", "#6a8ea3", "#587a8a"],
};
const ROOFS = {
  plain: ["#8d8a84", "#7e7b75", "#9a958c", "#6f6c67", "#a39c8f"],
  brick: ["#6b6660", "#5d5a55", "#7a736a"],
  glass: ["#4a5560", "#566370", "#3f4a54"],
};

// Things on the ground you ride over, into or off: the stadium's obstacles and the ramps.
export type ObstacleKind = "log" | "tire" | "rock" | "ramp" | "mud" | "whoop";
export interface Obstacle {
  kind: ObstacleKind;
  x: number;
  y: number;
  a: number; // ramps: the launch direction; logs and whoops: along their length
  len: number;
  wid: number;
  power?: number; // ramps: minimum take-off speed they give (river jumps)
}

export interface Stadium {
  rect: Rect; // world units, inside the fence
  path: { x: number; y: number }[]; // the lap: start/finish first
}

export interface Lamp {
  x: number;
  y: number;
  a: number; // towards the road
}

// Things to draw, bucketed by 16×16-tile chunks so a big city draws only what is in view.
export interface Chunk {
  buildings: Building[];
  trees: Tree[];
  lamps: Lamp[];
  obstacles: Obstacle[];
}
export const CHUNK = 16;

export class CityMap {
  readonly n: number;
  tiles: Uint8Array;
  bid: Int32Array; // building index per tile, -1 if none
  vroads: number[] = []; // left column of each north-south road
  hroads: number[] = []; // top row of each east-west road
  vnames: string[] = [];
  hnames: string[] = [];
  buildings: Building[] = [];
  trees: Tree[] = [];
  treeCells = new Map<number, Tree[]>();
  places: Place[] = [];
  jobs: JobSpot[] = [];
  lots: Rect[] = [];
  walls: Rect[] = []; // bridge railings (world units)
  rivers: [number, number][] = []; // first and last water row of each river
  private riverRow: Uint8Array;
  chunks: Chunk[] = [];
  readonly cn: number; // chunks per side
  private queue: Int32Array | null = null;
  land: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  doorsteps: number[] = []; // pavement tiles next to a building (delivery addresses)
  lamps: Lamp[] = []; // street lights
  obstacles: Obstacle[] = [];
  obCells = new Map<number, Obstacle[]>(); // tile -> obstacles touching it
  stadium: Stadium | null = null;
  phones: { x: number; y: number }[] = []; // payphones that ring with special jobs
  packages: { x: number; y: number }[] = []; // hidden packages
  readonly size: number;

  constructor(seed = 67) {
    const r = rng(seed);
    const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const pick = <X>(a: X[]) => a[Math.floor(r() * a.length)];
    // 354 × 354 tiles: about 11 × 11 thousand units (1.4 km across), ten times the first city.
    const n = 354;
    this.n = n;
    this.size = n * T;
    this.tiles = new Uint8Array(n * n); // all water
    this.bid = new Int32Array(n * n).fill(-1);
    this.riverRow = new Uint8Array(n);
    this.cn = Math.ceil(n / CHUNK);
    for (let i = 0; i < this.cn * this.cn; i++) this.chunks.push({ buildings: [], trees: [], lamps: [], obstacles: [] });

    // Road grid with uneven blocks; two wide gaps hold the rivers (a third and two thirds down).
    // One extra-wide column and row cross at the enduro stadium.
    let stadiumCol = -1;
    let stadiumRow = -1;
    for (let x = 7, i = 0; x <= n - 10; i++) {
      this.vroads.push(x);
      if (stadiumCol < 0 && x > n * 0.18) {
        stadiumCol = i;
        x += 2 + 34;
      } else x += 2 + ri(8, 11);
    }
    const riverGaps = new Set<number>();
    const riverAt = [0.3, 0.68];
    for (let y = 7, i = 0; y <= n - 10; i++) {
      this.hroads.push(y);
      if (riverAt.length && y > n * riverAt[0]) {
        riverAt.shift();
        riverGaps.add(i);
        y += 15;
      } else if (stadiumRow < 0 && y > n * 0.45) {
        stadiumRow = i;
        y += 2 + 34;
      } else y += 2 + ri(8, 11);
    }
    const vs = this.vroads;
    const hs = this.hroads;
    const vx0 = vs[0];
    const vx1 = vs[vs.length - 1] + 1;
    const hy0 = hs[0];
    const hy1 = hs[hs.length - 1] + 1;
    this.land = { x0: vx0 - 5, y0: hy0 - 5, x1: vx1 + 5, y1: hy1 + 5 };
    const L = this.land;

    // Land: grass, a beach round the edge, pavement round the ring road.
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++) {
        const edge = Math.min(x - L.x0, L.x1 - x, y - L.y0, L.y1 - y);
        this.set(x, y, edge <= 1 ? SAND : GRASS);
      }
    for (let y = hy0 - 1; y <= hy1 + 1; y++)
      for (let x = vx0 - 1; x <= vx1 + 1; x++) this.set(x, y, WALK);

    // Names for the streets.
    const hn = [...H_NAMES].sort(() => r() - 0.5);
    const vn = [...V_NAMES].sort(() => r() - 0.5);
    this.hnames = hs.map((_, i) => `ул. ${hn[i % hn.length]}`);
    this.vnames = vs.map((_, i) => `пр. ${vn[i % vn.length]}`);

    // River rows, in the middle of each river gap.
    for (const g of riverGaps) {
      const ry0 = hs[g] + 6;
      const ry1 = hs[g] + 10;
      this.rivers.push([ry0, ry1]);
      for (let y = ry0; y <= ry1; y++) {
        this.riverRow[y] = 1;
        for (let x = 0; x < n; x++) this.set(x, y, WATER);
      }
    }

    // Roads.
    for (const x of vs)
      for (let y = hy0; y <= hy1; y++) {
        const t = this.riverRow[y] ? BRIDGE : ROAD;
        this.set(x, y, t);
        this.set(x + 1, y, t);
      }
    for (const y of hs)
      for (let x = vx0; x <= vx1; x++) {
        this.set(x, y, ROAD);
        this.set(x, y + 1, ROAD);
      }
    // Bridges carry a pavement each side and a railing outside it.
    for (const [ry0, ry1] of this.rivers)
      for (const x of vs) {
        for (let y = ry0; y <= ry1; y++) {
          this.set(x - 1, y, WALK);
          this.set(x + 2, y, WALK);
        }
        this.walls.push({ x0: (x - 1) * T - 3, y0: ry0 * T, x1: (x - 1) * T, y1: (ry1 + 1) * T });
        this.walls.push({ x0: (x + 3) * T, y0: ry0 * T, x1: (x + 3) * T + 3, y1: (ry1 + 1) * T });
      }

    // Blocks.
    const cx = (vx0 + vx1) / 2;
    const cy = (hy0 + hy1) / 2;
    const half = Math.max(vx1 - vx0, hy1 - hy0) / 2;
    const leaves: { rect: Rect; block: Rect; park: boolean }[] = [];
    for (let i = 0; i + 1 < vs.length; i++)
      for (let j = 0; j + 1 < hs.length; j++) {
        const bx0 = vs[i] + 2;
        const bx1 = vs[i + 1] - 1;
        const by0 = hs[j] + 2;
        const by1 = hs[j + 1] - 1;
        const river = riverGaps.has(j) ? this.rivers.find(([a]) => a > by0 && a < by1) : undefined;
        const blocks: Rect[] = river
          ? [
              { x0: bx0, y0: by0, x1: bx1, y1: river[0] - 1 },
              { x0: bx0, y0: river[1] + 1, x1: bx1, y1: by1 },
            ]
          : [{ x0: bx0, y0: by0, x1: bx1, y1: by1 }];
        if (i === stadiumCol && j === stadiumRow && !river) {
          for (let y = by0; y <= by1; y++)
            for (let x = bx0; x <= bx1; x++) this.set(x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? WALK : DIRT);
          this.buildStadium({ x0: bx0 + 1, y0: by0 + 1, x1: bx1 - 1, y1: by1 - 1 }, r);
          continue;
        }
        for (const b of blocks) {
          for (let y = b.y0; y <= b.y1; y++)
            for (let x = b.x0; x <= b.x1; x++) {
              const ring = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1;
              this.set(x, y, ring ? WALK : GRASS);
            }
          const inner = { x0: b.x0 + 1, y0: b.y0 + 1, x1: b.x1 - 1, y1: b.y1 - 1 };
          if (inner.x1 < inner.x0 || inner.y1 < inner.y0) continue;
          // Embankment strips and some whole blocks are parks.
          const embank = !!river;
          const d = Math.hypot((b.x0 + b.x1) / 2 - cx, (b.y0 + b.y1) / 2 - cy) / half;
          if (embank || r() < 0.06 + d * 0.06) {
            leaves.push({ rect: inner, block: inner, park: true });
            continue;
          }
          const split = (q: Rect) => {
            const w = q.x1 - q.x0 + 1;
            const h = q.y1 - q.y0 + 1;
            if ((w <= 5 && h <= 5) || (w <= 3 || h <= 3 ? r() < 0.6 : false)) return leaves.push({ rect: q, block: inner, park: false });
            if (w >= h && w > 3) {
              const s = q.x0 + ri(2, w - 2) - 1;
              split({ ...q, x1: s });
              split({ ...q, x0: s + 1 });
            } else if (h > 3) {
              const s = q.y0 + ri(2, h - 2) - 1;
              split({ ...q, y1: s });
              split({ ...q, y0: s + 1 });
            } else leaves.push({ rect: q, block: inner, park: false });
          };
          split(inner);
        }
      }

    const touchesEdge = (q: Rect, b: Rect) => q.x0 === b.x0 || q.y0 === b.y0 || q.x1 === b.x1 || q.y1 === b.y1;
    const wantLots = { garage: 5, shop: 2 };
    // Special lots first, spread over the city: workshops and the bike showrooms.
    const order = leaves.map((_, i) => i).sort(() => r() - 0.5);
    const used = new Set<number>();
    const pickLot = (kind: "garage" | "shop", far: { x: number; y: number }[]) => {
      for (const i of order) {
        const l = leaves[i];
        const q = l.rect;
        const w = q.x1 - q.x0 + 1;
        const h = q.y1 - q.y0 + 1;
        if (used.has(i) || l.park || !touchesEdge(q, l.block) || w < 2 || h < 2 || w * h > 16) continue;
        const px = ((q.x0 + q.x1 + 1) / 2) * T;
        const py = ((q.y0 + q.y1 + 1) / 2) * T;
        if (far.some((p) => Math.hypot(p.x - px, p.y - py) < 3000)) continue;
        used.add(i);
        for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) this.set(x, y, LOT);
        this.lots.push(q);
        this.places.push({ kind, x: px, y: py, a: 0 });
        return;
      }
    };
    for (let k = 0; k < wantLots.garage + wantLots.shop; k++)
      pickLot(k < wantLots.garage ? "garage" : "shop", this.places.map((p) => ({ x: p.x, y: p.y })));

    const parks: Rect[] = [];
    // Three hospitals and three police stations, far apart.
    const civic: { kind: "hospital" | "police"; x: number; y: number }[] = [];
    const wantCivic = (kind: "hospital" | "police", x: number, y: number) =>
      civic.filter((c) => c.kind === kind).length < 3 && civic.every((c) => c.kind !== kind || Math.hypot(c.x - x, c.y - y) > n * 0.35);
    for (const i of order) {
      if (used.has(i)) continue;
      const { rect: q, block, park } = leaves[i];
      const w = q.x1 - q.x0 + 1;
      const h = q.y1 - q.y0 + 1;
      const mx = (q.x0 + q.x1 + 1) / 2;
      const my = (q.y0 + q.y1 + 1) / 2;
      const d = Math.min(1, Math.hypot(mx - cx, my - cy) / half);
      if (park) {
        for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) this.set(x, y, GRASS);
        parks.push(q);
        continue;
      }
      const roll = r();
      if (touchesEdge(q, block) && w * h <= 12 && roll < 0.1) {
        for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) this.set(x, y, LOT);
        this.lots.push(q);
        continue;
      }
      if (roll < 0.17 && d > 0.25) {
        for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) this.set(x, y, GRASS);
        continue;
      }
      let kind: BuildingKind = d < 0.4 ? (r() < 0.55 ? "glass" : "plain") : r() < 0.4 ? "brick" : "plain";
      let hgt = T * (1.6 + r() * 1.8) + (1 - d) * (1 - d) * T * (2 + r() * 7);
      if (w >= 3 && h >= 3 && wantCivic("hospital", mx, my)) {
        kind = "hospital";
        hgt = T * 2.6;
        civic.push({ kind, x: mx, y: my });
      } else if (w >= 3 && h >= 3 && wantCivic("police", mx, my)) {
        kind = "police";
        hgt = T * 2.2;
        civic.push({ kind, x: mx, y: my });
      }
      const pal = kind === "hospital" || kind === "police" ? "plain" : kind;
      const b: Building = {
        ...q,
        h: Math.min(hgt, T * 9.5),
        wall: kind === "hospital" ? "#e6e4de" : kind === "police" ? "#8fa3b8" : pick(WALLS[pal]),
        roof: kind === "hospital" ? "#f2f1ec" : kind === "police" ? "#2f4d7a" : pick(ROOFS[pal]),
        kind,
        seed: Math.floor(r() * 1e9),
      };
      const id = this.buildings.length;
      this.buildings.push(b);
      this.chunkAt(q.x0, q.y0).buildings.push(b);
      for (let y = q.y0; y <= q.y1; y++)
        for (let x = q.x0; x <= q.x1; x++) {
          this.set(x, y, BUILD);
          this.bid[y * n + x] = id;
        }
      if (kind === "hospital" || kind === "police") {
        // Respawn point on the pavement in front of the door.
        const door = this.nearestWalk(mx * T, (q.y1 + 1) * T + T / 2);
        this.places.push({ kind, x: door.x, y: door.y, a: Math.PI / 2 });
      }
    }

    // Trees in parks and on the grass round the city.
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++) {
        if (this.at(x, y) !== GRASS) continue;
        const nearRoad = [0, 1, 2, 3].some((d) => this.at(x + DX[d], y + DY[d]) === ROAD);
        if (nearRoad || r() > 0.45) continue;
        const t: Tree = { x: (x + 0.25 + r() * 0.5) * T, y: (y + 0.25 + r() * 0.5) * T, r: 10 + r() * 8 };
        this.trees.push(t);
        this.chunkAt(x, y).trees.push(t);
        const key = y * n + x;
        const cell = this.treeCells.get(key);
        if (cell) cell.push(t);
        else this.treeCells.set(key, [t]);
      }

    // A handful of helipads: the tallest towers, far apart.
    const towers = this.buildings
      .filter((b) => b.kind !== "hospital" && b.kind !== "police" && b.h > T * 6.5 && b.x1 - b.x0 >= 2 && b.y1 - b.y0 >= 2)
      .sort((a, b) => b.h - a.h);
    const pads: Building[] = [];
    for (const b of towers) {
      if (pads.length >= 6) break;
      if (pads.some((q) => Math.hypot(q.x0 - b.x0, q.y0 - b.y0) * T < 1000)) continue;
      b.helipad = true;
      pads.push(b);
    }

    // Rooftop billboards.
    // Brands from the 67MOTO catalogue (BSE three times as often). Billboards go on the
    // tallest roofs: a tower that stands above everything around it (nothing taller within
    // four tiles leans over the sign), with room for a whole board, spread over the city.
    const near = (a: Building, b: Building) => b.x0 <= a.x1 + 4 && b.x1 >= a.x0 - 4 && b.y0 <= a.y1 + 4 && b.y1 >= a.y0 - 4;
    const tops = this.buildings
      .filter((b) => !b.helipad && b.kind !== "hospital" && b.kind !== "police" && b.x1 - b.x0 >= 2 && b.y1 - b.y0 >= 1 && b.h > T * 4.5)
      .filter((b) => !this.buildings.some((o) => o !== b && o.h > b.h && near(b, o)))
      .sort((a, b) => b.h - a.h);
    const ads = [...BILLBOARDS, ...BILLBOARDS].sort(() => r() - 0.5); // every brand twice over
    for (const gap of [1800, 1200, 800, 400]) {
      for (const b of tops) {
        if (!ads.length) break;
        if (b.ad || this.buildings.some((o) => o.ad && Math.hypot(o.x0 - b.x0, o.y0 - b.y0) * T < gap)) continue;
        b.ad = ads.pop();
      }
    }

    // Street lights along the kerbs.
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++) {
        if (this.at(x, y) !== WALK || (x * 7 + y * 13) % 5 !== 0) continue;
        const d = [0, 1, 2, 3].find((k) => this.at(x + DX[k], y + DY[k]) === ROAD || this.at(x + DX[k], y + DY[k]) === BRIDGE);
        if (d === undefined) continue;
        const lamp = { x: (x + 0.5 + DX[d] * 0.38) * T, y: (y + 0.5 + DY[d] * 0.38) * T, a: (d * Math.PI) / 2 };
        this.lamps.push(lamp);
        this.chunkAt(x, y).lamps.push(lamp);
      }

    // Kicker ramps in parks, and over the rivers from one embankment to the other.
    let ramps = 0;
    for (const q of [...parks].sort(() => r() - 0.5)) {
      if (ramps >= 16) break;
      const w = q.x1 - q.x0 + 1;
      const h = q.y1 - q.y0 + 1;
      if (Math.max(w, h) < 5 || Math.min(w, h) < 2) continue;
      if (this.rivers.some(([a, b]) => q.y1 >= a - 3 && q.y0 <= b + 3)) continue;
      const along = w >= h ? (r() < 0.5 ? 0 : Math.PI) : r() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      const x = ((q.x0 + q.x1 + 1) / 2) * T;
      const y = ((q.y0 + q.y1 + 1) / 2) * T;
      this.addObstacle({ kind: "ramp", x, y, a: along, len: 44, wid: 46 });
      ramps++;
    }
    for (const [ry0, ry1] of this.rivers) {
      const cols = vs.map((_, i) => i).filter((i) => i + 1 < vs.length && i !== stadiumCol).sort(() => r() - 0.5).slice(0, 4);
      for (const i of cols) {
        const x = ((vs[i] + 2 + vs[i + 1]) / 2) * T;
        this.addObstacle({ kind: "ramp", x, y: (ry0 - 1.5) * T, a: Math.PI / 2, len: 40, wid: 50, power: 330 });
        this.addObstacle({ kind: "ramp", x: x + 2 * T, y: (ry1 + 2.5) * T, a: -Math.PI / 2, len: 40, wid: 50, power: 330 });
      }
    }

    // Delivery addresses: pavement in front of a building.
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++)
        if (this.at(x, y) === WALK && [0, 1, 2, 3].some((d) => this.at(x + DX[d], y + DY[d]) === BUILD)) this.doorsteps.push(y * n + x);

    // Payphones that ring with special jobs.
    for (let tries = 0; tries < 3000 && this.phones.length < 10; tries++) {
      const k = pick(this.doorsteps);
      const x = ((k % n) + 0.5) * T;
      const y = (Math.floor(k / n) + 0.5) * T;
      if ([...this.phones, ...this.places].some((p) => Math.hypot(p.x - x, p.y - y) < 2200)) continue;
      this.phones.push({ x, y });
    }

    // Hidden packages: deep in parks, on the beach, in the stadium's corners.
    const st = this.stadium as Stadium | null;
    if (st) {
      this.packages.push({ x: st.rect.x0 + 40, y: st.rect.y0 + 40 }, { x: st.rect.x1 - 40, y: st.rect.y1 - 40 });
    }
    for (let tries = 0; tries < 6000 && this.packages.length < 20; tries++) {
      const x = L.x0 + Math.floor(r() * (L.x1 - L.x0));
      const y = L.y0 + Math.floor(r() * (L.y1 - L.y0));
      const t = this.at(x, y);
      const beach = t === SAND && this.packages.length < 6;
      if (!beach && t !== GRASS) continue;
      if (t === GRASS && [0, 1, 2, 3].some((d) => this.at(x + DX[d], y + DY[d]) !== GRASS)) continue;
      const wx = (x + 0.5) * T;
      const wy = (y + 0.5) * T;
      if (this.packages.some((p) => Math.hypot(p.x - wx, p.y - wy) < 1500)) continue;
      if (this.treeCells.has(y * n + x)) continue;
      this.packages.push({ x: wx, y: wy });
    }

    // Job spots spread out over the city.
    const kinds: JobKind[] = [];
    for (let i = 0; i < 5; i++) kinds.push("delivery", "delivery", "delivery", "delivery", "delivery", "delivery", "race", "race", "hot", "hot");
    for (const kind of kinds) {
      for (let tries = 0; tries < 200; tries++) {
        const k = pick(this.doorsteps);
        const x = ((k % n) + 0.5) * T;
        const y = (Math.floor(k / n) + 0.5) * T;
        const all = [...this.jobs, ...this.places];
        if (all.some((p) => Math.hypot(p.x - x, p.y - y) < (tries < 150 ? 900 : 400))) continue;
        this.jobs.push({ kind, x, y });
        break;
      }
    }
  }

  // No trees on a ramp, its run-up or where it lands.
  private clearTrees(o: Obstacle) {
    const ca = Math.cos(o.a);
    const sa = Math.sin(o.a);
    const hit = (t: Tree) => {
      const dx = t.x - o.x;
      const dy = t.y - o.y;
      const u = dx * ca + dy * sa;
      const w = -dx * sa + dy * ca;
      return u > -160 && u < 340 && Math.abs(w) < o.wid / 2 + 26;
    };
    const gone = new Set(this.trees.filter(hit));
    if (!gone.size) return;
    this.trees = this.trees.filter((t) => !gone.has(t));
    for (const c of this.chunks) c.trees = c.trees.filter((t) => !gone.has(t));
    for (const [k, list] of this.treeCells) {
      const left = list.filter((t) => !gone.has(t));
      if (left.length) this.treeCells.set(k, left);
      else this.treeCells.delete(k);
    }
  }

  private addObstacle(o: Obstacle) {
    if (o.kind === "ramp") this.clearTrees(o);
    this.obstacles.push(o);
    this.chunkAt(Math.floor(o.x / T), Math.floor(o.y / T)).obstacles.push(o);
    const rad = Math.max(o.len, o.wid) / 2 + 2;
    for (let ty = Math.floor((o.y - rad) / T); ty <= Math.floor((o.y + rad) / T); ty++)
      for (let tx = Math.floor((o.x - rad) / T); tx <= Math.floor((o.x + rad) / T); tx++) {
        const k = ty * this.n + tx;
        const c = this.obCells.get(k);
        if (c) c.push(o);
        else this.obCells.set(k, [o]);
      }
  }

  // Obstacles near a point.
  obstaclesAt(x: number, y: number) {
    return this.obCells.get(Math.floor(y / T) * this.n + Math.floor(x / T));
  }

  // The enduro stadium: a fenced dirt arena with a lap of gates and obstacles along it.
  private buildStadium(q: Rect, r: () => number) {
    const X0 = q.x0 * T;
    const Y0 = q.y0 * T;
    const X1 = (q.x1 + 1) * T;
    const Y1 = (q.y1 + 1) * T;
    const W = X1 - X0;
    const H = Y1 - Y0;
    // Fence with a gate in the middle of each side.
    const g = 2 * T;
    const mx = (X0 + X1) / 2;
    const my = (Y0 + Y1) / 2;
    this.walls.push(
      { x0: X0, y0: Y0, x1: mx - g, y1: Y0 + 4 },
      { x0: mx + g, y0: Y0, x1: X1, y1: Y0 + 4 },
      { x0: X0, y0: Y1 - 4, x1: mx - g, y1: Y1 },
      { x0: mx + g, y0: Y1 - 4, x1: X1, y1: Y1 },
      { x0: X0, y0: Y0, x1: X0 + 4, y1: my - g },
      { x0: X0, y0: my + g, x1: X0 + 4, y1: Y1 },
      { x0: X1 - 4, y0: Y0, x1: X1, y1: my - g },
      { x0: X1 - 4, y0: my + g, x1: X1, y1: Y1 },
    );
    const P = (u: number, v: number) => ({ x: X0 + u * W, y: Y0 + v * H });
    const path = [
      P(0.5, 0.86),
      P(0.86, 0.86),
      P(0.86, 0.6),
      P(0.58, 0.5),
      P(0.86, 0.37),
      P(0.86, 0.13),
      P(0.14, 0.13),
      P(0.14, 0.42),
      P(0.4, 0.56),
      P(0.14, 0.7),
      P(0.14, 0.86),
    ];
    this.stadium = { rect: { x0: X0, y0: Y0, x1: X1, y1: Y1 }, path };
    const seg = (i: number, t: number) => {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, a: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const across = (i: number, t: number, kind: ObstacleKind, wid: number) => {
      const p = seg(i, t);
      this.addObstacle({ kind, x: p.x, y: p.y, a: p.a + Math.PI / 2, len: 84, wid });
    };
    const ramp = (i: number, t: number) => {
      const p = seg(i, t);
      this.addObstacle({ kind: "ramp", x: p.x, y: p.y, a: p.a, len: 40, wid: 70 });
    };
    const side = (i: number, t: number, off: number) => {
      const p = seg(i, t);
      return { x: p.x - Math.sin(p.a) * off, y: p.y + Math.cos(p.a) * off };
    };
    // 0: three logs across the track.
    for (const t of [0.25, 0.5, 0.75]) across(0, t, "log", 9);
    // 1: a tabletop.
    ramp(1, 0.35);
    // 2: tractor tyres, staggered.
    for (let k = 0; k < 5; k++) {
      const p = side(2, 0.2 + k * 0.15, k % 2 ? 22 : -22);
      this.addObstacle({ kind: "tire", x: p.x, y: p.y, a: 0, len: 24, wid: 24 });
    }
    // 3: a mud pit.
    {
      const p = seg(3, 0.5);
      this.addObstacle({ kind: "mud", x: p.x, y: p.y, a: p.a, len: 120, wid: 90 });
    }
    // 4: whoops.
    for (let k = 0; k < 7; k++) across(4, 0.2 + k * 0.09, "whoop", 12);
    // 5: the big double: a ramp over two logs.
    ramp(5, 0.22);
    across(5, 0.36, "log", 10);
    across(5, 0.44, "log", 10);
    // 6: rock garden.
    for (let k = 0; k < 9; k++) {
      const p = side(6, 0.15 + r() * 0.7, (r() - 0.5) * 70);
      const rr = 6 + r() * 5;
      this.addObstacle({ kind: "rock", x: p.x, y: p.y, a: r() * 6, len: rr * 2, wid: rr * 2 });
    }
    // 7: more tyres.
    for (let k = 0; k < 4; k++) {
      const p = side(7, 0.25 + k * 0.17, k % 2 ? -20 : 20);
      this.addObstacle({ kind: "tire", x: p.x, y: p.y, a: 0, len: 24, wid: 24 });
    }
    // 8: two logs.
    for (const t of [0.4, 0.6]) across(8, t, "log", 9);
    // 9: a second mud pit.
    {
      const p = seg(9, 0.5);
      this.addObstacle({ kind: "mud", x: p.x, y: p.y, a: p.a, len: 100, wid: 90 });
    }
    // 10: a kicker before the finish.
    ramp(10, 0.5);
  }

  private chunkAt(tx: number, ty: number) {
    const cx = Math.max(0, Math.min(this.cn - 1, Math.floor(tx / CHUNK)));
    const cy = Math.max(0, Math.min(this.cn - 1, Math.floor(ty / CHUNK)));
    return this.chunks[cy * this.cn + cx];
  }

  // Chunks touching a rectangle in world units (with a margin for tall things leaning in).
  inView(x0: number, y0: number, x1: number, y1: number) {
    const s = CHUNK * T;
    const out: Chunk[] = [];
    const cx0 = Math.max(0, Math.floor(x0 / s) - 1);
    const cy0 = Math.max(0, Math.floor(y0 / s) - 1);
    const cx1 = Math.min(this.cn - 1, Math.floor(x1 / s));
    const cy1 = Math.min(this.cn - 1, Math.floor(y1 / s));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) out.push(this.chunks[cy * this.cn + cx]);
    return out;
  }

  inRiver(ty: number) {
    return ty >= 0 && ty < this.n && this.riverRow[ty] === 1;
  }

  // The nearest place of a kind (respawn points, workshops).
  nearest(kind: PlaceKind, x: number, y: number) {
    let best: Place | null = null;
    let bd = Infinity;
    for (const p of this.places) {
      if (p.kind !== kind) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) (bd = d), (best = p);
    }
    return best;
  }

  set(x: number, y: number, t: number) {
    if (x >= 0 && y >= 0 && x < this.n && y < this.n) this.tiles[y * this.n + x] = t;
  }

  at(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.n || y >= this.n) return WATER;
    return this.tiles[y * this.n + x];
  }

  tileAt(wx: number, wy: number) {
    return this.at(Math.floor(wx / T), Math.floor(wy / T));
  }

  solid(x: number, y: number) {
    return this.at(x, y) === BUILD;
  }

  // Where a vehicle can go at all (police chase paths).
  drivable(x: number, y: number) {
    // (dirt, grass, pavement, roads and car parks)
    const t = this.at(x, y);
    return t !== WATER && t !== BUILD;
  }

  nearestWalk(wx: number, wy: number) {
    const tx = Math.floor(wx / T);
    const ty = Math.floor(wy / T);
    for (let rad = 0; rad < 20; rad++)
      for (let y = ty - rad; y <= ty + rad; y++)
        for (let x = tx - rad; x <= tx + rad; x++)
          if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) === rad && this.at(x, y) === WALK) return { x: (x + 0.5) * T, y: (y + 0.5) * T };
    return { x: wx, y: wy };
  }

  // "ул. Садовая / пр. Звёздный": the crossing nearest to a point.
  address(wx: number, wy: number) {
    let hi = 0;
    let vi = 0;
    for (let i = 0; i < this.hroads.length; i++)
      if (Math.abs((this.hroads[i] + 1) * T - wy) < Math.abs((this.hroads[hi] + 1) * T - wy)) hi = i;
    for (let i = 0; i < this.vroads.length; i++)
      if (Math.abs((this.vroads[i] + 1) * T - wx) < Math.abs((this.vroads[vi] + 1) * T - wx)) vi = i;
    return `${this.hnames[hi]} / ${this.vnames[vi]}`;
  }

  // Breadth-first distances (in tiles) from one tile over drivable ground; the police follow it.
  flowFrom(tx: number, ty: number, out: Int16Array) {
    const n = this.n;
    out.fill(-1);
    if (!this.drivable(tx, ty)) {
      // Standing in a doorway or the water: start from the nearest drivable neighbour.
      for (let d = 0; d < 4; d++)
        if (this.drivable(tx + DX[d], ty + DY[d])) {
          tx += DX[d];
          ty += DY[d];
          break;
        }
    }
    const q = (this.queue ??= new Int32Array(n * n));
    let head = 0;
    let tail = 0;
    const s = ty * n + tx;
    if (tx < 0 || ty < 0 || tx >= n || ty >= n) return;
    out[s] = 0;
    q[tail++] = s;
    while (head < tail) {
      const c = q[head++];
      const x = c % n;
      const y = (c - x) / n;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const k = ny * n + nx;
        if (out[k] >= 0 || !this.drivable(nx, ny)) continue;
        out[k] = out[c] + 1;
        q[tail++] = k;
      }
    }
  }

  // A route for the navigator: A* over tiles, roads preferred to pavements and lawns,
  // through no buildings or water. Returns the turning points (world units) or null.
  route(sx: number, sy: number, tx: number, ty: number) {
    const n = this.n;
    const cost = (t: number) => (t === ROAD || t === BRIDGE ? 1 : t === LOT ? 1.6 : t === DIRT ? 2 : t === WALK ? 2.6 : t === GRASS ? 3.2 : t === SAND ? 3.6 : 0);
    const snap = (wx: number, wy: number) => {
      const x0 = Math.floor(wx / T);
      const y0 = Math.floor(wy / T);
      for (let rad = 0; rad < 8; rad++)
        for (let y = y0 - rad; y <= y0 + rad; y++)
          for (let x = x0 - rad; x <= x0 + rad; x++)
            if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) === rad && cost(this.at(x, y)) > 0) return y * n + x;
      return -1;
    };
    const start = snap(sx, sy);
    const goal = snap(tx, ty);
    if (start < 0 || goal < 0) return null;
    const gx = goal % n;
    const gy = (goal - gx) / n;
    const g = (this.gScore ??= new Float32Array(n * n));
    const from = (this.cameFrom ??= new Int32Array(n * n));
    g.fill(Infinity);
    // Binary heap of [f, cell].
    const heapF: number[] = [];
    const heapC: number[] = [];
    const pushH = (f: number, c: number) => {
      let i = heapF.length;
      heapF.push(f);
      heapC.push(c);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapF[p] <= f) break;
        heapF[i] = heapF[p];
        heapC[i] = heapC[p];
        i = p;
      }
      heapF[i] = f;
      heapC[i] = c;
    };
    const popH = () => {
      const c = heapC[0];
      const lf = heapF.pop()!;
      const lc = heapC.pop()!;
      if (heapF.length) {
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          if (l >= heapF.length) break;
          const r = l + 1 < heapF.length && heapF[l + 1] < heapF[l] ? l + 1 : l;
          if (heapF[r] >= lf) break;
          heapF[i] = heapF[r];
          heapC[i] = heapC[r];
          i = r;
        }
        heapF[i] = lf;
        heapC[i] = lc;
      }
      return c;
    };
    g[start] = 0;
    from[start] = -1;
    pushH(0, start);
    let found = false;
    for (let steps = 0; heapF.length && steps < 400000; steps++) {
      const c = popH();
      if (c === goal) {
        found = true;
        break;
      }
      const x = c % n;
      const y = (c - x) / n;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const k = cost(this.tiles[ny * n + nx]);
        if (!k) continue;
        const ng = g[c] + k;
        const ci = ny * n + nx;
        if (ng >= g[ci]) continue;
        g[ci] = ng;
        from[ci] = c;
        pushH(ng + Math.abs(nx - gx) + Math.abs(ny - gy), ci);
      }
    }
    if (!found) return null;
    // Tiles back to the start, keeping only where the way turns.
    const cells: number[] = [];
    for (let c = goal; c >= 0; c = from[c]) cells.push(c);
    cells.reverse();
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (i > 0 && i < cells.length - 1) {
        const a = cells[i - 1];
        const b = cells[i + 1];
        if (c - a === b - c) continue;
      }
      pts.push({ x: ((c % n) + 0.5) * T, y: (Math.floor(c / n) + 0.5) * T });
    }
    return pts;
  }
  private gScore: Float32Array | null = null;
  private cameFrom: Int32Array | null = null;

  // Straight line of sight between two points (buildings block it).
  sees(ax: number, ay: number, bx: number, by: number) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.tileAt(ax + (bx - ax) * t, ay + (by - ay) * t) === BUILD) return false;
    }
    return true;
  }

  // Lane centre lines (world units) of road i in a direction.
  laneX(vi: number, dir: Dir) {
    return (this.vroads[vi] + (dir === 1 ? 0.5 : 1.5)) * T;
  }
  laneY(hi: number, dir: Dir) {
    return (this.hroads[hi] + (dir === 0 ? 1.5 : 0.5)) * T;
  }
}
