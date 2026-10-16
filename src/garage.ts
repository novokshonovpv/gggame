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
    desc: "Мягче приземления, меньше отскок",
    apply: (s, l) => {
      s.suspensionHz = BASE_STATS.suspensionHz - 0.14 * l;
      s.suspensionDamping = BASE_STATS.suspensionDamping + 0.04 * l;
    },
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
  { id: "factory", name: "Заводская", price: 0, look: { ...PLAYER_LOOK } },
  {
    id: "lime",
    name: "Лайм",
    price: 150,
    look: { plastic: "#b8e024", plasticDark: "#7fa30f", jersey: "#1d1f22", jerseyDark: "#0f1012", pants: "#b8e024", helmet: "#1d1f22", visor: "#b8e024" },
  },
  {
    id: "ice",
    name: "Лёд",
    price: 150,
    look: { plastic: "#f2f5f8", plasticDark: "#b9c6d3", jersey: "#2d7be0", jerseyDark: "#1c56a3", pants: "#f2f5f8", helmet: "#2d7be0", visor: "#f2f5f8" },
  },
  {
    id: "violet",
    name: "Неон",
    price: 250,
    look: { plastic: "#8b4dff", plasticDark: "#5d2ccc", jersey: "#ff4fa3", jerseyDark: "#c2306f", pants: "#1d1430", helmet: "#ff4fa3", visor: "#8b4dff" },
  },
  {
    id: "orange",
    name: "Оранж",
    price: 250,
    look: { plastic: "#ff7a00", plasticDark: "#c25700", jersey: "#1f1f24", jerseyDark: "#111114", pants: "#ff7a00", helmet: "#f4f4f4", visor: "#ff7a00" },
  },
  {
    id: "gold",
    name: "Чемпион",
    price: 600,
    look: { plastic: "#d9b23a", plasticDark: "#a07f1c", jersey: "#151515", jerseyDark: "#0a0a0a", pants: "#d9b23a", helmet: "#d9b23a", visor: "#151515" },
  },
];

export interface Profile {
  coins: number;
  levels: Record<UpgradeId, number>;
  paint: string;
  owned: string[];
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

export function saveProfile(p: Profile) {
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
  return { ...paint.look, name: PLAYER_LOOK.name };
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
