import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Sound } from "../audio.ts";
import type { Bike, BikePose, BodyPose } from "../bike.ts";
import type { Look } from "../race.ts";
import { BikeModel, restingPose } from "../render3d.ts";
import { Bike3D, OPEN_BIKE, rotate } from "./bike3d.ts";
import { type Built, HALF, SPAWN, WATER_Y, buildWorld } from "./world.ts";

// The open-world mode: ride freely through the forest and the enduro stadium, chase camera
// GTA-style or the view from the helmet, two timed routes started from glowing markers.
// Runs on its own canvas and loop; main.ts only opens and closes it.

export interface OpenOptions {
  look: Look;
  power: number;
  twoStroke: boolean;
  sound: Sound;
  onExit(): void;
  onCoins(n: number): void;
}

interface RaceDef {
  id: string;
  name: string;
  start: { x: number; z: number; yaw: number };
  gates: { x: number; z: number; yaw: number }[];
  laps: number;
  reward: number; // coins for the first finish (later finishes pay a third)
}

const DT = 1 / 60;
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const store = {
  get(k: string) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? null : Number(v);
    } catch {
      return null;
    }
  },
  set(k: string, v: number) {
    try {
      localStorage.setItem(k, String(v));
    } catch {
      /* not saved */
    }
  },
};

export async function startOpenWorld(opts: OpenOptions) {
  await RAPIER.init();
  const w = new OpenWorld(opts);
  if (import.meta.env.DEV) Object.assign(window, { ow: w });
  return w;
}

const HUD = `
  <canvas class="o-canvas"></canvas>
  <button class="o-btn o-pause" data-k="pause" aria-label="Пауза"><i></i><i></i></button>
  <div class="o-race hidden"></div>
  <div class="o-hint"></div>
  <div class="o-count hidden"></div>
  <div class="o-toast hidden"></div>
  <canvas class="o-map" width="300" height="300"></canvas>
  <div class="o-speed"><b>0</b><small>км/ч</small></div>
  <button class="o-btn o-cam" data-k="cam" aria-label="Камера">🎥</button>
  <div class="o-pad left">
    <button class="o-brake" data-k="brake" aria-label="Тормоз"></button>
    <button class="o-gas" data-k="gas" aria-label="Газ"></button>
  </div>
  <div class="o-pad right">
    <button class="o-steer l" data-k="left" aria-label="Влево"><i></i></button>
    <button class="o-steer r" data-k="right" aria-label="Вправо"><i></i></button>
  </div>
  <div class="o-crash hidden"><span>Падение!</span></div>
  <div class="o-menu hidden">
    <div class="panel">
      <h2>Открытый мир</h2>
      <button class="primary-wide" data-k="resume">Продолжить</button>
      <div class="row o-row">
        <button data-k="cam">Сменить камеру</button>
        <button data-k="home">На старт</button>
      </div>
      <button class="o-cancel hidden" data-k="cancel">Прервать заезд</button>
      <p class="keys">Клавиатура: <b>W/↑</b> газ · <b>S/↓</b> тормоз и назад · <b>A D / ← →</b> руль · <b>C</b> камера · <b>R</b> на ноги · <b>Esc</b> пауза</p>
      <button class="link" data-k="exit">Выйти в главное меню</button>
    </div>
  </div>`;

