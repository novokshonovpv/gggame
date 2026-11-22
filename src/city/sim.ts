// Everything that moves in the city: bikes and cars (top-down rigid bodies with tyre grip),
// pedestrians, the police, traffic that follows lanes and turns at crossings, crashes,
// fires, pick-ups and the courier jobs.

import type { NavState } from "./nav.ts";
import { BRIDGE, BUILD, CityMap, DIRT, type Obstacle, DX, DY, type Dir, GRASS, type JobKind, type JobSpot, LOT, type Place, ROAD, SAND, T, WALK, WATER, rng } from "./map.ts";

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

// The 67MOTO showroom sells the BSE line (prices in roubles); the player starts on a Z3.
export const BIKES: Model[] = [
  m({ id: "z3", name: "BSE Z3 250", type: "bike", len: 20, wid: 8, vmax: 285, accel: 400, brake: 540, turn: 3.3, grip: 15, offroad: 0.95, hp: 60, price: 0, colors: ["#f2c230", "#1d1d1f"] }),
  m({ id: "ex125", name: "BSE EX 125", type: "bike", len: 18, wid: 7, mass: 0.85, vmax: 265, accel: 425, brake: 560, turn: 3.8, grip: 17, offroad: 1, hp: 50, price: 45000, colors: ["#2f7de1", "#f2f2f2"] }),
  m({ id: "t5", name: "BSE T5 300", type: "bike", len: 21, wid: 8, vmax: 330, accel: 460, brake: 600, turn: 3.3, grip: 16, offroad: 0.95, hp: 75, price: 180000, colors: ["#e8e8e8", "#1d1d1f"] }),
  m({ id: "2t", name: "BSE 2T 300", type: "bike", len: 20, wid: 8, mass: 0.95, vmax: 365, accel: 555, brake: 640, turn: 3.5, grip: 17, offroad: 1, hp: 70, price: 350000, colors: ["#ff7a1a", "#1d1d1f"] }),
];
// Other people's bikes: can be taken off the street, not bought.
const STREET: Model[] = [
  m({ id: "scooter", name: "Скутер", type: "bike", len: 16, wid: 7, vmax: 185, accel: 270, brake: 420, turn: 3.7, grip: 14, offroad: 0.55, hp: 40, colors: ["#f2c230", "#7cc4e8", "#e86a8f", "#9ad06a"] }),
  m({ id: "chopper", name: "Чоппер", type: "bike", len: 24, wid: 10, mass: 1.5, vmax: 305, accel: 325, brake: 480, turn: 2.5, grip: 14, offroad: 0.55, hp: 100, colors: ["#1d1d1f", "#6b1414", "#2b3a55"] }),
  m({ id: "sport", name: "Спортбайк", type: "bike", len: 22, wid: 8, vmax: 400, accel: 520, brake: 660, turn: 2.9, grip: 16, offroad: 0.45, hp: 55, colors: ["#d81f26", "#1c4fd8", "#111", "#f2f2f2"] }),
];
const ALL_BIKES = [...BIKES, ...STREET];
export const BIKE = Object.fromEntries(ALL_BIKES.map((b) => [b.id, b])) as Record<string, Model>;

export const rub = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
const round100 = (n: number) => Math.round(n / 100) * 100;

// ---------- Weapons ----------

export type WeaponId = "pistol" | "smg" | "shotgun" | "rocket";
export interface Weapon {
  id: WeaponId;
  name: string;
  rate: number; // shots a second
  dmg: number;
  spread: number; // radians either side
  pellets: number;
  speed: number;
  range: number;
  pack: number; // rounds in a pick-up
}
export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol: { id: "pistol", name: "Пистолет", rate: 3.2, dmg: 34, spread: 0.035, pellets: 1, speed: 950, range: 520, pack: 24 },
  smg: { id: "smg", name: "Автомат", rate: 11, dmg: 15, spread: 0.075, pellets: 1, speed: 1000, range: 560, pack: 90 },
  shotgun: { id: "shotgun", name: "Дробовик", rate: 1.25, dmg: 20, spread: 0.2, pellets: 7, speed: 850, range: 300, pack: 14 },
  rocket: { id: "rocket", name: "Ракетница", rate: 0.9, dmg: 0, spread: 0.01, pellets: 1, speed: 520, range: 650, pack: 5 },
};
const WEAPON_ORDER: WeaponId[] = ["pistol", "smg", "shotgun", "rocket"];

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  dmg: number;
  owner: "player" | "police" | "remote"; // remote: another player's shot, only for show
  rocket?: boolean;
}

// Game clock: hours since midnight. Full dark from 21:30 to 4:30, twilight either side.
export function darkness(h: number) {
  if (h >= 21.5 || h < 4.5) return 1;
  if (h >= 19) return (h - 19) / 2.5;
  if (h < 7) return 1 - (h - 4.5) / 2.5;
  return 0;
}
export const HOUR = 20; // real seconds per game hour

const CARS: Model[] = [
  m({ id: "sedan", name: "Седан", type: "car", len: 34, wid: 16, mass: 4, vmax: 230, accel: 200, brake: 420, turn: 2.3, grip: 10, hp: 100, colors: ["#b8bcc2", "#2e5aa8", "#a82e2e", "#2d2d33", "#e9e6dc", "#3d7a4f", "#6b4f9a"] }),
  m({ id: "hatch", name: "Хэтчбек", type: "car", len: 29, wid: 15, mass: 3.2, vmax: 215, accel: 205, brake: 420, turn: 2.5, grip: 10, hp: 80, colors: ["#d65b2a", "#f0d04a", "#4ab0d6", "#e9e6dc", "#8a8f96"] }),
  m({ id: "taxi", name: "Такси", type: "car", len: 34, wid: 16, mass: 4, vmax: 240, accel: 205, brake: 420, turn: 2.3, grip: 10, hp: 100, colors: ["#f5c518"] }),
  m({ id: "van", name: "Фургон", type: "car", len: 40, wid: 18, mass: 6, vmax: 190, accel: 145, brake: 360, turn: 1.9, grip: 9, hp: 130, colors: ["#f0f0f0", "#3c6e9f", "#c9c2b0"] }),
  m({ id: "bus", name: "Автобус", type: "bus", len: 70, wid: 20, mass: 14, vmax: 160, accel: 100, brake: 300, turn: 1.4, grip: 9, hp: 250, colors: ["#e0b02a", "#3b8f5a"] }),
];
const POLICE: Model = m({ id: "police", name: "Полиция", type: "police", len: 35, wid: 16, mass: 4.5, vmax: 275, accel: 240, brake: 520, turn: 2.7, grip: 11, hp: 170, colors: ["#f4f4f4"] });

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
  z = 0; // height above the ground (jumps)
  vz = 0;
  airT = 0;
  airRot = 0; // how far the rider spun the bike in the air
  ramped = false; // this flight began on a ramp (only those count as stunts)
  lastOb: Obstacle | null = null;
  gunT = 1; // police: time to the next shot
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
  kind: "cash" | "health" | "surprise" | "coin" | WeaponId;
  temp?: boolean; // money-rain coins: gone once taken or when time runs out
  x: number;
  y: number;
  amount: number;
  respawn: number;
}

