import { autopilot } from "./ai.ts";
import { Sound } from "./audio.ts";
import {
  BIKES,
  DIFFICULTIES,
  GEAR,
  GEAR_SLOTS,
  PAINTS,
  PLACE_REWARD,
  RECORD_REWARD,
  STAR_REWARD,
  WIN_BONUS,
  boardId,
  bikeSpec,
  rewardScale,
} from "./catalog.ts";
import { Cloud, NICK_RE } from "./cloud.ts";
import { enterFullscreen, exitFullscreen, installHelp, isFullscreen, isInstalled, onFullscreenChange } from "./fullscreen.ts";
import { DAILY_REWARDS, MAX_LEVEL, UPGRADES, claimDaily, dailyState, loadProfile, lookFor, riderLevel, saveProfile, statsFor, upgradeCost } from "./garage.ts";
import { GHOST_LOOK, type GhostBike, GhostRecorder, loadGhost, saveGhost } from "./ghost.ts";
import { Controls } from "./input.ts";
import { MissionTracker, missionText, missionsFor } from "./missions.ts";
import {
  bestPlace,
  bestTime,
  levelOpen,
  levelWon,
  migrateOldProgress,
  missionsDone,
  setBestPlace,
  setBestTime,
  setLevelWon,
  setMissionsDone,
  totalPoints,
  totalStars,
} from "./progress.ts";
import { Race, type Racer } from "./race.ts";
import { type Camera, Renderer, type RiderView } from "./render.ts";
import { Renderer3D } from "./render3d.ts";
import { TRACKS, type Track, groundY } from "./track.ts";
import "./style.css";

const DT = 1 / 120;
const COUNTDOWN = 3;

type State = "menu" | "tracks" | "garage" | "board" | "countdown" | "racing" | "finished";
type GarageTab = "bikes" | "paint" | "gear" | "upgrades";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

