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

export type JobKind = "delivery" | "race" | "hot";
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

export class CityMap {
  readonly n: number;
  tiles: Uint8Array;
  bid: Int16Array; // building index per tile, -1 if none
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
  river: [number, number] = [0, 0]; // first and last water row of the river
  land: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  doorsteps: number[] = []; // pavement tiles next to a building (delivery addresses)
  readonly size: number;

  constructor(seed = 67) {
    const r = rng(seed);
    const ri = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const pick = <X>(a: X[]) => a[Math.floor(r() * a.length)];
    const n = 112;
    this.n = n;
    this.size = n * T;
    this.tiles = new Uint8Array(n * n); // all water
    this.bid = new Int16Array(n * n).fill(-1);

    // Road grid with uneven blocks; one wide gap in the middle holds the river.
    for (let x = 7; x <= n - 10; x += 2 + ri(8, 11)) this.vroads.push(x);
    const riverAt = 2;
    for (let y = 7, i = 0; y <= n - 10; i++) {
      this.hroads.push(y);
      y += i === riverAt ? 15 : 2 + ri(8, 11);
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

    // River rows, between road riverAt and the next one.
    const ry0 = hs[riverAt] + 6;
    const ry1 = hs[riverAt] + 10;
    this.river = [ry0, ry1];
    for (let y = ry0; y <= ry1; y++) for (let x = 0; x < n; x++) this.set(x, y, WATER);

    // Roads.
    for (const x of vs)
      for (let y = hy0; y <= hy1; y++) {
        const t = y >= ry0 && y <= ry1 ? BRIDGE : ROAD;
        this.set(x, y, t);
        this.set(x + 1, y, t);
      }
    for (const y of hs)
      for (let x = vx0; x <= vx1; x++) {
        this.set(x, y, ROAD);
        this.set(x, y + 1, ROAD);
      }
    // Bridges carry a pavement each side and a railing outside it.
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
        const blocks: Rect[] =
          j === riverAt
            ? [
                { x0: bx0, y0: by0, x1: bx1, y1: ry0 - 1 },
                { x0: bx0, y0: ry1 + 1, x1: bx1, y1: by1 },
              ]
            : [{ x0: bx0, y0: by0, x1: bx1, y1: by1 }];
        for (const b of blocks) {
          for (let y = b.y0; y <= b.y1; y++)
            for (let x = b.x0; x <= b.x1; x++) {
              const ring = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1;
              this.set(x, y, ring ? WALK : GRASS);
            }
          const inner = { x0: b.x0 + 1, y0: b.y0 + 1, x1: b.x1 - 1, y1: b.y1 - 1 };
          if (inner.x1 < inner.x0 || inner.y1 < inner.y0) continue;
          // Embankment strips and some whole blocks are parks.
          const embank = j === riverAt;
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
    const wantLots = { garage: 2, shop: 1 };
    // Special lots first, spread over the city: two workshops, a bike shop.
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
        if (far.some((p) => Math.hypot(p.x - px, p.y - py) < 1400)) continue;
        used.add(i);
        for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) this.set(x, y, LOT);
        this.lots.push(q);
        this.places.push({ kind, x: px, y: py, a: 0 });
        return;
      }
    };
    for (let k = 0; k < wantLots.garage + wantLots.shop; k++)
      pickLot(k < wantLots.garage ? "garage" : "shop", this.places.map((p) => ({ x: p.x, y: p.y })));

    let hospital = false;
    let police = false;
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
      if (!hospital && w >= 3 && h >= 3 && d > 0.2 && d < 0.7) {
        kind = "hospital";
        hgt = T * 2.6;
        hospital = true;
      } else if (!police && w >= 3 && h >= 3 && d < 0.45) {
        kind = "police";
        hgt = T * 2.2;
        police = true;
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
        const key = y * n + x;
        const cell = this.treeCells.get(key);
        if (cell) cell.push(t);
        else this.treeCells.set(key, [t]);
      }

    // Delivery addresses: pavement in front of a building.
    for (let y = L.y0; y <= L.y1; y++)
      for (let x = L.x0; x <= L.x1; x++)
        if (this.at(x, y) === WALK && [0, 1, 2, 3].some((d) => this.at(x + DX[d], y + DY[d]) === BUILD)) this.doorsteps.push(y * n + x);

    // Job spots spread out over the city.
    const kinds: JobKind[] = ["delivery", "delivery", "delivery", "delivery", "delivery", "delivery", "race", "race", "hot", "hot"];
    for (const kind of kinds) {
      for (let tries = 0; tries < 200; tries++) {
        const k = pick(this.doorsteps);
        const x = ((k % n) + 0.5) * T;
        const y = (Math.floor(k / n) + 0.5) * T;
        const all = [...this.jobs, ...this.places];
        if (all.some((p) => Math.hypot(p.x - x, p.y - y) < (tries < 150 ? 700 : 300))) continue;
        this.jobs.push({ kind, x, y });
        break;
      }
    }
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
    const q = new Int32Array(n * n);
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
