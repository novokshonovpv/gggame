import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { CLOUD_CONFIG } from "./cloud-config.ts";
import { loadGhost } from "./ghost.ts";
import { type Snapshot, applyLocal, collectLocal, merge, migrateOldProgress } from "./progress.ts";
import { TRACKS } from "./track.ts";

// Online features on Firebase. Every player gets an anonymous account at once (for the
// nickname and the leaderboards); signing in with Google links it, so progress follows the
// player to other devices. The SDK loads only when Firebase is configured.
//
// Firestore layout (rules in firestore.rules):
//   users/{uid}                  saved progress; users/{uid}/ghosts/{trackId} ghost replays
//   players/{uid}                { nick, nickLower, points, nickRemoved? }  public profile
//   nicks/{nickLower}            { uid, blocked? }  one owner per nickname
//   boards/{board}/times/{uid}   { time, at }  best time per track × level × class
//   admins/{uid}                 moderators (added by hand in the Firebase console)

export type CloudStatus = "off" | "loading" | "signed-out" | "syncing" | "synced" | "error";

interface RemoteDoc extends Snapshot {
  ghostTimes?: Record<string, number>; // best time each uploaded ghost belongs to
}

type Sdk = {
  auth: Auth;
  db: Firestore;
  authMod: typeof import("firebase/auth");
  fs: typeof import("firebase/firestore");
};

export type NickResult = "ok" | "taken" | "offline" | "error";
export interface TimeRow {
  uid: string;
  nick: string;
  time: number;
}
export interface PointsRow {
  uid: string;
  nick: string;
  points: number;
}

const ghostKey = (id: string) => `ghost:${id}`;
export const NICK_RE = /^[\p{L}\p{N}_\- ]{3,16}$/u;

export class Cloud {
  status: CloudStatus = CLOUD_CONFIG ? "loading" : "off";
  user: User | null = null;
  lastSync = 0;
  admin = false;
  onChange: (pulled: boolean) => void = () => {};
  onReady: () => void = () => {}; // signed in (anonymously or with Google)
  private sdk: Sdk | null = null;
  private timer = 0;
  private busy = false;
  private again = false;
  private nicks = new Map<string, string | null>(); // uid -> nick (null: removed)

  get configured() {
    return !!CLOUD_CONFIG;
  }

  get online() {
    return !!this.sdk && !!this.user;
  }

  // Signed in with Google (progress follows the player), not just anonymously.
  get linked() {
    return !!this.user && !this.user.isAnonymous;
  }

  async init() {
    if (!CLOUD_CONFIG) return;
    try {
      const [appMod, authMod, fs] = await Promise.all([import("firebase/app"), import("firebase/auth"), import("firebase/firestore")]);
      const app = appMod.initializeApp(CLOUD_CONFIG);
      this.sdk = { auth: authMod.getAuth(app), db: fs.getFirestore(app), authMod, fs };
      // Finishes a redirect sign-in (used when the popup was blocked).
      await authMod.getRedirectResult(this.sdk.auth).catch(() => null);
      authMod.onAuthStateChanged(this.sdk.auth, (u) => {
        this.user = u;
        if (!u) {
          this.set("signed-out");
          void authMod.signInAnonymously(this.sdk!.auth).catch(() => this.set("error"));
          return;
        }
        void this.checkAdmin();
        this.onReady();
        void this.sync();
      });
    } catch {
      this.set("error");
    }
  }

  private set(s: CloudStatus, pulled = false) {
    this.status = s;
    this.onChange(pulled);
  }

