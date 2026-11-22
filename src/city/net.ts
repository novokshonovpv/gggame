// Network transport for the online city. Two interchangeable kinds:
//   FirebaseNet — Firebase Realtime Database (production);
//   LocalNet    — BroadcastChannel between tabs of one browser (?net=local), for testing.
//
// Realtime Database layout (rules: database.rules.json):
//   city67/players/{uid}          { n, t }                 who is online (removed on disconnect)
//   city67/pos/{chunk}/{uid}      PlayerState              position, 8 times a second while moving
//   city67/ev/{chunk}/{pushId}    NetEvent                 shots, hits, laps (kept a few seconds)
//   city67/chat/{pushId}          { u, n, m, t }           chat lines (kept two minutes)
// A chunk is a 2048-unit square of the city; a player listens to the 3×3 around them.

import { CITY_RTDB_URL } from "../cloud-config.ts";
import type { CityCloud } from "./cloud.ts";

export const NET_CHUNK = 2048;
export const chunkOf = (x: number, y: number) => `${Math.floor(x / NET_CHUNK)}_${Math.floor(y / NET_CHUNK)}`;
export const chunksAround = (x: number, y: number) => {
  const cx = Math.floor(x / NET_CHUNK);
  const cy = Math.floor(y / NET_CHUNK);
  const out: string[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(`${cx + dx}_${cy + dy}`);
  return out;
};

export interface PlayerState {
  n: string; // nickname
  h: string; // helmet colour
  j: string; // jacket colour
  p: boolean; // PvP on
  x: number;
  y: number;
  a: number;
  z: number; // height in a jump
  vx: number;
  vy: number;
  m: "r" | "f" | "y" | "d"; // riding, on foot, flying off, down/out
  b: string; // bike model id
  c: string; // bike colour
  l: number; // lean
  s: number; // steering
}

export type NetEvent =
  | { k: "shot"; x: number; y: number; a: number; w: string }
  | { k: "hit"; to: string; dmg: number; w: string }
  | { k: "down"; by: string } // the sender was wasted by player `by`
  | { k: "lap"; time: number }
  | { k: "say"; m: string; x: number; y: number }; // said out loud: heard by players nearby

export interface ChatLine {
  u: string;
  n: string;
  m: string;
}

export interface Transport {
  readonly uid: string;
  connect(): Promise<boolean>;
  setChunks(chunks: string[]): void;
  sendState(s: PlayerState, chunk: string): void;
  sendEvent(chunk: string, e: NetEvent): void;
  sendChat(n: string, m: string): void;
  close(): void;
  onState: (uid: string, s: PlayerState) => void;
  onGone: (uid: string) => void;
  onEvent: (uid: string, e: NetEvent) => void;
  onChat: (c: ChatLine) => void;
  onCount: (n: number) => void;
  onStatus: (online: boolean) => void;
}

const noop = () => {};

// ---------- Firebase Realtime Database ----------

export class FirebaseNet implements Transport {
  uid = "";
  onState: Transport["onState"] = noop;
  onGone: Transport["onGone"] = noop;
  onEvent: Transport["onEvent"] = noop;
  onChat: Transport["onChat"] = noop;
  onCount: Transport["onCount"] = noop;
  onStatus: Transport["onStatus"] = noop;
  private db: typeof import("firebase/database") | null = null;
  private dbi: import("firebase/database").Database | null = null;
  private subs = new Map<string, () => void>();
  private posChunk = "";
  private offset = 0; // server clock minus ours, ms
  private cloud: CityCloud;
  private nick: () => string;
  private lastSent = new Map<string, number>();
  private want: string[] = []; // chunks asked for, applied once connected

  constructor(cloud: CityCloud, nick: () => string) {
    this.cloud = cloud;
    this.nick = nick;
  }

  async connect() {
    await this.cloud.init();
    if (!this.cloud.app || !this.cloud.user) return false;
    try {
      const db = await import("firebase/database");
      this.db = db;
      this.dbi = db.getDatabase(this.cloud.app, CITY_RTDB_URL);
      this.uid = this.cloud.user.uid;
      const { ref, onValue, set, onDisconnect, serverTimestamp, query, orderByChild, startAt, onChildAdded, remove } = db;
      onValue(ref(this.dbi, ".info/serverTimeOffset"), (s) => (this.offset = Number(s.val()) || 0));
      onValue(ref(this.dbi, ".info/connected"), (s) => {
        const on = s.val() === true;
        this.onStatus(on);
        if (!on) return;
        const me = ref(this.dbi!, `city67/players/${this.uid}`);
        void onDisconnect(me).remove();
        void set(me, { n: this.nick().slice(0, 16), t: serverTimestamp() }).catch(noop);
      });
      onValue(
        ref(this.dbi, "city67/players"),
        (s) => this.onCount(s.size),
        () => this.onStatus(false),
      );
      // Chat: the last two minutes, then everything new.
      const since = Date.now() + this.offset - 120000;
      onChildAdded(query(ref(this.dbi, "city67/chat"), orderByChild("t"), startAt(since)), (s) => {
        const v = s.val() as ChatLine | null;
        if (v && typeof v.m === "string") this.onChat({ u: String(v.u), n: String(v.n).slice(0, 16), m: v.m.slice(0, 80) });
      });
      void remove; // (used per message below)
      // The game may have asked for its chunks before the connection was up.
      if (this.want.length) this.setChunks(this.want);
      return true;
    } catch {
      this.onStatus(false);
      return false;
    }
  }

  setChunks(chunks: string[]) {
    this.want = chunks;
    if (!this.db || !this.dbi) return;
    const { ref, onChildAdded, onChildChanged, onChildRemoved, query, orderByChild, startAt } = this.db;
    for (const [c, off] of this.subs)
      if (!chunks.includes(c)) {
        off();
        this.subs.delete(c);
      }
    for (const c of chunks) {
      if (this.subs.has(c)) continue;
      const pos = ref(this.dbi, `city67/pos/${c}`);
      const take = (s: import("firebase/database").DataSnapshot) => {
        if (s.key && s.key !== this.uid) this.onState(s.key, s.val() as PlayerState);
      };
      const offs = [
        onChildAdded(pos, take),
        onChildChanged(pos, take),
        onChildRemoved(pos, (s) => s.key && s.key !== this.uid && this.onGone(s.key)),
        onChildAdded(query(ref(this.dbi, `city67/ev/${c}`), orderByChild("t"), startAt(Date.now() + this.offset - 1500)), (s) => {
          const v = s.val() as (NetEvent & { u: string }) | null;
          if (v && v.u !== this.uid) this.onEvent(v.u, v);
        }),
      ];
      this.subs.set(c, () => offs.forEach((f) => f()));
    }
  }

  sendState(st: PlayerState, chunk: string) {
    if (!this.db || !this.dbi) return;
    const { ref, set, remove, onDisconnect } = this.db;
    if (chunk !== this.posChunk) {
      if (this.posChunk) void remove(ref(this.dbi, `city67/pos/${this.posChunk}/${this.uid}`)).catch(noop);
      this.posChunk = chunk;
      void onDisconnect(ref(this.dbi, `city67/pos/${chunk}/${this.uid}`)).remove();
    }
    void set(ref(this.dbi, `city67/pos/${chunk}/${this.uid}`), st).catch(noop);
  }

  sendEvent(chunk: string, e: NetEvent) {
    if (!this.db || !this.dbi) return;
    const { ref, push, remove, serverTimestamp, onDisconnect } = this.db;
    const r = push(ref(this.dbi, `city67/ev/${chunk}`), { ...e, u: this.uid, t: serverTimestamp() });
    void onDisconnect(r).remove();
    setTimeout(() => void remove(r).catch(noop), 5000);
  }

  sendChat(n: string, m: string) {
    if (!this.db || !this.dbi) return;
    const now = Date.now();
    if (now - (this.lastSent.get("chat") ?? 0) < 2000) return;
    this.lastSent.set("chat", now);
    const { ref, push, remove, serverTimestamp, onDisconnect } = this.db;
    const r = push(ref(this.dbi, "city67/chat"), { u: this.uid, n: n.slice(0, 16), m: m.slice(0, 80), t: serverTimestamp() });
    // Gone after two minutes, or when the author leaves (nothing piles up in the database).
    void onDisconnect(r).remove();
    setTimeout(() => void remove(r).catch(noop), 120000);
  }

  close() {
    for (const off of this.subs.values()) off();
    this.subs.clear();
    if (this.db && this.dbi) {
      void this.db.remove(this.db.ref(this.dbi, `city67/players/${this.uid}`)).catch(noop);
      if (this.posChunk) void this.db.remove(this.db.ref(this.dbi, `city67/pos/${this.posChunk}/${this.uid}`)).catch(noop);
    }
  }
}

// ---------- Tabs of one browser (testing) ----------

type LocalMsg =
  | { t: "state"; u: string; s: PlayerState }
  | { t: "gone"; u: string }
  | { t: "ev"; u: string; e: NetEvent }
  | { t: "chat"; c: ChatLine };

export class LocalNet implements Transport {
  uid = `local-${Math.random().toString(36).slice(2, 8)}`;
  onState: Transport["onState"] = noop;
  onGone: Transport["onGone"] = noop;
  onEvent: Transport["onEvent"] = noop;
  onChat: Transport["onChat"] = noop;
  onCount: Transport["onCount"] = noop;
  onStatus: Transport["onStatus"] = noop;
  private ch: BroadcastChannel | null = null;
  private seen = new Map<string, number>();

  async connect() {
    this.ch = new BroadcastChannel("city67");
    this.ch.onmessage = (ev: MessageEvent<LocalMsg>) => {
      const m = ev.data;
      if (m.t === "state") {
        this.seen.set(m.u, Date.now());
        this.onState(m.u, m.s);
      } else if (m.t === "gone") {
        this.seen.delete(m.u);
        this.onGone(m.u);
      } else if (m.t === "ev") this.onEvent(m.u, m.e);
      else this.onChat(m.c);
      this.onCount(this.seen.size + 1);
    };
    window.addEventListener("pagehide", () => this.close());
    this.onStatus(true);
    this.onCount(1);
    return true;
  }
  setChunks() {}
  sendState(s: PlayerState) {
    this.ch?.postMessage({ t: "state", u: this.uid, s } satisfies LocalMsg);
  }
  sendEvent(_c: string, e: NetEvent) {
    this.ch?.postMessage({ t: "ev", u: this.uid, e } satisfies LocalMsg);
  }
  sendChat(n: string, m: string) {
    const c = { u: this.uid, n, m };
    this.ch?.postMessage({ t: "chat", c } satisfies LocalMsg);
    this.onChat(c);
  }
  close() {
    this.ch?.postMessage({ t: "gone", u: this.uid } satisfies LocalMsg);
  }
}
