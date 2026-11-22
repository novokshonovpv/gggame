// The online city: sends this player's state, shows the others (smoothly interpolated),
// passes shots, hits and knock-downs between players, and the chat. Traffic, people and
// police stay local to each player; only the players are shared.

import { censor } from "./censor.ts";
import type { CityCloud } from "./cloud.ts";
import { type ChatLine, FirebaseNet, LocalNet, type NetEvent, type PlayerState, type Transport, chunkOf, chunksAround } from "./net.ts";
import { BIKE, MODELS, Ped, type RemoteView, Vehicle, WEAPONS, type WeaponId, type World } from "./sim.ts";

const DELAY = 130; // ms: draw others this far in the past, between two received states
const STALE = 8000;

interface Remote {
  view: RemoteView;
  snaps: { t: number; s: PlayerState }[];
  last: number;
  bikeId: string;
}

export type OnlineStatus = "off" | "connecting" | "online" | "offline";

export class Online {
  status: OnlineStatus = "off";
  count = 0;
  private net: Transport | null = null;
  private remotes = new Map<string, Remote>();
  private chunk = "";
  private sendT = 0;
  private world: World;
  private nick: () => string;
  private hero: () => { helmet: string; jacket: string };
  onChat: (c: ChatLine, mine: boolean) => void = () => {};
  onMessage: (text: string, tone: "good" | "bad" | "info") => void = () => {};
  onChange: () => void = () => {};

  constructor(world: World, nick: () => string, hero: () => { helmet: string; jacket: string }) {
    this.world = world;
    this.nick = nick;
    this.hero = hero;
  }

  get uid() {
    return this.net?.uid ?? "";
  }

  async start(kind: "firebase" | "local", cloud: CityCloud) {
    if (this.net) return;
    const net: Transport = kind === "local" ? new LocalNet() : new FirebaseNet(cloud, this.nick);
    this.net = net;
    this.setStatus("connecting");
    net.onStatus = (on) => this.setStatus(on ? "online" : "offline");
    net.onCount = (n) => {
      this.count = n;
      this.onChange();
    };
    net.onState = (uid, s) => this.state(uid, s);
    net.onGone = (uid) => this.gone(uid);
    net.onEvent = (uid, e) => this.event(uid, e);
    net.onChat = (c) => this.onChat({ ...c, n: censor(c.n), m: censor(c.m) }, c.u === net.uid);
    const ok = await net.connect();
    if (!ok) this.setStatus("offline");
    // No answer from the database in a while: call it offline (the game goes on alone).
    setTimeout(() => {
      if (this.status === "connecting") this.setStatus("offline");
    }, 9000);
    window.addEventListener("pagehide", () => net.close());
  }

  private setStatus(s: OnlineStatus) {
    this.status = s;
    this.onChange();
  }

  get online() {
    return this.status === "online";
  }

  sendChat(text: string) {
    const m = censor(text.trim()).slice(0, 80);
    if (!m || !this.net) return;
    this.net.sendChat(censor(this.nick()), m);
  }

  // ---------- receiving ----------

  private state(uid: string, s: PlayerState) {
    if (!s || typeof s.x !== "number") return;
    let r = this.remotes.get(uid);
    if (!r) {
      r = {
        view: { uid, nick: "", pvp: false, x: s.x, y: s.y, vx: 0, vy: 0, z: 0, veh: null, ped: null },
        snaps: [],
        last: 0,
        bikeId: "",
      };
      this.remotes.set(uid, r);
      this.onMessage(`${censor(String(s.n || "Игрок"))} рядом в городе`, "info");
    }
    const now = performance.now();
    r.snaps.push({ t: now, s });
    if (r.snaps.length > 12) r.snaps.shift();
    r.last = now;
    r.view.nick = censor(String(s.n || "Игрок")).slice(0, 16);
    r.view.pvp = !!s.p;
  }

  private gone(uid: string) {
    this.remotes.delete(uid);
  }

  private nameOf(uid: string) {
    return this.remotes.get(uid)?.view.nick ?? "Игрок";
  }

