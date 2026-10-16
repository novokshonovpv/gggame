import { autopilot } from "./ai.ts";
import { Sound } from "./audio.ts";
import { Cloud } from "./cloud.ts";
import { Controls } from "./input.ts";
import {
  MAX_LEVEL,
  MISSION_REWARD,
  PAINTS,
  UPGRADES,
  loadProfile,
  lookFor,
  raceReward,
  saveProfile,
  statsFor,
  upgradeCost,
} from "./garage.ts";
import { MISSIONS, MissionTracker, missionText } from "./missions.ts";
import { Race, type Racer } from "./race.ts";
import { GHOST_LOOK, type GhostBike, GhostRecorder, loadGhost, saveGhost } from "./ghost.ts";
import { type Camera, Renderer, type RiderView } from "./render.ts";
import { Renderer3D } from "./render3d.ts";
import { TRACKS, type Track, groundY } from "./track.ts";
import "./style.css";

const DT = 1 / 120;
const COUNTDOWN = 3;

type State = "menu" | "garage" | "countdown" | "racing" | "finished";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// localStorage can be missing or throw (private mode); the game works without it.
const store = {
  get<T>(key: string): T | null {
    try {
      const v = localStorage.getItem(key);
      return v === null ? null : (JSON.parse(v) as T);
    } catch {
      return null;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* progress just won't persist */
    }
  },
};
const bestKey = (t: Track) => `best:${t.id}`;
const missionsKey = (t: Track) => `missions:${t.id}`;
const missionsDone = (t: Track) => store.get<boolean[]>(missionsKey(t)) ?? [];

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function stars(t: Track) {
  const total = (MISSIONS[t.id] ?? []).length;
  const done = missionsDone(t).filter(Boolean).length;
  return "★".repeat(done) + "☆".repeat(Math.max(0, total - done));
}

// 3D by default; the 2D canvas renderer remains as a fallback (no WebGL) or via ?2d.
function makeRenderer(): Renderer | Renderer3D {
  const canvas = $<HTMLCanvasElement>("game");
  if (!new URLSearchParams(location.search).has("2d")) {
    try {
      return new Renderer3D(canvas);
    } catch {
      /* no WebGL: fall back to 2D */
    }
  }
  return new Renderer(canvas);
}

class Game {
  renderer = makeRenderer();
  controls = new Controls((code) => this.onKey(code));
  track: Track = TRACKS[0];
  race!: Race;
  tracker!: MissionTracker;
  state: State = "menu";
  autopilot = false; // dev/testing: let the AI ride
  countdown = 0;
  clock = 0;
  acc = 0;
  toastTimer = 0;
  frame = 0;
  cam: Camera = { x: 0, y: 0, ppm: 40 };
  profile = loadProfile();
  newMissions = 0; // missions completed for the first time in this race
  sound = new Sound();
  cloud = new Cloud();
  recorder = new GhostRecorder();
  ghost: GhostBike | null = null;
  lastCount = 0; // countdown number last beeped

