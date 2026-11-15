import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import type { Sound } from "../audio.ts";
import type { Bike, BikePose, BodyPose } from "../bike.ts";
import type { Look } from "../race.ts";
import { BikeModel, restingPose } from "../render3d.ts";
import { Bike3D, type BikeInput, OPEN_BIKE, rotate } from "./bike3d.ts";
import { Dust } from "./fx.ts";
import { Grass } from "./grass.ts";
import { SUN_DIR, SkyDome } from "./sky.ts";
import { bladesTexture } from "./textures.ts";
import { type Built, HALF, N, SPAWN, STEP, WATER_Y, buildWorld } from "./world.ts";

// The open-world mode: ride freely through the forest and the enduro stadium, chase camera
// or the view from the helmet, two timed routes started from glowing markers. Runs on its
// own canvas and loop; main.ts only opens and closes it.

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

const DT = 1 / 120;
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
  <button class="o-btn o-mute mute-btn" data-k="mute" aria-label="Звук" title="Звук (M)"><svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path class="snd-on" d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.5 7.5 0 0 1 0 10.4" /><path class="snd-off" d="M15.5 9.5l5 5M20.5 9.5l-5 5" /></svg></button>
  <div class="o-race hidden"></div>
  <div class="o-hint"></div>
  <div class="o-count hidden"></div>
  <div class="o-toast hidden"></div>
  <canvas class="o-map" width="300" height="300"></canvas>
  <div class="o-speed"><div class="o-rpm"><span></span></div><b>0</b><small>км/ч</small><i class="o-gear">1</i></div>
  <button class="o-btn o-cam" data-k="cam" aria-label="Камера">🎥</button>
  <div class="o-pad left">
    <button class="o-brake" data-k="brake" aria-label="Тормоз"></button>
    <button class="o-gas" data-k="gas" aria-label="Газ"></button>
  </div>
  <div class="o-pad right">
    <button class="o-rear" data-k="rear" aria-label="Задний тормоз">Зад.<br>тормоз</button>
    <button class="o-steer l" data-k="left" aria-label="Наклон влево"><i></i></button>
    <button class="o-steer r" data-k="right" aria-label="Наклон вправо"><i></i></button>
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
      <p class="keys">Клавиатура: <b>W/↑</b> газ · <b>S/↓</b> тормоз · <b>Пробел</b> задний тормоз (занос) · <b>A D / ← →</b> наклон в поворот · <b>C</b> камера · <b>M</b> звук · <b>R</b> на ноги · <b>Esc</b> пауза</p>
      <p class="keys">Мотоцикл ведёт себя как настоящий: в поворот его наклоняют, на газу в первой передаче поднимается переднее колесо, резкий задний тормоз срывает заднее колесо в занос, а в воздухе газ поднимает нос, тормоз опускает.</p>
      <button class="link" data-k="exit">Выйти в главное меню</button>
    </div>
  </div>`;

// The garage bike uses Lambert materials; out here it gets physically based ones so the
// sky lights and reflects off it like everything else.
function toStandard(root: THREE.Object3D) {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((n) => {
    const m = n as THREE.Mesh;
    if (!m.isMesh) return;
    const conv = (mat: THREE.Material) => {
      let out = cache.get(mat);
      if (!out) {
        const l = mat as THREE.MeshLambertMaterial;
        out = l.isMeshLambertMaterial
          ? new THREE.MeshStandardMaterial({ map: l.map, color: l.color, transparent: l.transparent, opacity: l.opacity, side: l.side, vertexColors: l.vertexColors, depthWrite: l.depthWrite, roughness: 0.55, metalness: 0.05 })
          : mat;
        cache.set(mat, out);
      }
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
    m.castShadow = true;
  });
}

class OpenWorld {
  private o: OpenOptions;
  private root = document.createElement("div");
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  private sun = new THREE.DirectionalLight("#fff1dc", 2.35);
  private sky: SkyDome;
  private grass: Grass;
  private dust: Dust;
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
  private lean = 0;
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
  private backTimer = 0;
  private engine: Bike;
  private offs: (() => void)[] = [];
  private mobile: boolean;

  constructor(o: OpenOptions) {
    this.o = o;
    this.root.className = "open-root";
    this.root.innerHTML = HUD;
    document.body.appendChild(this.root);
    const canvas = this.root.querySelector<HTMLCanvasElement>(".o-canvas")!;
    this.mobile = matchMedia("(pointer: coarse)").matches;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 0.95;

    // Sky, sun, haze of a summer forest.
    const s = this.scene;
    this.sky = new SkyDome(s, this.gl);
    s.environmentIntensity = 0.6;
    s.fog = new THREE.FogExp2("#b9cfe0", 0.0021);
    s.add(new THREE.HemisphereLight("#cfe3ff", "#3e4a28", 0.35));
    this.sun.castShadow = true;
    const sz = this.mobile ? 1024 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -38;
    sc.right = sc.top = 38;
    sc.near = 5;
    sc.far = 220;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = DT;
    this.built = buildWorld(RAPIER, this.world, s, { mobile: this.mobile });
    const g = this.built.ground;
    this.grass = new Grass({
      heights: g.heights,
      N,
      half: HALF,
      step: STEP,
      mask: this.built.grassMask,
      maskSize: 256,
      count: this.mobile ? 16000 : 42000,
      patch: this.mobile ? 56 : 80,
      map: bladesTexture(),
    });
    s.add(this.grass.mesh);
    this.dust = new Dust(s);
    this.bike = new Bike3D(RAPIER, this.world, { x: SPAWN.x, y: g.at(SPAWN.x, SPAWN.z) + 0.95, z: SPAWN.z }, SPAWN.yaw, o.power, o.twoStroke);
    this.bike.surface = this.built.surface;

    // The garage bike and rider, posed from a resting 2D bike with live suspension and spin.
    this.model = new BikeModel(o.look, true);
    if (this.model.marker) this.model.marker.visible = false;
    if (this.model.halo) this.model.halo.visible = false;
    toStandard(this.model.root);
    const rest = restingPose();
    const r0 = rest.rear.getPosition();
    const f0 = rest.front.getPosition();
    Object.assign(this.poseRear, { x: r0.x, y: r0.y });
    Object.assign(this.poseFront, { x: f0.x, y: f0.y });
    const body = (p: { x: number; y: number; a: number }): BodyPose => ({ getPosition: () => ({ x: p.x, y: p.y }), getAngle: () => p.a });
    this.pose = { chassis: rest.chassis, rear: body(this.poseRear), front: body(this.poseFront), lean: 0 };
    const inner = new THREE.Group();
    inner.add(this.model.root);
    // The model's hubs on the physics hubs at rest (sagged), relative to the centre of mass.
    const B = OPEN_BIKE;
    const hubRest = B.hubTop - (B.travel - Bike3D.restSag);
    const mid = (B.wheelX[0] + B.wheelX[1]) / 2;
    inner.position.set(mid - (r0.x + f0.x) / 2, hubRest - (r0.y + f0.y) / 2, 0);
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

    // An object the engine sound can read like a 2D bike (the rpm itself comes from the sim).
    const self = this;
    this.engine = {
      power: 1,
      twoStroke: o.twoStroke,
      get grounded() {
        return self.bike.grounded;
      },
      rear: { getAngularVelocity: () => self.bike.wheels[1].omega },
      chassis: { getPosition: () => ({ x: 0, y: 0 }), getLinearVelocity: () => self.bike.body.linvel() },
    } as unknown as Bike;

    this.wireInput();
    const muteBtn = this.$(".o-mute");
    this.offs.push(
      o.sound.onMuteChange((m) => {
        muteBtn.classList.toggle("muted", m);
        muteBtn.title = m ? "Включить звук (M)" : "Выключить звук (M)";
      }),
    );
    this.resize();
    const onResize = () => this.resize();
    window.addEventListener("resize", onResize);
    this.offs.push(() => window.removeEventListener("resize", onResize));
    const onHide = () => document.hidden && this.setPaused(true);
    document.addEventListener("visibilitychange", onHide);
    this.offs.push(() => document.removeEventListener("visibilitychange", onHide));
    this.snapCamera();
    this.toast("Наклоняй мотоцикл в поворот. Жёлтые круги — старт заездов");
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
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
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
      Space: "rear",
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
      else if (e.code === "KeyM") this.o.sound.toggleMute();
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
    // Hold buttons (gas, brakes, lean) and tap buttons (everything else).
    this.root.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => {
      const k = el.dataset.k!;
      if (["gas", "brake", "rear", "left", "right"].includes(k)) {
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
          else if (k === "mute") this.o.sound.toggleMute();
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
    this.dust.setViewport(h * this.gl.getPixelRatio(), this.camera.fov);
  }

  private respawn(at: { x: number; z: number; yaw: number }) {
    const y = this.built.ground.at(at.x, at.z);
    this.bike.placeAt({ x: at.x, y: Math.max(y, WATER_Y + 0.5) + 0.95, z: at.z }, at.yaw);
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

  private input(): BikeInput {
    const frozen = this.crashTimer > 0 || (this.race?.countdown ?? 0) > 0;
    if (frozen) return { gas: 0, brake: 0, rearBrake: 0, lean: 0 };
    return { gas: this.held("gas") ? 1 : 0, brake: this.held("brake") ? 1 : 0, rearBrake: this.held("rear") ? 1 : 0, lean: this.lean };
  }

  frame(dt: number) {
    this.clock += dt;
    if (!this.paused) {
      const target = (this.held("right") ? 1 : 0) - (this.held("left") ? 1 : 0);
      this.lean += (target - this.lean) * Math.min(1, dt * 10);
      const input = this.input();
      // At a standstill, holding the brake walks the bike backwards (the rider paddles).
      this.backTimer = input.brake && Math.abs(this.bike.speed) < 0.8 && this.bike.grounded ? this.backTimer + dt : 0;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 12) {
        if (this.backTimer > 0.5) {
          const F = rotate(this.bike.rotation, { x: 1, y: 0, z: 0 });
          const v = this.bike.speed;
          const push = (-1.3 - v) * OPEN_BIKE.mass * 0.08;
          this.bike.body.applyImpulse({ x: F.x * push, y: 0, z: F.z * push }, true);
        }
        this.bike.apply(this.backTimer > 0.5 ? { ...input, brake: 0 } : input, DT);
        this.world.step();
        this.acc -= DT;
        steps++;
      }
      if (steps === 12) this.acc = 0;
      this.afterPhysics(dt, input);
    }
    this.render(dt);
  }

  private afterPhysics(dt: number, input: BikeInput) {
    const b = this.bike;
    const p = b.position;
    // Crashes: lying down, a hard hit, drowned, fallen off the world.
    if (this.crashTimer > 0) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.respawn(this.safe);
    } else if (b.crashed || p.y < WATER_Y - 0.4 || p.y < -30) {
      this.crashTimer = 2.2;
      b.crashed = true;
      this.$(".o-crash").classList.remove("hidden");
      this.$(".o-crash span").textContent = p.y < WATER_Y - 0.4 ? "В воду!" : b.crashReason || "Падение!";
      this.o.sound.crash();
    } else {
      // Remember where the bike was last upright on its wheels, to put it back there.
      this.safeTimer += dt;
      if (this.safeTimer > 0.6 && b.wheels[0].contact && b.wheels[1].contact && Math.abs(b.roll) < 0.3 && p.y > WATER_Y + 0.3) {
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
    this.o.sound.updateEngines([{ bike: this.engine, isPlayer: true, gas: input.gas > 0, active: this.crashTimer <= 0, rpm: Math.min(1, b.rpm01), throttle: b.throttle }], 0, true, dt);
    this.updateRace(dt);
    this.kickUp(dt);
  }

  // Dust off the tyres: roost from a spinning or sliding rear, a trail of dust at speed.
  private kickUp(dt: number) {
    const b = this.bike;
    const v = b.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    b.wheels.forEach((w, i) => {
      if (!w.contact) return;
      const p = w.point;
      const surf = this.built.surface(p.x, p.z);
      const mud = surf.roll > 0.1;
      const rate = (i === 1 ? w.slip * 90 : w.slip * 40) + Math.max(0, speed - 6) * (surf.mu > 0.95 ? 2.2 : 0.8);
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) {
          const back = rotate(b.rotation, { x: -1, y: 0, z: 0 });
          const fling = i === 1 ? 2 + w.slip * 6 : 1;
          const col = mud ? new THREE.Color("#4a3a28") : surf.mu > 0.95 ? new THREE.Color("#b49a78") : new THREE.Color("#8f8a66");
          this.dust.emit(
            new THREE.Vector3(p.x, p.y + 0.15, p.z),
            new THREE.Vector3(v.x * 0.4 + back.x * fling + (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * (1 + w.slip * 2), v.z * 0.4 + back.z * fling + (Math.random() - 0.5) * 1.5),
            col,
            0.35 + Math.random() * 0.4,
            1 + Math.random() * 0.8,
          );
        }
        n -= 1;
      }
    });
    this.dust.update(dt);
  }

  private snapCamera() {
    this.placeCamera(1, true);
  }

  // Dev only: hold the camera at a spot to look at the world.
  debugCam: { pos: THREE.Vector3Like; look: THREE.Vector3Like } | null = null;

  private placeCamera(dt: number, snap = false) {
    if (this.debugCam) {
      this.camera.position.copy(this.debugCam.pos);
      this.camera.up.set(0, 1, 0);
      this.camera.lookAt(this.debugCam.look.x, this.debugCam.look.y, this.debugCam.look.z);
      this.camera.updateProjectionMatrix();
      return;
    }
    const b = this.bike;
    const p = b.position;
    const q = b.rotation;
    const yaw = b.yaw;
    const fwd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    if (this.camMode === "chase") {
      const speed = Math.abs(b.speed);
      const back = 4.6 + speed * 0.05;
      const want = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(fwd, -back).add(new THREE.Vector3(0, 1.7, 0));
      const look = new THREE.Vector3(p.x, p.y + 0.6, p.z).addScaledVector(fwd, 3.5);
      const k = snap ? 1 : 1 - Math.exp(-dt * 4.5);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 10));
      const floor = this.built.ground.at(this.camPos.x, this.camPos.z) + 0.6;
      if (this.camPos.y < floor) this.camPos.y = floor;
      // Walls, boards and trees between the bike and the camera pull the camera in.
      const from = { x: p.x, y: p.y + 0.9, z: p.z };
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
      // A touch of the bike's lean in the horizon.
      this.camera.up.set(0, 1, 0).applyAxisAngle(fwd, b.crashed ? 0 : -Math.max(-0.8, Math.min(0.8, b.roll)) * 0.12);
      this.camera.lookAt(this.camLook);
      this.camera.fov = 60 + Math.min(14, speed * 0.38);
    } else {
      const F = rotate(q, { x: 1, y: 0, z: 0 });
      const U = rotate(q, { x: 0, y: 1, z: 0 });
      // Eyes where the helmet is, looking down enough to see the bars and gloves; the head
      // stays more level than the bike (half its lean).
      this.holder.updateMatrixWorld(true);
      const eyes = this.model.helmet.getWorldPosition(new THREE.Vector3()).addScaledVector(new THREE.Vector3(F.x, F.y, F.z), -0.06);
      this.camera.position.copy(eyes);
      const upv = new THREE.Vector3(U.x, U.y, U.z).add(new THREE.Vector3(0, 1, 0)).normalize();
      this.camera.up.copy(upv);
      this.camera.lookAt(this.camera.position.x + F.x * 10 - U.x * 6.2, this.camera.position.y + F.y * 10 - U.y * 6.2, this.camera.position.z + F.z * 10 - U.z * 6.2);
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
    this.poseWheel(this.poseRear, b.wheels[1].x, b.wheels[1].angle);
    this.poseWheel(this.poseFront, b.wheels[0].x, b.wheels[0].angle);
    this.pose.lean = (this.held("brake") ? 0.3 : 0) - (this.held("gas") ? 0.2 : 0);
    this.model.update(this.pose, this.clock, 0);
    this.model.front.rotation.y = -b.steer;

    this.placeCamera(dt);
    const cam = this.camera.position;
    this.sky.update(cam, this.clock);
    this.grass.update(cam, this.clock);
    this.built.flags.value = this.clock;
    this.sun.position.set(p.x + SUN_DIR.x * 90, p.y + SUN_DIR.y * 90, p.z + SUN_DIR.z * 90);
    this.sun.target.position.set(p.x, p.y, p.z);
    for (const m of this.markers) (m.children[0] as THREE.Mesh).rotation.y += dt * 0.6;
    if (this.ring.visible) this.ring.rotation.z += dt;
    // Water ripples drift.
    for (const m of this.built.waterMats) m.normalMap!.offset.set(this.clock * 0.012, this.clock * 0.006);

    this.$(".o-speed b").textContent = String(Math.round(Math.abs(b.speed) * 3.6));
    this.$(".o-gear").textContent = String(b.gear + 1);
    this.$(".o-rpm span").style.width = `${Math.round(Math.min(1, b.rpm01) * 100)}%`;
    this.$(".o-rpm").classList.toggle("red", b.rpm01 > 0.9);
    this.$(".o-hint").textContent = this.race ? "" : "Заезжай в жёлтый круг, чтобы начать заезд";
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.$(".o-toast").classList.add("hidden");
    }
    this.drawMap();
    this.gl.render(this.scene, this.camera);
  }

  private poseWheel(w: { x: number; y: number; a: number; y0?: number }, compression: number, angle: number) {
    if (w.y0 === undefined) w.y0 = w.y;
    // Compressed suspension lifts the wheel towards the frame.
    w.y = w.y0 + (compression - Bike3D.restSag);
    w.a = -angle;
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
    this.scene.environment?.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.root.remove();
    this.o.onExit();
  }
}

export type { OpenWorld };