function starsText(done: number, total = 5) {
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
  starCoins = 0; // coins already paid for them
  sound = new Sound();
  cloud = new Cloud();
  recorder = new GhostRecorder();
  ghost: GhostBike | null = null;
  lastCount = 0; // countdown number last beeped
  garageTab: GarageTab = "bikes";
  boardTab: "points" | "times" = "points";
  raceLevel = 0; // difficulty of the race in progress
  nickFirst = false; // the nickname prompt can't be skipped the first time
  paused = false;

  constructor() {
    migrateOldProgress();
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
    this.cloud.onReady = () => void this.checkNick();
    $("acc-btn").addEventListener("click", () => {
      const c = this.cloud;
      if (!c.linked && c.status !== "syncing") void c.signIn();
      else if (c.status === "synced") void c.signOut();
      else if (c.status === "error") void c.sync();
    });
    void this.cloud.init();
    this.renderAccount();

    // Full screen on and off ("свернуть") from the hub, the settings and the pause screen;
    // where a browser can't hide its bars, show how to install the game instead. An
    // installed game already runs full screen, so the buttons go away there.
    const fsButtons = ["btn-fullscreen", "pause-fs", "hub-fs"].map((id) => $(id));
    const syncFs = () => {
      const on = isFullscreen();
      for (const b of fsButtons) {
        b.classList.toggle("hidden", isInstalled());
        b.classList.toggle("on", on);
        if (b.id !== "hub-fs") b.textContent = on ? "⤡ Свернуть" : "⛶ Во весь экран";
        b.setAttribute("aria-label", on ? "Свернуть" : "Во весь экран");
        b.title = on ? "Свернуть" : "Во весь экран";
      }
    };
    syncFs();
    onFullscreenChange(syncFs);
    for (const b of fsButtons)
      b.addEventListener("click", async () => {
        if (isFullscreen()) return void exitFullscreen();
        if (await enterFullscreen()) return;
        const help = installHelp();
        $("fs-help-text").textContent = help.text;
        $("fs-help-steps").innerHTML = help.steps.map((s) => `<li>${s}</li>`).join("");
        $("fs-help").classList.remove("hidden");
      });
    $("fs-help-close").addEventListener("click", () => $("fs-help").classList.add("hidden"));
    // Sound toggles live in the settings and on the pause screen; keep both in step.
    const syncToggles = () => {
      for (const id of ["tgl-sfx", "p-sfx"]) $(id).setAttribute("aria-pressed", String(this.sound.sfxOn));
      for (const id of ["tgl-music", "p-music"]) $(id).setAttribute("aria-pressed", String(this.sound.musicOn));
    };
    for (const id of ["tgl-sfx", "p-sfx"]) toggle(id, () => this.sound.sfxOn, (on) => (this.sound.setSfx(on), syncToggles()));
    for (const id of ["tgl-music", "p-music"]) toggle(id, () => this.sound.musicOn, (on) => (this.sound.setMusic(on), syncToggles()));
    // Pause.
    $("btn-pause").addEventListener("click", () => this.pause());
    $("pause-resume").addEventListener("click", () => this.resume());
    $("pause-restart").addEventListener("click", () => this.load(this.track));
    $("pause-menu").addEventListener("click", () => this.showMenu());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause();
    });
    $("res-retry").addEventListener("click", () => this.load(this.track));
    $("res-next").addEventListener("click", () => {
      // Next track open on this level (wraps around to the first).
      const i = TRACKS.indexOf(this.track);
      for (let k = 1; k <= TRACKS.length; k++) {
        const t = TRACKS[(i + k) % TRACKS.length];
        if (this.trackOpen(t) && levelOpen(t, this.profile.difficulty)) return this.load(t);
      }
    });
    $("res-menu").addEventListener("click", () => this.showTracks());
    $("btn-garage").addEventListener("click", () => this.showGarage());
    $("garage-close").addEventListener("click", () => this.showMenu());
    $("garage-tabs").addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest("button")?.dataset.tab as GarageTab | undefined;
      if (tab) {
        this.garageTab = tab;
        this.renderGarage();
      }
    });
    $("btn-board").addEventListener("click", () => this.showBoard());
    $("board-close").addEventListener("click", () => this.showMenu());
    $("board-tabs").addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest("button")?.dataset.tab as "points" | "times" | undefined;
      if (tab) {
        this.boardTab = tab;
        void this.renderBoard();
      }
    });
    for (const id of ["board-track", "board-level", "board-class"]) $(id).addEventListener("change", () => void this.renderBoard());
    $("board-list").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-uid]");
      if (b) void this.removeNick(b.dataset.uid!, b.dataset.nick!);
    });
    $("btn-nick").addEventListener("click", () => this.showNick());
    // Hub buttons.
    const openGarage = (tab: GarageTab) => () => {
      this.garageTab = tab;
      this.showGarage();
    };
    $("hub-bikes").addEventListener("click", openGarage("bikes"));
    $("hub-gear").addEventListener("click", openGarage("gear"));
    $("hub-upgrades").addEventListener("click", openGarage("upgrades"));
    $("btn-race").addEventListener("click", () => this.showTracks());
    $("tracks-close").addEventListener("click", () => this.showMenu());
    $("btn-settings").addEventListener("click", () => $("settings").classList.remove("hidden"));
    $("settings-close").addEventListener("click", () => $("settings").classList.add("hidden"));
    $("set-nick").addEventListener("click", () => {
      $("settings").classList.add("hidden");
      this.showNick();
    });
    $("daily-claim").addEventListener("click", () => {
      const got = claimDaily(this.profile);
      if (!got) return;
      this.saveProfile();
      this.sound.coin();
      this.renderHub();
    });
    // Drag the garage to turn the bike.
    let dragX: number | null = null;
    const canvasEl = $("game");
    canvasEl.addEventListener("pointerdown", (e) => {
      if (this.state === "menu" || this.state === "garage") dragX = e.clientX;
    });
    window.addEventListener("pointermove", (e) => {
      if (dragX === null || !(this.renderer instanceof Renderer3D)) return;
      this.renderer.showroomYaw += (e.clientX - dragX) * 0.008;
      dragX = e.clientX;
    });
    window.addEventListener("pointerup", () => (dragX = null));
    // The daily reward timer ticks while the hub is open.
    window.setInterval(() => {
      if (this.state === "menu") this.renderDaily();
    }, 30000);
    $("nick-save").addEventListener("click", () => void this.saveNick());
    $("nick-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.saveNick();
    });
    $("nick-cancel").addEventListener("click", () => $("nick").classList.add("hidden"));
    this.load(this.track);
    this.showMenu();
    if (!this.profile.nick) this.showNick(undefined, true);
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
    if (!$("nick").classList.contains("hidden")) return;
    if (code === "KeyR" || code === "Enter") {
      if (this.state === "countdown" || this.state === "racing" || this.state === "finished") this.load(this.track);
    } else if (code === "Escape" || code === "KeyP") {
      if (!$("settings").classList.contains("hidden")) $("settings").classList.add("hidden");
      else if (this.paused) this.resume();
      else if (this.state === "countdown" || this.state === "racing") this.pause();
      else if (code === "Escape") this.showMenu();
    }
  }

  // ---------- Pause ----------

  pause() {
    if (this.paused || (this.state !== "countdown" && this.state !== "racing")) return;
    this.paused = true;
    $("pause-track").textContent = `${this.track.name} · ${DIFFICULTIES[this.raceLevel].name}`;
    $("pause").classList.remove("hidden");
    this.ui();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    $("pause").classList.add("hidden");
    this.ui();
  }

  trackOpen(t: Track) {
    return totalStars() >= t.stars;
  }

  addCoins(n: number) {
    this.profile.coins += Math.round(n);
    this.saveProfile();
  }

  saveProfile() {
    saveProfile(this.profile);
    this.cloud.pushSoon();
  }

  renderAccount() {
    const c = this.cloud;
    // Players never see Google sign-in: nicknames and records work on the anonymous account.
    // It shows only with ?login in the address (for the owner) or once already signed in.
    const showLogin = new URLSearchParams(location.search).has("login") || c.linked;
    $("account").classList.toggle("hidden", !c.configured || !showLogin);
    let status = "";
    let button = "";
    if (c.status === "loading") status = "Сервер подключается…";
    else if (c.status === "error") [status, button] = ["Нет связи с сервером", "Повторить"];
    else if (c.status === "syncing") status = "Синхронизация…";
    else if (c.linked) [status, button] = [`☁ ${c.user?.displayName ?? "Аккаунт"} · прогресс сохранён`, "Выйти"];
    else [status, button] = ["Прогресс только на этом устройстве", "Войти через Google"];
    $("acc-status").textContent = status;
    $("acc-btn").textContent = button;
    $("acc-btn").classList.toggle("hidden", !button);
  }

  // ---------- Nickname ----------

  showNick(message?: string, first = false) {
    this.nickFirst = first;
    $("nick-msg").textContent = message ?? "Под этим именем ты будешь в таблицах рекордов.";
    $<HTMLInputElement>("nick-input").value = this.profile.nick ?? "";
    $("nick-err").textContent = "";
    $("nick-cancel").classList.toggle("hidden", first);
    $("nick").classList.remove("hidden");
    setTimeout(() => $<HTMLInputElement>("nick-input").focus(), 50);
  }

  async saveNick() {
    const nick = $<HTMLInputElement>("nick-input").value.trim().replace(/\s+/g, " ");
    if (!NICK_RE.test(nick)) {
      $("nick-err").textContent = "От 3 до 16 символов: буквы, цифры, пробел, _ или -";
      return;
    }
    $("nick-err").textContent = "";
    if (this.cloud.online && nick !== this.profile.nick) {
      $("nick-save").setAttribute("disabled", "");
      const r = await this.cloud.claimNick(nick, totalPoints());
      $("nick-save").removeAttribute("disabled");
      if (r === "taken") {
        $("nick-err").textContent = "Этот ник уже занят, придумай другой";
        return;
      }
    }
    this.profile.nick = nick;
    this.saveProfile();
    $("nick").classList.add("hidden");
    $("menu-nick").textContent = nick;
  }

  // Once online: adopt the server's nickname, register the local one, or ask again if a
  // moderator removed it.
  async checkNick() {
    const remote = await this.cloud.myNick();
    if (remote === null) {
      const old = this.profile.nick;
      this.profile.nick = undefined;
      this.saveProfile();
      this.showNick(`Ник «${old ?? ""}» удалён модератором. Придумай другой.`, true);
    } else if (remote === undefined && this.profile.nick) {
      const r = await this.cloud.claimNick(this.profile.nick, totalPoints());
      if (r === "taken") this.showNick(`Ник «${this.profile.nick}» уже занят другим игроком. Придумай другой.`, true);
    } else if (typeof remote === "string" && remote !== this.profile.nick) {
      this.profile.nick = remote;
      this.saveProfile();
    }
    if (this.profile.nick) void this.cloud.submitPoints(totalPoints());
    $("menu-nick").textContent = this.profile.nick ?? "Без ника";
  }

  // ---------- Garage ----------

  showGarage() {
    this.state = "garage";
    this.renderGarage();
    this.ui();
  }

  // Rebuild the idle scene behind the garage so changes show on the bike and rider.
  private refreshBike() {
    this.load(this.track);
    this.state = "garage";
    this.ui();
  }

  private buy(price: number) {
    if (this.profile.coins < price) return false;
    this.profile.coins -= price;
    this.sound.coin();
    return true;
  }

  renderGarage() {
    const p = this.profile;
    $("garage-coins").textContent = String(p.coins);
    document.querySelectorAll<HTMLButtonElement>("#garage-tabs button").forEach((b) => b.classList.toggle("sel", b.dataset.tab === this.garageTab));
    const body = $("garage-body");
    body.innerHTML = "";
    const add = (html: string) => {
      const el = document.createElement("div");
      el.innerHTML = html;
      body.appendChild(el.firstElementChild!);
      return body.lastElementChild as HTMLElement;
    };
    const coinBtn = (owned: boolean, selected: boolean, price: number) =>
      selected ? "Выбран" : owned ? "Выбрать" : `<span class="coins">${price}</span>`;

    if (this.garageTab === "bikes") {
      const grid = add(`<div class="bikes"></div>`);
      const maxPower = Math.max(...BIKES.map((b) => b.power));
      for (const b of BIKES) {
        const owned = p.bikes.includes(b.id);
        const sel = p.bike === b.id;
        const bar = (v: number) => `<span class="bar"><i style="width:${Math.round(v * 100)}%"></i></span>`;
        const card = document.createElement("button");
        card.className = "bike-card" + (sel ? " sel" : "");
        card.disabled = !owned && p.coins < b.price;
        card.innerHTML =
          `<span class="cls">${b.label}</span><b>${b.name}</b><small>${b.desc}</small>` +
          `<span class="stat">Мощность ${bar(b.power / maxPower)}</span>` +
          `<span class="stat">Вращение ${bar((4.3 + b.airSpin) / 4.9)}</span>` +
          `<span class="stat">Очки ×${b.points} · монеты ×${b.reward}</span>` +
          `<span class="price">${coinBtn(owned, sel, b.price)}</span>`;
        card.addEventListener("click", () => {
          if (!owned && !this.buy(b.price)) return;
          if (!owned) p.bikes.push(b.id);
          p.bike = b.id;
          this.saveProfile();
          this.refreshBike();
          this.renderGarage();
        });
        grid.appendChild(card);
      }
    } else if (this.garageTab === "paint") {
      const grid = add(`<div class="swatches"></div>`);
      for (const paint of PAINTS) {
        const owned = p.owned.includes(paint.id);
        const sel = p.paint === paint.id;
        const b = document.createElement("button");
        b.className = "paint" + (sel ? " sel" : "");
        const sw = `background: linear-gradient(135deg, ${paint.plastic} 0 55%, ${paint.plasticDark} 55% 100%)`;
        b.innerHTML = `<span class="sw" style="${sw}"></span><span>${paint.name}</span><span class="price">${coinBtn(owned, sel, paint.price)}</span>`;
        b.disabled = !owned && p.coins < paint.price;
        b.addEventListener("click", () => {
          if (!owned && !this.buy(paint.price)) return;
          if (!owned) p.owned.push(paint.id);
          p.paint = paint.id;
          this.saveProfile();
          this.refreshBike();
          this.renderGarage();
        });
        grid.appendChild(b);
      }
    } else if (this.garageTab === "gear") {
      for (const { slot, name } of GEAR_SLOTS) {
        add(`<h3>${name}</h3>`);
        const grid = add(`<div class="swatches"></div>`);
        for (const item of GEAR.filter((x) => x.slot === slot)) {
          const owned = p.owned.includes(item.id);
          const sel = p.gear[slot] === item.id;
          const b = document.createElement("button");
          b.className = "paint" + (sel ? " sel" : "");
          const sw = `background: linear-gradient(135deg, ${item.color} 0 60%, ${item.color2} 60% 100%)`;
          b.innerHTML = `<span class="sw ${slot}" style="${sw}"></span><span>${item.name}</span><span class="price">${coinBtn(owned, sel, item.price)}</span>`;
          b.disabled = !owned && p.coins < item.price;
          b.addEventListener("click", () => {
            if (!owned && !this.buy(item.price)) return;
            if (!owned) p.owned.push(item.id);
            p.gear[slot] = item.id;
            this.saveProfile();
            this.refreshBike();
            this.renderGarage();
          });
          grid.appendChild(b);
        }
      }
    } else {
      add(`<p class="note">Прокачка остаётся с тобой на любом мотоцикле.</p>`);
      const ups = add(`<div class="upgrades"></div>`);
      for (const u of UPGRADES) {
        const level = p.levels[u.id];
        const cost = upgradeCost(level);
        const row = document.createElement("div");
        row.className = "upg";
        const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < level ? "on" : ""}"></i>`).join("");
        row.innerHTML = `<span class="info"><b>${u.name}</b><small>${u.desc}</small></span><span class="pips">${pips}</span>`;
        const btn = document.createElement("button");
        btn.className = "buy";
        btn.innerHTML = cost === null ? "Максимум" : `<span class="coins">${cost}</span>`;
        btn.disabled = cost === null || p.coins < cost;
        btn.addEventListener("click", () => {
          if (cost === null || !this.buy(cost)) return;
          p.levels[u.id]++;
          this.saveProfile();
          this.refreshBike();
          this.renderGarage();
        });
        row.appendChild(btn);
        ups.appendChild(row);
      }
    }
  }

  // ---------- Leaderboards ----------

  showBoard() {
    this.state = "board";
    const fill = (id: string, items: [string, string][], value: string) => {
      const sel = $<HTMLSelectElement>(id);
      sel.innerHTML = items.map(([v, label]) => `<option value="${v}">${esc(label)}</option>`).join("");
      sel.value = value;
    };
    fill("board-track", TRACKS.map((t) => [t.id, t.name]), this.track.id);
    fill("board-level", DIFFICULTIES.map((d) => [String(d.id), d.name]), String(this.profile.difficulty));
    fill("board-class", BIKES.map((b) => [b.id, `Класс ${b.label}`]), this.profile.bike);
    this.ui();
    void this.renderBoard();
  }

  async renderBoard() {
    document.querySelectorAll<HTMLButtonElement>("#board-tabs button").forEach((b) => b.classList.toggle("sel", b.dataset.tab === this.boardTab));
    $("board-filters").classList.toggle("hidden", this.boardTab !== "times");
    $("board-mine").textContent = `${totalPoints()} очк.`;
    const list = $("board-list");
    const note = $("board-note");
    const me = this.cloud.user?.uid;
    const nick = this.profile.nick ?? "Ты";
    const del = (uid: string, n: string) => (this.cloud.admin && uid !== me ? `<button class="del" data-uid="${uid}" data-nick="${esc(n)}" title="Удалить ник">✕</button>` : "");
    const row = (who: string, value: string, mine: boolean, extra = "") => `<li class="${mine ? "me" : ""}"><span class="who">${esc(who)}</span><span class="t">${value}</span>${extra}</li>`;
    note.textContent = "";

    if (this.boardTab === "points") {
      list.innerHTML = `<li class="loading">Загрузка…</li>`;
      const rows = this.cloud.online ? await this.cloud.topPoints() : null;
      if (this.state !== "board" || this.boardTab !== "points") return;
      if (!rows) {
        list.innerHTML = row(nick, `${totalPoints()} очк.`, true);
        note.textContent = this.cloud.configured ? "Нет связи с сервером: показаны только твои очки." : "Общая таблица заработает, когда игра будет подключена к серверу. Пока видны только твои очки.";
        return;
      }
      list.innerHTML = rows.length ? rows.map((r) => row(r.nick, `${r.points} очк.`, r.uid === me, del(r.uid, r.nick))).join("") : `<li class="loading">Пока пусто — стань первым!</li>`;
      note.textContent = "Очки: лучшее место на каждой трассе, уровне и классе плюс звёзды. Выше уровень и класс — больше очков.";
    } else {
      const track = $<HTMLSelectElement>("board-track").value;
      const level = Number($<HTMLSelectElement>("board-level").value);
      const cls = $<HTMLSelectElement>("board-class").value as (typeof BIKES)[number]["id"];
      const board = boardId(track, level, cls);
      list.innerHTML = `<li class="loading">Загрузка…</li>`;
      const rows = this.cloud.online ? await this.cloud.topTimes(board) : null;
      if (this.state !== "board" || this.boardTab !== "times") return;
      const mine = bestTime(board);
      if (!rows) {
        list.innerHTML = mine ? row(nick, fmt(mine), true) : `<li class="loading">Ты ещё не проезжал эту трассу на этом уровне и классе.</li>`;
        note.textContent = this.cloud.configured ? "Нет связи с сервером: показан только твой рекорд." : "Общая таблица заработает, когда игра будет подключена к серверу. Пока виден только твой рекорд.";
        return;
      }
      list.innerHTML = rows.length ? rows.map((r) => row(r.nick, fmt(r.time), r.uid === me, del(r.uid, r.nick))).join("") : `<li class="loading">Пока никто не проехал — стань первым!</li>`;
    }
  }

  async removeNick(uid: string, nick: string) {
    if (!confirm(`Удалить ник «${nick}»? Игрок пропадёт из таблиц и должен будет выбрать новый ник.`)) return;
    if (await this.cloud.removeNick(uid)) void this.renderBoard();
    else alert("Не получилось удалить ник: нет прав или связи.");
  }

  // ---------- Menu ----------

  showMenu() {
    this.state = "menu";
    this.paused = false;
    $("pause").classList.add("hidden");
    $("settings").classList.add("hidden");
    this.renderHub();
    this.ui();
  }

  // The MSM3-style hub over the garage: player card, balances, daily reward, progress
  // towards the next track, upgrades, rider level and the bike.
  renderHub() {
    const p = this.profile;
    const points = totalPoints();
    const earned = totalStars();
    const lvl = riderLevel(points);
    $("menu-coins").textContent = String(p.coins);
    $("menu-nick").textContent = p.nick ?? "Без ника";
    $("menu-stars").textContent = `${earned} ★`;
    $("menu-points").textContent = `${points} очк.`;
    $("hub-avatar").textContent = lookFor(p).number ?? "7";
    $("hub-avatar").style.background = lookFor(p).plastic;
    $("hub-level").textContent = `Уровень ${lvl.level}`;
    $("rl-title").textContent = `Уровень гонщика ${lvl.level}`;
    $("rl-bar").style.width = `${Math.round(lvl.progress * 100)}%`;
    $("rl-info").textContent = `${points} / ${lvl.to} очк. до уровня ${lvl.level + 1}`;
    $("menu-bike").textContent = bikeSpec(p.bike).name;
    const upg = Object.values(p.levels).reduce((s, v) => s + v, 0);
    $("hub-upg-info").textContent = `${upg} / ${UPGRADES.length * MAX_LEVEL} улучшений`;

    // Next goal: the next locked track, or the next level to win.
    const next = TRACKS.find((t) => earned < t.stars);
    if (next) {
      const prev = [...TRACKS].reverse().find((t) => t.stars <= earned && t.stars < next.stars)?.stars ?? 0;
      $("next-tag").textContent = "Новая трасса";
      $("next-title").textContent = next.name;
      $("next-info").textContent = `Звёзды: ${earned} / ${next.stars} ★`;
      $("next-bar").style.width = `${Math.round(Math.min(1, (earned - prev) / Math.max(1, next.stars - prev)) * 100)}%`;
    } else {
      const total = TRACKS.length * DIFFICULTIES.length * 5;
      $("next-tag").textContent = "Все трассы открыты";
      $("next-title").textContent = "Собери все звёзды";
      $("next-info").textContent = `Звёзды: ${earned} / ${total} ★`;
      $("next-bar").style.width = `${Math.round((earned / total) * 100)}%`;
    }
    this.renderDaily();
  }

  renderDaily() {
    const d = dailyState(this.profile);
    const btn = $<HTMLButtonElement>("daily-claim");
    btn.disabled = d.claimed;
    if (d.claimed) {
      const h = Math.floor(d.msLeft / 3600000);
      const m = Math.floor((d.msLeft % 3600000) / 60000);
      btn.textContent = `${h} ч ${m} мин`;
      $("daily-info").textContent = `День ${d.streak}: получено. Следующая через`;
    } else {
      btn.innerHTML = `Забрать <span class="coins">${d.reward}</span>`;
      $("daily-info").textContent = `День ${d.streak} из ${DAILY_REWARDS.length}: заходи каждый день — награда растёт`;
    }
  }

  // Track selection: difficulty levels and the track list.
  showTracks() {
    this.state = "tracks";
    const p = this.profile;
    const earned = totalStars();
    $("tracks-stars").textContent = `${earned} ★`;
    const levels = $("levels");
    levels.innerHTML = "";
    for (const d of DIFFICULTIES) {
      const b = document.createElement("button");
      b.className = "level" + (p.difficulty === d.id ? " sel" : "");
      b.style.setProperty("--lvl", d.color);
      b.textContent = d.name;
      b.addEventListener("click", () => {
        p.difficulty = d.id;
        saveProfile(p);
        this.showTracks();
      });
      levels.appendChild(b);
    }

    const list = $("track-list");
    list.innerHTML = "";
    const diff = DIFFICULTIES[p.difficulty];
    TRACKS.forEach((t, i) => {
      const best = bestTime(boardId(t.id, diff.id, p.bike));
      const lockedStars = earned < t.stars;
      const lockedLevel = !lockedStars && !levelOpen(t, diff.id);
      const done = missionsDone(t, diff.id).filter(Boolean).length;
      const b = document.createElement("button");
      b.className = "track" + (lockedStars || lockedLevel ? " locked" : "");
      b.disabled = lockedStars || lockedLevel;
      const won = levelWon(t);
      const medal = won >= 0 ? `<i class="medal" style="background:${DIFFICULTIES[won].color}" title="Победа: ${DIFFICULTIES[won].name}"></i>` : "";
      b.innerHTML =
        `<span class="num">${i + 1}</span>` +
        `<span class="name">${t.name}${medal}<small>${t.laps} ${t.laps === 1 ? "круг" : t.laps < 5 ? "круга" : "кругов"}</small></span>` +
        (lockedStars
          ? `<span class="need">Нужно ${t.stars} ★</span>`
          : lockedLevel
            ? `<span class="need">Победи на «${DIFFICULTIES[diff.id - 1].name}»</span>`
            : `<span class="stars">${starsText(done)}</span><span class="best">${best ? fmt(best) : "—"}</span>`);
      b.addEventListener("click", () => this.load(t));
      list.appendChild(b);
    });
    this.ui();
  }
  // ---------- Race ----------

  load(track: Track) {
    this.track = track;
    this.paused = false;
    $("pause").classList.add("hidden");
    const p = this.profile;
    // A level not yet open on this track falls back to the highest open one.
    let level = p.difficulty;
    while (level > 0 && !levelOpen(track, level)) level--;
    this.raceLevel = level;
    this.race = new Race(
      track,
      { look: lookFor(p), stats: statsFor(p) },
      {
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
      },
      Math.floor(Math.random() * 1e9),
      { difficulty: level, cls: p.bike },
    );

    this.recorder = new GhostRecorder();
    this.ghost = loadGhost(track.id);

    const starCoins = Math.round(STAR_REWARD * DIFFICULTIES[level].reward);
    this.tracker = new MissionTracker(missionsFor(track.id, level, p.bike), missionsDone(track, level), (i) => {
      setMissionsDone(track, level, this.tracker.done);
      // Star coins are paid at once, so they count even if the race is abandoned.
      this.newMissions++;
      this.starCoins += starCoins;
      this.addCoins(starCoins);
      this.sound.chime();
      this.toast(`★ ${missionText(this.tracker.missions[i])}  +${starCoins}`);
      this.renderMissions();
    });

    this.state = "countdown";
    this.countdown = COUNTDOWN;
    this.acc = 0;
    this.newMissions = 0;
    this.starCoins = 0;
    this.lastCount = 0;
    const pos = this.player.bike.chassis.getPosition();
    const ppm = this.renderer.basePpm();
    this.cam = { x: pos.x, y: pos.y + 1.2, ppm: ppm * 1.5 };
    this.renderMissions();
    $("toast").classList.add("hidden");
    this.ui();
  }

  finish() {
    this.state = "finished";
    const track = this.track;
    const level = this.raceLevel;
    const cls = this.profile.bike;
    const d = DIFFICULTIES[level];
    const board = boardId(track.id, level, cls);
    const time = this.player.finishTime;
    const place = this.race.placeOf(this.player);
    this.tracker.finished(place, time);

    const prev = bestTime(board);
    const record = prev === null || time < prev;
    if (record) setBestTime(board, time);
    const prevPlace = bestPlace(board);
    if (prevPlace === null || place < prevPlace) setBestPlace(board, place);
    const firstWin = place === 1 && levelWon(track) < level;
    if (place === 1) setLevelWon(track, level);
    // The ghost is your fastest run on the track, whatever the level or bike.
    const ghost = loadGhost(track.id);
    const ghostSaved = (!ghost || time < ghost.duration - 0.05) && saveGhost(track.id, this.recorder);

    $("res-level").textContent = `${d.name} · ${bikeSpec(cls).name}`;
    $("res-level").style.setProperty("--lvl", d.color);
    $("res-place").textContent = `${place}-е место`;
    $("res-place").classList.toggle("win", place === 1);
    this.sound.finish(place === 1);
    $("res-time").textContent = fmt(time);
    $("res-best").textContent = record ? (ghostSaved ? "Новый рекорд! Призрак обновлён" : "Новый рекорд!") : `Рекорд: ${fmt(prev!)}`;
    $("res-best").classList.toggle("record", record);
    const next = DIFFICULTIES[level + 1];
    $("res-unlock").classList.toggle("hidden", !(firstWin && next));
    if (firstWin && next) $("res-unlock").textContent = `Открыт уровень «${next.name}» на этой трассе!`;

    // Star coins were already paid during the race; place, first win and record are paid now.
    const scale = rewardScale(level, cls);
    const parts: [string, number][] = [[`${place}-е место`, Math.round((PLACE_REWARD[place - 1] ?? 0) * scale)]];
    if (this.newMissions) parts.push([`Звёзды ×${this.newMissions}`, this.starCoins]);
    if (firstWin) parts.push([`Первая победа · ${d.name}`, Math.round(WIN_BONUS * scale)]);
    if (record) parts.push(["Личный рекорд", Math.round(RECORD_REWARD * scale)]);
    const total = parts.reduce((s, [, v]) => s + v, 0);
    this.addCoins(total - this.starCoins);
    $("res-reward").innerHTML = parts.map(([label, v]) => `<span>${label} +${v}</span>`).join("") + `<span class="coins">+${total}</span>`;
    $("res-missions").innerHTML = this.tracker.missions.map((m, i) => `<li class="${this.tracker.done[i] ? "done" : ""}">${missionText(m)}</li>`).join("");
    this.renderStandings();
    this.ui();

    if (this.profile.nick) {
      if (record) void this.cloud.submitTime(board, time);
      void this.cloud.submitPoints(totalPoints());
    }
  }

  renderStandings() {
    $("res-table").innerHTML = this.race
      .standings()
      .map((r) => {
        const t = r.finished ? fmt(r.finishTime) : "едет…";
        const name = r.isPlayer ? (this.profile.nick ?? r.look.name) : r.look.name;
        return `<li class="${r.isPlayer ? "me" : ""}"><span class="dot" style="background:${r.look.plastic}"></span><span class="who">${esc(name)}</span><span class="t">${t}</span></li>`;
      })
      .join("");
  }

  renderMissions() {
    // MSM3-style plates: an icon in a diamond, the task, live progress on the right.
    const ICONS: Record<string, string> = { place: "🏆", time: "⏱", wheelie: "⤴", backflips: "⟲", frontflips: "⟳", air: "↗", speed: "⚡", clean: "✓" };
    $("missions").innerHTML = this.tracker.missions
      .map(
        (m, i) =>
          `<li class="${this.tracker.done[i] ? "done" : ""}"><span class="dia"><i>${ICONS[m.kind] ?? "★"}</i></span>` +
          `<span class="txt">${missionText(m)}</span><span class="prog" id="mp-${i}"></span></li>`,
      )
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

    if (this.state === "countdown" && !this.paused) {
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
    this.acc = this.paused ? 0 : this.acc + dt; // a paused race stands still
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
    // The player is spotlit on the grid and for the first seconds of the race.
    const highlight = this.state === "countdown" ? 1 : this.state === "racing" ? Math.max(0, 1 - race.time / 3) : 0;
    const riders: RiderView[] = race.racers.map((r) => (r.isPlayer ? { bike: r.bike, look: r.look, isPlayer: true, highlight } : r));
    if (this.ghost) {
      this.ghost.setTime(race.time);
      riders.push({ bike: this.ghost, look: GHOST_LOOK, isPlayer: false, ghost: true });
    }
    // The hub and the garage show the bike in the 3D garage; everything else the track.
    if ((this.state === "menu" || this.state === "garage") && this.renderer instanceof Renderer3D) this.renderer.drawShowroom(lookFor(this.profile), this.clock);
    else this.renderer.draw(this.cam, this.track, riders, this.clock);
    this.hud();

    const inRace = !this.paused && (this.state === "countdown" || this.state === "racing" || this.state === "finished");
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

    // During the countdown the camera closes in on the player, then eases out after the start.
    const start = this.state === "countdown" ? 1 : 0;
    // A page opened hidden starts at zero size and may get no resize event when shown.
    if (r.w !== window.innerWidth || r.h !== window.innerHeight) r.resize();
    // A zero-sized canvas would turn the camera into NaN for good: keep the last framing.
    if (!(r.basePpm() > 0)) return;
    if (!Number.isFinite(this.cam.x + this.cam.y) || !(this.cam.ppm > 0)) Object.assign(this.cam, { x: p.x, y: p.y, ppm: r.basePpm() });
    const ppm = (r.basePpm() * (1 + 0.5 * start)) / (1 + speed / 90 + Math.max(0, alt - 3) / 16);
    this.cam.ppm += (ppm - this.cam.ppm) * (1 - Math.exp(-dt * 2));

    const tx = p.x + (r.w * 0.12 * (1 - start)) / this.cam.ppm + ahead;
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
    const overlay = s === "menu" || s === "tracks" || s === "garage" || s === "board";
    this.sound.setMusicLevel(overlay || s === "finished" ? 0.35 : 0.14);
    $("menu").classList.toggle("hidden", s !== "menu");
    $("garage").classList.toggle("hidden", s !== "garage");
    $("tracks").classList.toggle("hidden", s !== "tracks");
    $("board").classList.toggle("hidden", s !== "board");
    $("results").classList.toggle("hidden", s !== "finished");
    $("hud").classList.toggle("hidden", overlay);
    $("controls").classList.toggle("hidden", overlay || s === "finished" || this.paused);
    $("track-name").textContent = `${this.track.name} · ${DIFFICULTIES[this.raceLevel].name}`;
  }
}

const game = new Game();
if (import.meta.env.DEV) Object.assign(window, { game, TRACKS });
