// Everything that moves in the city: bikes and cars (top-down rigid bodies with tyre grip),
// pedestrians, the police, traffic that follows lanes and turns at crossings, crashes,
// fires, pick-ups and the courier jobs.

import { BRIDGE, BUILD, CityMap, DX, DY, type Dir, GRASS, type JobKind, type JobSpot, LOT, type Place, ROAD, SAND, T, WALK, WATER, rng } from "./map.ts";

export type VType = "bike" | "car" | "bus" | "police";

export interface Model {
  id: string;
  name: string;
  type: VType;
  len: number;
  wid: number;
  mass: number;
  vmax: number; // units/s (8 units ≈ 1 m)
  accel: number;
  brake: number;
  turn: number; // yaw rate at full lock, rad/s
  grip: number; // how fast sideways slip dies, 1/s
  offroad: number; // speed kept on grass and sand
  hp: number;
  price: number;
  colors: string[];
}

const m = (o: Partial<Model> & Pick<Model, "id" | "name" | "type" | "len" | "wid">): Model => ({
  mass: 1,
  vmax: 300,
  accel: 400,
  brake: 520,
  turn: 3,
  grip: 14,
  offroad: 0.7,
  hp: 60,
  price: 0,
  colors: ["#c33"],
  ...o,
});

// Bikes the player can ride (and buy); the rest is traffic.
export const BIKES: Model[] = [
  m({ id: "scooter", name: "Скутер «Шмель»", type: "bike", len: 16, wid: 7, vmax: 210, accel: 300, brake: 420, turn: 3.7, grip: 14, offroad: 0.55, hp: 40, price: 0, colors: ["#f2c230", "#7cc4e8", "#e86a8f", "#9ad06a"] }),
  m({ id: "enduro", name: "Эндуро 250", type: "bike", len: 20, wid: 8, vmax: 330, accel: 440, brake: 540, turn: 3.3, grip: 15, offroad: 0.95, hp: 60, price: 0, colors: ["#e8e8e8", "#ff7a1a", "#2f7de1", "#2fae4f"] }),
  m({ id: "chopper", name: "Чоппер «Буря»", type: "bike", len: 24, wid: 10, mass: 1.5, vmax: 360, accel: 360, brake: 480, turn: 2.5, grip: 14, offroad: 0.55, hp: 100, price: 4000, colors: ["#1d1d1f", "#6b1414", "#2b3a55"] }),
  m({ id: "sport", name: "Спортбайк R6", type: "bike", len: 22, wid: 8, vmax: 470, accel: 580, brake: 660, turn: 2.9, grip: 16, offroad: 0.45, hp: 55, price: 7000, colors: ["#d81f26", "#1c4fd8", "#111", "#f2f2f2"] }),
  m({ id: "supermoto", name: "Супермото 450", type: "bike", len: 20, wid: 8, vmax: 420, accel: 560, brake: 680, turn: 3.5, grip: 18, offroad: 0.85, hp: 70, price: 12000, colors: ["#ff7a1a", "#f2f2f2", "#ffd21f"] }),
];
export const BIKE = Object.fromEntries(BIKES.map((b) => [b.id, b])) as Record<string, Model>;

const CARS: Model[] = [
  m({ id: "sedan", name: "Седан", type: "car", len: 34, wid: 16, mass: 4, vmax: 270, accel: 220, brake: 420, turn: 2.3, grip: 10, hp: 100, colors: ["#b8bcc2", "#2e5aa8", "#a82e2e", "#2d2d33", "#e9e6dc", "#3d7a4f", "#6b4f9a"] }),
  m({ id: "hatch", name: "Хэтчбек", type: "car", len: 29, wid: 15, mass: 3.2, vmax: 250, accel: 230, brake: 420, turn: 2.5, grip: 10, hp: 80, colors: ["#d65b2a", "#f0d04a", "#4ab0d6", "#e9e6dc", "#8a8f96"] }),
  m({ id: "taxi", name: "Такси", type: "car", len: 34, wid: 16, mass: 4, vmax: 280, accel: 230, brake: 420, turn: 2.3, grip: 10, hp: 100, colors: ["#f5c518"] }),
  m({ id: "van", name: "Фургон", type: "car", len: 40, wid: 18, mass: 6, vmax: 220, accel: 160, brake: 360, turn: 1.9, grip: 9, hp: 130, colors: ["#f0f0f0", "#3c6e9f", "#c9c2b0"] }),
  m({ id: "bus", name: "Автобус", type: "bus", len: 70, wid: 20, mass: 14, vmax: 190, accel: 110, brake: 300, turn: 1.4, grip: 9, hp: 250, colors: ["#e0b02a", "#3b8f5a"] }),
];
const POLICE: Model = m({ id: "police", name: "Полиция", type: "police", len: 35, wid: 16, mass: 4.5, vmax: 380, accel: 320, brake: 520, turn: 2.7, grip: 11, hp: 170, colors: ["#f4f4f4"] });

export interface Look {
  jacket: string;
  helmet: string;
}

export interface Ai {
  dir: Dir;
  road: number;
  path: { x: number; y: number; turn: boolean }[];
  cruise: number;
  wait: number;
  impatient: number;
  off: number; // seconds spent off the road
}

let nextId = 1;

export class Vehicle {
  id = nextId++;
  vx = 0;
  vy = 0;
  spin = 0;
  hp: number;
  rider: "player" | "npc" | null = null;
  look: Look;
  ai: Ai | null = null;
  thr = 0;
  brk = 0;
  steer = 0;
  hb = false;
  down = false;
  burn = 0;
  wreck = false;
  sink = 0;
  chase = false;
  stuck = 0;
  reverseT = 0;
  lean = 0;
  fwd = 0; // forward speed, for the renderer and sound
  slip = 0;
  hit = 0; // flash after a knock
  readonly circles: [number, number][];
  readonly inertia: number;

  model: Model;
  x: number;
  y: number;
  a: number;
  color: string;

  constructor(model: Model, x: number, y: number, a: number, color: string) {
    this.model = model;
    this.x = x;
    this.y = y;
    this.a = a;
    this.color = color;
    this.hp = model.hp;
    this.look = { jacket: pickOf(JACKETS), helmet: pickOf(HELMETS) };
    const r = model.wid / 2;
    const n = Math.max(1, Math.round(model.len / model.wid));
    const span = model.len / 2 - r;
    this.circles = [];
    if (model.type === "bike") this.circles = [[-model.len / 2 + 4.5, 4.5], [model.len / 2 - 4.5, 4.5]];
    else for (let i = 0; i < n; i++) this.circles.push([n === 1 ? 0 : -span + (2 * span * i) / (n - 1), r]);
    this.inertia = (model.mass * (model.len * model.len + model.wid * model.wid)) / 12;
  }

  get bike() {
    return this.model.type === "bike";
  }
  get police() {
    return this.model.type === "police";
  }
  get speed() {
    return Math.hypot(this.vx, this.vy);
  }
  get alive() {
    return !this.wreck && this.sink === 0;
  }
}

export type PedState = "walk" | "flee" | "fly" | "down" | "swim";

export class Ped {
  vx = 0;
  vy = 0;
  spin = 0;
  state: PedState = "walk";
  t = 0;
  phase = Math.random() * 6;
  dir: Dir = 0;
  tx = 0;
  ty = 0;
  off = (Math.random() - 0.5) * 14;
  speed = 22 + Math.random() * 12;
  crossing = 0;
  shirt = pickOf(SHIRTS);
  pants = pickOf(PANTS);
  hair = pickOf(HAIRS);
  helmet: string | null = null;
  x: number;
  y: number;
  a: number;
  constructor(x: number, y: number, a = 0) {
    this.x = x;
    this.y = y;
    this.a = a;
    this.tx = x;
    this.ty = y;
  }
}

const SHIRTS = ["#d94f4f", "#4f7fd9", "#e0c050", "#5fb36a", "#efefef", "#333840", "#c27ad9", "#e08a3c", "#6fc6c9"];
const PANTS = ["#2d3a55", "#3a3a3a", "#5a4632", "#283048", "#6b6b6b"];
const HAIRS = ["#2b1d14", "#5a3a22", "#c9a35a", "#111", "#8a8a8a", "#a3482a"];
const JACKETS = ["#222", "#3a2d24", "#7a1f1f", "#1f3a6b", "#555"];
const HELMETS = ["#111", "#e8e8e8", "#c62828", "#1565c0", "#f9a825", "#2e7d32"];
function pickOf<X>(a: X[]) {
  return a[Math.floor(Math.random() * a.length)];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  kind: "smoke" | "fire" | "spark" | "splash" | "dust" | "cash";
}

export interface Skid {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
}

export interface Pickup {
  kind: "cash" | "health";
  x: number;
  y: number;
  amount: number;
  respawn: number;
}

export interface Job {
  kind: JobKind;
  spot: JobSpot;
  points: { x: number; y: number }[];
  idx: number;
  time: number;
  reward: number;
  title: string;
}

