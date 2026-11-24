// The islands beyond the city, joined to it by causeways:
//   east  — the Motopark: a motocross track (dirt, jumps, whoops) and the Motodrome, an asphalt
//           ring for races against other riders;
//   south — the Airport: a runway where airliners take off and land, taxiways, an apron with
//           parked planes, the terminal, a control tower and cargo hangars.
// And in the city itself, the player's own garage (where every bike bought at 67MOTO waits).

import {
  BRIDGE,
  BUILD,
  type Building,
  CHUNK,
  type CityMap,
  DIRT,
  GRASS,
  LOT,
  type Obstacle,
  type ObstacleKind,
  ROAD,
  type Rect,
  SAND,
  T,
  TARMAC,
  TRACK,
  type Tree,
  WALK,
  WATER,
  rng,
} from "./map.ts";

export interface Pt {
  x: number;
  y: number;
}

// A closed lap: the enduro arena, the motocross track or the Motodrome.
export interface Track {
  id: "enduro" | "mx" | "ring" | "slalom";
  name: string;
  rect: Rect; // world units, inside the fence
  gates: Pt[]; // checkpoints: start/finish first
  line: Pt[]; // the drawn racing line (smooth, closed)
  width: number; // track width, world units
  surface: "dirt" | "asphalt";
  limit: number; // seconds for a lap
  laps: number; // laps in a race (the Motodrome) or 1 (time trial)
  grid: { x: number; y: number; a: number }[]; // start slots (the Motodrome)
  tyres: Pt[]; // tyre-stack barriers on the outside of the corners
  cones: Pt[]; // slalom cones
  gateR?: number; // how close to a gate counts (default 75)
}

// The player's garage: a building of its own with a fenced yard and a few parking bays.
export interface Home {
  block: Rect; // tiles: the plot inside the pavement
  building: Rect; // tiles
  door: Pt; // drive up here to open the garage
  bays: { x: number; y: number; a: number }[]; // where the other own bikes stand
  start: Pt; // where a new game begins
}

export const TYRE_R = 10; // a stack of tyres, world units

export interface Airport {
  rect: Rect; // world units
  runway: Rect; // world units
  taxi: Rect[];
  apron: Rect;
  planes: { x: number; y: number; a: number; livery: number }[]; // parked
  tower: Pt;
  liftoff: number; // world x where departing planes leave the ground
  raceStart: Pt; // the "beat the plane" mission
}

export interface Zone {
  name: string;
  x: number;
  y: number;
}

