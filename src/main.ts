import { Chain, World } from "planck";
import type { Body, Contact } from "planck";
import { autopilot } from "./ai.ts";
import { Bike, type FixtureTag } from "./bike.ts";
import { Controls } from "./input.ts";
import { type Camera, Renderer } from "./render.ts";
import { TRACKS, type Track, groundY } from "./track.ts";
import "./style.css";

const DT = 1 / 120;
const GRAVITY = -11;

type State = "menu" | "riding" | "crashed" | "finished";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = {
  get(key: string): number | null {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  },
  set(key: string, v: number) {
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* storage unavailable: best times just won't persist */
    }
  },
};
const bestKey = (t: Track) => `best:${t.id}`;

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

class Game {
  renderer = new Renderer($<HTMLCanvasElement>("game"));
  controls = new Controls((code) => this.onKey(code));
  world!: World;
  bike!: Bike;
  track: Track = TRACKS[0];
  state: State = "menu";
  autopilot = false; // dev/testing: let the AI ride
  time = 0;
  timerOn = false;
  crashTimer = 0;
  clock = 0;
  acc = 0;
  cam: Camera = { x: 0, y: 0, ppm: 40 };

  constructor() {
    window.addEventListener("resize", () => this.renderer.resize());
    $("btn-restart").addEventListener("click", () => this.load(this.track));
    $("btn-menu").addEventListener("click", () => this.showMenu());
    $("res-retry").addEventListener("click", () => this.load(this.track));
    $("res-next").addEventListener("click", () => this.load(TRACKS[(TRACKS.indexOf(this.track) + 1) % TRACKS.length]));
    $("res-menu").addEventListener("click", () => this.showMenu());
    this.load(this.track);
    this.showMenu();
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.update(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  onKey(code: string) {
    if (code === "KeyR" || code === "Enter") {
      if (this.state !== "menu") this.load(this.track);
    } else if (code === "Escape") {
      this.showMenu();
    }
  }

  showMenu() {
    this.state = "menu";
    const list = $("track-list");
    list.innerHTML = "";
    TRACKS.forEach((t, i) => {
      const best = store.get(bestKey(t));
      const b = document.createElement("button");
      b.className = "track";
      b.innerHTML = `<span class="num">${i + 1}</span><span class="name">${t.name}</span><span class="best">${best ? fmt(best) : "—"}</span>`;
      b.addEventListener("click", () => this.load(t));
      list.appendChild(b);
    });
    this.ui();
  }

  load(track: Track) {
    this.track = track;
    this.world = new World({ gravity: { x: 0, y: GRAVITY } });
    const ground: Body = this.world.createBody();
    ground.createFixture(new Chain(track.points, false), {
      friction: 0.9,
      userData: "ground" satisfies FixtureTag,
    });
    this.bike = new Bike(this.world, { x: track.startX, y: groundY(track, track.startX) });
    this.world.on("begin-contact", (c) => this.contact(c, 1));
    this.world.on("end-contact", (c) => this.contact(c, -1));

    this.state = "riding";
    this.time = 0;
    this.timerOn = false;
    this.crashTimer = 0;
    this.acc = 0;
    const p = this.bike.chassis.getPosition();
    this.cam = { x: p.x + 3, y: p.y, ppm: this.renderer.basePpm() };
    this.ui();
  }

  contact(c: Contact, delta: number) {
    const a = c.getFixtureA().getUserData() as FixtureTag;
    const b = c.getFixtureB().getUserData() as FixtureTag;
    if (a !== "ground" && b !== "ground") return;
    const other = a === "ground" ? b : a;
    if (other === "wheel-rear") this.bike.rearContacts += delta;
    else if (other === "wheel-front") this.bike.frontContacts += delta;
    else if (other === "rider" && delta > 0 && this.state === "riding") this.crash();
  }

  crash() {
    this.state = "crashed";
    this.crashTimer = 1.3;
    this.timerOn = false;
    this.ui();
  }

  finish() {
    this.state = "finished";
    this.timerOn = false;
    const key = bestKey(this.track);
    const prev = store.get(key);
    const record = prev === null || this.time < prev;
    if (record) store.set(key, this.time);
    $("res-time").textContent = fmt(this.time);
    $("res-best").textContent = record ? "Новый рекорд!" : `Рекорд: ${fmt(prev!)}`;
    $("res-best").classList.toggle("record", record);
    this.ui();
  }

  update(dt: number) {
    this.clock += dt;
    const input = this.autopilot ? autopilot(this.bike, this.track) : this.controls.read();
    const active = this.state === "riding";
    const effective = active ? input : { gas: false, brake: false, lean: 0 };

    if (active && !this.timerOn && (input.gas || input.lean !== 0)) this.timerOn = true;

    this.acc += dt;
    while (this.acc >= DT) {
      this.bike.apply(effective, DT);
      this.world.step(DT, 8, 3);
      if (this.timerOn) this.time += DT;
      this.acc -= DT;
    }

    const pos = this.bike.chassis.getPosition();
    if (this.state === "riding") {
      if (pos.x >= this.track.finishX) this.finish();
      else if (pos.y < -40) this.crash();
    }
    if (this.state === "crashed") {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.load(this.track);
    }

    this.updateCamera(dt);
    this.renderer.draw(this.cam, this.track, this.bike, this.clock);
    this.hud();
  }

  updateCamera(dt: number) {
    const p = this.bike.chassis.getPosition();
    const v = this.bike.chassis.getLinearVelocity();
    const look = Math.max(-2, Math.min(6, v.x * 0.3));
    const k = 1 - Math.exp(-dt * 5);
    this.cam.x += (p.x + 2 + look - this.cam.x) * k;
    this.cam.y += (p.y + 0.6 - this.cam.y) * (1 - Math.exp(-dt * 3.5));
    // Zoom out a bit at speed and on big air.
    const speed = Math.hypot(v.x, v.y);
    const target = this.renderer.basePpm() / (1 + speed / 45);
    this.cam.ppm += (target - this.cam.ppm) * (1 - Math.exp(-dt * 2));
  }

  hud() {
    $("time").textContent = fmt(this.time);
    const t = this.track;
    const p = Math.max(0, Math.min(1, (this.bike.chassis.getPosition().x - t.startX) / (t.finishX - t.startX)));
    $("progress-fill").style.width = `${(p * 100).toFixed(1)}%`;
    $("hint").classList.toggle("hidden", this.timerOn || this.state !== "riding");
  }

  ui() {
    const s = this.state;
    $("menu").classList.toggle("hidden", s !== "menu");
    $("results").classList.toggle("hidden", s !== "finished");
    $("crash").classList.toggle("hidden", s !== "crashed");
    $("hud").classList.toggle("hidden", s === "menu");
    $("controls").classList.toggle("hidden", s === "menu" || s === "finished");
    $("track-name").textContent = this.track.name;
    const best = store.get(bestKey(this.track));
    $("best").textContent = best ? `Рекорд ${fmt(best)}` : "";
  }
}

const game = new Game();
if (import.meta.env.DEV) Object.assign(window, { game });
