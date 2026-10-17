// What the game sells and how hard it gets: bikes by engine class, difficulty levels, bike
// paints and riding gear, plus the economy (rewards) and leaderboard points.

// ---------- Bikes ----------

export type BikeClass = "125" | "250" | "300" | "450";

export interface BikeSpec {
  id: BikeClass; // stable key for saves and leaderboards
  label: string; // class as shown to players
  name: string;
  brand: string; // big lettering on the shrouds
  model: string; // small lettering on the radiator scoop
  desc: string;
  price: number;
  power: number; // engine multiplier (rivals in this class get the same)
  airSpin: number; // added to the rotation rate in the air
  twoStroke: boolean; // engine sound
  reward: number; // coin multiplier
  points: number; // leaderboard points multiplier
  timeFactor: number; // par time multiplier for time missions
}

export const BIKES: BikeSpec[] = [
  { id: "125", label: "125", name: "BSE EX 125", brand: "BSE", model: "EX", desc: "Лёгкий и вёрткий: слабее, но быстрее всех вращается в воздухе", price: 1200, power: 0.9, airSpin: 0.6, twoStroke: false, reward: 0.9, points: 0.9, timeFactor: 1.05 },
  { id: "250", label: "250", name: "BSE Z3 250", brand: "BSE", model: "Z3", desc: "Надёжный четырёхтактник, с него начинают все", price: 0, power: 1, airSpin: 0, twoStroke: false, reward: 1, points: 1, timeFactor: 1 },
  { id: "300", label: "300", name: "BSE T5 300", brand: "BSE", model: "T5", desc: "Мощный четырёхтактный эндуро: больше тяги на подъёмах и в разгоне", price: 8000, power: 1.1, airSpin: -0.15, twoStroke: false, reward: 1.15, points: 1.2, timeFactor: 0.95 },
  { id: "450", label: "300 2T", name: "BSE 2T 300", brand: "BSE", model: "2T", desc: "Двухтактный и самый мощный: резкий подхват, нужна точная работа корпусом", price: 20000, power: 1.2, airSpin: -0.35, twoStroke: true, reward: 1.3, points: 1.4, timeFactor: 0.91 },
];

export const bikeSpec = (id: string) => BIKES.find((b) => b.id === id) ?? BIKES[1];

// ---------- Difficulty ----------

export interface Difficulty {
  id: number;
  name: string;
  color: string;
  rivals: [number, number, number]; // rival engine shares (times the class power)
  wobble: number; // rivals' landing misjudgement, radians: bigger = more mistakes
  place: number; // the place mission: finish this place or better
  time: number; // time mission: par time multiplier
  reward: number; // coin multiplier
  points: number; // leaderboard points multiplier
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 0, name: "Железо", color: "#9aa3ab", rivals: [0.66, 0.6, 0.55], wobble: 0.6, place: 3, time: 1.45, reward: 1, points: 1 },
  { id: 1, name: "Бронза", color: "#cd8a4a", rivals: [0.8, 0.75, 0.69], wobble: 0.45, place: 2, time: 1.3, reward: 1.6, points: 2 },
  { id: 2, name: "Серебро", color: "#c9d1db", rivals: [0.93, 0.88, 0.82], wobble: 0.32, place: 1, time: 1.18, reward: 2.5, points: 3.5 },
  { id: 3, name: "Золото", color: "#f2c94c", rivals: [1.03, 0.99, 0.94], wobble: 0.2, place: 1, time: 1.08, reward: 4, points: 5.5 },
  { id: 4, name: "Профи", color: "#ff5a45", rivals: [1.13, 1.1, 1.06], wobble: 0.08, place: 1, time: 1.0, reward: 6, points: 8 },
];

// One leaderboard per track, difficulty and bike class.
export const boardId = (track: string, diff: number, cls: BikeClass) => `${track}_${diff}_${cls}`;

// ---------- Bike paints ----------

export interface Paint {
  id: string;
  name: string;
  price: number;
  plastic: string;
  plasticDark: string;
  accent?: string;
  frame?: string;
}