  private event(uid: string, e: NetEvent) {
    const w = this.world;
    if (e.k === "shot") {
      const W = WEAPONS[e.w as WeaponId];
      if (!W) return;
      for (let i = 0; i < W.pellets; i++) {
        const a = e.a + (Math.random() * 2 - 1) * W.spread;
        w.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.range / W.speed, dmg: 0, owner: "remote", rocket: W.id === "rocket" });
      }
      w.flashes.push({ x: e.x, y: e.y, a: e.a, t: 0.05 });
      w.emit({ type: "shot", weapon: W.id, x: e.x, y: e.y, remote: true });
    } else if (e.k === "hit") {
      if (e.to !== this.uid) return;
      const dmg = Math.max(0, Math.min(100, Number(e.dmg) || 0));
      if (w.remoteHit(uid, dmg)) this.onMessage(`${this.nameOf(uid)} попал в тебя!`, "bad");
    } else if (e.k === "down") {
      if (e.by === this.uid) this.onMessage(`Ты сбил игрока ${this.nameOf(uid)}!`, "good");
      else this.onMessage(`${this.nameOf(e.by)} сбил игрока ${this.nameOf(uid)}`, "info");
    } else if (e.k === "lap") {
      this.onMessage(`${this.nameOf(uid)}: круг Эндуро-арены за ${Number(e.time).toFixed(2)} с`, "info");
    }
  }

  // ---------- every frame ----------

  update(dt: number) {
    const net = this.net;
    const w = this.world;
    if (!net) return;
    const p = w.player;
    // Our own state.
    const bike = p.mode === "ride" ? p.bike : null;
    const body = bike ?? p.body;
    const moving = Math.hypot(body.vx, body.vy) > 2 || (bike?.z ?? 0) > 0 || p.mode === "fly";
    this.sendT -= dt;
    const c = chunkOf(w.px, w.py);
    if (c !== this.chunk) {
      this.chunk = c;
      net.setChunks(chunksAround(w.px, w.py));
      this.sendT = 0;
    }
    if (this.sendT <= 0) {
      this.sendT = moving ? 0.125 : 1;
      const h = this.hero();
      const r1 = (v: number) => Math.round(v * 10) / 10;
      net.sendState(
        {
          n: this.nick().slice(0, 16),
          h: h.helmet,
          j: h.jacket,
          p: w.pvp,
          x: r1(w.px),
          y: r1(w.py),
          a: Math.round((bike ? bike.a : p.body.a) * 100) / 100,
          z: r1(bike?.z ?? 0),
          vx: r1(body.vx),
          vy: r1(body.vy),
          m: p.mode === "ride" ? "r" : p.mode === "foot" ? "f" : p.mode === "fly" ? "y" : "d",
          b: bike?.model.id ?? w.bikeId,
          c: bike?.color ?? "#f2c230",
          l: Math.round((bike?.lean ?? 0) * 100) / 100,
          s: bike?.steer ?? 0,
        },
        c,
      );
    }
    // Our events out.
    for (const e of w.events) {
      if (e.type === "shot" && e.weapon !== "police" && !e.remote) {
        const src = bike ?? p.body;
        if (Math.hypot(e.x - src.x, e.y - src.y) < 40) net.sendEvent(c, { k: "shot", x: Math.round(e.x), y: Math.round(e.y), a: Math.round(src.a * 100) / 100, w: e.weapon });
      } else if (e.type === "pvpHit") net.sendEvent(c, { k: "hit", to: e.uid, dmg: e.dmg, w: e.weapon });
      else if (e.type === "pvpDown") net.sendEvent(c, { k: "down", by: e.by });
      else if (e.type === "lap") net.sendEvent(c, { k: "lap", time: Math.round(e.time * 100) / 100 });
    }
    // Others, a little in the past.
    const now = performance.now();
    const views: RemoteView[] = [];
    for (const [uid, r] of this.remotes) {
      if (now - r.last > STALE) {
        this.remotes.delete(uid);
        continue;
      }
      this.place(r, now - DELAY, dt);
      views.push(r.view);
    }
    w.remotes = views;
  }

  private place(r: Remote, t: number, dt: number) {
    const snaps = r.snaps;
    let a = snaps[0];
    let b = snaps[snaps.length - 1];
    for (let i = 0; i + 1 < snaps.length; i++)
      if (snaps[i].t <= t && snaps[i + 1].t >= t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    const s = b.s;
    let x: number;
    let y: number;
    let ang: number;
    let z: number;
    if (t >= b.t) {
      // Past the newest state: carry on along its velocity for a moment.
      const ahead = Math.min(0.3, (t - b.t) / 1000);
      x = s.x + s.vx * ahead;
      y = s.y + s.vy * ahead;
      ang = s.a;
      z = s.z;
    } else {
      const k = b.t === a.t ? 1 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
      x = a.s.x + (s.x - a.s.x) * k;
      y = a.s.y + (s.y - a.s.y) * k;
      const da = Math.atan2(Math.sin(s.a - a.s.a), Math.cos(s.a - a.s.a));
      ang = a.s.a + da * k;
      z = a.s.z + (s.z - a.s.z) * k;
    }
    const v = r.view;
    v.x = x;
    v.y = y;
    v.vx = s.vx;
    v.vy = s.vy;
    v.z = z;
    if (s.m === "r") {
      const model = MODELS[s.b] ?? BIKE.z3;
      if (!v.veh || r.bikeId !== model.id) {
        v.veh = new Vehicle(model, x, y, ang, s.c);
        r.bikeId = model.id;
      }
      const veh = v.veh;
      veh.x = x;
      veh.y = y;
      veh.a = ang;
      veh.z = z;
      veh.vx = s.vx;
      veh.vy = s.vy;
      veh.fwd = s.vx * Math.cos(ang) + s.vy * Math.sin(ang);
      veh.lean = s.l;
      veh.steer = s.s;
      veh.color = s.c;
      veh.rider = "npc";
      veh.look = { jacket: s.j, helmet: s.h };
      v.ped = null;
    } else {
      v.veh = null;
      if (!v.ped) v.ped = new Ped(x, y, ang);
      const q = v.ped;
      q.x = x;
      q.y = y;
      q.a = ang;
      q.helmet = s.h;
      q.shirt = s.j;
      q.state = s.m === "f" ? "walk" : s.m === "y" ? "fly" : "down";
      q.phase += Math.hypot(s.vx, s.vy) * dt * 0.25;
    }
  }
}