// Catmull–Rom through closed control points, about `step` units apart.
export function smoothLoop(ctrl: Pt[], step = 40) {
  const out: Pt[] = [];
  const n = ctrl.length;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = Math.max(2, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

// Distance from a point to a closed polyline.
export function loopDist(line: Pt[], x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const a = line[i];
    const b = line[(i + 1) % line.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const d = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    if (d < best) best = d;
  }
  return best;
}

export function buildZones(map: CityMap, cityN: number) {
  const r = rng(6767);
  const n = map.n;
  const n0 = n;
  const city = map.land;
  const fill = (q: Rect, t: number) => {
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) map.set(x, y, t);
  };
  const island = (q: Rect) => {
    for (let y = q.y0; y <= q.y1; y++)
      for (let x = q.x0; x <= q.x1; x++) {
        const edge = Math.min(x - q.x0, q.x1 - x, y - q.y0, q.y1 - y);
        map.set(x, y, edge <= 1 ? SAND : GRASS);
      }
  };
  const near = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  // A two-lane road with a pavement each side, along x (horiz) or y; over water it becomes a
  // causeway with railings.
  const road = (horiz: boolean, at: number, from: number, to: number) => {
    for (let s = Math.min(from, to); s <= Math.max(from, to); s++) {
      const tx = (k: number) => (horiz ? s : at + k);
      const ty = (k: number) => (horiz ? at + k : s);
      const wet = map.at(tx(0), ty(0)) === WATER || map.at(tx(1), ty(1)) === WATER;
      for (const k of [0, 1]) if (map.at(tx(k), ty(k)) !== ROAD) map.set(tx(k), ty(k), wet ? BRIDGE : ROAD);
      for (const k of [-1, 2]) {
        const t = map.at(tx(k), ty(k));
        if (t !== ROAD && t !== BRIDGE) map.set(tx(k), ty(k), WALK);
      }
      if (wet) {
        if (horiz) {
          map.walls.push({ x0: s * T, y0: (at - 1) * T - 3, x1: (s + 1) * T, y1: (at - 1) * T });
          map.walls.push({ x0: s * T, y0: (at + 3) * T, x1: (s + 1) * T, y1: (at + 3) * T + 3 });
        } else {
          map.walls.push({ x0: (at - 1) * T - 3, y0: s * T, x1: (at - 1) * T, y1: (s + 1) * T });
          map.walls.push({ x0: (at + 3) * T, y0: s * T, x1: (at + 3) * T + 3, y1: (s + 1) * T });
        }
      }
    }
  };
  // A fence round a rectangle (tiles) with gates (world points on its sides, `gap` wide).
  const fence = (q: Rect, gates: Pt[], gap = 3 * T) => {
    const X0 = q.x0 * T;
    const Y0 = q.y0 * T;
    const X1 = (q.x1 + 1) * T;
    const Y1 = (q.y1 + 1) * T;
    const side = (a: Pt, b: Pt, horiz: boolean) => {
      // Split the side at every gate on it.
      const cuts = gates
        .filter((g) => (horiz ? Math.abs(g.y - a.y) < T && g.x > a.x && g.x < b.x : Math.abs(g.x - a.x) < T && g.y > a.y && g.y < b.y))
        .map((g) => (horiz ? g.x : g.y))
        .sort((u, v) => u - v);
      let s = horiz ? a.x : a.y;
      for (const c of [...cuts, Infinity]) {
        const e = c === Infinity ? (horiz ? b.x : b.y) : c - gap / 2;
        if (e > s) map.walls.push(horiz ? { x0: s, y0: a.y - 2, x1: e, y1: a.y + 2 } : { x0: a.x - 2, y0: s, x1: a.x + 2, y1: e });
        s = c + gap / 2;
      }
    };
    side({ x: X0, y: Y0 }, { x: X1, y: Y0 }, true);
    side({ x: X0, y: Y1 }, { x: X1, y: Y1 }, true);
    side({ x: X0, y: Y0 }, { x: X0, y: Y1 }, false);
    side({ x: X1, y: Y0 }, { x: X1, y: Y1 }, false);
  };
  const building = (q: Rect, h: number, wall: string, roof: string, kind: Building["kind"]) => {
    const b: Building = { ...q, h, wall, roof, kind, seed: Math.floor(r() * 1e9) };
    const id = map.buildings.length;
    map.buildings.push(b);
    map.chunkAt(q.x0, q.y0).buildings.push(b);
    for (let y = q.y0; y <= q.y1; y++)
      for (let x = q.x0; x <= q.x1; x++) {
        map.set(x, y, BUILD);
        map.bid[y * n + x] = id;
      }
    return b;
  };
  const W = (x: number, y: number) => ({ x: x * T, y: y * T });

  // ---------- the islands ----------
  const east: Rect = { x0: cityN - 2, y0: 4, x1: n - 5, y1: city.y1 - 3 };
  const south: Rect = { x0: 4, y0: city.y1 + 8, x1: n - 5, y1: city.y1 + 80 };
  island(east);
  island(south);

  // ---------- the Motopark (east) ----------
  const spineX = east.x0 + 4; // the island's main road, north to south
  road(false, spineX, east.y0 + 6, east.y1 - 6);
  const mxRect: Rect = { x0: spineX + 6, y0: east.y0 + 8, x1: east.x1 - 4, y1: east.y0 + 116 };
  const ringRect: Rect = { x0: spineX + 6, y0: mxRect.y1 + 12, x1: east.x1 - 4, y1: east.y1 - 6 };
  const ringX1 = city.x1 - 4; // the city's eastern ring road ends here (its pavement column + 1)
  const hA = near(map.hroads, (mxRect.y0 + mxRect.y1) / 2 - 10);
  const hB = near(map.hroads, (ringRect.y0 + ringRect.y1) / 2);
  for (const h of [hA, hB]) road(true, h, ringX1, spineX + 5);

  // Motocross: a fenced dirt park with a long lap of jumps, whoops and berms.
  {
    const q = mxRect;
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) map.set(x, y, x === q.x0 || x === q.x1 || y === q.y0 || y === q.y1 ? WALK : DIRT);
    const R = { x0: (q.x0 + 1) * T, y0: (q.y0 + 1) * T, x1: q.x1 * T, y1: q.y1 * T };
    const P = (u: number, v: number) => ({ x: R.x0 + u * (R.x1 - R.x0), y: R.y0 + v * (R.y1 - R.y0) });
    const gv = ((hA + 1) * T - R.y0) / (R.y1 - R.y0);
    // The start/finish line is straight across from the gate: ride in and you are on it.
    const ctrl = [
      P(0.05, gv),
      P(0.1, 0.12),
      P(0.4, 0.1),
      P(0.5, 0.3),
      P(0.68, 0.12),
      P(0.9, 0.1),
      P(0.92, 0.36),
      P(0.7, 0.47),
      P(0.88, 0.62),
      P(0.9, 0.88),
      P(0.6, 0.92),
      P(0.46, 0.7),
      P(0.3, 0.9),
      P(0.1, 0.88),
      P(0.05, 0.62),
    ];
    const line = smoothLoop(ctrl, 30);
    const gate = { x: q.x0 * T, y: (hA + 1) * T };
    fence(q, [gate]);
    const gates = ctrl.map((c) => line.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a)));
    const mx: Track = { id: "mx", name: "Мотокросс", rect: R, gates, line, width: 110, surface: "dirt", limit: 200, laps: 1, grid: [], tyres: [], cones: [] };
    map.tracks.push(mx);
    // Features along the lap (fraction of the way round the smooth line).
    const at = (f: number) => {
      const i = Math.floor(f * line.length) % line.length;
      const a = line[i];
      const b = line[(i + 1) % line.length];
      return { x: a.x, y: a.y, a: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const add = (kind: ObstacleKind, f: number, len: number, wid: number, across = false) => {
      const p = at(f);
      map.addObstacle({ kind, x: p.x, y: p.y, a: p.a + (across ? Math.PI / 2 : 0), len, wid } as Obstacle);
    };
    const whoops = (f: number, k: number) => {
      for (let i = 0; i < k; i++) add("whoop", f + i * 0.0045, 100, 13, true);
    };
    add("ramp", 0.035, 44, 90); // first table
    whoops(0.07, 8);
    add("ramp", 0.13, 44, 90); // the big double
    add("ramp", 0.2, 44, 90);
    whoops(0.26, 7);
    add("mud", 0.33, 140, 100);
    add("ramp", 0.4, 44, 90);
    add("ramp", 0.47, 44, 90);
    whoops(0.52, 9);
    add("ramp", 0.6, 44, 90);
    add("log", 0.66, 100, 10, true);
    add("log", 0.672, 100, 10, true);
    add("ramp", 0.72, 44, 90);
    whoops(0.79, 8);
    add("mud", 0.86, 120, 100);
    add("ramp", 0.93, 44, 90);
    tyreWalls(map, mx, [gate, gates[0]]);
    map.zones.push({ name: "МОТОКРОСС", x: (R.x0 + R.x1) / 2, y: (R.y0 + R.y1) / 2 });
  }

  // The Motodrome: an asphalt ring on a lawn, a grandstand on the main straight.
  {
    const q = ringRect;
    for (let y = q.y0; y <= q.y1; y++) for (let x = q.x0; x <= q.x1; x++) map.set(x, y, x === q.x0 || x === q.x1 || y === q.y0 || y === q.y1 ? WALK : GRASS);
    const R = { x0: (q.x0 + 1) * T, y0: (q.y0 + 1) * T, x1: q.x1 * T, y1: q.y1 * T };
    const P = (u: number, v: number) => ({ x: R.x0 + u * (R.x1 - R.x0), y: R.y0 + v * (R.y1 - R.y0) });
    const gv = ((hB + 1) * T - R.y0) / (R.y1 - R.y0);
    // The main straight runs past the gate; the start line is level with it.
    const ctrl = [
      P(0.1, gv),
      P(0.1, 0.12),
      P(0.2, 0.05),
      P(0.48, 0.08),
      P(0.56, 0.22),
      P(0.8, 0.1),
      P(0.9, 0.2),
      P(0.88, 0.44),
      P(0.72, 0.52),
      P(0.88, 0.6),
      P(0.9, 0.88),
      P(0.76, 0.95),
      P(0.52, 0.86),
      P(0.42, 0.66),
      P(0.32, 0.88),
      P(0.18, 0.94),
      P(0.1, 0.85),
    ];
    const line = smoothLoop(ctrl, 30);
    const width = 124;
    for (let y = q.y0 + 1; y < q.y1; y++)
      for (let x = q.x0 + 1; x < q.x1; x++) if (loopDist(line, (x + 0.5) * T, (y + 0.5) * T) < width / 2 + T * 0.75) map.set(x, y, TRACK);
    // An access lane from the gate to the main straight.
    for (let x = q.x0; x <= q.x0 + 8; x++)
      for (const y of [hB, hB + 1]) if (map.at(x, y) === GRASS || map.at(x, y) === WALK) map.set(x, y, TRACK);
    fence(q, [{ x: q.x0 * T, y: (hB + 1) * T }]);
    const gates = ctrl.map((c) => line.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a)));
    // Start grid: two by two behind the line, facing up the straight (north).
    const s = gates[0];
    const grid = [
      { x: s.x - 28, y: s.y + 60, a: -Math.PI / 2 },
      { x: s.x + 28, y: s.y + 100, a: -Math.PI / 2 },
      { x: s.x - 28, y: s.y + 140, a: -Math.PI / 2 },
      { x: s.x + 28, y: s.y + 180, a: -Math.PI / 2 },
    ];
    const ring: Track = { id: "ring", name: "Мотодром", rect: R, gates, line, width, surface: "asphalt", limit: 240, laps: 2, grid, tyres: [], cones: [] };
    map.tracks.push(ring);
    // Grandstand along the main straight, clear of the gate lane.
    const gx0 = q.x0 + 2;
    building({ x0: gx0, y0: q.y0 + 12, x1: gx0 + 2, y1: Math.min(hB - 3, q.y0 + 44) }, T * 1.4, "#d9d4c7", "#c62828", "plain");
    tyreWalls(map, ring, [{ x: q.x0 * T, y: (hB + 1) * T }, gates[0], ...grid]);
    // Trees in the infield, clear of the asphalt.
    for (let k = 0; k < 160; k++) {
      const x = R.x0 + r() * (R.x1 - R.x0);
      const y = R.y0 + r() * (R.y1 - R.y0);
      if (map.tileAt(x, y) !== GRASS || loopDist(line, x, y) < width / 2 + 70) continue;
      addTree(map, x, y, 10 + r() * 8);
    }
    map.zones.push({ name: "МОТОДРОМ", x: (R.x0 + R.x1) / 2, y: R.y0 + (R.y1 - R.y0) * 0.38 });
  }

  // ---------- the Airport (south) ----------
  {
    const spineY = south.y0 + 3;
    road(true, spineY, south.x0 + 6, south.x1 - 6);
    const ringY1 = city.y1 - 4; // the city's southern ring road's pavement row + 1
    const vA = near(map.vroads, (south.x0 + south.x1) / 2 - 20);
    const vB = near(map.vroads, south.x0 + 70);
    for (const v of [vA, vB]) road(false, v, ringY1, spineY + 1);
    const cA = vA + 1; // the terminal's centre column
    // Terminal, car park in front, control tower.
    const term: Rect = { x0: cA - 34, y0: spineY + 5, x1: cA + 34, y1: spineY + 12 };
    building(term, T * 3.1, "#5d7f96", "#d7dde3", "glass");
    fill({ x0: term.x0, y0: spineY + 3, x1: term.x1, y1: spineY + 4 }, WALK);
    const tower = { x0: cA + 40, y0: spineY + 6, x1: cA + 42, y1: spineY + 8 };
    building(tower, T * 9.2, "#e9e6dc", "#2f3b48", "plain");
    // Apron, taxiway, runway.
    const apron: Rect = { x0: cA - 60, y0: term.y1 + 1, x1: cA + 60, y1: term.y1 + 20 };
    fill(apron, TARMAC);
    const taxiY0 = apron.y1 + 1;
    const taxi: Rect = { x0: south.x0 + 22, y0: taxiY0, x1: south.x1 - 22, y1: taxiY0 + 4 };
    fill(taxi, TARMAC);
    const rwY0 = taxi.y1 + 9;
    const runway: Rect = { x0: south.x0 + 14, y0: rwY0, x1: south.x1 - 14, y1: rwY0 + 7 };
    fill(runway, TARMAC);
    const links: Rect[] = [];
    for (const x of [taxi.x0, cA - 2, taxi.x1 - 4]) {
      const l = { x0: x, y0: taxi.y1 + 1, x1: x + 4, y1: runway.y0 - 1 };
      fill(l, TARMAC);
      links.push(l);
    }
    // A road from the spine onto the apron, beside the terminal.
    road(false, term.x1 + 2, spineY + 2, apron.y0);
    // Cargo hangars west of the terminal, each with its own apron.
    const hx = south.x0 + 30;
    for (let k = 0; k < 3; k++) {
      const q = { x0: hx + k * 24, y0: spineY + 6, x1: hx + k * 24 + 18, y1: spineY + 18 };
      building(q, T * 2.2, "#a7adb3", "#7d858c", "plain");
      fill({ x0: q.x0, y0: q.y1 + 1, x1: q.x1, y1: taxi.y0 - 1 }, TARMAC);
      fill({ x0: q.x0 + 7, y0: spineY + 2, x1: q.x1 - 7, y1: spineY + 5 }, TARMAC);
    }
    const A = (q: Rect) => ({ x0: q.x0 * T, y0: q.y0 * T, x1: (q.x1 + 1) * T, y1: (q.y1 + 1) * T });
    const planes = [-45, -15, 15, 45].map((dx, i) => ({ x: (cA + dx) * T, y: (apron.y0 + 9) * T, a: -Math.PI / 2, livery: i }));
    // The fuselages are solid; wings are high enough to ride under.
    for (const p of planes) map.walls.push({ x0: p.x - 16, y0: p.y - 120, x1: p.x + 16, y1: p.y + 130, hidden: true });
    const rw = A(runway);
    map.airport = {
      rect: A(south),
      runway: rw,
      taxi: [taxi, ...links].map(A),
      apron: A(apron),
      planes,
      tower: { x: (cA + 41.5) * T, y: (spineY + 7.5) * T },
      liftoff: rw.x0 + (rw.x1 - rw.x0) * 0.42,
      raceStart: { x: rw.x0 + 260, y: rw.y0 - 70 },
    };
    // Lights along the runway edges (glow at night).
    map.zones.push({ name: "АЭРОПОРТ", x: (rw.x0 + rw.x1) / 2, y: (spineY + 3) * T });
    // Trees on the grass away from the runway.
    for (let k = 0; k < 900; k++) {
      const x = south.x0 + 2 + r() * (south.x1 - south.x0 - 4);
      const y = south.y0 + 2 + r() * (south.y1 - south.y0 - 4);
      const t = map.at(Math.floor(x), Math.floor(y));
      if (t !== GRASS) continue;
      if (y > taxi.y0 - 6 && y < runway.y1 + 10) continue;
      if ([0, 1, 2, 3].some((d) => map.at(Math.floor(x) + [1, 0, -1, 0][d], Math.floor(y) + [0, 1, 0, -1][d]) !== GRASS)) continue;
      addTree(map, x * T, y * T, 10 + r() * 8);
    }
    // Job spots: cargo (hot) by the hangars, a delivery at the terminal, the plane race.
    map.jobs.push({ kind: "hot", ...W(hx + 9, spineY + 20) });
    map.jobs.push({ kind: "delivery", ...W(term.x0 + 6, spineY + 3.5) });
    map.jobs.push({ kind: "plane", x: map.airport.raceStart.x, y: map.airport.raceStart.y });

    // East of the terminal: a tarmac pad for the drift challenge and a cone slalom.
    const padY0 = spineY + 3;
    const padY1 = taxi.y0 - 2;
    const drift: Rect = { x0: cA + 70, y0: padY0, x1: cA + 130, y1: padY1 };
    const sl: Rect = { x0: cA + 136, y0: padY0, x1: south.x1 - 18, y1: padY1 };
    fill(drift, TARMAC);
    fill(sl, TARMAC);
    // No trees on the tarmac.
    const bare = (q: Rect) => {
      const x0 = q.x0 * T - 20;
      const y0 = q.y0 * T - 20;
      const x1 = (q.x1 + 1) * T + 20;
      const y1 = (q.y1 + 1) * T + 20;
      const gone = new Set(map.trees.filter((t) => t.x > x0 && t.x < x1 && t.y > y0 && t.y < y1));
      if (!gone.size) return;
      map.trees = map.trees.filter((t) => !gone.has(t));
      for (const ch of map.chunks) ch.trees = ch.trees.filter((t) => !gone.has(t));
      for (const [k, list] of map.treeCells) {
        const left = list.filter((t) => !gone.has(t));
        if (left.length) map.treeCells.set(k, left);
        else map.treeCells.delete(k);
      }
    };
    bare(drift);
    bare(sl);
    const D = A(drift);
    map.drift = D;
    map.jobs.push({ kind: "drift", x: (D.x0 + D.x1) / 2, y: D.y0 + 40 });
    map.zones.push({ name: "ДРИФТ", x: (D.x0 + D.x1) / 2, y: (D.y0 + D.y1) / 2 });
    {
      const S = A(sl);
      const y1 = S.y0 + (S.y1 - S.y0) * 0.3;
      const y2 = S.y0 + (S.y1 - S.y0) * 0.74;
      const X0 = S.x0;
      const X1 = S.x1;
      const n = Math.max(5, Math.floor((X1 - X0 - 700) / 250));
      const gates: Pt[] = [{ x: X0 + 160, y: y1 }];
      const cones: Pt[] = [];
      for (let k = 0; k < n; k++) {
        const x = X0 + 420 + k * 250;
        cones.push({ x, y: y1 });
        gates.push({ x, y: y1 + (k % 2 ? 80 : -80) });
      }
      gates.push({ x: X1 - 150, y: (y1 + y2) / 2 });
      gates.push({ x: X0 + (X1 - X0) * 0.62, y: y2 });
      gates.push({ x: X0 + (X1 - X0) * 0.3, y: y2 });
      gates.push({ x: X0 + 110, y: (y1 + y2) / 2 + 30 });
      // Cones marking the turns too.
      for (const g of [gates[n + 1], gates[n + 4]]) for (const d of [-1, 1]) cones.push({ x: g.x + (g === gates[n + 1] ? 100 : -90), y: g.y + d * 60 });
      const slalom: Track = { id: "slalom", name: "Слалом", rect: S, gates, line: smoothLoop(gates, 30), width: 80, surface: "asphalt", limit: 75, laps: 1, grid: [], tyres: [], cones, gateR: 62 };
      for (const c of cones) {
        const key = Math.floor(c.y / T) * n0 + Math.floor(c.x / T);
        const cell = map.tyreCells.get(key);
        if (cell) cell.push(c);
        else map.tyreCells.set(key, [c]);
      }
      map.tracks.push(slalom);
      map.zones.push({ name: "СЛАЛОМ", x: (S.x0 + S.x1) / 2, y: (S.y0 + S.y1) / 2 });
    }
  }

  // Trees on the Motopark island's open grass.
  for (let k = 0; k < 500; k++) {
    const x = east.x0 + 2 + Math.floor(r() * (east.x1 - east.x0 - 4));
    const y = east.y0 + 2 + Math.floor(r() * (east.y1 - east.y0 - 4));
    if (map.at(x, y) !== GRASS) continue;
    if (x > mxRect.x0 - 2 && y < ringRect.y1 + 2) continue;
    if ([0, 1, 2, 3].some((d) => map.at(x + [1, 0, -1, 0][d], y + [0, 1, 0, -1][d]) !== GRASS)) continue;
    addTree(map, (x + 0.25 + r() * 0.5) * T, (y + 0.25 + r() * 0.5) * T, 10 + r() * 8);
  }
  map.jobs.push({ kind: "delivery", ...W(spineX - 1.5, hB + 6) });

  // Street lights on the new roads.
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (x <= city.x1 && y <= city.y1) continue;
      if (map.at(x, y) !== WALK || (x * 7 + y * 13) % 5 !== 0) continue;
      const d = [0, 1, 2, 3].find((k) => {
        const t = map.at(x + [1, 0, -1, 0][k], y + [0, 1, 0, -1][k]);
        return t === ROAD || t === BRIDGE;
      });
      if (d === undefined) continue;
      const lamp = { x: (x + 0.5 + [1, 0, -1, 0][d] * 0.38) * T, y: (y + 0.5 + [0, 1, 0, -1][d] * 0.38) * T, a: (d * Math.PI) / 2 };
      map.lamps.push(lamp);
      map.chunkAt(x, y).lamps.push(lamp);
    }

  // ---------- the player's garage, in town: a whole plot of its own ----------
  buildHome(map, r);
  // Round the garage the billboards are BSE, not REGULMOTO: the REGULMOTO board nearby becomes
  // BSE, the BSE board furthest from the garage takes the brand of the board furthest of all,
  // and that one becomes REGULMOTO (each brand keeps its number of boards).
  if (map.home) {
    const { x, y } = map.home.door;
    const dist = (b: Building) => Math.hypot(((b.x0 + b.x1 + 1) / 2) * T - x, ((b.y0 + b.y1 + 1) / 2) * T - y);
    const byFar = (p: Building, q: Building) => dist(q) - dist(p);
    for (const b of map.buildings.filter((q) => q.ad === "regulmoto" && dist(q) < 3000)) {
      const bse = map.buildings.filter((q) => q.ad === "bse" && dist(q) > dist(b)).sort(byFar)[0];
      const other = map.buildings.filter((q) => q.ad && q.ad !== "bse" && q.ad !== "regulmoto" && dist(q) > Math.max(3000, dist(b))).sort(byFar)[0];
      if (!bse || !other) break;
      bse.ad = other.ad;
      other.ad = "regulmoto";
      b.ad = "bse";
    }
    // And the board closest to the garage is a BSE one.
    const boards = map.buildings.filter((q) => q.ad).sort((p, q) => dist(p) - dist(q));
    if (boards[0] && boards[0].ad !== "bse") {
      const far = boards.filter((q) => q.ad === "bse").pop();
      if (far) [far.ad, boards[0].ad] = [boards[0].ad, "bse"];
    }
  }

  // ---------- test drives at the 67MOTO showrooms ----------
  for (const shop of map.places.filter((p) => p.kind === "shop")) {
    for (const [dx, dy] of [[0, 90], [90, 0], [-90, 0], [0, -90]]) {
      const w = map.nearestWalk(shop.x + dx, shop.y + dy);
      const d = Math.hypot(w.x - shop.x, w.y - shop.y);
      if (d < 60 || d > 160) continue;
      map.jobs.push({ kind: "testdrive", x: w.x, y: w.y });
      break;
    }
  }

  // ---------- stunt ramps (★): ten of the ramps round town, spread out ----------
  {
    const inTrack = (o: Obstacle) => map.tracks.some((t) => o.x > t.rect.x0 && o.x < t.rect.x1 && o.y > t.rect.y0 && o.y < t.rect.y1);
    const pool = map.obstacles.filter((o) => o.kind === "ramp" && !inTrack(o));
    const picked: Obstacle[] = [];
    // Farthest-point sampling from the first river ramp: ten ramps all over the city.
    const first = pool.find((o) => o.power) ?? pool[0];
    if (first) picked.push(first);
    while (picked.length < 10 && picked.length < pool.length) {
      let best: Obstacle | null = null;
      let bd = -1;
      for (const o of pool) {
        if (picked.includes(o)) continue;
        const d = Math.min(...picked.map((q) => Math.hypot(q.x - o.x, q.y - o.y)));
        if (d > bd) (bd = d), (best = o);
      }
      if (!best) break;
      picked.push(best);
    }
    picked.forEach((o, i) => (o.unique = i));
    map.jumps = picked;
  }

  map.land = { x0: city.x0, y0: city.y0, x1: east.x1, y1: south.y1 };
  void CHUNK;
  void LOT;
  void SAND;
}