  // Google sign-in; an anonymous account is linked so its nickname and records stay.
  async signIn() {
    if (!this.sdk) return;
    const { authMod, auth } = this.sdk;
    const provider = new authMod.GoogleAuthProvider();
    const anon = auth.currentUser?.isAnonymous ? auth.currentUser : null;
    try {
      if (anon) await authMod.linkWithPopup(anon, provider);
      else await authMod.signInWithPopup(auth, provider);
      this.user = auth.currentUser;
      void this.sync();
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/credential-already-in-use") {
        // This Google account already plays here: switch to it (local progress merges in).
        const cred = authMod.GoogleAuthProvider.credentialFromError(e as never);
        if (cred) await authMod.signInWithCredential(auth, cred).catch(() => this.set("error"));
      } else if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        if (anon) await authMod.linkWithRedirect(anon, provider);
        else await authMod.signInWithRedirect(auth, provider);
      } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") this.set("error");
    }
  }

  async signOut() {
    if (this.sdk) await this.sdk.authMod.signOut(this.sdk.auth);
  }

  // Debounced upload after a race or a purchase.
  pushSoon() {
    if (!this.user) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.sync(), 1500);
  }

  // Pull, merge with this device, write the result to both sides, then reconcile ghosts.
  async sync() {
    if (!this.sdk || !this.user) return;
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    this.set("syncing");
    try {
      // A request can hang (seen right after the very first anonymous sign-in): give up
      // after a while so the next race or purchase gets to sync again.
      await Promise.race([this.syncOnce(), new Promise((_, reject) => setTimeout(() => reject(new Error("sync timeout")), 20000))]);
      this.lastSync = Date.now();
      this.set(this.linked ? "synced" : "signed-out", true);
    } catch {
      this.set("error");
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    }
  }

  private async syncOnce() {
    const { fs, db } = this.sdk!;
    const uid = this.user!.uid;
    {
      const ref = fs.doc(db, "users", uid);
      const snap = await fs.getDoc(ref);
      const remote = snap.exists() ? (snap.data() as RemoteDoc) : null;
      const local = collectLocal();
      const merged = remote ? merge(local, { profile: remote.profile, missions: remote.missions ?? {}, best: remote.best ?? {}, places: remote.places, wins: remote.wins }) : local;
      applyLocal(merged);
      migrateOldProgress(); // a save from an older version of the game

      const ghostTimes: Record<string, number> = { ...(remote?.ghostTimes ?? {}) };
      for (const t of TRACKS) {
        const mine = loadGhost(t.id)?.duration;
        const theirs = ghostTimes[t.id];
        if (theirs !== undefined && (mine === undefined || theirs < mine - 0.05)) {
          // The cloud holds a faster run than this device: take its ghost.
          const g = await fs.getDoc(fs.doc(db, "users", uid, "ghosts", t.id));
          const d = g.exists() ? (g.data() as { d?: number[] }).d : undefined;
          if (d) {
            try {
              localStorage.setItem(ghostKey(t.id), JSON.stringify({ v: 1, d }));
            } catch {
              /* no room: keep racing without it */
            }
          }
        } else if (mine !== undefined && (theirs === undefined || mine < theirs - 0.05)) {
          const raw = JSON.parse(localStorage.getItem(ghostKey(t.id))!) as { d: number[] };
          await fs.setDoc(fs.doc(db, "users", uid, "ghosts", t.id), { time: mine, d: raw.d });
          ghostTimes[t.id] = mine;
        }
      }

      // JSON round-trip drops undefined fields, which Firestore rejects.
      await fs.setDoc(ref, JSON.parse(JSON.stringify({ ...merged, ghostTimes })));
    }
  }

  // ---------- Nicknames ----------

  // The nickname the server holds for this player: a string, null when a moderator removed
  // it, undefined when there is none yet (or no connection).
  async myNick(): Promise<string | null | undefined> {
    if (!this.sdk || !this.user) return undefined;
    const { fs, db } = this.sdk;
    try {
      const snap = await fs.getDoc(fs.doc(db, "players", this.user.uid));
      if (!snap.exists()) return undefined;
      const d = snap.data() as { nick?: string | null; nickRemoved?: boolean };
      return d.nickRemoved && !d.nick ? null : (d.nick ?? undefined);
    } catch {
      return undefined;
    }
  }

  // Reserves a nickname for this player (and frees the previous one).
  async claimNick(nick: string, points: number): Promise<NickResult> {
    if (!this.sdk || !this.user) return "offline";
    const { fs, db } = this.sdk;
    const uid = this.user.uid;
    const lower = nick.trim().toLowerCase();
    try {
      const taken = await fs.getDoc(fs.doc(db, "nicks", lower));
      if (taken.exists() && (taken.data() as { uid: string }).uid !== uid) return "taken";
      if (taken.exists() && (taken.data() as { blocked?: boolean }).blocked) return "taken";
      const me = await fs.getDoc(fs.doc(db, "players", uid));
      const old = me.exists() ? (me.data() as { nickLower?: string }).nickLower : undefined;
      const batch = fs.writeBatch(db);
      if (!taken.exists()) batch.set(fs.doc(db, "nicks", lower), { uid });
      batch.set(fs.doc(db, "players", uid), { nick: nick.trim(), nickLower: lower, points, nickRemoved: false, updatedAt: Date.now() });
      if (old && old !== lower) {
        const oldDoc = await fs.getDoc(fs.doc(db, "nicks", old));
        if (oldDoc.exists() && !(oldDoc.data() as { blocked?: boolean }).blocked) batch.delete(fs.doc(db, "nicks", old));
      }
      await batch.commit();
      this.nicks.set(uid, nick.trim());
      return "ok";
    } catch {
      return "error";
    }
  }

  private async checkAdmin() {
    if (!this.sdk || !this.user) return;
    const { fs, db } = this.sdk;
    try {
      this.admin = (await fs.getDoc(fs.doc(db, "admins", this.user.uid))).exists();
    } catch {
      this.admin = false;
    }
  }

  // Moderator: takes a nickname away. It stays reserved, so nobody can use it again, the
  // player disappears from the tables and is asked for a new one.
  async removeNick(uid: string) {
    if (!this.sdk || !this.admin) return false;
    const { fs, db } = this.sdk;
    try {
      const p = await fs.getDoc(fs.doc(db, "players", uid));
      const lower = p.exists() ? (p.data() as { nickLower?: string }).nickLower : undefined;
      const batch = fs.writeBatch(db);
      batch.set(fs.doc(db, "players", uid), { nick: null, nickLower: null, nickRemoved: true }, { merge: true });
      if (lower) batch.set(fs.doc(db, "nicks", lower), { uid, blocked: true });
      await batch.commit();
      this.nicks.set(uid, null);
      return true;
    } catch {
      return false;
    }
  }

  // ---------- Leaderboards ----------

  async submitTime(board: string, time: number) {
    if (!this.sdk || !this.user) return;
    const { fs, db } = this.sdk;
    try {
      const ref = fs.doc(db, "boards", board, "times", this.user.uid);
      const cur = await fs.getDoc(ref);
      if (cur.exists() && (cur.data() as { time: number }).time <= time) return;
      await fs.setDoc(ref, { time, at: Date.now() });
    } catch {
      /* try again after the next race */
    }
  }

  async submitPoints(points: number) {
    if (!this.sdk || !this.user) return;
    const { fs, db } = this.sdk;
    try {
      await fs.setDoc(fs.doc(db, "players", this.user.uid), { points, updatedAt: Date.now() }, { merge: true });
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

  async topTimes(board: string, n = 20): Promise<TimeRow[] | null> {
    if (!this.sdk) return null;
    const { fs, db } = this.sdk;
    try {
      const q = fs.query(fs.collection(db, "boards", board, "times"), fs.orderBy("time"), fs.limit(n + 10));
      const snap = await fs.getDocs(q);
      const rows: TimeRow[] = [];
      for (const d of snap.docs) {
        const nick = await this.nickOf(d.id);
        if (nick) rows.push({ uid: d.id, nick, time: (d.data() as { time: number }).time });
      }
      return rows.slice(0, n);
    } catch {
      return null;
    }
  }

  async topPoints(n = 50): Promise<PointsRow[] | null> {
    if (!this.sdk) return null;
    const { fs, db } = this.sdk;
    try {
      const q = fs.query(fs.collection(db, "players"), fs.orderBy("points", "desc"), fs.limit(n + 10));
      const snap = await fs.getDocs(q);
      const rows: PointsRow[] = [];
      for (const d of snap.docs) {
        const v = d.data() as { nick?: string | null; points?: number };
        this.nicks.set(d.id, v.nick ?? null);
        if (v.nick) rows.push({ uid: d.id, nick: v.nick, points: v.points ?? 0 });
      }
      return rows.slice(0, n);
    } catch {
      return null;
    }
  }
}
