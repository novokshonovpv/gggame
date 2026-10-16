import { type Profile, loadProfile, saveProfile } from "./garage.ts";
import { TRACKS } from "./track.ts";

// Everything a player has earned, in one object: what cloud save uploads and merges.
// (Ghost replays are large and synced separately, see cloud.ts.)
export interface Snapshot {
  profile: Profile;
  missions: Record<string, boolean[]>; // per track, which missions are done
  best: Record<string, number>; // per track, best time in seconds
}

function read<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}

function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function collectLocal(): Snapshot {
  const s: Snapshot = { profile: loadProfile(), missions: {}, best: {} };
  for (const t of TRACKS) {
    const m = read<boolean[]>(`missions:${t.id}`);
    if (m) s.missions[t.id] = m;
    const b = read<number>(`best:${t.id}`);
    if (typeof b === "number") s.best[t.id] = b;
  }
  return s;
}

export function applyLocal(s: Snapshot) {
  saveProfile(s.profile, s.profile.updatedAt ?? Date.now());
  for (const [id, m] of Object.entries(s.missions)) write(`missions:${id}`, m);
  for (const [id, b] of Object.entries(s.best)) write(`best:${id}`, b);
}

// Combines two devices' progress without losing anything earned:
// purchases and upgrades are united, missions OR-ed, best times take the minimum.
// Coins can go down when spent, so the balance comes from the most recently saved profile.
export function merge(a: Snapshot, b: Snapshot): Snapshot {
  const newer = (a.profile.updatedAt ?? 0) >= (b.profile.updatedAt ?? 0) ? a.profile : b.profile;
  const levels = { ...newer.levels };
  for (const k of Object.keys(levels) as (keyof typeof levels)[])
    levels[k] = Math.max(a.profile.levels[k] ?? 0, b.profile.levels[k] ?? 0);
  const owned = [...new Set([...a.profile.owned, ...b.profile.owned])];
  const profile: Profile = {
    ...newer,
    levels,
    owned,
    paint: owned.includes(newer.paint) ? newer.paint : "factory",
    updatedAt: Math.max(a.profile.updatedAt ?? 0, b.profile.updatedAt ?? 0),
  };

  const missions: Record<string, boolean[]> = {};
  for (const id of new Set([...Object.keys(a.missions), ...Object.keys(b.missions)])) {
    const x = a.missions[id] ?? [];
    const y = b.missions[id] ?? [];
    missions[id] = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => !!(x[i] || y[i]));
  }

  const best: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a.best), ...Object.keys(b.best)])) {
    const times = [a.best[id], b.best[id]].filter((v): v is number => typeof v === "number");
    best[id] = Math.min(...times);
  }
  return { profile, missions, best };
}
