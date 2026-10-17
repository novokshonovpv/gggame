import { BIKES, type BikeClass, DIFFICULTIES, boardId, boardPoints, starPoints } from "./catalog.ts";
import { type Profile, loadProfile, normalize, saveProfile } from "./garage.ts";
import { TRACKS, type Track } from "./track.ts";

// Everything a player has earned, in one object: what cloud save uploads and merges.
// (Ghost replays are large and synced separately, see cloud.ts.)
export interface Snapshot {
  profile: Profile;
  missions: Record<string, boolean[]>; // per track and level ("forest:0"), which missions are done
  best: Record<string, number>; // per board (track_level_class), best time in seconds
  places?: Record<string, number>; // per board, best finishing place
  wins?: Record<string, number>; // per track, the highest level won
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

// ---------- Per-track progress in localStorage ----------

export const missionKey = (t: Track, diff: number) => `${t.id}:${diff}`;
export const missionsDone = (t: Track, diff: number) => read<boolean[]>(`missions:${missionKey(t, diff)}`) ?? [];
export const setMissionsDone = (t: Track, diff: number, done: boolean[]) => write(`missions:${missionKey(t, diff)}`, done);
export const bestTime = (board: string) => read<number>(`best:${board}`);
export const setBestTime = (board: string, time: number) => write(`best:${board}`, time);
export const bestPlace = (board: string) => read<number>(`place:${board}`);
export const setBestPlace = (board: string, place: number) => write(`place:${board}`, place);
export const levelWon = (t: Track) => read<number>(`wins:${t.id}`) ?? -1;
export const setLevelWon = (t: Track, diff: number) => write(`wins:${t.id}`, Math.max(levelWon(t), diff));

// A level opens once the one below it has been won on that track (Железо is always open).
export const levelOpen = (t: Track, diff: number) => diff === 0 || levelWon(t) >= diff - 1;

// Stars earned on every track and level: they open new tracks.
export function totalStars() {
  let n = 0;
  for (const t of TRACKS) for (const d of DIFFICULTIES) n += missionsDone(t, d.id).filter(Boolean).length;
  return n;
}

// Leaderboard points: best place on every board plus every star (see catalog.ts).
export function totalPoints() {
  let pts = 0;
  for (const t of TRACKS)
    for (const d of DIFFICULTIES) {
      pts += missionsDone(t, d.id).filter(Boolean).length * starPoints(d.id);
      for (const b of BIKES) {
        const place = bestPlace(boardId(t.id, d.id, b.id));
        if (place) pts += boardPoints(place, d.id, b.id);
      }
    }
  return Math.round(pts);
}

// Saves from before levels and classes: their stars count on Железо, their times on the 250.
export function migrateOldProgress() {
  for (const t of TRACKS) {
    const old = read<boolean[]>(`missions:${t.id}`);
    if (old) {
      if (!read(`missions:${missionKey(t, 0)}`)) write(`missions:${missionKey(t, 0)}`, [...old, false, false].slice(0, 5));
      try {
        localStorage.removeItem(`missions:${t.id}`);
      } catch {
        /* ignore */
      }
    }
    const best = read<number>(`best:${t.id}`);
    if (typeof best === "number") {
      const b = boardId(t.id, 0, "250" as BikeClass);
      if (bestTime(b) === null) setBestTime(b, best);
      try {
        localStorage.removeItem(`best:${t.id}`);
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------- Snapshot for cloud save ----------

export function collectLocal(): Snapshot {
  const s: Snapshot = { profile: loadProfile(), missions: {}, best: {}, places: {}, wins: {} };
  for (const t of TRACKS) {
    for (const d of DIFFICULTIES) {
      const m = missionsDone(t, d.id);
      if (m.length) s.missions[missionKey(t, d.id)] = m;
      for (const b of BIKES) {
        const id = boardId(t.id, d.id, b.id);
        const time = bestTime(id);
        if (typeof time === "number") s.best[id] = time;
        const place = bestPlace(id);
        if (typeof place === "number") s.places![id] = place;
      }
    }
    const w = levelWon(t);
    if (w >= 0) s.wins![t.id] = w;
  }
  return s;
}

export function applyLocal(s: Snapshot) {
  saveProfile(s.profile, s.profile.updatedAt ?? Date.now());
  for (const [id, m] of Object.entries(s.missions)) write(`missions:${id}`, m);
  for (const [id, b] of Object.entries(s.best)) write(`best:${id}`, b);
  for (const [id, p] of Object.entries(s.places ?? {})) write(`place:${id}`, p);
  for (const [id, w] of Object.entries(s.wins ?? {})) write(`wins:${id}`, w);
}

const minMerge = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = [a[id], b[id]].filter((x): x is number => typeof x === "number");
    out[id] = Math.min(...v);
  }
  return out;
};

// Combines two devices' progress without losing anything earned:
// purchases and upgrades are united, missions OR-ed, best times and places take the minimum.
// Coins can go down when spent, so the balance comes from the most recently saved profile.
export function merge(a: Snapshot, b: Snapshot): Snapshot {
  const pa = normalize(a.profile);
  const pb = normalize(b.profile);
  const newer = (pa.updatedAt ?? 0) >= (pb.updatedAt ?? 0) ? pa : pb;
  const levels = { ...newer.levels };
  for (const k of Object.keys(levels) as (keyof typeof levels)[]) levels[k] = Math.max(pa.levels[k] ?? 0, pb.levels[k] ?? 0);
  const profile = normalize({
    ...newer,
    levels,
    owned: [...new Set([...pa.owned, ...pb.owned])],
    bikes: [...new Set([...pa.bikes, ...pb.bikes])],
    updatedAt: Math.max(pa.updatedAt ?? 0, pb.updatedAt ?? 0),
  });

  const missions: Record<string, boolean[]> = {};
  for (const id of new Set([...Object.keys(a.missions), ...Object.keys(b.missions)])) {
    const x = a.missions[id] ?? [];
    const y = b.missions[id] ?? [];
    missions[id] = Array.from({ length: Math.max(x.length, y.length) }, (_, i) => !!(x[i] || y[i]));
  }

  const wins: Record<string, number> = { ...a.wins };
  for (const [id, w] of Object.entries(b.wins ?? {})) wins[id] = Math.max(wins[id] ?? -1, w);
  return { profile, missions, best: minMerge(a.best, b.best), places: minMerge(a.places, b.places), wins };
}