export const PAINTS: Paint[] = [
  { id: "factory", name: "Жёлтый", price: 0, plastic: "#f4d10f", plasticDark: "#1b1b1d", accent: "#1b1b1d", frame: "#202022" },
  { id: "black", name: "Чёрный", price: 200, plastic: "#1d1d20", plasticDark: "#111113", accent: "#f4d10f", frame: "#1a1a1c" },
  { id: "lime", name: "Лайм", price: 200, plastic: "#b8e024", plasticDark: "#1d1f22", accent: "#1d1f22" },
  { id: "ice", name: "Лёд", price: 200, plastic: "#f2f5f8", plasticDark: "#1c56a3", accent: "#2d7be0" },
  { id: "red", name: "Красный", price: 250, plastic: "#d8312b", plasticDark: "#1c1c1f", accent: "#f2f2f2", frame: "#1c1c1f" },
  { id: "violet", name: "Неон", price: 300, plastic: "#8b4dff", plasticDark: "#1d1430", accent: "#ff4fa3", frame: "#1d1430" },
  { id: "orange", name: "Оранж", price: 300, plastic: "#ff7a00", plasticDark: "#1f1f24", accent: "#1f1f24", frame: "#ff7a00" },
  { id: "factoryBlue", name: "Заводской синий", price: 450, plastic: "#18306a", plasticDark: "#0e1a3a", accent: "#2f7fe0", frame: "#e8641e" },
  { id: "factoryGrey", name: "Заводской серый", price: 450, plastic: "#3b3e44", plasticDark: "#1f2124", accent: "#f2f2f2", frame: "#e8641e" },
  { id: "camo", name: "Хаки", price: 500, plastic: "#5d6b3a", plasticDark: "#2b3020", accent: "#d8d0a8", frame: "#2b3020" },
  { id: "gold", name: "Чемпион", price: 900, plastic: "#d9b23a", plasticDark: "#151515", accent: "#151515", frame: "#d9b23a" },
];

// ---------- Riding gear ----------

export type GearSlot = "jersey" | "pants" | "helmet" | "boots";

export interface GearItem {
  id: string; // unique across slots
  slot: GearSlot;
  name: string;
  price: number;
  color: string; // main color (jersey, pants, helmet shell, boots)
  color2: string; // second color (jersey cuffs/panels, helmet visor/goggles, boots trim)
}

export const GEAR_SLOTS: { slot: GearSlot; name: string }[] = [
  { slot: "jersey", name: "Джерси" },
  { slot: "pants", name: "Штаны" },
  { slot: "helmet", name: "Шлем" },
  { slot: "boots", name: "Мотоботы" },
];

const g = (slot: GearSlot, key: string, name: string, price: number, color: string, color2: string): GearItem => ({ id: `${slot}:${key}`, slot, name, price, color, color2 });

