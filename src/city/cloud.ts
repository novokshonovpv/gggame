// Online part of the city game, on the same Firebase project as Moto Trials: the same
// anonymous account and nickname (players/, nicks/), and two leaderboards in boards/:
//   city67_money — most money earned in total (higher is better)
//   city67_lap   — best lap of the enduro arena, seconds (lower is better)
// The existing rules store any record as { time: number > 10 }, so "time" holds the value.
// The Firebase SDK is loaded only when the menu asks for it.

import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { CLOUD_CONFIG } from "../cloud-config.ts";

export type NickResult = "ok" | "taken" | "offline" | "error";
export interface Row {
  uid: string;
  nick: string;
  value: number;
}
export const BOARD_MONEY = "city67_money";
export const BOARD_LAP = "city67_lap";
export const NICK_RE = /^[\p{L}\p{N}_\- ]{3,16}$/u;

type Sdk = {
  auth: Auth;
  db: Firestore;
  fs: typeof import("firebase/firestore");
};

export class CityCloud {
  status: "off" | "loading" | "ready" | "error" = CLOUD_CONFIG ? "loading" : "off";
  user: User | null = null;
  private sdk: Sdk | null = null;
  private nicks = new Map<string, string | null>();
  private ready: Promise<void> | null = null;
  onReady: () => void = () => {};

  init() {
    if (!CLOUD_CONFIG) return Promise.resolve();
    this.ready ??= (async () => {
      try {
        const [appMod, authMod, fs] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
        const app = appMod.getApps()[0] ?? appMod.initializeApp(CLOUD_CONFIG);
        const auth = authMod.getAuth(app);
        this.sdk = { auth, db: fs.getFirestore(app), fs };
        await new Promise<void>((resolve) => {
          authMod.onAuthStateChanged(auth, (u) => {
            this.user = u;
            if (!u) {
              void authMod.signInAnonymously(auth).catch(() => {
                this.status = "error";
                resolve();
              });
              return;
            }
            this.status = "ready";
            this.onReady();
            resolve();
          });
        });
      } catch {
        this.status = "error";
      }
    })();
    return this.ready;
  }

  get online() {
    return !!this.sdk && !!this.user;
  }

  // The nickname on the server (shared with Moto Trials); undefined if none or offline.
  async myNick(): Promise<string | undefined> {
    if (!this.sdk || !this.user) return undefined;
    const { fs, db } = this.sdk;
    try {
      const snap = await fs.getDoc(fs.doc(db, "players", this.user.uid));
      if (!snap.exists()) return undefined;
      return (snap.data() as { nick?: string | null }).nick ?? undefined;
    } catch {
      return undefined;
    }
  }

  // Reserves a nickname (frees the old one), keeping the Moto Trials points as they are.
  async claimNick(nick: string): Promise<NickResult> {
    if (!this.sdk || !this.user) return "offline";
    const { fs, db } = this.sdk;
    const uid = this.user.uid;
    const lower = nick.trim().toLowerCase();
    try {
      const taken = await fs.getDoc(fs.doc(db, "nicks", lower));
      if (taken.exists() && ((taken.data() as { uid: string }).uid !== uid || (taken.data() as { blocked?: boolean }).blocked)) return "taken";
      const me = await fs.getDoc(fs.doc(db, "players", uid));
      const data = me.exists() ? (me.data() as { nickLower?: string; points?: number }) : {};
      const batch = fs.writeBatch(db);
      if (!taken.exists()) batch.set(fs.doc(db, "nicks", lower), { uid });
      batch.set(fs.doc(db, "players", uid), { nick: nick.trim(), nickLower: lower, points: data.points ?? 0, nickRemoved: false, updatedAt: Date.now() });
      if (data.nickLower && data.nickLower !== lower) {
        const oldDoc = await fs.getDoc(fs.doc(db, "nicks", data.nickLower));
        if (oldDoc.exists() && !(oldDoc.data() as { blocked?: boolean }).blocked) batch.delete(fs.doc(db, "nicks", data.nickLower));
      }
      await batch.commit();
      this.nicks.set(uid, nick.trim());
      return "ok";
    } catch {
      return "error";
    }
  }

  // Sends a result if it beats the player's own record on that board.
  async submit(board: string, value: number, higherIsBetter: boolean) {
    if (!this.sdk || !this.user || !(value > 10)) return;
    const { fs, db } = this.sdk;
    try {
      const ref = fs.doc(db, "boards", board, "times", this.user.uid);
      const cur = await fs.getDoc(ref);
      if (cur.exists()) {
        const old = (cur.data() as { time: number }).time;
        if (higherIsBetter ? old >= value : old <= value) return;
      }
      await fs.setDoc(ref, { time: value, at: Date.now() });
    } catch {
      /* next time */
    }
  }

  private async nickOf(uid: string) {
    if (this.nicks.has(uid)) return this.nicks.get(uid)!;
    const { fs, db } = this.sdk!;
    const snap = await fs.getDoc(fs.doc(db, "players", uid));
    const nick = snap.exists() ? ((snap.data() as { nick?: string | null }).nick ?? null) : null;
    this.nicks.set(uid, nick);
    return nick;
  }

  async top(board: string, higherIsBetter: boolean, n = 20): Promise<Row[] | null> {
    if (!this.sdk || !this.user) return null;
    const { fs, db } = this.sdk;
    try {
      const q = fs.query(fs.collection(db, "boards", board, "times"), fs.orderBy("time", higherIsBetter ? "desc" : "asc"), fs.limit(n + 10));
      const snap = await fs.getDocs(q);
      const rows: Row[] = [];
      for (const d of snap.docs) {
        const nick = await this.nickOf(d.id);
        if (nick) rows.push({ uid: d.id, nick, value: (d.data() as { time: number }).time });
      }
      return rows.slice(0, n);
    } catch {
      return null;
    }
  }
}