class OpenWorld {
  private o: OpenOptions;
  private root = document.createElement("div");
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  private sun = new THREE.DirectionalLight("#fff4e0", 2.4);
  private world: RAPIER.World;
  private built: Built;
  private bike: Bike3D;
  private model: BikeModel;
  private holder = new THREE.Group();
  private pose: BikePose;
  private poseRear: { x: number; y: number; a: number; y0?: number } = { x: 0, y: 0, a: 0 };
  private poseFront: { x: number; y: number; a: number; y0?: number } = { x: 0, y: 0, a: 0 };
  private keys = new Set<string>();
  private touch = new Set<string>();
  private steer = 0;
  private camMode: "chase" | "helmet" = "chase";
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private paused = false;
  private crashTimer = 0;
  private safe = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };
  private safeTimer = 0;
  private races: RaceDef[];
  private markers: THREE.Group[] = [];
  private armed: boolean[] = []; // a marker starts its route again only after the bike has left it
  private race: { def: RaceDef; gate: number; lap: number; time: number; countdown: number } | null = null;
  private ring: THREE.Mesh;
  private ring2: THREE.Mesh;
  private toastTimer = 0;
  private clock = 0;
  private wasGrounded = true;
  private airTime = 0;
  private lastVy = 0;
  private engine: Bike;
  private offs: (() => void)[] = [];

  constructor(o: OpenOptions) {
    this.o = o;
    this.root.className = "open-root";
    this.root.innerHTML = HUD;
    document.body.appendChild(this.root);
    const canvas = this.root.querySelector<HTMLCanvasElement>(".o-canvas")!;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    const coarse = matchMedia("(pointer: coarse)").matches;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;

    // Sky, light and haze of a summer forest.
    const s = this.scene;
    s.background = new THREE.Color("#a9d4f2");
    s.fog = new THREE.Fog("#c9e2f0", 80, 430);
    s.add(new THREE.HemisphereLight("#d8ecff", "#4a5a30", 1.35));
    this.sun.castShadow = true;
    const sz = coarse ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -45;
    sc.right = sc.top = 45;
    sc.near = 10;
    sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun, this.sun.target);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.built = buildWorld(RAPIER, this.world, s);
    const g = this.built.ground;
    this.bike = new Bike3D(RAPIER, this.world, { x: SPAWN.x, y: g.at(SPAWN.x, SPAWN.z) + 0.9, z: SPAWN.z }, SPAWN.yaw, o.power);

    // The garage bike and rider, posed from a resting 2D bike with live suspension and spin.
    this.model = new BikeModel(o.look, true);
    if (this.model.marker) this.model.marker.visible = false;
    if (this.model.halo) this.model.halo.visible = false;
    const rest = restingPose();
    const r0 = rest.rear.getPosition();
    const f0 = rest.front.getPosition();
    Object.assign(this.poseRear, { x: r0.x, y: r0.y });
    Object.assign(this.poseFront, { x: f0.x, y: f0.y });
    const body = (p: { x: number; y: number; a: number }): BodyPose => ({ getPosition: () => ({ x: p.x, y: p.y }), getAngle: () => p.a });
    this.pose = { chassis: rest.chassis, rear: body(this.poseRear), front: body(this.poseFront), lean: 0 };
    const inner = new THREE.Group();
    inner.add(this.model.root);
    // Hub line of the model on the physics wheels' hubs (0.19 m under the body origin).
    inner.position.set(-(r0.x + f0.x) / 2, -0.19 - (r0.y + f0.y) / 2, 0);
    this.holder.add(inner);
    s.add(this.holder);

    this.races = [
      { id: "stadium", name: "Эндуро-стадион", start: this.built.startStadium, gates: this.built.stadiumGates, laps: 2, reward: 150 },
      { id: "forest", name: "Лесной маршрут", start: this.built.startTrail, gates: this.built.trailGates, laps: 1, reward: 250 },
    ];
    for (const r of this.races) {
      this.markers.push(this.marker(r));
      this.armed.push(true);
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: "#ffb21a", transparent: true, opacity: 0.85, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.28, 8, 40), ringMat);
    this.ring2 = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.18, 8, 40), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false }));
    this.ring.visible = this.ring2.visible = false;
    s.add(this.ring, this.ring2);

    // An object the engine sound can read like a 2D bike.
    const self = this;
    this.engine = {
      power: 1,
      twoStroke: o.twoStroke,
      get grounded() {
        return self.bike.grounded;
      },
      rear: { getAngularVelocity: () => (self.bike.speed / (OPEN_BIKE.topSpeed * self.bike.power)) * 62 },
      chassis: { getPosition: () => ({ x: 0, y: 0 }), getLinearVelocity: () => self.bike.body.linvel() },
    } as unknown as Bike;

    this.wireInput();
    this.resize();
    const onResize = () => this.resize();
    window.addEventListener("resize", onResize);
    this.offs.push(() => window.removeEventListener("resize", onResize));
    const onHide = () => document.hidden && this.setPaused(true);
    document.addEventListener("visibilitychange", onHide);
    this.offs.push(() => document.removeEventListener("visibilitychange", onHide));
    this.snapCamera();
    this.toast("Катайся где хочешь. Жёлтые круги — старт заездов");
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  // A glowing cylinder with a floating sign: drive into it to start a route.
  private marker(r: RaceDef) {
    const g = new THREE.Group();
    const y = this.built.ground.at(r.start.x, r.start.z);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.6, 3.2, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: "#ffd21f", transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.y = 1.6;
    const best = store.get(`open:best:${r.id}`);
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(10,18,30,0.8)";
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 144, 24);
    ctx.fill();
    ctx.fillStyle = "#ffd21f";
    ctx.font = "italic 900 54px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(r.name.toUpperCase(), 256, 72, 480);
    ctx.fillStyle = "#fff";
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.fillText(best ? `Рекорд ${fmt(best)}` : `Награда ${r.reward} монет`, 256, 126);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
    sign.scale.set(6.4, 2, 1);
    sign.position.y = 4.8;
    g.add(beam, sign);
    g.position.set(r.start.x, y, r.start.z);
    this.scene.add(g);
    return g;
  }

  private $(sel: string) {
    return this.root.querySelector<HTMLElement>(sel)!;
  }

  private wireInput() {
    const KEYMAP: Record<string, string> = {
      ArrowUp: "gas",
      KeyW: "gas",
      ArrowDown: "brake",
      KeyS: "brake",
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyD: "right",
    };
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      const k = KEYMAP[e.code];
      if (k) {
        this.keys.add(k);
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.repeat) return;
      if (e.code === "KeyC") this.toggleCam();
      else if (e.code === "KeyR") this.respawn(this.safe);
      else if (e.code === "Escape" || e.code === "KeyP") this.setPaused(!this.paused);
      e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k) this.keys.delete(k);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    const blur = () => {
      this.keys.clear();
      this.touch.clear();
    };
    window.addEventListener("blur", blur);
    this.offs.push(() => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
    });
    // Hold buttons (gas, brake, steering) and tap buttons (everything else).
    this.root.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => {
      const k = el.dataset.k!;
      if (["gas", "brake", "left", "right"].includes(k)) {
        el.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          this.touch.add(k);
          el.classList.add("down");
        });
        const release = () => {
          this.touch.delete(k);
          el.classList.remove("down");
        };
        el.addEventListener("pointerup", release);
        el.addEventListener("pointercancel", release);
        el.addEventListener("contextmenu", (e) => e.preventDefault());
      } else
        el.addEventListener("click", () => {
          this.o.sound.click();
          if (k === "pause") this.setPaused(true);
          else if (k === "resume") this.setPaused(false);
          else if (k === "cam") this.toggleCam();
          else if (k === "home") {
            this.endRace();
            this.respawn({ x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw });
            this.setPaused(false);
          } else if (k === "cancel") {
            this.endRace();
            this.setPaused(false);
          } else if (k === "exit") this.exit();
        });
    });
  }

  private held(k: string) {
    return this.keys.has(k) || this.touch.has(k);
  }

  private setPaused(p: boolean) {
    this.paused = p;
    this.$(".o-menu").classList.toggle("hidden", !p);
    this.$(".o-cancel").classList.toggle("hidden", !this.race);
    if (p) {
      this.keys.clear();
      this.touch.clear();
    }
  }

  private toggleCam() {
    this.camMode = this.camMode === "chase" ? "helmet" : "chase";
    // From the helmet only the forearms, gloves, legs and the bike show.
    const chase = this.camMode === "chase";
    this.model.helmet.visible = this.model.neck.visible = this.model.torso.visible = chase;
    for (const m of this.model.uppers) m.visible = chase;
    this.camera.near = this.camMode === "helmet" ? 0.06 : 0.3;
    this.camera.updateProjectionMatrix();
    this.toast(this.camMode === "helmet" ? "Вид из шлема" : "Камера сзади");
    this.snapCamera();
  }

  private toast(text: string) {
    const el = this.$(".o-toast");
    el.textContent = text;
    el.classList.remove("hidden");
    this.toastTimer = 2.6;
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private respawn(at: { x: number; z: number; yaw: number }) {
    const y = this.built.ground.at(at.x, at.z);
    this.bike.placeAt({ x: at.x, y: Math.max(y, WATER_Y + 0.5) + 0.9, z: at.z }, at.yaw);
    this.crashTimer = 0;
    this.$(".o-crash").classList.add("hidden");
    this.snapCamera();
  }

  // ---------- Routes ----------

  private startRace(def: RaceDef) {
    this.race = { def, gate: 0, lap: 1, time: 0, countdown: 3 };
    for (const m of this.markers) m.visible = false;
    this.armed = this.armed.map(() => false);
    this.respawn(def.start);
    this.showGate();
    this.o.sound.beep();
    this.$(".o-race").classList.remove("hidden");
  }

  private endRace() {
    this.race = null;
    for (const m of this.markers) m.visible = true;
    this.armed = this.armed.map(() => false);
    this.ring.visible = this.ring2.visible = false;
    this.$(".o-race").classList.add("hidden");
    this.$(".o-count").classList.add("hidden");
  }

  private showGate() {
    const r = this.race!;
    const place = (m: THREE.Mesh, i: number) => {
      const gt = r.def.gates[i % r.def.gates.length];
      const y = this.built.ground.at(gt.x, gt.z);
      m.position.set(gt.x, y + 3.2, gt.z);
      m.rotation.set(0, gt.yaw + Math.PI / 2, 0);
      m.visible = true;
    };
    place(this.ring, r.gate);
    const lastLapLastGate = r.lap === r.def.laps && r.gate === r.def.gates.length - 1;
    if (lastLapLastGate) this.ring2.visible = false;
    else place(this.ring2, r.gate + 1);
  }

  private updateRace(dt: number) {
    const r = this.race;
    if (!r) {
      // Free ride: a marker starts its route.
      const p = this.bike.position;
      this.races.forEach((def, i) => {
        const d = Math.hypot(p.x - def.start.x, p.z - def.start.z);
        if (d > 6) this.armed[i] = true;
        else if (d < 2.8 && this.armed[i] && Math.abs(this.bike.speed) < 14) this.startRace(def);
      });
      return;
    }
    const count = this.$(".o-count");
    if (r.countdown > 0) {
      const before = Math.ceil(r.countdown);
      r.countdown -= dt;
      // Hold the bike on the line.
      this.bike.body.setLinvel({ x: 0, y: Math.min(0, this.bike.body.linvel().y), z: 0 }, true);
      count.classList.remove("hidden");
      count.textContent = r.countdown > 0 ? String(Math.ceil(r.countdown)) : "Старт!";
      if (Math.ceil(r.countdown) !== before) this.o.sound.beep(r.countdown <= 0);
      if (r.countdown <= 0) setTimeout(() => count.classList.add("hidden"), 600);
    } else r.time += dt;
    const p = this.bike.position;
    const gt = r.def.gates[r.gate];
    if (Math.hypot(p.x - gt.x, p.z - gt.z) < 5.5) {
      r.gate++;
      this.o.sound.chime();
      if (r.gate >= r.def.gates.length) {
        r.gate = 0;
        r.lap++;
        if (r.lap > r.def.laps) return this.finishRace();
        this.toast(r.lap === r.def.laps ? "Последний круг!" : `Круг ${r.lap}`);
        this.o.sound.lap();
      }
      this.showGate();
    }
    const lapTxt = r.def.laps > 1 ? ` · Круг ${Math.min(r.lap, r.def.laps)}/${r.def.laps}` : "";
    this.$(".o-race").innerHTML = `<small>${r.def.name}${lapTxt} · Ворота ${r.gate + 1}/${r.def.gates.length}</small><b>${fmt(r.time)}</b>`;
  }

  private finishRace() {
    const r = this.race!;
    const key = `open:best:${r.def.id}`;
    const prev = store.get(key);
    const record = prev === null || r.time < prev;
    if (record) store.set(key, r.time);
    const first = prev === null;
    const coins = (first ? r.def.reward : Math.round(r.def.reward / 3)) + (record && !first ? 50 : 0);
    this.o.onCoins(coins);
    this.o.sound.finish(true);
    this.toast(`${r.def.name}: ${fmt(r.time)}${record ? " — рекорд!" : ` (рекорд ${fmt(prev!)})`}  +${coins} монет`);
    this.toastTimer = 5;
    // Refresh the sign with the new record.
    const i = this.races.indexOf(r.def);
    this.scene.remove(this.markers[i]);
    this.markers[i] = this.marker(r.def);
    this.markers[i].visible = false; // shown again by endRace()
    this.endRace();
  }

  // ---------- Frame ----------

  private frame(dt: number) {
    this.clock += dt;
    if (!this.paused) {
      const target = (this.held("right") ? 1 : 0) - (this.held("left") ? 1 : 0);
      this.steer += (target - this.steer) * Math.min(1, dt * 7);
      const frozen = this.crashTimer > 0 || (this.race?.countdown ?? 0) > 0;
      const input = frozen ? { gas: 0, brake: 0, steer: 0 } : { gas: this.held("gas") ? 1 : 0, brake: this.held("brake") ? 1 : 0, steer: this.steer };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 5) {
        const p = this.bike.position;
        const mud = this.built.inMud(p.x, p.z);
        this.bike.power = this.o.power * (mud ? 0.55 : 1);
        if (mud && this.bike.grounded) {
          const v = this.bike.body.linvel();
          this.bike.body.applyImpulse({ x: -v.x * 0.9 * OPEN_BIKE.mass * DT, y: 0, z: -v.z * 0.9 * OPEN_BIKE.mass * DT }, true);
        }
        this.bike.apply(input, DT);
        this.world.step();
        this.acc -= DT;
        steps++;
      }
      if (steps === 5) this.acc = 0;
      this.afterPhysics(dt, input.gas > 0);
    }
    this.render(dt);
  }

  private afterPhysics(dt: number, gas: boolean) {
    const b = this.bike;
    const p = b.position;
    // Crashes: lying down, drowned, fallen off the world.
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.respawn(this.safe);
    } else if (b.crashed || p.y < WATER_Y - 0.4 || p.y < -30) {
      this.crashTimer = 1.4;
      this.$(".o-crash").classList.remove("hidden");
      this.$(".o-crash span").textContent = p.y < WATER_Y - 0.4 ? "В воду!" : "Падение!";
      this.o.sound.crash();
    } else {
      // Remember where the bike was last upright on its wheels, to put it back there.
      this.safeTimer += dt;
      if (this.safeTimer > 0.6 && b.grounded && Math.abs(b.roll) < 0.3 && p.y > WATER_Y + 0.3) {
        this.safeTimer = 0;
        this.safe = { x: p.x, z: p.z, yaw: b.yaw };
      }
    }
    // Landing thumps.
    const g = b.grounded;
    if (!g) {
      this.airTime += dt;
      this.lastVy = b.body.linvel().y;
    } else if (!this.wasGrounded && this.airTime > 0.3) this.o.sound.land(Math.min(1, Math.abs(this.lastVy) / 12));
    if (g) this.airTime = 0;
    this.wasGrounded = g;
    this.o.sound.updateEngines([{ bike: this.engine, isPlayer: true, gas, active: this.crashTimer <= 0 }], 0, true, dt);
    this.updateRace(dt);
  }

  private snapCamera() {
    this.placeCamera(1, true);
  }

  private placeCamera(dt: number, snap = false) {
    const b = this.bike;
    const p = b.position;
    const q = b.rotation;
    const yaw = b.yaw;
    const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (this.camMode === "chase") {
      const speed = Math.abs(b.speed);
      const back = 5.2 + speed * 0.06;
      const want = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(fwd, -back).add(new THREE.Vector3(0, 2.1, 0));
      const look = new THREE.Vector3(p.x, p.y + 0.9, p.z).addScaledVector(fwd, 3);
      const k = snap ? 1 : 1 - Math.exp(-dt * 5);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 9));
      const floor = this.built.ground.at(this.camPos.x, this.camPos.z) + 0.7;
      if (this.camPos.y < floor) this.camPos.y = floor;
      // Walls, stands and trees between the bike and the camera pull the camera in.
      const from = { x: p.x, y: p.y + 1.2, z: p.z };
      const dir = { x: this.camPos.x - from.x, y: this.camPos.y - from.y, z: this.camPos.z - from.z };
      const dist = Math.hypot(dir.x, dir.y, dir.z);
      this.camera.position.copy(this.camPos);
      if (dist > 0.5) {
        const ray = new RAPIER.Ray(from, { x: dir.x / dist, y: dir.y / dist, z: dir.z / dist });
        const hit = this.world.castRay(ray, dist, true, undefined, undefined, undefined, b.body);
        if (hit && hit.timeOfImpact < dist) {
          const t = Math.max(0.6, hit.timeOfImpact - 0.35);
          this.camera.position.set(from.x + (dir.x / dist) * t, from.y + (dir.y / dist) * t, from.z + (dir.z / dist) * t);
        }
      }
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.camLook);
      this.camera.fov = 62 + Math.min(12, speed * 0.4);
    } else {
      // From the helmet: the horizon tilts with half the bike's lean.
      const F = rotate(q, { x: 1, y: 0, z: 0 });
      const U = rotate(q, { x: 0, y: 1, z: 0 });
      // Eyes where the helmet is, looking ~20° down so the bars and gloves are in view.
      this.holder.updateMatrixWorld(true);
      const eyes = this.model.helmet.getWorldPosition(new THREE.Vector3()).addScaledVector(new THREE.Vector3(F.x, F.y, F.z), -0.06);
      this.camera.position.copy(eyes);
      const upv = new THREE.Vector3(U.x, U.y, U.z).add(new THREE.Vector3(0, 1, 0)).normalize();
      this.camera.up.copy(upv);
      this.camera.lookAt(this.camera.position.x + F.x * 10 - U.x * 5.2, this.camera.position.y + F.y * 10 - U.y * 5.2, this.camera.position.z + F.z * 10 - U.z * 5.2);
      this.camera.fov = 84;
    }
    this.camera.updateProjectionMatrix();
  }

  private render(dt: number) {
    const b = this.bike;
    const p = b.position;
    const q = b.rotation;
    this.holder.position.set(p.x, p.y, p.z);
    this.holder.quaternion.set(q.x, q.y, q.z, q.w);
    // Suspension and wheel spin onto the model's pose.
    const rs = b.wheelState(1);
    const fs = b.wheelState(0);
    this.posePoseWheel(this.poseRear, rs, 1);
    this.posePoseWheel(this.poseFront, fs, 0);
    this.pose.lean = (this.held("brake") ? 0.3 : 0) - (this.held("gas") ? 0.2 : 0);
    this.model.update(this.pose, this.clock, 0);
    this.model.front.rotation.y = b.steer;

    this.placeCamera(dt);
    this.sun.position.set(p.x + 40, p.y + 70, p.z + 25);
    this.sun.target.position.set(p.x, p.y, p.z);
    for (const m of this.markers) (m.children[0] as THREE.Mesh).rotation.y += dt * 0.6;
    if (this.ring.visible) this.ring.rotation.z += dt;
    // Water drifts.
    const wt = (this.built.water.material as THREE.MeshLambertMaterial).map!;
    wt.offset.set(this.clock * 0.01, this.clock * 0.004);

    this.$(".o-speed b").textContent = String(Math.round(Math.abs(b.speed) * 3.6));
    this.$(".o-hint").textContent = this.race ? "" : "Заезжай в жёлтый круг, чтобы начать заезд";
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.$(".o-toast").classList.add("hidden");
    }
    this.drawMap();
    this.gl.render(this.scene, this.camera);
  }

  private posePoseWheel(w: { x: number; y: number; a: number; y0?: number }, s: { travel: number; spin: number }, _i: number) {
    if (w.y0 === undefined) w.y0 = w.y;
    // Compressed suspension lifts the wheel towards the frame.
    w.y = w.y0 + (0.31 - s.travel);
    w.a = -s.spin;
  }

  // Heading-up minimap: the trail, the stadium, the start markers and the next gate.
  private drawMap() {
    const c = this.$(".o-map") as HTMLCanvasElement;
    const ctx = c.getContext("2d")!;
    const W = c.width;
    const p = this.bike.position;
    const scale = 1.1; // canvas px per map px (map: 1.25 m per px)
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "#3a5a30";
    ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(this.bike.yaw - Math.PI / 2);
    const mx = ((p.x + HALF) / 1.25) * scale;
    const mz = ((p.z + HALF) / 1.25) * scale;
    ctx.drawImage(this.built.map, -mx, -mz, 512 * scale, 512 * scale);
    const dot = (x: number, z: number, color: string, r: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(((x + HALF) / 1.25) * scale - mx, ((z + HALF) / 1.25) * scale - mz, r, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const r of this.races) dot(r.start.x, r.start.z, "#ffd21f", 9);
    if (this.race) {
      const gt = this.race.def.gates[this.race.gate];
      dot(gt.x, gt.z, "#ff8a1f", 8);
    }
    ctx.restore();
    // The player: an arrow in the middle, pointing up.
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(W / 2, W / 2 - 16);
    ctx.lineTo(W / 2 + 11, W / 2 + 12);
    ctx.lineTo(W / 2, W / 2 + 6);
    ctx.lineTo(W / 2 - 11, W / 2 + 12);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  exit() {
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    this.o.sound.updateEngines([], 0, false, 0);
    this.bike.dispose();
    this.world.free();
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh;
      m.geometry?.dispose?.();
    });
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.root.remove();
    this.o.onExit();
  }
}

export type { OpenWorld };