  constructor() {
    window.addEventListener("resize", () => this.renderer.resize());
    // Every UI button ticks; toggles flip sound and music.
    document.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b && !b.dataset.action) this.sound.click(); // not the touch pad
    });
    const toggle = (id: string, get: () => boolean, set: (on: boolean) => void) => {
      const el = $(id);
      el.setAttribute("aria-pressed", String(get()));
      el.addEventListener("click", () => {
        set(!get());
        el.setAttribute("aria-pressed", String(get()));
      });
    };
    // Cloud save: after a pull, re-read progress and refresh whatever screen is open.
    this.cloud.onChange = (pulled) => {
      if (pulled) {
        this.profile = loadProfile();
        if (this.state === "menu") this.showMenu();
        if (this.state === "garage") this.renderGarage();
      }
      this.renderAccount();
    };
    $("acc-btn").addEventListener("click", () => {
      const s = this.cloud.status;
      if (s === "signed-out") void this.cloud.signIn();
      else if (s === "synced") void this.cloud.signOut();
      else if (s === "error") void (this.cloud.user ? this.cloud.sync() : this.cloud.signIn());
    });
    void this.cloud.init();
    this.renderAccount();
    toggle("tgl-sfx", () => this.sound.sfxOn, (on) => this.sound.setSfx(on));
    toggle("tgl-music", () => this.sound.musicOn, (on) => this.sound.setMusic(on));
    $("btn-restart").addEventListener("click", () => this.load(this.track));
    $("btn-menu").addEventListener("click", () => this.showMenu());
    $("res-retry").addEventListener("click", () => this.load(this.track));
    $("res-next").addEventListener("click", () => {
      // Next track that is already unlocked (wraps around to the first).
      const earned = TRACKS.reduce((n, t) => n + missionsDone(t).filter(Boolean).length, 0);
      const i = TRACKS.indexOf(this.track);
      for (let k = 1; k <= TRACKS.length; k++) {
        const t = TRACKS[(i + k) % TRACKS.length];
        if (earned >= t.stars) return this.load(t);
      }
    });
    $("res-menu").addEventListener("click", () => this.showMenu());
    $("btn-garage").addEventListener("click", () => this.showGarage());
    $("garage-close").addEventListener("click", () => this.showMenu());
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

  get player(): Racer {
    return this.race.player!;
  }

  onKey(code: string) {
    if (code === "KeyR" || code === "Enter") {
      if (this.state !== "menu" && this.state !== "garage") this.load(this.track);
    } else if (code === "Escape") {
      this.showMenu();
    }
  }

  addCoins(n: number) {
    this.profile.coins += n;
    saveProfile(this.profile);
    this.cloud.pushSoon();
  }

  renderAccount() {
    const c = this.cloud;
    $("account").classList.toggle("hidden", !c.configured);
    const text: Record<string, [string, string]> = {
      loading: ["Облако подключается…", ""],
      "signed-out": ["Прогресс только на этом устройстве", "Войти через Google"],
      syncing: ["Синхронизация…", ""],
      synced: [`☁ ${c.user?.displayName ?? "Аккаунт"} · прогресс сохранён`, "Выйти"],
      error: ["Нет связи с облаком", "Повторить"],
      off: ["", ""],
    };
    const [status, button] = text[c.status];
    $("acc-status").textContent = status;
    $("acc-btn").textContent = button;
    $("acc-btn").classList.toggle("hidden", !button);
  }

  showGarage() {
    this.state = "garage";
    this.renderGarage();
    this.ui();
  }

  renderGarage() {
    const p = this.profile;
    $("garage-coins").textContent = String(p.coins);

    const ups = $("upgrades");
    ups.innerHTML = "";
    for (const u of UPGRADES) {
      const level = p.levels[u.id];
      const cost = upgradeCost(level);
      const row = document.createElement("div");
      row.className = "upg";
      const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < level ? "on" : ""}"></i>`).join("");
      row.innerHTML = `<span class="info"><b>${u.name}</b><small>${u.desc}</small></span><span class="pips">${pips}</span>`;
      const btn = document.createElement("button");
      btn.className = "buy";
      btn.textContent = cost === null ? "Максимум" : `${cost}`;
      if (cost !== null) btn.classList.add("coins");
      btn.disabled = cost === null || p.coins < cost;
      btn.addEventListener("click", () => {
        if (cost === null || p.coins < cost) return;
        p.coins -= cost;
        p.levels[u.id]++;
        saveProfile(p);
        this.cloud.pushSoon();
        this.sound.coin();
        this.renderGarage();
      });
      row.appendChild(btn);
      ups.appendChild(row);
    }

    const paints = $("paints");
    paints.innerHTML = "";
    for (const paint of PAINTS) {
      const owned = p.owned.includes(paint.id);
      const b = document.createElement("button");
      b.className = "paint" + (p.paint === paint.id ? " sel" : "");
      const sw = `background: linear-gradient(135deg, ${paint.look.plastic} 0 50%, ${paint.look.jersey} 50% 100%)`;
      const status = p.paint === paint.id ? "Выбрана" : owned ? "Выбрать" : `<span class="coins">${paint.price}</span>`;
      b.innerHTML = `<span class="sw" style="${sw}"></span><span>${paint.name}</span><span class="price">${status}</span>`;
      b.disabled = !owned && p.coins < paint.price;
      b.addEventListener("click", () => {
        if (!owned) {
          if (p.coins < paint.price) return;
          p.coins -= paint.price;
          p.owned.push(paint.id);
          this.sound.coin();
        }
        p.paint = paint.id;
        saveProfile(p);
        this.cloud.pushSoon();
        // Rebuild the idle scene behind the garage so the new paint shows on the bike.
        this.load(this.track);
        this.state = "garage";
        this.renderGarage();
        this.ui();
      });
      paints.appendChild(b);
    }
  }

  showMenu() {
    this.state = "menu";
    $("menu-coins").textContent = String(this.profile.coins);
    const list = $("track-list");
    list.innerHTML = "";
    // New tracks open with mission stars earned anywhere.
    const earned = TRACKS.reduce((n, t) => n + missionsDone(t).filter(Boolean).length, 0);
    $("menu-stars").textContent = `${earned} ★`;
    TRACKS.forEach((t, i) => {
      const best = store.get<number>(bestKey(t));
      const locked = earned < t.stars;
      const b = document.createElement("button");
      b.className = "track" + (locked ? " locked" : "");
      b.disabled = locked;
      b.innerHTML =
        `<span class="num">${i + 1}</span>` +
        `<span class="name">${t.name}<small>${t.laps} ${t.laps === 1 ? "круг" : t.laps < 5 ? "круга" : "кругов"}</small></span>` +
        (locked
          ? `<span class="need">Нужно ${t.stars} ★</span>`
          : `<span class="stars">${stars(t)}</span><span class="best">${best ? fmt(best) : "—"}</span>`);
      b.addEventListener("click", () => this.load(t));
      list.appendChild(b);
    });
    this.ui();
  }

  load(track: Track) {
    this.track = track;
    this.race = new Race(track, { look: lookFor(this.profile), stats: statsFor(this.profile) }, {
      crash: (r) => {
        if (!r.isPlayer) return;
        this.tracker.crashed();
        this.sound.crash();
      },
      lap: (r, dx, dy) => {
        if (!r.isPlayer) return;
        this.cam.x += dx;
        this.cam.y += dy;
        this.toast(r.lap === track.laps ? "Последний круг!" : `Круг ${r.lap}`);
        this.sound.lap();
      },
      finish: (r) => {
        if (r.isPlayer) this.finish();
      },
    }, Math.floor(Math.random() * 1e9));

    this.recorder = new GhostRecorder();
    this.ghost = loadGhost(track.id);

    this.tracker = new MissionTracker(MISSIONS[track.id] ?? [], missionsDone(track), (i) => {
      store.set(missionsKey(track), this.tracker.done);
      // Mission coins are paid at once, so they count even if the race is abandoned.
      this.newMissions++;
      this.addCoins(MISSION_REWARD);
      this.sound.chime();
      this.toast(`✓ ${missionText(this.tracker.missions[i])}  +${MISSION_REWARD}`);
      this.renderMissions();
    });

    this.state = "countdown";
    this.countdown = COUNTDOWN;
    this.acc = 0;
    this.newMissions = 0;
    this.lastCount = 0;
    const p = this.player.bike.chassis.getPosition();
    const ppm = this.renderer.basePpm();
    this.cam = { x: p.x + (this.renderer.w * 0.12) / ppm, y: p.y + 1.2, ppm };
    this.renderMissions();
    $("toast").classList.add("hidden");
    this.ui();
  }

  finish() {
    this.state = "finished";
    const time = this.player.finishTime;
    const place = this.race.placeOf(this.player);
    this.tracker.finished(place, time);
    const prev = store.get<number>(bestKey(this.track));
    const record = prev === null || time < prev;
    if (record) store.set(bestKey(this.track), time);
    $("res-place").textContent = `${place}-е место`;
    $("res-place").classList.toggle("win", place === 1);
    this.sound.finish(place === 1);
    $("res-time").textContent = fmt(time);
    // A new record replaces the ghost you'll race against next time.
    const ghostSaved = record && saveGhost(this.track.id, this.recorder);
    $("res-best").textContent = record ? (ghostSaved ? "Новый рекорд! Призрак обновлён" : "Новый рекорд!") : `Рекорд: ${fmt(prev!)}`;
    $("res-best").classList.toggle("record", record);
    // Mission coins were already paid during the race; place and record are paid now.
    const reward = raceReward(place, this.newMissions, record);
    this.addCoins(reward.total - this.newMissions * MISSION_REWARD);
    $("res-reward").innerHTML =
      reward.parts.map(([label, v]) => `<span>${label} +${v}</span>`).join("") +
      `<span class="coins">+${reward.total}</span>`;
    $("res-missions").innerHTML = this.tracker.missions
      .map((m, i) => `<li class="${this.tracker.done[i] ? "done" : ""}">${missionText(m)}</li>`)
      .join("");
    this.renderStandings();
    this.ui();
  }

  renderStandings() {
    $("res-table").innerHTML = this.race
      .standings()
      .map((r) => {
        const t = r.finished ? fmt(r.finishTime) : "едет…";
        return `<li class="${r.isPlayer ? "me" : ""}"><span class="dot" style="background:${r.look.plastic}"></span><span class="who">${r.look.name}</span><span class="t">${t}</span></li>`;
      })
      .join("");
  }

  renderMissions() {
    $("missions").innerHTML = this.tracker.missions
      .map((m, i) => `<li class="${this.tracker.done[i] ? "done" : ""}"><span class="txt">${missionText(m)}</span><span class="prog" id="mp-${i}"></span></li>`)
      .join("");
  }

  toast(text: string) {
    const el = $("toast");
    el.textContent = text;
    el.classList.remove("hidden");
    el.style.animation = "none";
    void el.offsetWidth; // restart the pop-in animation
    el.style.animation = "";
    this.toastTimer = 1.8;
  }

  update(dt: number) {
    this.clock += dt;
    this.frame++;
    const race = this.race;
    const player = this.player;

    if (this.state === "countdown") {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = "racing";
        race.started = true;
        this.toast("Старт!");
        this.sound.beep(true);
      } else if (Math.ceil(this.countdown) !== this.lastCount) {
        this.lastCount = Math.ceil(this.countdown);
        this.sound.beep();
      }
    }

    const input = this.autopilot ? autopilot(player.bike, this.track) : this.controls.read();
    this.acc += dt;
    while (this.acc >= DT) {
      race.step(DT, input);
      if (this.state === "racing" && !player.crashed && !player.finished) this.tracker.step(player.bike, DT);
      if (race.started && !player.finished) this.recorder.step(player.bike, race.time);
      this.acc -= DT;
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) $("toast").classList.add("hidden");
    }
    if (this.state === "finished" && this.frame % 15 === 0) this.renderStandings();

    this.updateCamera(dt);
    const riders: RiderView[] = [...race.racers];
    if (this.ghost) {
      this.ghost.setTime(race.time);
      riders.push({ bike: this.ghost, look: GHOST_LOOK, isPlayer: false, ghost: true });
    }
    this.renderer.draw(this.cam, this.track, riders, this.clock);
    this.hud();

    const inRace = this.state === "countdown" || this.state === "racing" || this.state === "finished";
    this.sound.updateEngines(
      race.racers.map((r) => ({
        bike: r.bike,
        isPlayer: r.isPlayer,
        gas: r.isPlayer ? input.gas : true,
        active: race.started && !r.crashed && !r.finished,
      })),
      player.x,
      inRace,
      dt,
    );
    if (this.state === "racing" && !player.crashed) this.sound.watchLanding(player.bike, dt);
  }

  // Rider sits left of center so the track ahead is visible; vertically the camera
  // blends the rider with the terrain ahead and zooms out at speed and on big air.
  updateCamera(dt: number) {
    const r = this.renderer;
    const bike = this.player.bike;
    const p = bike.chassis.getPosition();
    const v = bike.chassis.getLinearVelocity();
    const ahead = Math.max(-3, Math.min(9, v.x * 0.45));
    const terrain = groundY(this.track, p.x + 4 + ahead);
    const alt = p.y - groundY(this.track, p.x);
    const speed = Math.hypot(v.x, v.y);

    const ppm = r.basePpm() / (1 + speed / 90 + Math.max(0, alt - 3) / 16);
    this.cam.ppm += (ppm - this.cam.ppm) * (1 - Math.exp(-dt * 2));

    const tx = p.x + (r.w * 0.12) / this.cam.ppm + ahead;
    this.cam.x += (tx - this.cam.x) * (1 - Math.exp(-dt * 5));
    let ty = p.y * 0.6 + terrain * 0.4 + 1.2;
    // Keep the rider inside the middle 50% of the screen height.
    const span = (r.h * 0.25) / this.cam.ppm;
    ty = Math.max(p.y - span, Math.min(p.y + span, ty));
    this.cam.y += (ty - this.cam.y) * (1 - Math.exp(-dt * 4));
  }

  hud() {
    const t = this.track;
    const race = this.race;
    const player = this.player;
    $("time").textContent = fmt(player.finished ? player.finishTime : race.time);
    $("pos").textContent = `${race.placeOf(player)}/${race.racers.length}`;
    $("lap").textContent = `${Math.min(player.lap, t.laps)}/${t.laps}`;
    const total = t.laps * (t.finishX - t.startX);
    const p = Math.max(0, Math.min(1, player.progress(t) / total));
    $("progress-fill").style.width = `${(p * 100).toFixed(1)}%`;

    const cd = $("countdown");
    cd.classList.toggle("hidden", this.state !== "countdown");
    if (this.state === "countdown") cd.textContent = String(Math.ceil(this.countdown));
    $("crash").classList.toggle("hidden", !player.crashed);

    if (this.frame % 6 === 0)
      this.tracker.missions.forEach((_, i) => {
        const el = document.getElementById(`mp-${i}`);
        if (el) el.textContent = this.tracker.progress(i);
      });
  }

  ui() {
    const s = this.state;
    const overlay = s === "menu" || s === "garage";
    this.sound.setMusicLevel(overlay || s === "finished" ? 0.35 : 0.14);
    $("menu").classList.toggle("hidden", s !== "menu");
    $("garage").classList.toggle("hidden", s !== "garage");
    $("results").classList.toggle("hidden", s !== "finished");
    $("hud").classList.toggle("hidden", overlay);
    $("controls").classList.toggle("hidden", overlay || s === "finished");
    $("track-name").textContent = this.track.name;
  }
}

const game = new Game();
if (import.meta.env.DEV) Object.assign(window, { game, TRACKS });
