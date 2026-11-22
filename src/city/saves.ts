// Three save slots in the browser (localStorage), like the save games of the old city
// games. The first city save (moto-city-v2, before slots) moves into slot 1.

import { BIKE, BIKES, WEAPONS, type WeaponId } from "./sim.ts";

export interface Save {
  money: number;
  earned: number; // all money ever made (the leaderboard)
  owned: string[];
  bike: string;
  arms: Partial<Record<WeaponId, number>>;
  bestLap: number;
  packages: number[];
  helmet: string;
  jacket: string;
  playTime: number; // seconds
  savedAt: number; // ms since 1970, 0 = never played
}

export const SLOTS = 3;
const KEY = (i: number) => `moto-city-slot-${i}`;
const ACTIVE = "moto-city-active";
const V2 = "moto-city-v2";
const V1 = "moto-city-v1";
const SHOP_IDS = new Set(BIKES.map((b) => b.id));

export const HELMETS = ["#ff7a1a", "#e53935", "#1e88e5", "#43a047", "#fdd835", "#f4f4f4", "#212121", "#8e24aa"];
export const JACKETS = ["#1d1d1f", "#5d4037", "#b71c1c", "#0d47a1", "#1b5e20", "#e0e0e0", "#ef6c00", "#4a148c"];

export const fresh = (): Save => ({
  money: 0,
  earned: 0,
  owned: ["z3"],
  bike: "z3",
  arms: {},
  bestLap: 0,
  packages: [],
  helmet: HELMETS[0],
  jacket: JACKETS[0],
  playTime: 0,
  savedAt: 0,
});

function clean(s: Partial<Save> | null): Save | null {
  if (!s || typeof s !== "object") return null;
  const def = fresh();
  const arms: Save["arms"] = {};
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const n = Math.floor(Number(s.arms?.[id]) || 0);
    if (n > 0) arms[id] = n;
  }
  const money = Math.max(0, Math.floor(Number(s.money) || 0));
  return {
    money,
    earned: Math.max(money, Math.floor(Number(s.earned) || 0)),
    owned: Array.isArray(s.owned) ? [...new Set([...def.owned, ...s.owned.filter((id) => SHOP_IDS.has(id))])] : def.owned,
    bike: s.bike && SHOP_IDS.has(s.bike) && BIKE[s.bike] ? s.bike : def.bike,
    arms,
    bestLap: Math.max(0, Number(s.bestLap) || 0),
    packages: Array.isArray(s.packages) ? s.packages.filter((i) => Number.isInteger(i) && i >= 0 && i < 100) : [],
    helmet: HELMETS.includes(s.helmet ?? "") ? s.helmet! : def.helmet,
    jacket: JACKETS.includes(s.jacket ?? "") ? s.jacket! : def.jacket,
    playTime: Math.max(0, Number(s.playTime) || 0),
    savedAt: Math.max(0, Number(s.savedAt) || 0),
  };
}

const read = (key: string) => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Save> | null;
  } catch {
    return null;
  }
};

// Moves the pre-slot save into slot 1 once.
function migrate() {
  if (read(KEY(1))) return;
  const v2 = clean(read(V2));
  if (v2) {
    v2.savedAt = v2.savedAt || Date.now();
    write(1, v2);
    return;
  }
  const v1 = read(V1) as { money?: number } | null;
  if (v1) {
    const s = fresh();
    s.money = Math.max(0, Math.floor(Number(v1.money) || 0)) * 50;
    s.earned = s.money;
    s.savedAt = Date.now();
    write(1, s);
  }
}

export function loadSlot(i: number): Save | null {
  return clean(read(KEY(i)));
}

export function write(i: number, s: Save) {
  try {
    localStorage.setItem(KEY(i), JSON.stringify(s));
  } catch {
    /* private mode: lives only in this tab */
  }
}

export function removeSlot(i: number) {
  try {
    localStorage.removeItem(KEY(i));
  } catch {
    /* nothing */
  }
}

export function activeSlot() {
  migrate();
  try {
    const n = Number(localStorage.getItem(ACTIVE));
    return n >= 1 && n <= SLOTS ? n : 1;
  } catch {
    return 1;
  }
}

export function setActive(i: number) {
  try {
    localStorage.setItem(ACTIVE, String(i));
  } catch {
    /* fine */
  }
}

export const NICK_KEY = "moto-city-nick";
export function localNick() {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}
export function setLocalNick(n: string) {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {
    /* fine */
  }
}