export const GEAR: GearItem[] = [
  g("jersey", "blue", "Синяя", 0, "#1f5fbf", "#163f80"),
  g("jersey", "black", "Чёрная", 150, "#26262b", "#141417"),
  g("jersey", "white", "Белая", 150, "#eef0f3", "#b9c2cc"),
  g("jersey", "red", "Красная", 200, "#d33a2f", "#8f1f19"),
  g("jersey", "green", "Зелёная", 200, "#2f9e55", "#1b6136"),
  g("jersey", "orange", "Оранжевая", 250, "#ff7a00", "#b45400"),
  g("jersey", "pink", "Неон", 300, "#ff4fa3", "#c2306f"),
  g("jersey", "gold", "Золотая", 600, "#d9b23a", "#8c6d16"),

  g("pants", "blue", "Синие", 0, "#1f5fbf", "#163f80"),
  g("pants", "black", "Чёрные", 120, "#26262b", "#141417"),
  g("pants", "white", "Белые", 150, "#eef0f3", "#b9c2cc"),
  g("pants", "grey", "Серые", 150, "#6c727b", "#3e434a"),
  g("pants", "red", "Красные", 200, "#d33a2f", "#8f1f19"),
  g("pants", "yellow", "Жёлтые", 200, "#f4d10f", "#b39500"),
  g("pants", "orange", "Оранжевые", 250, "#ff7a00", "#b45400"),
  g("pants", "gold", "Золотые", 500, "#d9b23a", "#8c6d16"),

  g("helmet", "white", "Белый", 0, "#f2f2f2", "#f4d10f"),
  g("helmet", "black", "Чёрный матовый", 200, "#1d1d20", "#f4d10f"),
  g("helmet", "red", "Красный", 250, "#e23b3b", "#f2f2f2"),
  g("helmet", "blue", "Синий", 250, "#2d7be0", "#f2f2f2"),
  g("helmet", "lime", "Лайм", 300, "#b8e024", "#1d1f22"),
  g("helmet", "orange", "Оранжевый", 300, "#ff7a00", "#1d1d20"),
  g("helmet", "chrome", "Хром", 600, "#c9cfd6", "#2fd0ff"),
  g("helmet", "gold", "Золотой", 800, "#d9b23a", "#151515"),

  g("boots", "white", "Белые", 0, "#ececec", "#1b1b1d"),
  g("boots", "black", "Чёрные", 100, "#1d1d20", "#5a5f66"),
  g("boots", "grey", "Серые", 120, "#7a8088", "#1d1d20"),
  g("boots", "red", "Красные", 180, "#d33a2f", "#1d1d20"),
  g("boots", "blue", "Синие", 180, "#2d7be0", "#1d1d20"),
  g("boots", "yellow", "Жёлтые", 220, "#f4d10f", "#1d1d20"),
  g("boots", "gold", "Золотые", 450, "#d9b23a", "#151515"),
];

export const STOCK_GEAR: Record<GearSlot, string> = { jersey: "jersey:blue", pants: "pants:blue", helmet: "helmet:white", boots: "boots:white" };
export const gearItem = (id: string) => GEAR.find((x) => x.id === id);

// ---------- Economy ----------
//
// Coins per race, by difficulty (Железо → Профи) for the stock 250:
//   place 1/2/3/4:        100/60/40/20 × 1, 1.6, 2.5, 4, 6
//   each new star (5):     40 × the same multipliers (40 … 240)
//   first win on a level: 150 × the same (150 … 900), which also opens the next level
//   new personal best:     20 × the same
// Bigger classes pay more (125 ×0.9, 300 ×1.15, 300 2T ×1.3).
// A full first pass over the 13 tracks earns about 5.9k on Железо, 9.4k on Бронза,
// 14.6k on Серебро, 23k on Золото and 35k on Профи: about 88k in all. Everything in the
// shop costs about 55k (bikes 29k, upgrades 11k, paints 3k, gear 9k), so after Серебро
// you can afford the T5 300 and some upgrades, and the 2T 300 around Золото.

export const PLACE_REWARD = [100, 60, 40, 20];
export const STAR_REWARD = 40;
export const WIN_BONUS = 150;
export const RECORD_REWARD = 20;

export function rewardScale(diff: number, cls: BikeClass) {
  return DIFFICULTIES[diff].reward * bikeSpec(cls).reward;
}

// ---------- Leaderboard points ----------
//
// Every board (track × level × class) scores once, for your best place there:
//   1st 100, 2nd 60, 3rd 40, 4th 25 points × level (1, 2, 3.5, 5.5, 8) × class (0.9 … 1.4),
// and every star scores 10 × the level multiplier. The overall table ranks the sum.

const PLACE_POINTS = [100, 60, 40, 25];

export function boardPoints(place: number, diff: number, cls: BikeClass) {
  return Math.round((PLACE_POINTS[place - 1] ?? 0) * DIFFICULTIES[diff].points * bikeSpec(cls).points);
}

export function starPoints(diff: number) {
  return 10 * DIFFICULTIES[diff].points;
}
