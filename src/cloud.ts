import type { Auth, User } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { CLOUD_CONFIG } from "./cloud-config.ts";
import { type Snapshot, applyLocal, collectLocal, merge } from "./progress.ts";
import { TRACKS } from "./track.ts";

// Cloud save on Firebase: Google sign-in, progress in Firestore at users/{uid}, ghost
// replays in users/{uid}/ghosts/{trackId}. The SDK loads only when cloud save is
// configured, so the offline game stays small.

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

const ghostKey = (id: string) => `ghost:${id}`;

export class Cloud {
  status: CloudStatus = CLOUD_CONFIG ? "loading" : "off";
  user: User | null = null;
  lastSync = 0;
  onChange: (pulled: boolean) => void = () => {};
  private sdk: Sdk | null = null;
  private timer = 0;
  private busy = false;
  private again = false;

  get configured() {
    return !!CLOUD_CONFIG;
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
        if (u) void this.sync();
        else this.set("signed-out");
      });
    } catch {
      this.set("error");
    }
  }

  private set(s: CloudStatus, pulled = false) {
    this.status = s;
    this.onChange(pulled);
  }

  async signIn() {
    if (!this.sdk) return;
    const { authMod, auth } = this.sdk;
    const provider = new authMod.GoogleAuthProvider();
    try {
      await authMod.signInWithPopup(auth, provider);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "";
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment")
        await authMod.signInWithRedirect(auth, provider);
      else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") this.set("error");
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
    const { fs, db } = this.sdk;
    const uid = this.user.uid;
    try {
      const ref = fs.doc(db, "users", uid);
      const snap = await fs.getDoc(ref);
      const remote = snap.exists() ? (snap.data() as RemoteDoc) : null;
      const local = collectLocal();
      const merged = remote ? merge(local, { profile: remote.profile, missions: remote.missions ?? {}, best: remote.best ?? {} }) : local;
      applyLocal(merged);

      const ghostTimes: Record<string, number> = { ...(remote?.ghostTimes ?? {}) };
      for (const t of TRACKS) {
        const mine = local.best[t.id];
        const theirs = ghostTimes[t.id];
        const hasLocalGhost = (() => {
          try {
            return localStorage.getItem(ghostKey(t.id)) !== null;
          } catch {
            return false;
          }
        })();
        if (theirs !== undefined && (mine === undefined || theirs < mine - 1e-3)) {
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
        } else if (hasLocalGhost && mine !== undefined && (theirs === undefined || mine < theirs - 1e-3)) {
          const raw = JSON.parse(localStorage.getItem(ghostKey(t.id))!) as { d: number[] };
          await fs.setDoc(fs.doc(db, "users", uid, "ghosts", t.id), { time: mine, d: raw.d });
          ghostTimes[t.id] = mine;
        }
      }

      // JSON round-trip drops undefined fields, which Firestore rejects.
      await fs.setDoc(ref, JSON.parse(JSON.stringify({ ...merged, ghostTimes })));
      this.lastSync = Date.now();
      this.set("synced", true);
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
}