// Clears a city block near the centre and puts the player's garage on it: the building at the
// back, a fenced yard with a gate onto the street, three parking bays for the other own bikes.
function buildHome(map: CityMap, r: () => number) {
  const n = map.n;
  const V = map.vroads;
  const H = map.hroads;
  const c = map.land;
  const mid = { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 };
  const inBlock = (q: Rect, x: number, y: number, m = 1) => x >= (q.x0 - m) * T && x < (q.x1 + 1 + m) * T && y >= (q.y0 - m) * T && y < (q.y1 + 1 + m) * T;
  let best: Rect | null = null;
  let bd = Infinity;
  for (let i = 0; i + 1 < V.length; i++)
    for (let j = 0; j + 1 < H.length; j++) {
      const q = { x0: V[i] + 3, y0: H[j] + 3, x1: V[i + 1] - 2, y1: H[j + 1] - 2 }; // inside the pavement ring
      if (q.x1 - q.x0 + 1 < 8 || q.y1 - q.y0 + 1 < 8 || q.x1 - q.x0 > 12 || q.y1 - q.y0 > 12) continue;
      let ok = true;
      for (let y = q.y0 - 1; y <= q.y1 + 1 && ok; y++) if (map.inRiver(y)) ok = false;
      for (let y = q.y0; y <= q.y1 && ok; y++) for (let x = q.x0; x <= q.x1 && ok; x++) if (map.at(x, y) === DIRT || map.at(x, y) === WATER) ok = false;
      if (!ok) continue;
      if (map.places.some((p) => inBlock(q, p.x, p.y))) continue;
      if ([...map.phones, ...map.packages, ...map.jobs].some((p) => inBlock(q, p.x, p.y))) continue;
      if (map.obstacles.some((o) => inBlock(q, o.x, o.y, 2))) continue;
      if (map.buildings.some((b) => (b.ad || b.helipad) && b.x0 >= q.x0 && b.x1 <= q.x1 && b.y0 >= q.y0 && b.y1 <= q.y1)) continue;
      const d = Math.hypot((q.x0 + q.x1) / 2 - mid.x, (q.y0 + q.y1) / 2 - mid.y);
      if (d < bd) (bd = d), (best = q);
    }
  if (!best) return;
  const q = best;
  // Clear the plot: buildings, trees, car parks.
  const inside = (x0: number, y0: number, x1: number, y1: number) => x0 >= q.x0 && x1 <= q.x1 && y0 >= q.y0 && y1 <= q.y1;
  const gone = new Set(map.buildings.filter((b) => inside(b.x0, b.y0, b.x1, b.y1)));
  map.buildings = map.buildings.filter((b) => !gone.has(b));
  for (const ch of map.chunks) ch.buildings = ch.buildings.filter((b) => !gone.has(b));
  map.lots = map.lots.filter((l) => !inside(l.x0, l.y0, l.x1, l.y1));
  const goneT = new Set(map.trees.filter((t) => t.x >= q.x0 * T && t.x < (q.x1 + 1) * T && t.y >= q.y0 * T && t.y < (q.y1 + 1) * T));
  map.trees = map.trees.filter((t) => !goneT.has(t));
  for (const ch of map.chunks) ch.trees = ch.trees.filter((t) => !goneT.has(t));
  for (let y = q.y0; y <= q.y1; y++)
    for (let x = q.x0; x <= q.x1; x++) {
      map.treeCells.delete(y * n + x);
      map.set(x, y, LOT);
      map.bid[y * n + x] = -1;
    }
  // The garage at the back (north), lawn strips either side of it.
  const bq: Rect = { x0: q.x0 + 1, y0: q.y0, x1: q.x1 - 1, y1: q.y0 + 2 };
  for (const x of [q.x0, q.x1]) for (let y = bq.y0; y <= bq.y1; y++) map.set(x, y, GRASS);
  const b: Building = { ...bq, h: T * 1.8, wall: "#3e434b", roof: "#ff9f1a", kind: "plain", seed: Math.floor(r() * 1e9), sign: "ТВОЙ ГАРАЖ" };
  map.buildings.push(b);
  map.chunkAt(bq.x0, bq.y0).buildings.push(b);
  for (let y = bq.y0; y <= bq.y1; y++)
    for (let x = bq.x0; x <= bq.x1; x++) {
      map.set(x, y, BUILD);
      map.bid[y * n + x] = map.buildings.length - 1;
    }
  // Yard: three bays on the left, the door on the right, a fence with a gate onto the street.
  const yardY0 = bq.y1 + 1;
  map.lots.push({ x0: q.x0 + 1, y0: yardY0, x1: q.x0 + 3, y1: yardY0 });
  const bays = [0, 1, 2].map((k) => ({ x: (q.x0 + 1 + k + 0.5) * T, y: (yardY0 + 0.55) * T, a: -Math.PI / 2 }));
  const door = { x: (q.x1 - 1.5) * T, y: yardY0 * T + 24 };
  const gate = door.x;
  const Y1 = (q.y1 + 1) * T;
  map.walls.push(
    { x0: q.x0 * T - 2, y0: yardY0 * T, x1: q.x0 * T + 2, y1: Y1 },
    { x0: (q.x1 + 1) * T - 2, y0: yardY0 * T, x1: (q.x1 + 1) * T + 2, y1: Y1 },
    { x0: q.x0 * T, y0: Y1 - 2, x1: gate - 52, y1: Y1 + 2 },
    { x0: gate + 52, y0: Y1 - 2, x1: (q.x1 + 1) * T, y1: Y1 + 2 },
  );
  const start = { x: (q.x0 + 2) * T, y: (q.y1 + 0.2) * T };
  map.home = { block: q, building: bq, door, bays, start };
  map.places.push({ kind: "home", x: door.x, y: door.y, a: Math.PI / 2 });
  map.zones.push({ name: "ТВОЙ ГАРАЖ", x: ((q.x0 + q.x1 + 1) / 2) * T, y: (q.y0 - 1) * T });
}