export interface Job {
  kind: JobKind;
  spot: JobSpot;
  start?: number; // stadium: lap start time
  phone?: { type: "chase" | "destroy" | "escape"; stage: number; target: Vehicle | null };
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
  | { type: "kick" }
  | { type: "shot"; weapon: WeaponId | "police"; x: number; y: number; remote?: boolean }
  | { type: "weapon"; id: WeaponId }
  | { type: "surprise"; text: string; good: boolean }
  | { type: "nitro" }
  | { type: "coin" }
  | { type: "stunt"; text: string; amount: number }
  | { type: "ring"; x: number; y: number }
  | { type: "package"; got: number; total: number }
  | { type: "lap"; time: number; best: number; record: boolean }
  | { type: "pvpHit"; uid: string; dmg: number; weapon: string }
  | { type: "pvpDown"; by: string };

// Another player in the city, as this client sees them (moved by the network code).
export interface RemoteView {
  uid: string;
  nick: string;
  pvp: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  veh: Vehicle | null; // riding: a display-only bike
  ped: Ped | null; // on foot or thrown off
}

export interface Input {
  gas: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  hb: boolean;
  action: boolean; // edge: get on / off
  kick: boolean; // edge
  fire: boolean; // held
  swap: boolean; // edge: next weapon
  sprint: boolean; // held: run on foot, nitro on the bike
}

export interface Player {
  mode: "ride" | "foot" | "fly" | "out";
  bike: Vehicle | null;
  body: Ped;
  health: number;
  getup: number;
  bust: number;
  outT: number;
  armor: number;
  nitro: number; // charges
  jailCard: boolean;
}

const WANTED_LOSE = 8; // seconds out of sight per star
const POLICE_FOR = [0, 1, 2, 3, 4, 6];
const CRASH = 150; // impact speed that throws a rider off
const GRAV = 520; // jumps: units/s² (stretched for the top-down view)
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
  double = 0; // seconds of double money left
  streak = 0; // jobs in a row without being wasted or busted: raises the money multiplier
  bestLap = 0; // stadium record, seconds
  packagesGot = new Set<number>();
  heli: { x: number; y: number; a: number; vx: number; vy: number; gunT: number; rotor: number } | null = null;
  ringing = -1; // payphone that is ringing
  private ringT = 0;
  private ringCool = 25;
  target: Vehicle | null = null; // a payphone job's mark
  remotes: RemoteView[] = []; // other online players
  nav: NavState | null = null; // the navigator's route (nav.ts)
  pvp = true; // this player takes part in PvP
  pvpGrace = 0; // seconds of PvP protection after respawning
  private lastHitBy: { uid: string; t: number } | null = null;
  boostT = 0; // nitro burning
  rush: { t: number; left: number; got: number } | null = null; // money rain
  private sprintPrev = false;
  time = 0;
  view = { x0: 0, y0: 0, x1: 0, y1: 0 };
  bikeId = "z3";
  clock = 17; // game hours
  arms: Partial<Record<WeaponId, number>> = {};
  weapon: WeaponId | null = null;
  bullets: Bullet[] = [];
  flashes: { x: number; y: number; a: number; t: number }[] = [];
  private fireT = 0;
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
    // Start by the workshop nearest the city centre.
    const mid = (map.n * T) / 2;
    const home = map.nearest("garage", mid, mid) ?? map.places[0];
    const start = map.nearestWalk(home.x, home.y - T * 2);
    const body = new Ped(start.x, start.y, -Math.PI / 2);
    body.helmet = "#ff7a1a";
    body.shirt = "#1d1d1f";
    this.player = { mode: "foot", bike: null, body, health: 100, getup: 0, bust: 0, outT: 0, armor: 0, nitro: 0, jailCard: false };
    // Scaled to the size of the city.
    for (let i = 0; i < 380; i++) this.placePickup("cash");
    for (let i = 0; i < 70; i++) this.placePickup("health");
    for (const [kind, n] of [["pistol", 60], ["smg", 35], ["shotgun", 35], ["surprise", 130]] as const) for (let i = 0; i < n; i++) this.placePickup(kind);
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
    const model = BIKE[id] ?? BIKE.z3;
    const v = new Vehicle(model, x, y, a, model.colors[0]);
    this.vehicles.push(v);
    if (mount) this.mount(v);
    return v;
  }

  private placePickup(kind: Pickup["kind"]) {
    const map = this.map;
    for (let tries = 0; tries < 100; tries++) {
      const x = map.land.x0 + Math.floor(this.r() * (map.land.x1 - map.land.x0));
      const y = map.land.y0 + Math.floor(this.r() * (map.land.y1 - map.land.y0));
      const t = map.at(x, y);
      if (t !== WALK && t !== LOT && t !== GRASS) continue;
      this.pickups.push({ kind, x: (x + 0.5) * T, y: (y + 0.5) * T, amount: kind === "cash" ? 300 + 100 * Math.floor(this.r() * 13) : kind === "health" ? 40 : kind === "surprise" || kind === "coin" ? 0 : WEAPONS[kind].pack, respawn: 0 });
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
    // Only roads that pass near the player (the city is big).
    const across = horiz ? this.py : this.px;
    const near: number[] = [];
    for (let k = 0; k < list.length; k++) if (Math.abs((list[k] + 1) * T - across) < maxD) near.push(k);
    if (near.length === 0) return null;
    const i = near[Math.floor(this.r() * near.length)];
    const dir = (horiz ? (this.r() < 0.5 ? 0 : 2) : this.r() < 0.5 ? 1 : 3) as Dir;
    const lo = cross[0] * T;
    const hi = (cross[cross.length - 1] + 2) * T;
    // Along the stretch closest to the player.
    const along = horiz ? this.px : this.py;
    let s = along + (this.r() * 2 - 1) * maxD;
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
    else if (roll < 0.3) model = ALL_BIKES[Math.floor(this.r() * ALL_BIKES.length)];
    else if (roll < 0.58) model = CARS[0];
    else if (roll < 0.74) model = CARS[1];
    else if (roll < 0.84) model = CARS[2];
    else if (roll < 0.93) model = CARS[3];
    else if (roll < 0.97) model = CARS[4];
    else model = POLICE;
    const v = new Vehicle(model, spot.x, spot.y, (spot.dir * Math.PI) / 2, pickOf(model.colors));
    v.rider = "npc";
    const cruise = model.type === "bike" ? 85 + this.r() * 40 : model.type === "bus" ? 60 : 70 + this.r() * 30;
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
      const pool = [STREET[0], STREET[0], BIKES[0], BIKES[1], STREET[1], STREET[2]];
      const model = pool[Math.floor(this.r() * pool.length)];
      this.vehicles.push(new Vehicle(model, wx, wy, a + (this.r() - 0.5) * 0.3, pickOf(model.colors)));
      return;
    }
  }

  populate(first: boolean) {
    const px = this.px;
    const py = this.py;
    // Forget what is far behind.
    this.vehicles = this.vehicles.filter((v) => {
      if (v === this.player.bike || v === this.target) return true;
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

  // Another player says they hit us.
  remoteHit(uid: string, dmg: number) {
    const p = this.player;
    if (!this.pvp || this.pvpGrace > 0 || p.mode === "out") return false;
    this.lastHitBy = { uid, t: this.time };
    dmg *= 0.5; // players take half the damage the guns do to everything else
    if (p.mode === "ride" && p.bike) {
      this.damage(p.bike, dmg * 0.3);
      p.bike.hit = 0.15;
    }
    this.hurt(dmg);
    return true;
  }

  private canHit(r: RemoteView) {
    return this.pvp && r.pvp && this.pvpGrace <= 0 && this.player.mode !== "out";
  }

  hurt(dmg: number) {
    const p = this.player;
    if (p.mode === "out" || dmg <= 0) return;
    const soak = Math.min(p.armor, dmg);
    p.armor -= soak;
    dmg -= soak;
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
    if (this.streak > 0) this.say("Серия заданий прервана", "bad");
    this.streak = 0;
    p.outT = 3.2;
    p.bike = null;
    if (this.job) this.failJob(how === "busted" ? "Задание провалено: задержан" : "Задание провалено");
    this.emit({ type: how });
    if (how === "wasted" && this.lastHitBy && this.time - this.lastHitBy.t < 6) this.emit({ type: "pvpDown", by: this.lastHitBy.uid });
    this.lastHitBy = null;
  }

  respawn(how: "wasted" | "busted") {
    const p = this.player;
    // The nearest hospital or police station to where it happened.
    const place = this.map.nearest(how === "busted" ? "police" : "hospital", p.body.x, p.body.y) ?? this.map.places[0];
    const card = how === "busted" && p.jailCard;
    const fee = card ? 0 : how === "busted" ? Math.min(this.money, 4000 + this.wanted * 3000) : Math.min(this.money, 3000);
    if (card) p.jailCard = false;
    if (how === "wasted") p.armor = 0;
    this.boostT = 0;
    this.money -= fee;
    this.wanted = 0;
    this.heat = 0;
    for (const v of this.vehicles) v.chase = false;
    p.health = 100;
    this.pvpGrace = 5;
    p.mode = "foot";
    p.body.state = "walk";
    p.body.x = place.x;
    p.body.y = place.y;
    p.body.vx = p.body.vy = 0;
    p.body.a = place.a;
    p.bust = 0;
    // The rider's own bike is waiting at the kerb.
    this.spawnPlayerBike(this.bikeId, place.x + Math.cos(place.a + Math.PI / 2) * 16, place.y + Math.sin(place.a + Math.PI / 2) * 16, place.a, false);
    if (how === "busted" && !card) {
      // The police keep the guns.
      this.arms = {};
      this.weapon = null;
    }
    if (card) this.say("Карта «Выйти из участка»: отпустили бесплатно, оружие при тебе", "good");
    else this.say(how === "busted" ? `Отпустили под залог: −${rub(fee)}, оружие изъято` : `Больница: −${rub(fee)}`, "bad");
    this.populate(true);
  }

  crime(points: number, x: number, y: number) {
    let witnessed = false;
    for (const v of this.vehicles) if (v.police && v.alive && Math.hypot(v.x - x, v.y - y) < 300) witnessed = true;
    this.heat += points * (witnessed ? 2 : 1);
    const need = this.wanted === 0 ? 1.5 : 2 + this.wanted;
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
    this.clock = (this.clock + dt / HOUR) % 24;
    this.tick++;
    const p = this.player;
    this.controlPlayer(dt, inp);
    this.shoot(dt, inp);

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
    this.collideRemotes();
    this.pvpGrace = Math.max(0, this.pvpGrace - dt);
    for (const ped of this.peds) this.stepPed(ped, dt);
    this.peds = this.peds.filter((q) => q.state !== "swim" || q.t > 0);
    if (p.mode !== "ride" && p.mode !== "out") this.stepBody(dt);
    this.collidePeds();
    if (p.mode === "out") {
      p.outT -= dt;
    }
    this.stepPolice(dt);
    this.stepHeli(dt);
    this.stepPhones(dt);
    this.stepBullets(dt);
    this.stepPickups(dt);
    this.stepJob(dt);
    this.stepPlaces();
    this.stepFx(dt);
    if (this.tick % 15 === 0) this.populate(false);
  }

  private controlPlayer(dt: number, inp: Input) {
    const p = this.player;
    this.controlPlayerInner(dt, inp);
    this.sprintPrev = inp.sprint;
    this.boostT = Math.max(0, this.boostT - dt);
    this.double = Math.max(0, this.double - dt);
    if (this.boostT > 0 && p.mode === "ride" && p.bike) {
      const b = p.bike;
      const ex = b.x - Math.cos(b.a) * (b.model.len / 2 + 2);
      const ey = b.y - Math.sin(b.a) * (b.model.len / 2 + 2);
      this.puff(ex, ey, "fire", 0.5);
      if (this.tick % 2 === 0) this.puff(ex, ey, "smoke", 0.5);
    }
  }

  private controlPlayerInner(dt: number, inp: Input) {
    const p = this.player;
    if (p.mode === "ride" && p.bike) {
      const v = p.bike;
      v.thr = inp.gas ? 1 : 0;
      v.brk = inp.brake ? 1 : 0;
      v.steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      v.hb = inp.hb;
      if (inp.sprint && !this.sprintPrev && this.boostT <= 0) {
        if (p.nitro > 0) {
          p.nitro--;
          this.boostT = 2.5;
          this.emit({ type: "nitro" });
        } else if (this.tick % 30 === 0) this.say("Нитро нет — ищи ящики «?»", "info");
      }
      if (inp.action) this.dismount();
    } else if (p.mode === "foot") {
      const b = p.body;
      const turn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      b.a += turn * 3.8 * dt;
      const sp = inp.gas ? (inp.sprint ? 130 : 72) : inp.brake ? -32 : 0;
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
    if (v.z > 0 || v.vz > 0) {
      this.fly(v, dt);
      return;
    }
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
    const rough = tile === GRASS || tile === SAND || tile === DIRT;
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
      const boost = v.rider === "player" && this.boostT > 0;
      const vmax = M.vmax * (rough ? M.offroad : 1) * (v.hp <= M.hp * 0.25 ? 0.75 : 1) * (boost ? 1.35 : 1);
      if (v.thr > 0) {
        if (vf < -5) vf += M.brake * dt;
        else vf += M.accel * (boost ? 2.2 : 1) * v.thr * Math.max(0, 1 - (vf / vmax) ** 2) * dt;
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

    this.groundObstacles(v, dt);

    // Fire.
    if (v.burn > 0) {
      v.burn -= dt;
      if (this.tick % 2 === 0) this.puff(v.x + (this.r() - 0.5) * 10, v.y + (this.r() - 0.5) * 10, this.r() < 0.6 ? "fire" : "smoke", 1);
      if (v.burn <= 0) this.explode(v);
    } else if (v.alive && v.hp < M.hp * 0.35 && this.tick % 6 === 0) this.puff(v.x + fx * M.len * 0.35, v.y + fy * M.len * 0.35, "smoke", 0.7);

    this.collideWorld(v);
  }

  // In the air: ballistic, the rider can spin the bike; land square or crash.
  private fly(v: Vehicle, dt: number) {
    v.z += v.vz * dt;
    v.vz -= GRAV * dt;
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.airT += dt;
    if (v.bike && v.rider === "player") {
      const s = v.steer * 5.5 * dt;
      v.a += s;
      v.airRot += s;
    } else v.a += v.spin * dt;
    v.fwd = v.vx * Math.cos(v.a) + v.vy * Math.sin(v.a);
    if (v.z <= 0) this.land(v);
    this.collideWorld(v);
  }

  private land(v: Vehicle) {
    const hitDown = -v.vz;
    v.z = 0;
    v.vz = 0;
    const sp = v.speed;
    const off = Math.abs(wrap(Math.atan2(v.vy, v.vx) - v.a));
    this.burst(v.x, v.y, 6, "dust");
    const air = v.ramped ? v.airT : 0;
    const spins = Math.floor((Math.abs(v.airRot) + 0.7) / (Math.PI * 2));
    v.airT = 0;
    v.airRot = 0;
    v.ramped = false;
    if (v.bike && v.rider && sp > 60 && off > 0.8) {
      this.emit({ type: "crash", power: sp, x: v.x, y: v.y });
      this.throwRider(v, sp * 0.8 + 60);
      return;
    }
    if (hitDown > 430) {
      this.damage(v, (hitDown - 430) * 0.12);
      if (v.rider === "player") this.hurt((hitDown - 430) * 0.05);
    }
    // Wheels down: the bike carries on the way it points.
    const k = Math.cos(off);
    v.vx = Math.cos(v.a) * sp * k;
    v.vy = Math.sin(v.a) * sp * k;
    if (v.rider === "player" && air > 0.55) {
      let amt = Math.round((1200 * air * air) / 100) * 100;
      let name = air > 1.5 ? "БЕЗУМНЫЙ ТРЮК!" : air > 1 ? "Отличный прыжок!" : "Прыжок!";
      if (spins > 0) {
        amt *= 1 + spins;
        name = `${spins * 360}°! ${name}`;
      }
      amt = Math.round(amt * this.mult);
      this.money += amt;
      this.emit({ type: "stunt", text: `${name} ${air.toFixed(1)} с в воздухе`, amount: amt });
    }
  }

  // Ramps launch, logs and whoops bounce, mud drags (wheels on the ground only).
  private groundObstacles(v: Vehicle, dt: number) {
    const fx = Math.cos(v.a);
    const fy = Math.sin(v.a);
    const px = v.x + fx * v.model.len * 0.3;
    const py = v.y + fy * v.model.len * 0.3;
    const list = this.map.obstaclesAt(px, py);
    let touched: Obstacle | null = null;
    let mud = false;
    let crawl = false;
    // Tyres and rocks under either wheel: the bike climbs over them at a crawl, bucking.
    const under = this.map.obstaclesAt(v.x, v.y);
    for (const set of [list, under])
      if (set)
        for (const o of set)
          if ((o.kind === "tire" || o.kind === "rock") && Math.hypot(v.x - o.x, v.y - o.y) < o.len / 2 + v.model.len * 0.4) crawl = true;
    if (list)
      for (const o of list) {
        if (o.kind === "tire" || o.kind === "rock") continue;
        const dx = px - o.x;
        const dy = py - o.y;
        const ca = Math.cos(o.a);
        const sa = Math.sin(o.a);
        if (Math.abs(dx * ca + dy * sa) > o.len / 2 || Math.abs(-dx * sa + dy * ca) > o.wid / 2) continue;
        if (o.kind === "mud") {
          mud = true;
          continue;
        }
        touched = o;
        if (v.lastOb === o) continue;
        const sp = v.speed;
        if (o.kind === "ramp") {
          const along = v.vx * ca + v.vy * sa;
          if (along < 70 || Math.cos(wrap(v.a - o.a)) < 0.55) continue;
          const go = Math.max(along, o.power ?? 0);
          if (o.power) {
            v.vx = ca * go;
            v.vy = sa * go;
          }
          v.vz = Math.min(340, go * 0.62);
          v.z = 0.1;
          v.airT = 0;
          v.airRot = 0;
          v.ramped = true;
        } else if (o.kind === "log") {
          if (v.bike && sp > 50) {
            // An enduro bike hops a log.
            v.vz = 70 + sp * 0.1;
            v.z = 0.1;
            v.vx *= 0.85;
            v.vy *= 0.85;
          } else {
            const k = v.bike ? 0.3 : 0.65;
            v.vx *= k;
            v.vy *= k;
            if (!v.bike && sp > 60) {
              v.vz = 50;
              v.z = 0.1;
            }
          }
        } else if (o.kind === "whoop") {
          if (v.bike && sp > 150) {
            v.vz = 85;
            v.z = 0.1;
          } else {
            v.vx *= 0.85;
            v.vy *= 0.85;
          }
        }
      }
    v.lastOb = touched;
    if (crawl) {
      const sp = v.speed;
      const cap = v.bike ? 40 : 30;
      if (sp > cap) {
        const k = Math.max(cap / sp, Math.exp(-7 * dt));
        v.vx *= k;
        v.vy *= k;
      }
      if (sp > 15 && this.r() < dt * 6) {
        v.vz = 35 + this.r() * 25;
        v.z = 0.1;
        v.spin += (this.r() - 0.5) * 1.2;
      }
    }
    if (mud) {
      const k = Math.exp(-2.4 * dt);
      v.vx *= k;
      v.vy *= k;
      if (v.speed > 40 && this.r() < 0.5) this.puff(v.x - fx * 9, v.y - fy * 9, "dust", 1.2);
    }
  }

  // Push a circle out of buildings, railings and tree trunks.
  private resolveCircle(cx: number, cy: number, r: number, low = true) {
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
        void low; // tyres and rocks are ridden over (slowly), see groundObstacles
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
      const { dx, dy } = this.resolveCircle(cx, cy, r, v.z < 8);
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
    this.damage(v, Math.max(0, power - 60) * (v.bike ? 0.18 : 0.22) * (other ? Math.sqrt(other.model.mass / v.model.mass) : 1));
    if (v === this.player.bike || (other && other === this.player.bike)) this.emit({ type: "crash", power, x, y });
    if (v.bike && v.rider && power > CRASH) this.throwRider(v, power);
    if (v.rider === "player" && other?.police && other.alive) this.crime(power > 120 ? 1.2 : 0.4, x, y);
  }

  private damage(v: Vehicle, dmg: number) {
    if (!v.alive || v.burn > 0 || dmg <= 0) return;
    v.hp -= dmg;
    if (v.hp <= 0) {
      v.hp = 0;
      v.burn = v.bike ? 2.5 : 4 + this.r() * 2;
      if (!v.bike && v.rider === "npc") this.bail(v);
      if (v.rider === "player") this.say("Байк горит — прыгай!", "bad");
    }
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
    if (v.rider) this.throwRider(v, 200);
    this.blast(v.x, v.y, v, false, 1);
  }

  blast(x: number, y: number, skip: Vehicle | null, byPlayer: boolean, power: number) {
    this.emit({ type: "explode", x, y });
    this.burst(x, y, Math.round(30 * power), "fire");
    this.burst(x, y, Math.round(20 * power), "smoke");
    this.burst(x, y, 20, "spark");
    const R = 95 * Math.sqrt(power);
    if (byPlayer)
      for (const r of this.remotes) {
        const d = Math.hypot(r.x - x, r.y - y);
        if (d < R && this.canHit(r)) this.emit({ type: "pvpHit", uid: r.uid, dmg: Math.round(70 * power * (1 - d / R)), weapon: "rocket" });
      }
    for (const o of this.vehicles) {
      if (o === skip) continue;
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy);
      if (d > R || d === 0) continue;
      const k = 1 - d / R;
      o.vx += (dx / d) * 260 * k;
      o.vy += (dy / d) * 260 * k;
      o.spin += (this.r() - 0.5) * 8 * k;
      if (o.rider === "player") this.impact(o, 60 + 120 * k * power, o.x, o.y, null);
      else this.impact(o, 100 + 150 * k, o.x, o.y, null);
      if (byPlayer && o.police && o.alive) this.crime(1.5, o.x, o.y);
    }
    for (const q of this.peds) {
      const dx = q.x - x;
      const dy = q.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R && q.state !== "swim") {
        this.knock(q, (dx / d) * 220, (dy / d) * 220);
        if (byPlayer) this.crime(0.7, q.x, q.y);
      }
    }
    const b = this.player.body;
    if (this.player.mode !== "ride") {
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < R) {
        this.hurt(70 * power * (1 - d / R));
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
        if (B.sink || Math.abs(A.z - B.z) > 10) continue;
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
      if (v.sink || v.z > 6) continue;
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
    if (!(d < 180 && map.sees(v.x, v.y, px, py))) {
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
    v.steer = clamp(diff * 1.6, -1, 1);
    v.hb = false;
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
        this.flowT = 1.5; // the police radio is slow: routes go stale
        this.flowTile = tile;
        this.map.flowFrom(Math.floor(px / T), Math.floor(py / T), this.flow);
      }
      let seen = false;
      let near = false;
      for (const v of this.vehicles) {
        if (!v.police || !v.alive || v.rider !== "npc") continue;
        v.chase = true;
        const d = Math.hypot(v.x - px, v.y - py);
        const sees = d < 380 - 150 * darkness(this.clock) && this.map.sees(v.x, v.y, px, py);
        if (sees) seen = true;
        // From three stars the police open fire.
        v.gunT -= dt;
        if (this.wanted >= 3 && sees && d < 260 && v.gunT <= 0 && p.mode !== "fly") {
          v.gunT = 1.4 + this.r() * 1.2;
          const a = Math.atan2(py - v.y, px - v.x) + (this.r() - 0.5) * 0.4;
          const sx = v.x + Math.cos(a) * 20;
          const sy = v.y + Math.sin(a) * 20;
          this.bullets.push({ x: sx, y: sy, vx: Math.cos(a) * 800, vy: Math.sin(a) * 800, life: 0.5, dmg: 6, owner: "police" });
          this.flashes.push({ x: sx, y: sy, a, t: 0.06 });
          this.emit({ type: "shot", weapon: "police", x: sx, y: sy });
        }
        if (d < 40 && v.speed < 80) near = true;
      }
      const h = this.heli;
      if (h && Math.hypot(h.x - px, h.y - py) < 170) seen = true;
      this.unseen = seen ? 0 : this.unseen + dt;
      if (this.unseen > WANTED_LOSE) {
        this.unseen = 0;
        this.setWanted(this.wanted - 1);
        if (this.wanted === 0) this.say("Полиция потеряла след", "good");
      }
      const slow = p.mode !== "ride" || (p.bike?.speed ?? 0) < 25;
      if (near && slow && p.mode !== "fly") p.bust += dt;
      else p.bust = Math.max(0, p.bust - dt * 0.5);
      if (p.bust > 2.2) this.endLife("busted");
    } else p.bust = 0;
  }

  // Police helicopter from four stars: follows from above, spots you, shoots at five.
  private stepHeli(dt: number) {
    const p = this.player;
    if (this.wanted < 4 || p.mode === "out") {
      this.heli = null;
      return;
    }
    const px = this.px;
    const py = this.py;
    if (!this.heli) {
      const a = this.r() * Math.PI * 2;
      this.heli = { x: px + Math.cos(a) * 900, y: py + Math.sin(a) * 900, a: a + Math.PI, vx: 0, vy: 0, gunT: 2, rotor: 0 };
      this.say("Полицейский вертолёт!", "bad");
    }
    const h = this.heli;
    const pv = p.mode === "ride" && p.bike ? p.bike : p.body;
    const tx = px + pv.vx * 0.5 - h.x;
    const ty = py + pv.vy * 0.5 - h.y;
    const d = Math.hypot(tx, ty) || 1;
    const want = Math.min(230, d * 1.4);
    const k = Math.min(1, dt * 1.1);
    h.vx += ((tx / d) * want - h.vx) * k;
    h.vy += ((ty / d) * want - h.vy) * k;
    h.x += h.vx * dt;
    h.y += h.vy * dt;
    h.rotor += dt * 30;
    if (Math.hypot(h.vx, h.vy) > 20) h.a += wrap(Math.atan2(h.vy, h.vx) - h.a) * Math.min(1, dt * 2);
    h.gunT -= dt;
    if (this.wanted >= 5 && d < 280 && h.gunT <= 0 && p.mode !== "fly") {
      h.gunT = 1.8;
      const a = Math.atan2(ty, tx) + (this.r() - 0.5) * 0.25;
      this.bullets.push({ x: h.x, y: h.y, vx: Math.cos(a) * 850, vy: Math.sin(a) * 850, life: 0.45, dmg: 6, owner: "police" });
      this.emit({ type: "shot", weapon: "police", x: h.x, y: h.y });
    }
  }

  // Payphones: one rings now and then; pick it up for a special job.
  private stepPhones(dt: number) {
    const phones = this.map.phones;
    const p = this.player;
    if (!phones.length || p.mode === "out") return;
    if (this.ringing < 0) {
      if (this.job) return;
      this.ringCool -= dt;
      if (this.ringCool > 0) return;
      const near = phones.map((_, i) => i).filter((i) => {
        const d = Math.hypot(phones[i].x - this.px, phones[i].y - this.py);
        return d > 300 && d < 2600;
      });
      this.ringCool = 30;
      if (!near.length) return;
      this.ringing = near[Math.floor(this.r() * near.length)];
      this.ringT = 70;
      this.say("Где-то рядом звонит телефон-автомат…", "info");
      return;
    }
    const ph = phones[this.ringing];
    this.ringT -= dt;
    const d = Math.hypot(ph.x - this.px, ph.y - this.py);
    if (this.tick % 75 === 0 && d < 900) this.emit({ type: "ring", x: ph.x, y: ph.y });
    if (this.ringT <= 0 || this.job) {
      this.ringing = -1;
      return;
    }
    if (d < 24) {
      this.ringing = -1;
      this.startPhoneJob(ph);
    }
  }

  private startPhoneJob(ph: { x: number; y: number }) {
    const spot: JobSpot = { kind: "phone", x: ph.x, y: ph.y };
    const type = (["chase", "destroy", "escape"] as const)[Math.floor(this.r() * 3)];
    if (type === "escape") {
      this.setWanted(4);
      this.job = { kind: "phone", spot, points: [], idx: 0, time: 180, reward: 25000, title: "Звонок: «Тебя сдали. Уйди от погони за 3 минуты»", phone: { type, stage: 0, target: null } };
    } else {
      let v: Vehicle | null = null;
      for (let i = 0; i < 40 && !v; i++) v = this.spawnTraffic(false);
      if (!v) {
        this.say("В трубке тишина…", "info");
        return;
      }
      if (type === "chase") {
        v.model = BIKE.sport;
        v.color = "#111";
        v.look = { jacket: "#c62828", helmet: "#c62828" };
        v.hp = v.model.hp;
        if (v.ai) v.ai.cruise = 125;
        this.job = { kind: "phone", spot, points: [{ x: v.x, y: v.y }], idx: 0, time: 150, reward: 15000, title: "Звонок: «Перехвати курьера конкурентов — чёрный спортбайк»", phone: { type, stage: 0, target: v } };
      } else {
        v.model = CARS[3];
        v.color = "#151515";
        v.hp = v.model.hp;
        this.arms.rocket = (this.arms.rocket ?? 0) + 3;
        this.weapon = "rocket";
        this.emit({ type: "weapon", id: "rocket" });
        this.job = { kind: "phone", spot, points: [{ x: v.x, y: v.y }], idx: 0, time: 150, reward: 20000, title: "Звонок: «Взорви чёрный фургон. Ракеты — подарок»", phone: { type, stage: 0, target: v } };
      }
      this.target = v;
    }
    this.say(this.job!.title, "info");
  }

  // Money, streak and messages for any job done.
  private completeJob(job: Job, extra: number, note = "") {
    const m = this.mult;
    const total = Math.round((job.reward + extra) * m);
    this.money += total;
    this.streak++;
    this.say(`Готово! +${rub(total)}${note}${m > 1 ? ` (×${m.toFixed(2).replace(/\.?0+$/, "")})` : ""}`, "good");
    if (this.streak >= 2) this.say(`Серия заданий: ${this.streak} — множитель ×${(1 + 0.25 * Math.min(this.streak, 4)).toFixed(2).replace(/\.?0+$/, "")}`, "info");
    this.emit({ type: "jobDone", reward: total });
    this.job = null;
    this.target = null;
    this.jobCooldown = 4;
  }

  private stepPhoneJob(job: Job) {
    const ph = job.phone!;
    const v = ph.target;
    if (ph.type === "escape") {
      if (this.wanted === 0) this.completeJob(job, Math.max(0, Math.floor(job.time)) * 100);
      return;
    }
    if (!v || v.sink > 0 || !this.vehicles.includes(v)) {
      if (ph.type === "destroy" && v && v.sink > 0) this.completeJob(job, 0, " Фургон на дне");
      else this.failJob("Цель ушла — задание провалено");
      return;
    }
    if (ph.type === "destroy") {
      job.points[0] = { x: v.x, y: v.y };
      if (v.wreck || v.burn > 0) this.completeJob(job, Math.max(0, Math.floor(job.time)) * 100);
      return;
    }
    // Chase: knock the rider off, then take his parcel to the client.
    if (ph.stage === 0) {
      job.points[0] = { x: v.x, y: v.y };
      if (v.rider !== "npc") {
        ph.stage = 1;
        const to = this.randomDoorstep(v.x, v.y, 1500, 3500);
        job.points[0] = to;
        job.time += 60;
        this.target = null;
        this.say(`Посылка у тебя! Отвези заказчику: ${this.map.address(to.x, to.y)}`, "good");
        this.emit({ type: "checkpoint" });
      }
      return;
    }
    const t = job.points[0];
    if (Math.hypot(t.x - this.px, t.y - this.py) < 30) this.completeJob(job, Math.max(0, Math.floor(job.time)) * 100);
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
      if (k.kind === "surprise") {
        this.surprise(k);
        continue;
      }
      if (k.kind === "coin") {
        const amt = 1000 * this.mult;
        this.money += amt;
        this.burst(k.x, k.y, 8, "cash");
        this.emit({ type: "coin" });
        k.respawn = 1e9;
        const r = this.rush;
        if (r) {
          r.left--;
          r.got++;
          if (r.left <= 0) {
            const bonus = 10000 * this.mult;
            this.money += bonus;
            this.say(`Денежный дождь собран целиком! Бонус +${rub(bonus)}`, "good");
            this.emit({ type: "jobDone", reward: bonus });
            this.rush = null;
          }
        }
        continue;
      }
      if (k.kind === "pistol" || k.kind === "smg" || k.kind === "shotgun") {
        const had = (this.arms[k.kind] ?? 0) > 0;
        this.arms[k.kind] = (this.arms[k.kind] ?? 0) + k.amount;
        if (!this.weapon || (this.arms[this.weapon] ?? 0) <= 0 || !had) this.weapon = k.kind;
        this.say(`${WEAPONS[k.kind].name}: +${k.amount} патронов`, "info");
        this.emit({ type: "weapon", id: k.kind });
        k.respawn = 90;
        continue;
      }
      if (k.kind === "cash") {
        this.money += k.amount * this.mult;
        this.emit({ type: "cash", amount: k.amount * this.mult });
        this.burst(k.x, k.y, 8, "cash");
      } else {
        this.player.health = Math.min(100, this.player.health + k.amount);
        this.emit({ type: "health" });
      }
      k.respawn = 60;
    }
    // Hidden packages.
    const pk = this.map.packages;
    for (let i = 0; i < pk.length; i++) {
      if (this.packagesGot.has(i) || this.player.mode === "out") continue;
      if (Math.abs(pk[i].x - px) > 20 || Math.abs(pk[i].y - py) > 20) continue;
      this.packagesGot.add(i);
      this.money += 5000;
      this.burst(pk[i].x, pk[i].y, 12, "cash");
      this.emit({ type: "package", got: this.packagesGot.size, total: pk.length });
      if (this.packagesGot.size === pk.length) {
        this.money += 100000;
        this.say("Все секретные посылки найдены! +100 000 ₽", "good");
      } else this.say(`Секретная посылка ${this.packagesGot.size} из ${pk.length}: +5 000 ₽`, "good");
    }
    // Money rain: the clock and the coins that are left.
    if (this.rush) {
      this.rush.t -= dt;
      if (this.rush.t <= 0) {
        this.say(`Денежный дождь закончился: собрано ${this.rush.got} из 10`, "info");
        this.rush = null;
      }
    }
    if (!this.rush) this.pickups = this.pickups.filter((k) => !k.temp);
    else this.pickups = this.pickups.filter((k) => !k.temp || k.respawn <= 0);
  }

  get mult() {
    return (this.double > 0 ? 2 : 1) * (1 + 0.25 * Math.min(this.streak, 4));
  }

  // A "?" crate: mostly good things, now and then a nasty one.
  private surprise(k: Pickup) {
    const p = this.player;
    const r = this.r;
    const say = (text: string, good = true) => {
      this.say(text, good ? "good" : "bad");
      this.emit({ type: "surprise", text, good });
    };
    const table: [number, () => void][] = [
      [22, () => {
        const amt = (5000 + 1000 * Math.floor(r() * 16)) * this.mult;
        this.money += amt;
        this.burst(k.x, k.y, 14, "cash");
        say(`Сюрприз: ${rub(amt)}!`);
      }],
      [14, () => {
        p.armor = 100;
        say("Сюрприз: бронежилет — держит 100 урона");
      }],
      [9, () => {
        if (this.wanted > 0) {
          this.setWanted(0);
          this.heat = 0;
          say("Сюрприз: взятка — полиция тебя больше не ищет");
        } else {
          this.money += 3000 * this.mult;
          say(`Сюрприз: ${rub(3000 * this.mult)}`);
        }
      }],
      [8, () => {
        p.jailCard = true;
        say("Сюрприз: карта «Выйти из участка» — следующее задержание бесплатно");
      }],
      [14, () => {
        p.nitro += 3;
        say("Сюрприз: нитро ×3 — жми Shift на мотоцикле");
      }],
      [9, () => {
        this.double = 90;
        say("Сюрприз: двойные деньги на 90 секунд!");
      }],
      [8, () => {
        this.arms.rocket = (this.arms.rocket ?? 0) + 5;
        this.weapon = "rocket";
        say("Сюрприз: ракетница, 5 ракет");
        this.emit({ type: "weapon", id: "rocket" });
      }],
      [9, () => this.startRush()],
      [7, () => {
        say("Ящик с сюрпризом… БАХ! Ловушка", false);
        this.blast(k.x, k.y, null, false, 0.45);
      }],
    ];
    let roll = r() * table.reduce((a, [w]) => a + w, 0);
    for (const [w, f] of table) {
      roll -= w;
      if (roll <= 0) {
        f();
        break;
      }
    }
    // The crate turns up somewhere else in a couple of minutes.
    k.respawn = 120;
    const map = this.map;
    for (let tries = 0; tries < 50; tries++) {
      const x = map.land.x0 + Math.floor(r() * (map.land.x1 - map.land.x0));
      const y = map.land.y0 + Math.floor(r() * (map.land.y1 - map.land.y0));
      const t = map.at(x, y);
      if (t !== WALK && t !== LOT && t !== GRASS) continue;
      k.x = (x + 0.5) * T;
      k.y = (y + 0.5) * T;
      break;
    }
  }

  // Ten coins around the player and 45 seconds to grab them.
  private startRush() {
    const map = this.map;
    this.pickups = this.pickups.filter((k) => !k.temp);
    let n = 0;
    for (let tries = 0; tries < 400 && n < 10; tries++) {
      const a = this.r() * Math.PI * 2;
      const d = 200 + this.r() * 550;
      const x = this.px + Math.cos(a) * d;
      const y = this.py + Math.sin(a) * d;
      const t = map.tileAt(x, y);
      if (t !== ROAD && t !== WALK && t !== LOT && t !== BRIDGE) continue;
      this.pickups.push({ kind: "coin", x, y, amount: 1000, respawn: 0, temp: true });
      n++;
    }
    this.rush = { t: 45, left: n, got: 0 };
    this.say("Сюрприз: денежный дождь! Собери 10 монет за 45 секунд", "good");
    this.emit({ type: "surprise", text: "Денежный дождь", good: true });
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
          const cost = 4000 * this.wanted;
          if (this.money >= cost) {
            this.money -= cost;
            this.setWanted(0);
            this.heat = 0;
            this.say(`Сервис 67МОТО: новые номера и перекраска −${rub(cost)}. Полиция потеряла след`, "good");
            v.color = v.model.colors[Math.floor(this.r() * v.model.colors.length)];
          } else this.say(`Смена номеров стоит ${rub(cost)} — не хватает денег`, "bad");
        }
        if (v.hp < v.model.hp || v.burn > 0) {
          v.hp = v.model.hp;
          v.burn = 0;
          this.say("Сервис 67МОТО: байк как новый", "good");
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
    if (spot.kind === "delivery") {
      // Most addresses are a few blocks away, some across town (and pay for it).
      const far = this.r() < 0.3;
      const to = this.randomDoorstep(spot.x, spot.y, far ? 2600 : 900, far ? 5000 : 2600);
      const d = Math.hypot(to.x - spot.x, to.y - spot.y);
      points = [to];
      time = Math.round(d / 165 + 14);
      reward = round100(1500 + d * 2.2);
      const what = ["Запчасти 67МОТО", "Шлем клиенту", "Масло и фильтры", "Цепь и звёзды", "Посылка", "Экипировка"][Math.floor(this.r() * 6)];
      title = `${what}: ${this.map.address(to.x, to.y)}`;
    } else if (spot.kind === "hot") {
      const garages = this.map.places.filter((p) => p.kind === "garage");
      // The workshop that is a proper ride away, but not across the whole city.
      const dist = (g: Place) => Math.hypot(g.x - spot.x, g.y - spot.y);
      const fits = garages.filter((g) => dist(g) > 1500 && dist(g) < 5000);
      const to = (fits.length ? fits : garages).reduce((a, b) => (Math.abs(dist(b) - 3000) < Math.abs(dist(a) - 3000) ? b : a));
      const d = Math.hypot(to.x - spot.x, to.y - spot.y);
      points = [{ x: to.x, y: to.y }];
      time = Math.round(d / 150 + 20);
      reward = round100(8000 + d * 3);
      title = "Горячий груз: довези до сервиса 67МОТО";
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
      reward = round100(6000 + total * 2);
      title = "Уличная гонка: 6 контрольных точек";
    }
    this.job = { kind: spot.kind, spot, points, idx: 0, time, reward, title };
    this.say(`${title} · ${time} с · ${rub(reward)}`, "info");
  }

  failJob(text: string) {
    if (!this.job) return;
    this.job = null;
    this.target = null;
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
      const st = this.map.stadium;
      if (st && p.mode === "ride" && Math.hypot(st.path[0].x - this.px, st.path[0].y - this.py) < 45 && this.jobCooldown <= 0) {
        this.startLap();
        return;
      }
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
    if (job.time <= 0) {
      this.failJob(job.kind === "stadium" ? "Круг не уложился в 2,5 минуты" : "Время вышло — задание провалено");
      return;
    }
    if (job.kind === "phone") {
      this.stepPhoneJob(job);
      return;
    }
    const t = job.points[job.idx];
    const radius = job.kind === "race" ? 50 : job.kind === "stadium" ? 70 : 30;
    if (Math.hypot(t.x - this.px, t.y - this.py) < radius) {
      job.idx++;
      if (job.idx >= job.points.length) {
        if (job.kind === "stadium") {
          const lap = this.time - (job.start ?? this.time);
          const record = !this.bestLap || lap < this.bestLap;
          if (record) this.bestLap = lap;
          this.emit({ type: "lap", time: lap, best: this.bestLap, record });
          this.completeJob(job, record ? 10000 : 0, ` Круг ${lap.toFixed(2)} с${record ? " — новый рекорд стадиона!" : ` (рекорд ${this.bestLap.toFixed(2)} с)`}`);
          // Straight into the next lap.
          this.startLap();
          return;
        }
        const bonus = Math.max(0, Math.floor(job.time)) * 100;
        if (job.kind === "hot" && this.wanted > 0) {
          this.setWanted(0);
          this.heat = 0;
        }
        this.completeJob(job, bonus, bonus ? ` (с бонусом за скорость)` : "");
        return;
      }
      this.emit({ type: "checkpoint" });
    }
  }

  private startLap() {
    const st = this.map.stadium!;
    const spot: JobSpot = { kind: "stadium", x: st.path[0].x, y: st.path[0].y };
    this.job = { kind: "stadium", spot, points: [...st.path.slice(1), st.path[0]], idx: 0, time: 150, reward: 4000, title: "Эндуро-стадион: круг на время", start: this.time };
    this.jobCooldown = 0;
  }

  // ---------- guns ----------

  cycleWeapon() {
    const have = WEAPON_ORDER.filter((w) => (this.arms[w] ?? 0) > 0);
    if (have.length === 0) {
      this.weapon = null;
      return;
    }
    const i = this.weapon ? have.indexOf(this.weapon) : -1;
    this.weapon = have[(i + 1) % have.length];
  }

  private shoot(dt: number, inp: Input) {
    const p = this.player;
    this.fireT = Math.max(0, this.fireT - dt);
    if (inp.swap) this.cycleWeapon();
    if (!inp.fire || this.fireT > 0 || (p.mode !== "ride" && p.mode !== "foot")) return;
    if (!this.weapon) {
      if (this.tick % 90 === 0) this.say("Нет оружия — ищи ящики на улицах", "info");
      return;
    }
    const W = WEAPONS[this.weapon];
    const ammo = this.arms[this.weapon] ?? 0;
    if (ammo <= 0) {
      this.cycleWeapon();
      return;
    }
    this.arms[this.weapon] = ammo - 1;
    this.fireT = 1 / W.rate;
    const src = p.mode === "ride" && p.bike ? p.bike : p.body;
    const reach = p.mode === "ride" && p.bike ? p.bike.model.len / 2 + 3 : 7;
    const x = src.x + Math.cos(src.a) * reach;
    const y = src.y + Math.sin(src.a) * reach;
    for (let i = 0; i < W.pellets; i++) {
      const a = src.a + (this.r() * 2 - 1) * W.spread;
      const sp = W.speed * (W.pellets > 1 ? 0.85 + this.r() * 0.3 : 1);
      this.bullets.push({ x, y, vx: Math.cos(a) * sp + src.vx, vy: Math.sin(a) * sp + src.vy, life: W.range / W.speed, dmg: W.dmg, owner: "player", rocket: W.id === "rocket" });
    }
    this.flashes.push({ x, y, a: src.a, t: 0.05 });
    this.emit({ type: "shot", weapon: W.id, x, y });
    // Gunfire scatters people; a patrol nearby takes note.
    for (const q of this.peds)
      if (q.state === "walk" && Math.abs(q.x - x) < 170 && Math.abs(q.y - y) < 170) {
        q.state = "flee";
        q.t = 2 + this.r() * 2;
        q.a = Math.atan2(q.y - y, q.x - x) + (this.r() - 0.5);
      }
    if (this.vehicles.some((v) => v.police && v.alive && Math.hypot(v.x - x, v.y - y) < 450)) this.crime(0.15, x, y);
    if (this.arms[this.weapon] === 0) {
      this.say(`${W.name}: патроны кончились`, "bad");
      this.cycleWeapon();
    }
  }

  private stepBullets(dt: number) {
    const map = this.map;
    for (const b of this.bullets) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      let rem = Math.min(dt, b.life);
      b.life -= dt;
      while (rem > 0 && b.life > -dt) {
        const h = Math.min(rem, 7 / sp);
        rem -= h;
        b.x += b.vx * h;
        b.y += b.vy * h;
        const tile = map.tileAt(b.x, b.y);
        if (tile === BUILD || map.walls.some((w) => b.x > w.x0 && b.x < w.x1 && b.y > w.y0 && b.y < w.y1)) {
          this.burst(b.x - b.vx * h, b.y - b.vy * h, 3, "spark");
          if (b.rocket) {
            if (b.owner === "remote") this.showBlast(b.x - b.vx * h, b.y - b.vy * h);
            else this.blast(b.x - b.vx * h, b.y - b.vy * h, null, true, 1);
          }
          b.life = -1;
          break;
        }
        if (b.owner === "remote") continue;
        if (b.rocket ? this.rocketHits(b) : this.bulletHits(b)) {
          if (b.rocket) this.blast(b.x, b.y, null, true, 1);
          b.life = -1;
          break;
        }
      }
      if (b.rocket) {
        this.puff(b.x - b.vx * 0.02, b.y - b.vy * 0.02, "smoke", 0.5);
        // Out of range: goes off where it is.
        if (b.life <= 0 && b.life > -1) {
          if (b.owner === "remote") this.showBlast(b.x, b.y);
          else this.blast(b.x, b.y, null, true, 1);
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // Someone else's explosion: fire and noise, no damage (their client sends the hits).
  showBlast(x: number, y: number) {
    this.emit({ type: "explode", x, y });
    this.burst(x, y, 30, "fire");
    this.burst(x, y, 20, "smoke");
    this.burst(x, y, 20, "spark");
  }

  // The other player a shot struck, if any (their bike or their body).
  private remoteAt(x: number, y: number, pad: number) {
    for (const r of this.remotes) {
      if (r.z > 20) continue;
      const rad = r.veh ? 11 : 5.5;
      if (Math.hypot(r.x - x, r.y - y) < rad + pad) return r;
    }
    return null;
  }

  private rocketHits(b: Bullet) {
    const p = this.player;
    if (b.owner === "player" && this.remoteAt(b.x, b.y, 2)) return true;
    for (const v of this.vehicles) if (v !== p.bike && !v.sink && Math.hypot(b.x - v.x, b.y - v.y) < v.model.len / 2 + 3) return true;
    for (const q of this.peds) if (q.state !== "swim" && Math.abs(q.x - b.x) < 6 && Math.abs(q.y - b.y) < 6) return true;
    return false;
  }

  private bulletHits(b: Bullet) {
    const p = this.player;
    if (b.owner === "player") {
      const r = this.remoteAt(b.x, b.y, 0);
      if (r) {
        this.burst(b.x, b.y, 4, "spark");
        if (this.canHit(r)) this.emit({ type: "pvpHit", uid: r.uid, dmg: b.dmg, weapon: this.weapon ?? "" });
        return true;
      }
    }
    for (const v of this.vehicles) {
      if (v.sink || (b.owner === "player" && v === p.bike) || (b.owner === "police" && v.police)) continue;
      const reach = v.model.len / 2 + 2;
      if (Math.abs(b.x - v.x) > reach || Math.abs(b.y - v.y) > reach) continue;
      const fx = Math.cos(v.a);
      const fy = Math.sin(v.a);
      let hit = false;
      for (const [o, r] of v.circles) if (Math.hypot(b.x - v.x - fx * o, b.y - v.y - fy * o) < r + 1) hit = true;
      if (!hit) continue;
      this.burst(b.x, b.y, 4, "spark");
      v.hit = 0.12;
      v.vx += b.vx * 0.004 * (v.bike ? 3 : 1);
      v.vy += b.vy * 0.004 * (v.bike ? 3 : 1);
      if (v.rider === "player") {
        this.hurt(b.dmg);
        this.damage(v, b.dmg * 0.3);
        return true;
      }
      this.damage(v, b.dmg * (v.bike ? 0.8 : 0.55));
      if (b.owner === "player") {
        if (v.bike && v.rider === "npc" && this.r() < 0.45) this.throwRider(v, 0);
        else if (!v.bike && v.rider === "npc" && v.hp < v.model.hp * 0.4 && !v.police) this.bail(v);
        if (v.police && v.alive) this.crime(1, b.x, b.y);
      }
      return true;
    }
    for (const q of this.peds) {
      if (q.state === "swim" || q.state === "fly" || q.state === "down") continue;
      if (Math.abs(q.x - b.x) > 5 || Math.abs(q.y - b.y) > 5) continue;
      this.knock(q, b.vx * 0.12, b.vy * 0.12);
      q.t = 10 + this.r() * 8;
      if (b.owner === "player") this.crime(1, q.x, q.y);
      return true;
    }
    if (b.owner === "police" && (p.mode === "foot" || p.mode === "fly")) {
      if (Math.abs(p.body.x - b.x) < 5.5 && Math.abs(p.body.y - b.y) < 5.5) {
        this.hurt(b.dmg);
        return true;
      }
    }
    return false;
  }

  // Other players are solid: bikes push each other; a hard ram with PvP on knocks the rider off.
  private collideRemotes() {
    const p = this.player;
    if (p.mode === "out") return;
    const me = p.mode === "ride" && p.bike ? p.bike : null;
    const mx = me ? me.x : p.body.x;
    const my = me ? me.y : p.body.y;
    const mz = me ? me.z : 0;
    const mr = me ? 9 : 4.5;
    for (const r of this.remotes) {
      if (Math.abs(r.z - mz) > 10) continue;
      const rr = r.veh ? 9 : 4.5;
      let nx = mx - r.x;
      let ny = my - r.y;
      const d = Math.hypot(nx, ny);
      const pen = mr + rr - d;
      if (pen <= 0 || d === 0) continue;
      nx /= d;
      ny /= d;
      const mvx = me ? me.vx : p.body.vx;
      const mvy = me ? me.vy : p.body.vy;
      const vn = (mvx - r.vx) * nx + (mvy - r.vy) * ny;
      const body = me ?? p.body;
      body.x += nx * pen;
      body.y += ny * pen;
      if (vn < 0) {
        // Bounce off them (they are as heavy as us).
        body.vx -= vn * nx * 1.1;
        body.vy -= vn * ny * 1.1;
      }
      const hard = Math.max(-vn, Math.hypot(r.vx, r.vy) * 0.6);
      if (!this.canHit(r) || hard < 120) continue;
      this.lastHitBy = { uid: r.uid, t: this.time };
      if (me) {
        this.emit({ type: "crash", power: hard, x: mx, y: my });
        this.throwRider(me, hard);
      } else if (r.veh) {
        this.hurt(hard * 0.12);
        p.mode = "fly";
        p.body.state = "fly";
        p.body.vx = r.vx * 0.8 + nx * 50;
        p.body.vy = r.vy * 0.8 + ny * 50;
        p.body.spin = 9;
        p.getup = 0;
      }
    }
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
    for (const f of this.flashes) f.t -= dt;
    this.flashes = this.flashes.filter((f) => f.t > 0);
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