export type GameEvent =
  | { type: "crash"; power: number; x: number; y: number }
  | { type: "ped"; x: number; y: number }
  | { type: "cash"; amount: number }
  | { type: "health" }
  | { type: "explode"; x: number; y: number }
  | { type: "splash"; x: number; y: number }
  | { type: "msg"; text: string; tone: "good" | "bad" | "info" }
  | { type: "jobDone"; reward: number }
  | { type: "jobFail" }
  | { type: "checkpoint" }
  | { type: "wanted"; level: number }
  | { type: "horn"; x: number; y: number }
  | { type: "busted" }
  | { type: "wasted" }
  | { type: "shop" }
  | { type: "kick" };

export interface Input {
  gas: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  hb: boolean;
  action: boolean; // edge: get on / off
  kick: boolean; // edge
}

export interface Player {
  mode: "ride" | "foot" | "fly" | "out";
  bike: Vehicle | null;
  body: Ped;
  health: number;
  getup: number;
  bust: number;
  outT: number;
}

const WANTED_LOSE = 12; // seconds out of sight per star
const POLICE_FOR = [0, 2, 3, 4, 6, 8];
const CRASH = 150; // impact speed that throws a rider off
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export class World {
  vehicles: Vehicle[] = [];
  peds: Ped[] = [];
  particles: Particle[] = [];
  skids: Skid[] = [];
  pickups: Pickup[] = [];
  events: GameEvent[] = [];
  player: Player;
  money = 0;
  wanted = 0;
  unseen = 0;
  heat = 0; // crimes since the last star
  job: Job | null = null;
  jobCooldown = 0;
  time = 0;
  view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  bikeId = "enduro";
  private flow: Int16Array;
  private flowTile = -1;
  private flowT = 0;
  private placeIn = new Set<Place>();
  private r = rng(1234);
  private tick = 0;

  map: CityMap;
  constructor(map: CityMap) {
    this.map = map;
    this.flow = new Int16Array(map.n * map.n);
    const home = map.places.find((p) => p.kind === "garage") ?? map.places[0];
    const start = map.nearestWalk(home.x, home.y - T * 2);
    const body = new Ped(start.x, start.y, -Math.PI / 2);
    body.helmet = "#ff7a1a";
    body.shirt = "#1d1d1f";
    this.player = { mode: "foot", bike: null, body, health: 100, getup: 0, bust: 0, outT: 0 };
    for (let i = 0; i < 46; i++) this.placePickup(i < 38 ? "cash" : "health");
  }

  emit(e: GameEvent) {
    this.events.push(e);
  }
  say(text: string, tone: "good" | "bad" | "info" = "info") {
    this.emit({ type: "msg", text, tone });
  }

  get px() {
    return this.player.mode === "ride" && this.player.bike ? this.player.bike.x : this.player.body.x;
  }
  get py() {
    return this.player.mode === "ride" && this.player.bike ? this.player.bike.y : this.player.body.y;
  }

  // ---------- spawning ----------

  spawnPlayerBike(id: string, x: number, y: number, a: number, mount: boolean) {
    const model = BIKE[id] ?? BIKE.enduro;
    const v = new Vehicle(model, x, y, a, model.colors[0]);
    this.vehicles.push(v);
    if (mount) this.mount(v);
    return v;
  }

  private placePickup(kind: "cash" | "health") {
    const map = this.map;
    for (let tries = 0; tries < 100; tries++) {
      const x = map.land.x0 + Math.floor(this.r() * (map.land.x1 - map.land.x0));
      const y = map.land.y0 + Math.floor(this.r() * (map.land.y1 - map.land.y0));
      const t = map.at(x, y);
      if (t !== WALK && t !== LOT && t !== GRASS) continue;
      this.pickups.push({ kind, x: (x + 0.5) * T, y: (y + 0.5) * T, amount: kind === "cash" ? 50 * (1 + Math.floor(this.r() * 5)) : 40, respawn: 0 });
      return;
    }
  }

  private offscreen(x: number, y: number, margin = 80) {
    const v = this.view;
    return x < v.x0 - margin || x > v.x1 + margin || y < v.y0 - margin || y > v.y1 + margin;
  }

  private laneSpot(minD: number, maxD: number, anywhere: boolean) {
    const map = this.map;
    const horiz = this.r() < 0.5;
    const list = horiz ? map.hroads : map.vroads;
    const cross = horiz ? map.vroads : map.hroads;
    const i = Math.floor(this.r() * list.length);
    const dir = (horiz ? (this.r() < 0.5 ? 0 : 2) : this.r() < 0.5 ? 1 : 3) as Dir;
    const lo = cross[0] * T;
    const hi = (cross[cross.length - 1] + 2) * T;
    // Near the player: along the stretch closest to them.
    const along = horiz ? this.px : this.py;
    let s = anywhere ? lo + this.r() * (hi - lo) : along + (this.r() * 2 - 1) * maxD;
    s = clamp(s, lo + 4, hi - 4);
    const st = Math.floor(s / T);
    if (cross.some((c) => st === c || st === c + 1)) return null;
    const x = horiz ? s : map.laneX(i, dir);
    const y = horiz ? map.laneY(i, dir) : s;
    const d = Math.hypot(x - this.px, y - this.py);
    if (d < minD || d > maxD) return null;
    if (!anywhere && !this.offscreen(x, y)) return null;
    if (this.vehicles.some((v) => Math.abs(v.x - x) + Math.abs(v.y - y) < 70)) return null;
    return { x, y, dir, road: i };
  }

  private spawnTraffic(anywhere: boolean, police = false) {
    const spot = this.laneSpot(anywhere ? 200 : 650, anywhere ? 1300 : 1100, anywhere);
    if (!spot) return null;
    let model: Model;
    const roll = this.r();
    if (police) model = POLICE;
    else if (roll < 0.3) model = BIKES[Math.floor(this.r() * BIKES.length)];
    else if (roll < 0.58) model = CARS[0];
    else if (roll < 0.74) model = CARS[1];
    else if (roll < 0.84) model = CARS[2];
    else if (roll < 0.93) model = CARS[3];
    else if (roll < 0.97) model = CARS[4];
    else model = POLICE;
    const v = new Vehicle(model, spot.x, spot.y, (spot.dir * Math.PI) / 2, pickOf(model.colors));
    v.rider = "npc";
    const cruise = model.type === "bike" ? 100 + this.r() * 50 : model.type === "bus" ? 70 : 80 + this.r() * 35;
    v.ai = { dir: spot.dir, road: spot.road, path: [], cruise, wait: 0, impatient: 0, off: 0 };
    const f = cruise * 0.8;
    v.vx = Math.cos(v.a) * f;
    v.vy = Math.sin(v.a) * f;
    if (police && this.wanted > 0) v.chase = true;
    this.vehicles.push(v);
    return v;
  }

  private spawnPed(anywhere: boolean) {
    const map = this.map;
    const rad = anywhere ? 1000 : 900;
    for (let tries = 0; tries < 8; tries++) {
      const x = this.px + (this.r() * 2 - 1) * rad;
      const y = this.py + (this.r() * 2 - 1) * rad;
      if (map.tileAt(x, y) !== WALK) continue;
      if (!anywhere && !this.offscreen(x, y, 40)) continue;
      if (Math.hypot(x - this.px, y - this.py) < 120) continue;
      const tx = Math.floor(x / T);
      const ty = Math.floor(y / T);
      const p = new Ped((tx + 0.5) * T, (ty + 0.5) * T);
      p.dir = Math.floor(this.r() * 4) as Dir;
      this.peds.push(p);
      return;
    }
  }

  private spawnParked(anywhere: boolean) {
    const map = this.map;
    for (let tries = 0; tries < 10; tries++) {
      const x = this.px + (this.r() * 2 - 1) * 900;
      const y = this.py + (this.r() * 2 - 1) * 900;
      const tx = Math.floor(x / T);
      const ty = Math.floor(y / T);
      const t = map.at(tx, ty);
      if (t !== WALK && t !== LOT) continue;
      // At the kerb, parallel to the road.
      let a = this.r() * Math.PI * 2;
      if (t === WALK) {
        const d = [0, 1, 2, 3].find((k) => map.at(tx + DX[k], ty + DY[k]) === ROAD);
        if (d === undefined) continue;
        a = d % 2 === 0 ? Math.PI / 2 + (this.r() < 0.5 ? 0 : Math.PI) : this.r() < 0.5 ? 0 : Math.PI;
      }
      const wx = (tx + 0.5) * T;
      const wy = (ty + 0.5) * T;
      if (!anywhere && !this.offscreen(wx, wy)) continue;
      if (Math.hypot(wx - this.px, wy - this.py) < 60) continue;
      if (this.vehicles.some((v) => Math.abs(v.x - wx) + Math.abs(v.y - wy) < 40)) continue;
      const model = BIKES[Math.floor(this.r() * 2) + (this.r() < 0.25 ? 2 : 0)];
      this.vehicles.push(new Vehicle(model, wx, wy, a + (this.r() - 0.5) * 0.3, pickOf(model.colors)));
      return;
    }
  }

  populate(first: boolean) {
    const px = this.px;
    const py = this.py;
    // Forget what is far behind.
    this.vehicles = this.vehicles.filter((v) => {
      if (v === this.player.bike) return true;
      const d = Math.hypot(v.x - px, v.y - py);
      if (v.chase && this.wanted > 0) return d < 2400;
      return d < 1500 || !this.offscreen(v.x, v.y, 200);
    });
    this.peds = this.peds.filter((p) => Math.hypot(p.x - px, p.y - py) < 1300 || !this.offscreen(p.x, p.y, 100));
    const near = (v: Vehicle) => Math.hypot(v.x - px, v.y - py) < 1300;
    const traffic = this.vehicles.filter((v) => v.ai && !v.chase && near(v)).length;
    const parked = this.vehicles.filter((v) => !v.ai && v.bike && v.rider === null && near(v)).length;
    const cops = this.vehicles.filter((v) => v.police && v.chase).length;
    const tries = first ? 300 : 8;
    for (let i = 0; i < tries && this.vehicles.filter((v) => v.ai && !v.chase).length < 30; i++) if (traffic + i < 30) this.spawnTraffic(first);
    for (let i = 0; i < (first ? 60 : 2) && this.peds.length < 55; i++) this.spawnPed(first);
    for (let i = 0; i < (first ? 10 : 1) && parked + i < 6; i++) this.spawnParked(first);
    if (cops < POLICE_FOR[this.wanted] && this.tick % 30 === 0) this.spawnTraffic(false, true);
  }

  // ---------- player ----------

  mount(v: Vehicle) {
    const p = this.player;
    if (v.rider === "npc") {
      this.throwRider(v, 60);
      this.crime(0.7, v.x, v.y);
      this.say("Байк угнан!", "info");
    }
    v.ai = null;
    v.chase = false;
    v.rider = "player";
    v.down = false;
    v.spin = 0;
    p.bike = v;
    p.mode = "ride";
    p.body.state = "walk";
  }

  private dismount() {
    const p = this.player;
    const v = p.bike;
    if (!v) return;
    const fast = v.speed > 80;
    if (fast) {
      this.throwRider(v, v.speed * 0.6);
      return;
    }
    v.rider = null;
    v.thr = 0;
    v.brk = 1;
    const rx = -Math.sin(v.a);
    const ry = Math.cos(v.a);
    p.body.x = v.x + rx * 12;
    p.body.y = v.y + ry * 12;
    p.body.a = v.a;
    p.body.vx = v.vx;
    p.body.vy = v.vy;
    p.mode = "foot";
    p.bike = null;
  }

  // Rider leaves the bike through the air.
  throwRider(v: Vehicle, impact: number) {
    const f = { x: Math.cos(v.a), y: Math.sin(v.a) };
    if (v.rider === "player") {
      const p = this.player;
      const b = p.body;
      b.x = v.x + f.x * 6;
      b.y = v.y + f.y * 6;
      b.vx = v.vx * 0.9;
      b.vy = v.vy * 0.9;
      b.spin = (this.r() < 0.5 ? -1 : 1) * (5 + this.r() * 6);
      b.state = "fly";
      p.mode = "fly";
      p.bike = null;
      p.getup = 0;
      this.hurt(Math.max(0, impact - 60) * 0.18);
      if (this.job?.kind === "delivery" && impact > CRASH) this.say("Посылка помялась, но цела", "info");
    } else if (v.rider === "npc") {
      const ped = new Ped(v.x + f.x * 6, v.y + f.y * 6, v.a);
      ped.helmet = v.look.helmet;
      ped.shirt = v.look.jacket;
      ped.vx = v.vx * 0.9;
      ped.vy = v.vy * 0.9;
      ped.spin = 6;
      ped.state = "fly";
      ped.t = 6 + this.r() * 4;
      this.peds.push(ped);
    }
    v.rider = null;
    v.ai = null;
    v.chase = false;
    v.down = true;
    v.thr = 0;
    v.brk = 0;
  }

  hurt(dmg: number) {
    const p = this.player;
    if (p.mode === "out" || dmg <= 0) return;
    p.health = Math.max(0, p.health - dmg);
    if (p.health <= 0) this.endLife("wasted");
  }

  private endLife(how: "wasted" | "busted") {
    const p = this.player;
    if (p.mode === "out") return;
    if (p.bike) {
      p.body.x = p.bike.x + Math.cos(p.bike.a + Math.PI / 2) * 12;
      p.body.y = p.bike.y + Math.sin(p.bike.a + Math.PI / 2) * 12;
      p.body.a = p.bike.a;
      p.bike.rider = null;
      p.bike.brk = 1;
      p.bike.thr = 0;
    }
    p.body.vx = p.body.vy = 0;
    p.body.state = how === "wasted" ? "down" : "walk";
    p.mode = "out";
    p.outT = 3.2;
    p.bike = null;
    if (this.job) this.failJob(how === "busted" ? "Задание провалено: задержан" : "Задание провалено");
    this.emit({ type: how });
  }

  respawn(how: "wasted" | "busted") {
    const p = this.player;
    const place = this.map.places.find((q) => q.kind === (how === "busted" ? "police" : "hospital")) ?? this.map.places[0];
    const fee = how === "busted" ? Math.min(this.money, 300 + this.wanted * 200) : Math.min(this.money, 200);
    this.money -= fee;
    this.wanted = 0;
    this.heat = 0;
    for (const v of this.vehicles) v.chase = false;
    p.health = 100;
    p.mode = "foot";
    p.body.state = "walk";
    p.body.x = place.x;
    p.body.y = place.y;
    p.body.vx = p.body.vy = 0;
    p.body.a = place.a;
    p.bust = 0;
    // The rider's own bike is waiting at the kerb.
    this.spawnPlayerBike(this.bikeId, place.x + Math.cos(place.a + Math.PI / 2) * 16, place.y + Math.sin(place.a + Math.PI / 2) * 16, place.a, false);
    this.say(how === "busted" ? `Отпустили под залог: −$${fee}` : `Больница: −$${fee}`, "bad");
    this.populate(true);
  }

  crime(points: number, x: number, y: number) {
    let witnessed = false;
    for (const v of this.vehicles) if (v.police && v.alive && Math.hypot(v.x - x, v.y - y) < 420) witnessed = true;
    this.heat += points * (witnessed ? 2 : 1);
    const need = this.wanted === 0 ? 1 : 1.5 + this.wanted;
    if (this.heat >= need && this.wanted < 5) {
      this.heat = 0;
      this.setWanted(this.wanted + 1);
    }
    this.unseen = 0;
  }

  setWanted(level: number) {
    const before = this.wanted;
    this.wanted = clamp(level, 0, 5);
    if (this.wanted > 0) for (const v of this.vehicles) if (v.police && v.alive && v.rider === "npc") v.chase = true;
    if (this.wanted === 0)
      for (const v of this.vehicles)
        if (v.chase) {
          v.chase = false;
          this.relane(v);
        }
    if (this.wanted !== before) this.emit({ type: "wanted", level: this.wanted });
  }

  // ---------- main step ----------

  step(dt: number, inp: Input) {
    this.time += dt;
    this.tick++;
    const p = this.player;
    this.controlPlayer(dt, inp);

    for (const v of this.vehicles) {
      if (v.rider === "npc" && v.alive && !v.down && (v.chase || v.ai)) {
        if (v.chase) this.drivePolice(v, dt);
        else this.driveTraffic(v, dt);
      } else if (v.rider !== "player") {
        v.thr = 0;
        v.steer = 0;
        v.brk = v.down ? 0 : 1;
        v.hb = false;
      }
      this.integrate(v, dt);
    }
    this.collideVehicles();
    for (const ped of this.peds) this.stepPed(ped, dt);
    this.peds = this.peds.filter((q) => q.state !== "swim" || q.t > 0);
    if (p.mode !== "ride" && p.mode !== "out") this.stepBody(dt);
    this.collidePeds();
    if (p.mode === "out") {
      p.outT -= dt;
    }
    this.stepPolice(dt);
    this.stepPickups(dt);
    this.stepJob(dt);
    this.stepPlaces();
    this.stepFx(dt);
    if (this.tick % 15 === 0) this.populate(false);
  }

  private controlPlayer(dt: number, inp: Input) {
    const p = this.player;
    if (p.mode === "ride" && p.bike) {
      const v = p.bike;
      v.thr = inp.gas ? 1 : 0;
      v.brk = inp.brake ? 1 : 0;
      v.steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      v.hb = inp.hb;
      if (inp.action) this.dismount();
    } else if (p.mode === "foot") {
      const b = p.body;
      const turn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      b.a += turn * 3.8 * dt;
      const sp = inp.gas ? 72 : inp.brake ? -32 : 0;
      b.vx = Math.cos(b.a) * sp;
      b.vy = Math.sin(b.a) * sp;
      if (sp !== 0) b.phase += dt * Math.abs(sp) * 0.25;
      if (inp.action) {
        let best: Vehicle | null = null;
        let bd = 34;
        let car: Vehicle | null = null;
        for (const v of this.vehicles) {
          const d = Math.hypot(v.x - b.x, v.y - b.y);
          if (!v.alive || v.burn > 0) continue;
          if (v.bike && d < bd) {
            bd = d;
            best = v;
          } else if (!v.bike && d < v.model.len / 2 + 14) car = v;
        }
        if (best && best.speed < 160) this.mount(best);
        else if (car) this.say("Байкеры не угоняют машины — ищи мотоцикл", "info");
      }
      if (inp.kick) {
        this.emit({ type: "kick" });
        const fx = Math.cos(b.a);
        const fy = Math.sin(b.a);
        for (const q of this.peds) {
          if (q.state === "fly" || q.state === "down") continue;
          const dx = q.x - b.x;
          const dy = q.y - b.y;
          const along = dx * fx + dy * fy;
          if (along > 0 && along < 18 && Math.abs(dx * -fy + dy * fx) < 10) {
            this.knock(q, fx * 90, fy * 90);
            this.crime(1, q.x, q.y);
          }
        }
      }
    }
  }

  // Top-down tyre model: drive along the heading, slip sideways only as far as grip lets.
  private integrate(v: Vehicle, dt: number) {
    const M = v.model;
    if (v.sink > 0) {
      v.sink += dt;
      v.vx *= Math.exp(-3 * dt);
      v.vy *= Math.exp(-3 * dt);
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      return;
    }
    v.hit = Math.max(0, v.hit - dt);
    const tile = this.map.tileAt(v.x, v.y);
    if (tile === WATER) {
      v.sink = 0.01;
      this.emit({ type: "splash", x: v.x, y: v.y });
      this.burst(v.x, v.y, 18, "splash");
      if (v.rider === "player") {
        this.say("Байк утонул!", "bad");
        this.endLife("wasted");
      }
      if (v.rider === "npc") v.rider = null;
      return;
    }
    const rough = tile === GRASS || tile === SAND;
    let fx = Math.cos(v.a);
    let fy = Math.sin(v.a);
    let vf = v.vx * fx + v.vy * fy;
    const dead = v.down || v.wreck || v.burn > 0 && v.rider !== "player";
    // Steering: yaw rate grows with speed up to full lock, then tightens less at top speed.
    const sf = clamp(Math.abs(vf) / 70, 0, 1) * (1 - 0.4 * clamp(Math.abs(vf) / M.vmax, 0, 1));
    const yaw = dead ? 0 : v.steer * M.turn * sf * Math.sign(vf || 1) * (v.hb ? 1.35 : 1);
    v.a += (yaw + v.spin) * dt;
    v.spin *= Math.exp(-(dead ? 1.5 : 4) * dt);
    fx = Math.cos(v.a);
    fy = Math.sin(v.a);
    const rx = -fy;
    const ry = fx;
    vf = v.vx * fx + v.vy * fy;
    let vr = v.vx * rx + v.vy * ry;
    if (dead) {
      const k = Math.exp(-(v.down ? 2.4 : 1.6) * dt);
      vf *= k;
      vr *= k;
    } else {
      const vmax = M.vmax * (rough ? M.offroad : 1) * (v.hp <= M.hp * 0.25 ? 0.75 : 1);
      if (v.thr > 0) {
        if (vf < -5) vf += M.brake * dt;
        else vf += M.accel * v.thr * Math.max(0, 1 - (vf / vmax) ** 2) * dt;
      }
      if (v.brk > 0) {
        if (vf > 5) vf -= M.brake * v.brk * dt;
        else if (v.thr === 0 && (v.rider === "player" || v.reverseT > 0)) vf = Math.max(vf - 220 * dt, -60);
        else vf *= Math.exp(-8 * dt);
      }
      if (vf > vmax) vf -= (vf - vmax) * 2 * dt;
      vf -= vf * (v.thr > 0 ? 0.05 : 0.45) * dt;
      if (v.hb) vf *= Math.exp(-0.7 * dt);
      const grip = (v.hb ? 2.2 : M.grip) * (rough ? 0.7 : 1);
      vr *= Math.exp(-grip * dt);
    }
    v.vx = fx * vf + rx * vr;
    v.vy = fy * vf + ry * vr;
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.fwd = vf;
    v.slip = vr;
    const lean = clamp(yaw * vf * 0.004 + vr * 0.004, -1, 1);
    v.lean += (lean - v.lean) * Math.min(1, dt * 8);

    // Skid marks and dust.
    const skidding = Math.abs(vr) > 55 || (v.brk > 0 && vf > 160 && v.bike) || (v.thr > 0 && vf < 60 && vf > 5 && v.bike && v.brk > 0);
    if (skidding && this.tick % 2 === 0 && !rough) {
      const back = -v.model.len / 2 + 3;
      const bx = v.x + fx * back;
      const by = v.y + fy * back;
      const pdx = v.vx * dt * 2;
      const pdy = v.vy * dt * 2;
      if (v.bike) this.skids.push({ x1: bx - pdx, y1: by - pdy, x2: bx, y2: by, life: 1 });
      else {
        const w = v.model.wid / 2 - 3;
        this.skids.push({ x1: bx + rx * w - pdx, y1: by + ry * w - pdy, x2: bx + rx * w, y2: by + ry * w, life: 1 });
        this.skids.push({ x1: bx - rx * w - pdx, y1: by - ry * w - pdy, x2: bx - rx * w, y2: by - ry * w, life: 1 });
      }
      if (this.r() < 0.3) this.puff(bx, by, "smoke", 0.6);
    }
    if (rough && Math.abs(vf) > 80 && this.r() < 0.25) this.puff(v.x - fx * 8, v.y - fy * 8, "dust", 0.8);

    // Fire.
    if (v.burn > 0) {
      v.burn -= dt;
      if (this.tick % 2 === 0) this.puff(v.x + (this.r() - 0.5) * 10, v.y + (this.r() - 0.5) * 10, this.r() < 0.6 ? "fire" : "smoke", 1);
      if (v.burn <= 0) this.explode(v);
    } else if (v.alive && v.hp < M.hp * 0.35 && this.tick % 6 === 0) this.puff(v.x + fx * M.len * 0.35, v.y + fy * M.len * 0.35, "smoke", 0.7);

    this.collideWorld(v);
  }

  // Push a circle out of buildings, railings and tree trunks.
  private resolveCircle(cx: number, cy: number, r: number) {
    const map = this.map;
    let dx = 0;
    let dy = 0;
    const push = (px: number, py: number, rx0: number, ry0: number, rx1: number, ry1: number) => {
      const qx = clamp(px, rx0, rx1);
      const qy = clamp(py, ry0, ry1);
      let nx = px - qx;
      let ny = py - qy;
      let d = Math.hypot(nx, ny);
      if (d >= r) return;
      if (d === 0) {
        // Centre inside: out along the shallowest side.
        const l = px - rx0;
        const rr = rx1 - px;
        const t = py - ry0;
        const b = ry1 - py;
        const mn = Math.min(l, rr, t, b);
        if (mn === l) (nx = -1), (ny = 0), (d = -l);
        else if (mn === rr) (nx = 1), (ny = 0), (d = -rr);
        else if (mn === t) (nx = 0), (ny = -1), (d = -t);
        else (nx = 0), (ny = 1), (d = -b);
        dx += nx * (r - d);
        dy += ny * (r - d);
        return;
      }
      dx += (nx / d) * (r - d);
      dy += (ny / d) * (r - d);
    };
    const tx0 = Math.floor((cx - r) / T);
    const tx1 = Math.floor((cx + r) / T);
    const ty0 = Math.floor((cy - r) / T);
    const ty1 = Math.floor((cy + r) / T);
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        if (map.at(tx, ty) === BUILD) push(cx + dx, cy + dy, tx * T, ty * T, (tx + 1) * T, (ty + 1) * T);
        const trees = map.treeCells.get(ty * map.n + tx);
        if (trees)
          for (const t of trees) {
            const ex = cx + dx - t.x;
            const ey = cy + dy - t.y;
            const d = Math.hypot(ex, ey);
            const rr = r + 3.5;
            if (d < rr && d > 0) {
              dx += (ex / d) * (rr - d);
              dy += (ey / d) * (rr - d);
            }
          }
      }
    for (const w of map.walls)
      if (cx + r > w.x0 && cx - r < w.x1 && cy + r > w.y0 && cy - r < w.y1) push(cx + dx, cy + dy, w.x0, w.y0, w.x1, w.y1);
    return { dx, dy };
  }

  private collideWorld(v: Vehicle) {
    const fx = Math.cos(v.a);
    const fy = Math.sin(v.a);
    for (const [o, r] of v.circles) {
      const cx = v.x + fx * o;
      const cy = v.y + fy * o;
      const { dx, dy } = this.resolveCircle(cx, cy, r);
      if (dx === 0 && dy === 0) continue;
      v.x += dx;
      v.y += dy;
      const d = Math.hypot(dx, dy);
      const nx = dx / d;
      const ny = dy / d;
      const rx = fx * o;
      const ry = fy * o;
      const cvx = v.vx - v.spin * ry;
      const cvy = v.vy + v.spin * rx;
      const vn = cvx * nx + cvy * ny;
      if (vn >= 0) continue;
      const rn = rx * ny - ry * nx;
      const im = 1 / v.model.mass;
      const j = (-(1 + 0.25) * vn) / (im + (rn * rn) / v.inertia);
      v.vx += j * nx * im;
      v.vy += j * ny * im;
      v.spin = clamp(v.spin + (rn * j) / v.inertia, -7, 7);
      // Scrape: some speed lost along the wall too.
      const tx = -ny;
      const ty = nx;
      const vt = cvx * tx + cvy * ty;
      const jt = clamp(-vt * 0.25, -Math.abs(j) * 0.3, Math.abs(j) * 0.3) * v.model.mass;
      v.vx += jt * tx * im;
      v.vy += jt * ty * im;
      this.impact(v, -vn, cx + nx * -r, cy + ny * -r, null);
    }
  }

  private impact(v: Vehicle, power: number, x: number, y: number, other: Vehicle | null) {
    if (power < 40) return;
    if (power > 70) {
      v.hit = 0.25;
      this.burst(x, y, Math.min(14, Math.floor(power / 25)), "spark");
    }
    const dmg = Math.max(0, power - 60) * (v.bike ? 0.18 : 0.22) * (other ? Math.sqrt(other.model.mass / v.model.mass) : 1);
    if (v.alive && v.burn <= 0) {
      v.hp -= dmg;
      if (v.hp <= 0) {
        v.hp = 0;
        v.burn = v.bike ? 2.5 : 4 + this.r() * 2;
        if (!v.bike && v.rider === "npc") this.bail(v);
        if (v.rider === "player") this.say("Байк горит — прыгай!", "bad");
      }
    }
    if (v === this.player.bike || (other && other === this.player.bike)) this.emit({ type: "crash", power, x, y });
    if (v.bike && v.rider && power > CRASH) this.throwRider(v, power);
    if (v.rider === "player" && other?.police && other.alive) this.crime(power > 120 ? 1.2 : 0.4, x, y);
  }

  // Driver jumps out and runs.
  private bail(v: Vehicle) {
    const rx = -Math.sin(v.a);
    const ry = Math.cos(v.a);
    const ped = new Ped(v.x + rx * (v.model.wid / 2 + 6), v.y + ry * (v.model.wid / 2 + 6), v.a);
    ped.state = "flee";
    ped.t = 3;
    ped.a = Math.atan2(ry, rx);
    this.peds.push(ped);
    v.rider = null;
    v.ai = null;
    v.chase = false;
  }

  private explode(v: Vehicle) {
    v.wreck = true;
    v.burn = 0;
    v.hp = 0;
    this.emit({ type: "explode", x: v.x, y: v.y });
    this.burst(v.x, v.y, 30, "fire");
    this.burst(v.x, v.y, 20, "smoke");
    this.burst(v.x, v.y, 20, "spark");
    if (v.rider) this.throwRider(v, 200);
    const R = 95;
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x;
      const dy = o.y - v.y;
      const d = Math.hypot(dx, dy);
      if (d > R || d === 0) continue;
      const k = 1 - d / R;
      o.vx += (dx / d) * 260 * k;
      o.vy += (dy / d) * 260 * k;
      o.spin += (this.r() - 0.5) * 8 * k;
      this.impact(o, 100 + 150 * k, o.x, o.y, null);
    }
    for (const q of this.peds) {
      const dx = q.x - v.x;
      const dy = q.y - v.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R) this.knock(q, (dx / d) * 220, (dy / d) * 220);
    }
    const b = this.player.body;
    if (this.player.mode !== "ride") {
      const dx = b.x - v.x;
      const dy = b.y - v.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R) {
        this.hurt(70 * (1 - d / R));
        b.vx += (dx / d) * 200;
        b.vy += (dy / d) * 200;
        if (this.player.mode === "foot") {
          b.state = "fly";
          this.player.mode = "fly";
          b.spin = 8;
        }
      }
    }
  }

  private collideVehicles() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const A = vs[i];
      if (A.sink) continue;
      for (let j = i + 1; j < vs.length; j++) {
        const B = vs[j];
        if (B.sink) continue;
        const reach = (A.model.len + B.model.len) / 2 + 2;
        if (Math.abs(A.x - B.x) > reach || Math.abs(A.y - B.y) > reach) continue;
        const afx = Math.cos(A.a);
        const afy = Math.sin(A.a);
        const bfx = Math.cos(B.a);
        const bfy = Math.sin(B.a);
        for (const [oa, ra] of A.circles)
          for (const [ob, rb] of B.circles) {
            const ax = A.x + afx * oa;
            const ay = A.y + afy * oa;
            const bx = B.x + bfx * ob;
            const by = B.y + bfy * ob;
            let nx = ax - bx;
            let ny = ay - by;
            const d = Math.hypot(nx, ny);
            const pen = ra + rb - d;
            if (pen <= 0 || d === 0) continue;
            nx /= d;
            ny /= d;
            const ia = 1 / A.model.mass;
            const ib = 1 / B.model.mass;
            A.x += nx * pen * (ia / (ia + ib));
            A.y += ny * pen * (ia / (ia + ib));
            B.x -= nx * pen * (ib / (ia + ib));
            B.y -= ny * pen * (ib / (ia + ib));
            const rax = afx * oa;
            const ray = afy * oa;
            const rbx = bfx * ob;
            const rby = bfy * ob;
            const vax = A.vx - A.spin * ray;
            const vay = A.vy + A.spin * rax;
            const vbx = B.vx - B.spin * rby;
            const vby = B.vy + B.spin * rbx;
            const vn = (vax - vbx) * nx + (vay - vby) * ny;
            if (vn >= 0) continue;
            const rna = rax * ny - ray * nx;
            const rnb = rbx * ny - rby * nx;
            const jn = (-(1 + 0.3) * vn) / (ia + ib + (rna * rna) / A.inertia + (rnb * rnb) / B.inertia);
            A.vx += jn * nx * ia;
            A.vy += jn * ny * ia;
            B.vx -= jn * nx * ib;
            B.vy -= jn * ny * ib;
            A.spin = clamp(A.spin + (rna * jn) / A.inertia, -7, 7);
            B.spin = clamp(B.spin - (rnb * jn) / B.inertia, -7, 7);
            const cx = (ax + bx) / 2;
            const cy = (ay + by) / 2;
            this.impact(A, -vn, cx, cy, B);
            this.impact(B, -vn, cx, cy, A);
          }
      }
    }
  }

  // ---------- pedestrians ----------

  private knock(q: Ped, vx: number, vy: number) {
    q.state = "fly";
    q.vx = vx;
    q.vy = vy;
    q.spin = (this.r() - 0.5) * 16;
    q.t = 6 + this.r() * 5;
    this.emit({ type: "ped", x: q.x, y: q.y });
  }

  private walkable(x: number, y: number) {
    return this.map.at(x, y) === WALK;
  }

  private stepPed(q: Ped, dt: number) {
    const map = this.map;
    if (q.state === "swim") {
      q.t -= dt;
      return;
    }
    if (q.state === "fly") {
      const sp = Math.hypot(q.vx, q.vy);
      const k = Math.max(0, sp - 360 * dt) / (sp || 1);
      q.vx *= k;
      q.vy *= k;
      q.a += q.spin * dt;
      q.spin *= Math.exp(-3 * dt);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      this.bodyWorld(q);
      if (sp < 12) q.state = "down";
      return;
    }
    if (q.state === "down") {
      q.t -= dt;
      if (q.t <= 0) {
        q.state = "flee";
        q.t = 3;
        q.a += Math.PI;
      }
      return;
    }
    // Run from vehicles bearing down.
    if (q.state === "walk" && this.tick % 6 === q.phase % 6 >> 0) {
      for (const v of this.vehicles) {
        if (v.speed < 110) continue;
        const dx = q.x - v.x;
        const dy = q.y - v.y;
        const d = Math.hypot(dx, dy);
        if (d > 90) continue;
        if ((dx * v.vx + dy * v.vy) / (d * v.speed) > 0.75) {
          q.state = "flee";
          q.t = 1.2;
          const side = dx * -v.vy + dy * v.vx > 0 ? 1 : -1;
          q.a = Math.atan2(v.vx * side, -v.vy * side);
          break;
        }
      }
    }
    if (q.state === "flee") {
      q.t -= dt;
      q.phase += dt * 20;
      q.x += Math.cos(q.a) * 85 * dt;
      q.y += Math.sin(q.a) * 85 * dt;
      this.bodyWorld(q);
      if (map.tileAt(q.x, q.y) === WATER) {
        q.state = "swim";
        q.t = 1;
        this.burst(q.x, q.y, 6, "splash");
      }
      if (q.t <= 0) {
        q.state = "walk";
        const tx = Math.floor(q.x / T);
        const ty = Math.floor(q.y / T);
        q.tx = (tx + 0.5) * T;
        q.ty = (ty + 0.5) * T;
        if (!this.walkable(tx, ty)) {
          const w = map.nearestWalk(q.x, q.y);
          q.tx = w.x;
          q.ty = w.y;
        }
      }
      return;
    }
    // Walk tile to tile along the pavement; cross at corners now and then.
    const dx = q.tx - q.x;
    const dy = q.ty - q.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      const tx = Math.floor(q.x / T);
      const ty = Math.floor(q.y / T);
      if (q.crossing > 0) q.crossing--;
      let dir = q.dir;
      const ok = (k: number) => this.walkable(tx + DX[k], ty + DY[k]) || (q.crossing > 0 && map.at(tx + DX[k], ty + DY[k]) === ROAD);
      if (!ok(dir)) {
        const ahead = map.at(tx + DX[dir], ty + DY[dir]);
        if (ahead === ROAD && this.walkable(tx + DX[dir] * 3, ty + DY[dir] * 3) && map.at(tx + DX[dir] * 2, ty + DY[dir] * 2) === ROAD && this.r() < 0.35) q.crossing = 3;
        else {
          const opts = [(dir + 1) % 4, (dir + 3) % 4].filter(ok);
          dir = (opts.length ? opts[Math.floor(this.r() * opts.length)] : (dir + 2) % 4) as Dir;
        }
      } else if (this.r() < 0.08) {
        const side = ((dir + (this.r() < 0.5 ? 1 : 3)) % 4) as Dir;
        if (ok(side)) dir = side;
      }
      q.dir = dir as Dir;
      const nx = tx + DX[q.dir];
      const ny = ty + DY[q.dir];
      if (!this.walkable(nx, ny) && !(q.crossing > 0 && map.at(nx, ny) === ROAD)) {
        q.tx = q.x;
        q.ty = q.y;
        return;
      }
      const lat = q.crossing > 0 ? 0 : q.off;
      q.tx = (nx + 0.5) * T + -DY[q.dir] * lat;
      q.ty = (ny + 0.5) * T + DX[q.dir] * lat;
      return;
    }
    const sp = Math.min(q.speed, d / dt) * (q.crossing > 0 ? 1.5 : 1);
    q.x += (dx / d) * sp * dt;
    q.y += (dy / d) * sp * dt;
    const want = Math.atan2(dy, dx);
    q.a += wrap(want - q.a) * Math.min(1, dt * 10);
    q.phase += dt * sp * 0.25;
  }

  private bodyWorld(q: Ped) {
    const { dx, dy } = this.resolveCircle(q.x, q.y, 4.5);
    if (dx === 0 && dy === 0) return;
    q.x += dx;
    q.y += dy;
    const d = Math.hypot(dx, dy);
    const vn = (q.vx * dx + q.vy * dy) / d;
    if (vn < 0) {
      q.vx -= (1.4 * vn * dx) / d;
      q.vy -= (1.4 * vn * dy) / d;
      if (q === this.player.body && vn < -120) this.hurt((-vn - 120) * 0.12);
    }
  }

  private stepBody(dt: number) {
    const p = this.player;
    const b = p.body;
    if (p.mode === "fly") {
      const sp = Math.hypot(b.vx, b.vy);
      const k = Math.max(0, sp - 380 * dt) / (sp || 1);
      b.vx *= k;
      b.vy *= k;
      b.a += b.spin * dt;
      b.spin *= Math.exp(-3 * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.bodyWorld(b);
      if (sp < 10) {
        p.getup += dt;
        b.state = "down";
        if (p.getup > 0.7) {
          p.mode = "foot";
          b.state = "walk";
          b.vx = b.vy = 0;
        }
      }
    } else {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.vx = b.vy = 0;
      this.bodyWorld(b);
    }
    if (this.map.tileAt(b.x, b.y) === WATER) {
      this.burst(b.x, b.y, 12, "splash");
      this.emit({ type: "splash", x: b.x, y: b.y });
      this.say("Не умеешь плавать в экипировке!", "bad");
      this.endLife("wasted");
    }
  }

  private collidePeds() {
    const p = this.player;
    const bodies = this.peds.filter((q) => q.state !== "swim");
    const playerOnFoot = p.mode === "foot" || p.mode === "fly";
    if (playerOnFoot) bodies.push(p.body);
    for (const v of this.vehicles) {
      if (v.sink) continue;
      const fx = Math.cos(v.a);
      const fy = Math.sin(v.a);
      for (const q of bodies) {
        if (Math.abs(q.x - v.x) > v.model.len || Math.abs(q.y - v.y) > v.model.len) continue;
        for (const [o, r] of v.circles) {
          const cx = v.x + fx * o;
          const cy = v.y + fy * o;
          let nx = q.x - cx;
          let ny = q.y - cy;
          const d = Math.hypot(nx, ny);
          const pen = r + 4.5 - d;
          if (pen <= 0 || d === 0) continue;
          nx /= d;
          ny /= d;
          const vn = (v.vx - q.vx) * nx + (v.vy - q.vy) * ny;
          const isPlayer = q === p.body;
          if (vn > 55 && q.state !== "fly") {
            if (isPlayer) {
              this.hurt(vn * 0.12);
              q.state = "fly";
              p.mode = "fly";
              p.getup = 0;
              q.vx = v.vx * 0.8 + nx * 50;
              q.vy = v.vy * 0.8 + ny * 50;
              q.spin = 9;
            } else {
              this.knock(q, v.vx * 0.8 + nx * 50, v.vy * 0.8 + ny * 50);
              if (v.rider === "player") this.crime(1, q.x, q.y);
            }
            const slow = v.bike ? 0.8 : 0.95;
            v.vx *= slow;
            v.vy *= slow;
            if (v.bike && v.rider && vn > 230) this.throwRider(v, vn * 0.7);
          } else {
            q.x += nx * pen;
            q.y += ny * pen;
            if (vn > 0) {
              q.vx += nx * vn * 0.5;
              q.vy += ny * vn * 0.5;
            }
          }
          break;
        }
      }
    }
  }

  // ---------- traffic ----------

  private plan(v: Vehicle) {
    const ai = v.ai!;
    const map = this.map;
    const V = map.vroads;
    const H = map.hroads;
    const horiz = ai.dir === 0 || ai.dir === 2;
    let hi = horiz ? ai.road : -1;
    let vi = horiz ? -1 : ai.road;
    if (horiz) {
      for (let i = 0; i < V.length; i++) {
        if (ai.dir === 0 && V[i] * T > v.x - 2 && (vi < 0 || V[i] < V[vi])) vi = i;
        if (ai.dir === 2 && (V[i] + 2) * T < v.x + 2 && (vi < 0 || V[i] > V[vi])) vi = i;
      }
    } else {
      for (let i = 0; i < H.length; i++) {
        if (ai.dir === 1 && H[i] * T > v.y - 2 && (hi < 0 || H[i] < H[hi])) hi = i;
        if (ai.dir === 3 && (H[i] + 2) * T < v.y + 2 && (hi < 0 || H[i] > H[hi])) hi = i;
      }
    }
    if (vi < 0 || hi < 0) {
      // End of the road (should not happen on the ring): park.
      v.ai = null;
      return;
    }
    const opts: Dir[] = [];
    const can = (d: Dir) => (d === 0 ? vi < V.length - 1 : d === 2 ? vi > 0 : d === 1 ? hi < H.length - 1 : hi > 0);
    for (const d of [0, 1, 2, 3] as Dir[]) {
      if (d === (ai.dir + 2) % 4 || !can(d)) continue;
      opts.push(d);
      if (d === ai.dir) opts.push(d, d); // straight on more often
    }
    const nd = opts[Math.floor(this.r() * opts.length)];
    const vx = V[vi];
    const hy = H[hi];
    const entry = [
      { x: vx * T, y: (hy + 1.5) * T },
      { x: (vx + 0.5) * T, y: hy * T },
      { x: (vx + 2) * T, y: (hy + 0.5) * T },
      { x: (vx + 1.5) * T, y: (hy + 2) * T },
    ][ai.dir];
    const exit = [
      { x: (vx + 2) * T, y: (hy + 1.5) * T },
      { x: (vx + 0.5) * T, y: (hy + 2) * T },
      { x: vx * T, y: (hy + 0.5) * T },
      { x: (vx + 1.5) * T, y: hy * T },
    ][nd];
    const straight = nd === ai.dir;
    const c = straight ? { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 } : horiz ? { x: exit.x, y: entry.y } : { x: entry.x, y: exit.y };
    const bz = (t: number) => ({
      x: (1 - t) * (1 - t) * entry.x + 2 * (1 - t) * t * c.x + t * t * exit.x,
      y: (1 - t) * (1 - t) * entry.y + 2 * (1 - t) * t * c.y + t * t * exit.y,
      turn: !straight,
    });
    // Approach on the lane (straightens a car knocked aside), then through the crossing.
    const back = 2.2 * T;
    ai.path.push({ x: entry.x - DX[ai.dir] * back, y: entry.y - DY[ai.dir] * back, turn: false });
    ai.path.push({ ...entry, turn: !straight });
    ai.path.push(bz(0.35), bz(0.7), { ...exit, turn: false });
    ai.path.push({ x: exit.x + DX[nd] * T * 0.8, y: exit.y + DY[nd] * T * 0.8, turn: false });
    // Drop approach points already behind the vehicle.
    while (ai.path.length > 1) {
      const p0 = ai.path[0];
      if ((p0.x - v.x) * DX[ai.dir] + (p0.y - v.y) * DY[ai.dir] < 6) ai.path.shift();
      else break;
    }
    ai.dir = nd;
    ai.road = nd === 0 || nd === 2 ? hi : vi;
  }

  // Back to ordinary driving from wherever the vehicle is: the nearest lane, the way it faces.
  relane(v: Vehicle) {
    const map = this.map;
    let best = Infinity;
    let pick: { dir: Dir; road: number } | null = null;
    const fx = Math.cos(v.a);
    const fy = Math.sin(v.a);
    for (let i = 0; i < map.hroads.length; i++) {
      const dir: Dir = fx >= 0 ? 0 : 2;
      const d = Math.abs(map.laneY(i, dir) - v.y);
      if (d < best) (best = d), (pick = { dir, road: i });
    }
    for (let i = 0; i < map.vroads.length; i++) {
      const dir: Dir = fy >= 0 ? 1 : 3;
      const d = Math.abs(map.laneX(i, dir) - v.x);
      if (d < best) (best = d), (pick = { dir, road: i });
    }
    if (!pick || best > 4 * T) {
      v.ai = null;
      return;
    }
    const { dir, road } = pick;
    v.ai = { dir, road, path: [], cruise: 90, wait: 0, impatient: 0, off: 0 };
  }

  private obstacleAhead(v: Vehicle, look: number) {
    const fx = Math.cos(v.a);
    const fy = Math.sin(v.a);
    const half = v.model.wid / 2 + 5;
    let best = Infinity;
    let blocker: "player" | "other" | null = null;
    const test = (x: number, y: number, r: number, who: "player" | "other") => {
      const dx = x - v.x;
      const dy = y - v.y;
      const along = dx * fx + dy * fy - v.model.len / 2;
      if (along < -4 || along > look) return;
      const lat = Math.abs(-dx * fy + dy * fx);
      if (lat > half + r) return;
      if (along < best) {
        best = along;
        blocker = who;
      }
    };
    for (const o of this.vehicles) {
      if (o === v || Math.abs(o.x - v.x) > look + 40 || Math.abs(o.y - v.y) > look + 40) continue;
      // Ignore vehicles driving towards us in the other lane.
      const fa = Math.cos(o.a) * fx + Math.sin(o.a) * fy;
      if (fa < -0.7 && o.speed > 20) {
        const lat = Math.abs(-(o.x - v.x) * fy + (o.y - v.y) * fx);
        if (lat > 14) continue;
      }
      test(o.x, o.y, o.model.wid / 2, o === this.player.bike ? "player" : "other");
    }
    for (const q of this.peds) if (q.state !== "swim") test(q.x, q.y, 4, "other");
    const p = this.player;
    if (p.mode === "foot" || p.mode === "fly") test(p.body.x, p.body.y, 5, "player");
    return { dist: best, blocker };
  }

  private driveTraffic(v: Vehicle, dt: number) {
    const ai = v.ai!;
    if (ai.path.length === 0) this.plan(v);
    if (!v.ai) return;
    let t = ai.path[0];
    while (t && Math.hypot(t.x - v.x, t.y - v.y) < 14) {
      ai.path.shift();
      if (ai.path.length === 0) this.plan(v);
      if (!v.ai) return;
      t = ai.path[0];
    }
    const want = Math.atan2(t.y - v.y, t.x - v.x);
    const diff = wrap(want - v.a);
    const sp = v.fwd;
    v.steer = clamp(diff * 2.4, -1, 1);
    const turning = ai.path.slice(0, 3).some((q) => q.turn);
    let target = turning ? 42 : ai.cruise;
    if (Math.abs(diff) > 0.6) target = Math.min(target, 30);
    const look = 26 + Math.max(0, sp) * 0.7;
    ai.impatient = Math.max(0, ai.impatient - dt);
    if (ai.impatient <= 0) {
      const ob = this.obstacleAhead(v, look);
      if (ob.dist < Infinity) {
        target = Math.min(target, Math.max(0, (ob.dist - 8) * 1.6));
        if (sp < 8) {
          ai.wait += dt;
          if (ob.blocker === "player" && ai.wait > 1.5 && this.tick % 90 === v.id % 90) this.emit({ type: "horn", x: v.x, y: v.y });
          if (ai.wait > 5) {
            ai.impatient = 1.2;
            ai.wait = 0;
          }
        }
      } else ai.wait = 0;
    }
    if (sp < target - 5) {
      v.thr = 1;
      v.brk = 0;
    } else if (sp > target + 12) {
      v.thr = 0;
      v.brk = Math.min(1, (sp - target) / 60);
    } else {
      v.thr = 0.3;
      v.brk = 0;
    }
    if (target === 0) {
      v.thr = 0;
      v.brk = 1;
    }
    // Knocked off the road for good: the driver gives up and walks away.
    const tile = this.map.tileAt(v.x, v.y);
    ai.off = tile === ROAD || tile === BRIDGE ? 0 : ai.off + dt;
    if (ai.off > 5) this.bail(v);
  }

  private drivePolice(v: Vehicle, dt: number) {
    const map = this.map;
    const p = this.player;
    const px = this.px;
    const py = this.py;
    const pv = p.mode === "ride" && p.bike ? p.bike : p.body;
    const d = Math.hypot(px - v.x, py - v.y);
    let tx = px + pv.vx * 0.35;
    let ty = py + pv.vy * 0.35;
    if (!(d < 300 && map.sees(v.x, v.y, px, py))) {
      // Follow the breadth-first distances towards the player, two tiles ahead.
      let cx = Math.floor(v.x / T);
      let cy = Math.floor(v.y / T);
      const n = map.n;
      if (this.flow[cy * n + cx] > 0) {
        for (let s = 0; s < 3; s++) {
          let bx = cx;
          let by = cy;
          let bd = this.flow[cy * n + cx];
          for (let k = 0; k < 4; k++) {
            const nx = cx + DX[k];
            const ny = cy + DY[k];
            const f = nx >= 0 && ny >= 0 && nx < n && ny < n ? this.flow[ny * n + nx] : -1;
            if (f >= 0 && f < bd) {
              bd = f;
              bx = nx;
              by = ny;
            }
          }
          cx = bx;
          cy = by;
        }
        tx = (cx + 0.5) * T;
        ty = (cy + 0.5) * T;
      }
    }
    const want = Math.atan2(ty - v.y, tx - v.x);
    const diff = wrap(want - v.a);
    if (v.reverseT > 0) {
      v.reverseT -= dt;
      v.thr = 0;
      v.brk = 1;
      v.steer = -Math.sign(diff);
      return;
    }
    v.steer = clamp(diff * 2.5, -1, 1);
    v.hb = Math.abs(diff) > 1.2 && v.fwd > 120;
    const close = d < 60 && (p.mode !== "ride" || (p.bike?.speed ?? 0) < 40);
    v.thr = close ? 0 : Math.abs(diff) < 1.3 ? 1 : 0.5;
    v.brk = close || (v.fwd > 200 && Math.abs(diff) > 0.9) ? 1 : 0;
    if (v.fwd < 12 && v.thr > 0) {
      v.stuck += dt;
      if (v.stuck > 1.1) {
        v.stuck = 0;
        v.reverseT = 0.9;
      }
    } else v.stuck = Math.max(0, v.stuck - dt);
  }

  private stepPolice(dt: number) {
    const p = this.player;
    if (p.mode === "out") return;
    const px = this.px;
    const py = this.py;
    if (this.wanted > 0) {
      this.flowT -= dt;
      const tile = Math.floor(py / T) * this.map.n + Math.floor(px / T);
      if (this.flowT <= 0 && tile !== this.flowTile) {
        this.flowT = 0.35;
        this.flowTile = tile;
        this.map.flowFrom(Math.floor(px / T), Math.floor(py / T), this.flow);
      }
      let seen = false;
      let near = false;
      for (const v of this.vehicles) {
        if (!v.police || !v.alive || v.rider !== "npc") continue;
        v.chase = true;
        const d = Math.hypot(v.x - px, v.y - py);
        if (d < 520 && this.map.sees(v.x, v.y, px, py)) seen = true;
        if (d < 46 && v.speed < 90) near = true;
      }
      this.unseen = seen ? 0 : this.unseen + dt;
      if (this.unseen > WANTED_LOSE) {
        this.unseen = 0;
        this.setWanted(this.wanted - 1);
        if (this.wanted === 0) this.say("Полиция потеряла след", "good");
      }
      const slow = p.mode !== "ride" || (p.bike?.speed ?? 0) < 25;
      if (near && slow && p.mode !== "fly") p.bust += dt;
      else p.bust = Math.max(0, p.bust - dt * 0.5);
      if (p.bust > 1.4) this.endLife("busted");
    } else p.bust = 0;
  }

  // ---------- pick-ups, places, jobs ----------

  private stepPickups(dt: number) {
    const px = this.px;
    const py = this.py;
    for (const k of this.pickups) {
      if (k.respawn > 0) {
        k.respawn -= dt;
        continue;
      }
      if (Math.abs(k.x - px) > 18 || Math.abs(k.y - py) > 18 || this.player.mode === "out") continue;
      if (k.kind === "health" && this.player.health >= 100) continue;
      if (k.kind === "cash") {
        this.money += k.amount;
        this.emit({ type: "cash", amount: k.amount });
        this.burst(k.x, k.y, 8, "cash");
      } else {
        this.player.health = Math.min(100, this.player.health + k.amount);
        this.emit({ type: "health" });
      }
      k.respawn = 60;
    }
  }

  private stepPlaces() {
    const p = this.player;
    for (const pl of this.map.places) {
      const inside = Math.hypot(pl.x - this.px, pl.y - this.py) < (pl.kind === "garage" || pl.kind === "shop" ? 36 : 0);
      if (!inside) {
        this.placeIn.delete(pl);
        continue;
      }
      if (this.placeIn.has(pl)) continue;
      this.placeIn.add(pl);
      if (pl.kind === "shop") this.emit({ type: "shop" });
      if (pl.kind === "garage" && p.mode === "ride" && p.bike) {
        const v = p.bike;
        if (this.wanted > 0) {
          const cost = 250 * this.wanted;
          if (this.money >= cost) {
            this.money -= cost;
            this.setWanted(0);
            this.heat = 0;
            this.say(`Новые номера и перекраска: −$${cost}. Полиция потеряла след`, "good");
            v.color = v.model.colors[Math.floor(this.r() * v.model.colors.length)];
          } else this.say(`Смена номеров стоит $${cost} — не хватает денег`, "bad");
        }
        if (v.hp < v.model.hp || v.burn > 0) {
          v.hp = v.model.hp;
          v.burn = 0;
          this.say("Мотосервис: байк как новый", "good");
        }
      }
    }
  }

  private randomDoorstep(fromX: number, fromY: number, minD: number, maxD: number) {
    const map = this.map;
    for (let tries = 0; tries < 300; tries++) {
      const k = map.doorsteps[Math.floor(this.r() * map.doorsteps.length)];
      const x = ((k % map.n) + 0.5) * T;
      const y = (Math.floor(k / map.n) + 0.5) * T;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d >= minD && d <= maxD) return { x, y };
    }
    return { x: fromX, y: fromY };
  }

  private crossingPoint(fromX: number, fromY: number, minD: number, maxD: number) {
    const map = this.map;
    for (let tries = 0; tries < 200; tries++) {
      const vi = Math.floor(this.r() * map.vroads.length);
      const hi = Math.floor(this.r() * map.hroads.length);
      const x = (map.vroads[vi] + 1) * T;
      const y = (map.hroads[hi] + 1) * T;
      const d = Math.hypot(x - fromX, y - fromY);
      if (d >= minD && d <= maxD) return { x, y };
    }
    return this.randomDoorstep(fromX, fromY, minD, maxD);
  }

  startJob(spot: JobSpot) {
    let points: { x: number; y: number }[] = [];
    let time = 0;
    let reward = 0;
    let title = "";
    const round = (n: number) => Math.round(n / 10) * 10;
    if (spot.kind === "delivery") {
      const to = this.randomDoorstep(spot.x, spot.y, 900, 2600);
      const d = Math.hypot(to.x - spot.x, to.y - spot.y);
      points = [to];
      time = Math.round(d / 165 + 14);
      reward = round(120 + d * 0.28);
      title = `Доставка: ${this.map.address(to.x, to.y)}`;
    } else if (spot.kind === "hot") {
      const garages = this.map.places.filter((p) => p.kind === "garage");
      const to = garages.reduce((a, b) => (Math.hypot(b.x - spot.x, b.y - spot.y) > Math.hypot(a.x - spot.x, a.y - spot.y) ? b : a));
      const d = Math.hypot(to.x - spot.x, to.y - spot.y);
      points = [{ x: to.x, y: to.y }];
      time = Math.round(d / 150 + 20);
      reward = round(600 + d * 0.5);
      title = "Горячий груз: довези до мотосервиса";
      this.setWanted(Math.max(this.wanted, 2));
    } else {
      let x = spot.x;
      let y = spot.y;
      let total = 0;
      for (let i = 0; i < 6; i++) {
        const q = this.crossingPoint(x, y, 450, 1000);
        total += Math.hypot(q.x - x, q.y - y);
        points.push(q);
        x = q.x;
        y = q.y;
      }
      time = Math.round(total / 230 + 8);
      reward = round(500 + total * 0.22);
      title = "Уличная гонка: 6 контрольных точек";
    }
    this.job = { kind: spot.kind, spot, points, idx: 0, time, reward, title };
    this.say(`${title} · ${time} с · $${reward}`, "info");
  }

  failJob(text: string) {
    if (!this.job) return;
    this.job = null;
    this.jobCooldown = 3;
    this.say(text, "bad");
    this.emit({ type: "jobFail" });
  }

  private stepJob(dt: number) {
    const p = this.player;
    this.jobCooldown = Math.max(0, this.jobCooldown - dt);
    if (p.mode === "out") return;
    const job = this.job;
    if (!job) {
      if (this.jobCooldown > 0) return;
      for (const s of this.map.jobs)
        if (Math.hypot(s.x - this.px, s.y - this.py) < 26) {
          if (p.mode !== "ride") {
            if (this.tick % 120 === 0) this.say("Задания берут на мотоцикле", "info");
            continue;
          }
          this.startJob(s);
          break;
        }
      return;
    }
    job.time -= dt;
    const t = job.points[job.idx];
    const radius = job.kind === "race" ? 50 : 30;
    if (Math.hypot(t.x - this.px, t.y - this.py) < radius) {
      job.idx++;
      if (job.idx >= job.points.length) {
        const bonus = Math.max(0, Math.floor(job.time)) * 10;
        if (job.kind === "hot" && this.wanted > 0) {
          this.setWanted(0);
          this.heat = 0;
        }
        const total = job.reward + bonus;
        this.money += total;
        this.say(`Готово! +$${job.reward}${bonus ? ` и $${bonus} за скорость` : ""}`, "good");
        this.emit({ type: "jobDone", reward: total });
        this.job = null;
        this.jobCooldown = 4;
        return;
      }
      this.emit({ type: "checkpoint" });
    }
    if (job.time <= 0) this.failJob("Время вышло — задание провалено");
  }

  // ---------- effects ----------

  puff(x: number, y: number, kind: Particle["kind"], scale = 1) {
    if (this.particles.length > 500) return;
    const r = this.r;
    const base = {
      smoke: { c: "rgba(90,90,90,", life: 1.6, size: 4, grow: 9, sp: 10 },
      fire: { c: "rgba(255,140,30,", life: 0.6, size: 5, grow: 6, sp: 20 },
      spark: { c: "rgba(255,230,120,", life: 0.35, size: 1.4, grow: 0, sp: 160 },
      splash: { c: "rgba(220,240,255,", life: 0.8, size: 2.5, grow: 4, sp: 70 },
      dust: { c: "rgba(150,125,90,", life: 1, size: 4, grow: 8, sp: 12 },
      cash: { c: "rgba(120,220,90,", life: 0.9, size: 3, grow: 0, sp: 80 },
    }[kind];
    const a = r() * Math.PI * 2;
    const s = base.sp * (0.3 + r()) * scale;
    this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: base.life * (0.6 + r() * 0.6), max: base.life, size: base.size * scale, grow: base.grow, color: base.c, kind });
  }

  burst(x: number, y: number, n: number, kind: Particle["kind"]) {
    for (let i = 0; i < n; i++) this.puff(x, y, kind, kind === "fire" || kind === "smoke" ? 1.6 : 1);
  }

  private stepFx(dt: number) {
    for (const q of this.particles) {
      q.life -= dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const k = Math.exp(-(q.kind === "spark" ? 3 : 2) * dt);
      q.vx *= k;
      q.vy *= k;
      q.size += q.grow * dt;
    }
    this.particles = this.particles.filter((q) => q.life > 0);
    for (const s of this.skids) s.life -= dt / 25;
    if (this.skids.length > 900) this.skids.splice(0, this.skids.length - 900);
    this.skids = this.skids.filter((s) => s.life > 0);
    // Sunk vehicles disappear.
    this.vehicles = this.vehicles.filter((v) => v.sink < 2.5);
  }
}

