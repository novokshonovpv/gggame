import { BASE_STATS, type BikeStats } from "./bike.ts";
import { PLAYER_LOOK, type Look } from "./race.ts";

// Player progression: coins from races, bike upgrades and paint jobs.

export type UpgradeId = "engine" | "grip" | "suspension" | "air";

export interface Upgrade {
  id: UpgradeId;
  name: string;
  desc: string;
  apply(s: BikeStats, level: number): void;
}

export const MAX_LEVEL = 5;
const COSTS = [120, 220, 350, 500, 700]; // price of the next level, by current level

export const UPGRADES: Upgrade[] = [
  {
    id: "engine",
    name: "Двигатель",
    desc: "Разгон и максимальная скорость",
    apply: (s, l) => (s.power = 1 + 0.035 * l),
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
    apply: (s, l) => (s.airSpin = BASE_STATS.airSpin + 0.3 * l),
  },
];

export interface Paint {
  id: string;
  name: string;
  price: number;
  look: Omit<Look, "name">;
}

export const PAINTS: Paint[] = [
  { id: "factory", name: "T5 Yellow", price: 0, look: { ...PLAYER_LOOK } },
  // BSE T5 factory colorways (black, Factory Blue, Factory Grey with the orange frame).
  {
    id: "black",
    name: "T5 Black",
    price: 150,
    look: { plastic: "#1d1d20", plasticDark: "#111113", accent: "#f4d10f", frame: "#1a1a1c", jersey: "#26262b", jerseyDark: "#141417", pants: "#f4d10f", helmet: "#1d1d20", visor: "#f4d10f" },
  },
  {
    id: "factoryBlue",
    name: "Factory Blue",
    price: 350,
    look: { plastic: "#18306a", plasticDark: "#0e1a3a", accent: "#2f7fe0", frame: "#e8641e", jersey: "#18306a", jerseyDark: "#0e1a3a", pants: "#f2f2f2", helmet: "#2f7fe0", visor: "#e8641e" },
  },
  {
    id: "factoryGrey",
    name: "Factory Grey",
    price: 350,
    look: { plastic: "#3b3e44", plasticDark: "#1f2124", accent: "#f2f2f2", frame: "#e8641e", jersey: "#2b2d31", jerseyDark: "#1a1b1e", pants: "#e8641e", helmet: "#f2f2f2", visor: "#e8641e" },
  },
  {
    id: "lime",
    name: "Лайм",
    price: 150,
    look: { plastic: "#b8e024", plasticDark: "#1d1f22", accent: "#1d1f22", jersey: "#1d1f22", jerseyDark: "#0f1012", pants: "#b8e024", helmet: "#1d1f22", visor: "#b8e024" },
  },
  {
    id: "ice",
    name: "Лёд",
    price: 150,
    look: { plastic: "#f2f5f8", plasticDark: "#1c56a3", accent: "#2d7be0", jersey: "#2d7be0", jerseyDark: "#1c56a3", pants: "#f2f5f8", helmet: "#2d7be0", visor: "#f2f5f8" },
  },
  {
    id: "violet",
    name: "Неон",
    price: 250,
    look: { plastic: "#8b4dff", plasticDark: "#1d1430", accent: "#ff4fa3", frame: "#1d1430", jersey: "#ff4fa3", jerseyDark: "#c2306f", pants: "#1d1430", helmet: "#ff4fa3", visor: "#8b4dff" },
  },
  {
    id: "orange",
    name: "Оранж",
    price: 250,
    look: { plastic: "#ff7a00", plasticDark: "#1f1f24", accent: "#1f1f24", frame: "#ff7a00", jersey: "#1f1f24", jerseyDark: "#111114", pants: "#ff7a00", helmet: "#f4f4f4", visor: "#ff7a00" },
  },
  {
    id: "gold",
    name: "Чемпион",
    price: 600,
    look: { plastic: "#d9b23a", plasticDark: "#151515", accent: "#151515", frame: "#d9b23a", jersey: "#151515", jerseyDark: "#0a0a0a", pants: "#d9b23a", helmet: "#d9b23a", visor: "#151515" },
  },
];

export interface Profile {
  coins: number;
  levels: Record<UpgradeId, number>;
  paint: string;
  owned: string[];
  updatedAt?: number;
}

const KEY = "profile";

export function loadProfile(): Profile {
  const fresh: Profile = { coins: 0, levels: { engine: 0, grip: 0, suspension: 0, air: 0 }, paint: "factory", owned: ["factory"] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Profile>;
    return { ...fresh, ...p, levels: { ...fresh.levels, ...p.levels }, owned: p.owned ?? fresh.owned };
  } catch {
    return fresh;
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

export function statsFor(p: Profile): BikeStats {
  const s = { ...BASE_STATS };
  for (const u of UPGRADES) u.apply(s, p.levels[u.id]);
  return s;
}

export function lookFor(p: Profile): Look {
  const paint = PAINTS.find((x) => x.id === p.paint) ?? PAINTS[0];
  return { ...paint.look, name: PLAYER_LOOK.name, number: PLAYER_LOOK.number };
}

// Race payout: by finishing place, plus a bonus per mission completed for the first time.
const PLACE_REWARD = [100, 70, 50, 30];
export const MISSION_REWARD = 60;
export const RECORD_REWARD = 25;

export function raceReward(place: number, newMissions: number, record: boolean) {
  const parts: [string, number][] = [[`${place}-е место`, PLACE_REWARD[place - 1] ?? 20]];
  if (newMissions) parts.push([`Задания ×${newMissions}`, newMissions * MISSION_REWARD]);
  if (record) parts.push(["Рекорд трассы", RECORD_REWARD]);
  return { parts, total: parts.reduce((s, [, v]) => s + v, 0) };
}
