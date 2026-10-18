import { BASE_STATS, type BikeStats } from "./bike.ts";
import { type BikeClass, GEAR, type GearSlot, PAINTS, STOCK_GEAR, bikeSpec, gearItem } from "./catalog.ts";
import { PLAYER_LOOK, type Look } from "./race.ts";

// Player progression: coins, owned bikes, upgrades, bike paint and riding gear, nickname.

export type UpgradeId = "engine" | "grip" | "suspension" | "air";

export interface Upgrade {
  id: UpgradeId;
  name: string;
  desc: string;
  apply(s: BikeStats, level: number): void;
}

export const MAX_LEVEL = 5;
const COSTS = [150, 300, 500, 750, 1100]; // price of the next level, by current level

// Upgrades belong to the rider and carry over to every bike; they scale the bike's own numbers.
export const UPGRADES: Upgrade[] = [
  {
    id: "engine",
    name: "Двигатель",
    desc: "Разгон и максимальная скорость",
    apply: (s, l) => (s.power *= 1 + 0.035 * l),
  },
  {
    id: "grip",
    name: "Резина",
    desc: "Сцепление на подъёмах и при разгоне",
    apply: (s, l) => (s.grip = BASE_STATS.grip + 0.12 * l),
  },
  {
    id: "suspension",
    name: "Подвеска",
    desc: "Меньше отскок и раскачка после прыжков",
    apply: (s, l) => (s.suspensionDamping = Math.min(1, BASE_STATS.suspensionDamping + 0.02 * l)),
  },
  {
    id: "air",
    name: "Баланс",
    desc: "Быстрее вращение в воздухе",
    apply: (s, l) => (s.airSpin += 0.3 * l),
  },
];

export interface Profile {
  coins: number;
  levels: Record<UpgradeId, number>;
  bike: BikeClass; // the bike you ride
  bikes: BikeClass[]; // bikes you own
  paint: string;
  owned: string[]; // paints and gear items you own
  gear: Record<GearSlot, string>; // gear you wear
  difficulty: number; // last chosen difficulty level
  daily?: { day: string; streak: number }; // last daily reward claimed (local date) and streak
  nick?: string;
  updatedAt?: number;
}

const KEY = "profile";

export function freshProfile(): Profile {
  return {
    coins: 0,
    levels: { engine: 0, grip: 0, suspension: 0, air: 0 },
    bike: "250",
    bikes: ["250"],
    paint: "factory",
    owned: ["factory", ...Object.values(STOCK_GEAR)],
    gear: { ...STOCK_GEAR },
    difficulty: 0,
  };
}

// Fills in whatever an older save (or another device) lacks.
export function normalize(p: Partial<Profile>): Profile {
  const f = freshProfile();
  const owned = [...new Set([...f.owned, ...(p.owned ?? [])])];
  const bikes = [...new Set([...f.bikes, ...(p.bikes ?? [])])];
  const gear = { ...f.gear, ...p.gear };
  for (const slot of Object.keys(gear) as GearSlot[]) if (!owned.includes(gear[slot]) || !gearItem(gear[slot])) gear[slot] = f.gear[slot];
  return {
    ...f,
    ...p,
    levels: { ...f.levels, ...p.levels },
    owned,
    bikes,
    gear,
    bike: p.bike && bikes.includes(p.bike) ? p.bike : "250",
    paint: p.paint && owned.includes(p.paint) && PAINTS.some((x) => x.id === p.paint) ? p.paint : "factory",
    difficulty: Math.max(0, Math.min(4, p.difficulty ?? 0)),
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return normalize(raw ? (JSON.parse(raw) as Partial<Profile>) : {});
  } catch {
    return freshProfile();
  }
}

// `updatedAt` decides which device's coin balance wins when cloud save merges profiles.
export function saveProfile(p: Profile, updatedAt = Date.now()) {
  p.updatedAt = updatedAt;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* progress just won't persist */
  }
}

export function upgradeCost(level: number) {
  return level >= MAX_LEVEL ? null : COSTS[level];
}

// Physics numbers for the chosen bike with the rider's upgrades.
export function statsFor(p: Profile): BikeStats {
  const spec = bikeSpec(p.bike);
  const s = { ...BASE_STATS, power: spec.power, airSpin: BASE_STATS.airSpin + spec.airSpin };
  for (const u of UPGRADES) u.apply(s, p.levels[u.id]);
  return s;
}

// The player's bike paint and riding gear.
export function lookFor(p: Profile): Look {
  const paint = PAINTS.find((x) => x.id === p.paint) ?? PAINTS[0];
  const item = (slot: GearSlot) => gearItem(p.gear[slot]) ?? gearItem(STOCK_GEAR[slot])!;
  const spec = bikeSpec(p.bike);
  return {
    ...PLAYER_LOOK,
    plastic: paint.plastic,
    plasticDark: paint.plasticDark,
    accent: paint.accent,
    frame: paint.frame,
    jersey: item("jersey").color,
    jerseyDark: item("jersey").color2,
    pants: item("pants").color,
    helmet: item("helmet").color,
    visor: item("helmet").color2,
    boots: item("boots").color,
    brand: spec.brand,
    model: spec.model,
  };
}

export { GEAR };

// ---------- Daily free reward ----------
//
// Once per calendar day; coming back on consecutive days climbs the ladder, a missed day
// starts it again. A week of play earns 2 000 coins: a little more than one first-pass
// Iron track, so it helps without replacing racing.
export const DAILY_REWARDS = [100, 150, 200, 250, 300, 400, 600];

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function dailyState(p: Profile, now = new Date()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const last = p.daily;
  const claimed = last?.day === today;
  const streak = claimed ? last!.streak : last?.day === yesterday ? last.streak + 1 : 1;
  const reward = DAILY_REWARDS[Math.min(streak, DAILY_REWARDS.length) - 1];
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { claimed, streak, reward, msLeft: tomorrow.getTime() - now.getTime() };
}

export function claimDaily(p: Profile, now = new Date()) {
  const s = dailyState(p, now);
  if (s.claimed) return 0;
  p.daily = { day: dayKey(now), streak: s.streak };
  p.coins += s.reward;
  return s.reward;
}

// ---------- Rider level ----------
// Grows with leaderboard points: level n needs 50·(n−1)² points.
export function riderLevel(points: number) {
  const level = Math.floor(Math.sqrt(points / 50)) + 1;
  const from = 50 * (level - 1) ** 2;
  const to = 50 * level ** 2;
  return { level, from, to, progress: (points - from) / (to - from) };
}