// Tyre stacks along the outside of every bend, just off the track: they soak up a rider who
// runs wide. None across the gate, the start or another part of the lap.
function tyreWalls(map: CityMap, tr: Track, keepClear: Pt[]) {
  const L = tr.line;
  const n = L.length;
  const k = 5;
  const off = tr.width / 2 + 24;
  const inside = (p: Pt) => p.x > tr.rect.x0 + 18 && p.x < tr.rect.x1 - 18 && p.y > tr.rect.y0 + 18 && p.y < tr.rect.y1 - 18;
  const put = (p: Pt) => {
    if (!inside(p) || map.tileAt(p.x, p.y) === BUILD) return;
    if (keepClear.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < 170)) return;
    if (loopDist(L, p.x, p.y) < tr.width / 2 + 16) return;
    if (tr.tyres.some((t) => Math.hypot(t.x - p.x, t.y - p.y) < TYRE_R * 1.7)) return;
    if (map.obstacles.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < Math.max(o.len, o.wid) / 2 + 12)) return;
    tr.tyres.push(p);
    const key = Math.floor(p.y / T) * map.n + Math.floor(p.x / T);
    const cell = map.tyreCells.get(key);
    if (cell) cell.push(p);
    else map.tyreCells.set(key, [p]);
  };
  const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  let prev: Pt | null = null;
  for (let i = 0; i < n; i++) {
    const a = L[(i - k + n) % n];
    const b = L[i];
    const c = L[(i + k) % n];
    const turn = wrapA(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    if (Math.abs(turn) < 0.42) {
      prev = null;
      continue;
    }
    const p0 = L[(i - 1 + n) % n];
    const p1 = L[(i + 1) % n];
    const l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    // Outside of the bend: left of a right-hander, right of a left-hander.
    const d = -Math.sign(turn) * off;
    const p = { x: b.x - ((p1.y - p0.y) / l) * d, y: b.y + ((p1.x - p0.x) / l) * d };
    // A continuous wall: fill in from the previous stack.
    if (prev) {
      const gap = Math.hypot(p.x - prev.x, p.y - prev.y);
      const steps = Math.ceil(gap / (TYRE_R * 1.75));
      for (let s = 1; s < steps; s++) put({ x: prev.x + ((p.x - prev.x) * s) / steps, y: prev.y + ((p.y - prev.y) * s) / steps });
    }
    put(p);
    prev = p;
  }
}

function addTree(map: CityMap, x: number, y: number, r: number) {
  const t: Tree = { x, y, r };
  map.trees.push(t);
  const tx = Math.floor(x / T);
  const ty = Math.floor(y / T);
  map.chunkAt(tx, ty).trees.push(t);
  const key = ty * map.n + tx;
  const cell = map.treeCells.get(key);
  if (cell) cell.push(t);
  else map.treeCells.set(key, [t]);
}
