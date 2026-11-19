// "Мото-город": entry point of city.html. Game loop, camera, keyboard and touch input, HUD,
// the bike shop and saving. Works on its own page and inside an <iframe> on any site.

import { enterFullscreen, exitFullscreen, isFullscreen, isTouch, onFullscreenChange } from "../fullscreen.ts";
import { CitySound } from "./audio.ts";
import { CityMap } from "./map.ts";
import { type Camera, Renderer } from "./render.ts";
import { BIKE, BIKES, type Input, World } from "./sim.ts";
import "./style.css";

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
const SAVE = "moto-city-v1";
const DT = 1 / 60;
const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

interface Save {
  money: number;
  owned: string[];
  bike: string;
}

function load(): Save {
  const def: Save = { money: 0, owned: ["scooter", "enduro"], bike: "enduro" };
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) ?? "null") as Partial<Save> | null;
    if (!s) return def;
    return {
      money: Math.max(0, Math.floor(Number(s.money) || 0)),
      owned: Array.isArray(s.owned) ? [...new Set([...def.owned, ...s.owned.filter((id) => BIKE[id])])] : def.owned,
      bike: s.bike && BIKE[s.bike] ? s.bike : def.bike,
    };
  } catch {
    return def;
  }
}

const save = load();
function store() {
  save.money = world.money;
  try {
    localStorage.setItem(SAVE, JSON.stringify(save));
  } catch {
    /* private mode: progress lives only in this tab */
  }
}

const map = new CityMap(67);
const world = new World(map);
world.money = save.money;
world.bikeId = save.bike;
{
  // Start on foot by the workshop, the rider's own bike at the kerb.
  const b = world.player.body;
  world.spawnPlayerBike(save.bike, b.x + Math.cos(b.a + Math.PI / 2) * 16, b.y + Math.sin(b.a + Math.PI / 2) * 16, b.a, false);
}
const canvas = $<HTMLCanvasElement>("c");
const renderer = new Renderer(canvas, map);
const sound = new CitySound();
const cam: Camera = { x: world.px, y: world.py, zoom: 1 };
world.view = { x0: cam.x - 500, y0: cam.y - 300, x1: cam.x + 500, y1: cam.y + 300 };
world.populate(true);

type Mode = "title" | "play" | "pause" | "shop";
let mode: Mode = "title";

// ---------- input ----------

const held = new Set<string>();
const edges = new Set<string>();
const KEYS: Record<string, string> = {
  ArrowUp: "gas",
  KeyW: "gas",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  Space: "hb",
  KeyE: "action",
  KeyF: "action",
  Enter: "action",
};
window.addEventListener("keydown", (e) => {
  const k = KEYS[e.code];
  if (k) {
    e.preventDefault();
    if (!held.has(k)) edges.add(k);
    held.add(k);
    return;
  }
  if (e.repeat) return;
  if (e.code === "Escape" || e.code === "KeyP") {
    if (mode === "play") pause();
    else if (mode === "pause") resume();
    else if (mode === "shop") closeShop();
  } else if (e.code === "KeyM") sound.toggle();
});
window.addEventListener("keyup", (e) => {
  const k = KEYS[e.code];
  if (k) held.delete(k);
});
window.addEventListener("blur", () => {
  held.clear();
  if (mode === "play") pause();
});
document.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => {
  const k = el.dataset.k!;
  const ids = new Set<number>();
  const up = (e: PointerEvent) => {
    ids.delete(e.pointerId);
    if (ids.size === 0) {
      held.delete(k);
      el.classList.remove("down");
    }
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    ids.add(e.pointerId);
    if (!held.has(k)) edges.add(k);
    held.add(k);
    el.classList.add("down");
  });
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
});

function readInput(): Input {
  const onFoot = world.player.mode !== "ride";
  const inp: Input = {
    gas: held.has("gas"),
    brake: held.has("brake"),
    left: held.has("left"),
    right: held.has("right"),
    hb: held.has("hb") && !onFoot,
    action: edges.has("action"),
    kick: edges.has("hb") && onFoot,
  };
  edges.clear();
  return inp;
}

// ---------- screens ----------

function show(id: string, on: boolean) {
  $(id).classList.toggle("hidden", !on);
}

function start() {
  sound.unlock();
  mode = "play";
  show("title", false);
  show("hud", true);
  show("touch", isTouch());
  window.focus();
}

function pause() {
  mode = "pause";
  const owned = save.owned.length;
  $("pause-stats").textContent = `Деньги: $${world.money.toLocaleString("ru-RU")} · байков: ${owned} из ${BIKES.length}`;
  show("pause", true);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
}

function resume() {
  sound.unlock();
  mode = "play";
  show("pause", false);
  window.focus();
}

function openShop() {
  mode = "shop";
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  renderShop();
  show("shop", true);
}

function closeShop() {
  mode = "play";
  show("shop", false);
  window.focus();
}

function renderShop() {
  const list = $("shop-list");
  list.innerHTML = "";
  for (const b of BIKES) {
    const owned = save.owned.includes(b.id);
    const current = save.bike === b.id;
    const card = document.createElement("div");
    card.className = "bike-card" + (current ? " current" : "");
    const stat = (label: string, v: number) => `<div class="stat"><span>${label}</span><i style="width:${Math.round(v * 100)}%"></i></div>`;
    card.innerHTML = `
      <div class="swatch" style="background:${b.colors[0]}"></div>
      <b>${b.name}</b>
      ${stat("Скорость", b.vmax / 470)}
      ${stat("Разгон", b.accel / 580)}
      ${stat("Управление", (b.turn * b.grip) / (3.5 * 18))}
      ${stat("Прочность", b.hp / 100)}`;
    const btn = document.createElement("button");
    if (current) {
      btn.textContent = "Твой байк";
      btn.disabled = true;
    } else if (owned) btn.textContent = "Выбрать";
    else {
      btn.textContent = `Купить $${b.price.toLocaleString("ru-RU")}`;
      btn.disabled = world.money < b.price;
    }
    btn.addEventListener("click", () => {
      if (!owned) {
        if (world.money < b.price) return;
        world.money -= b.price;
        save.owned.push(b.id);
        sound.cash();
      }
      save.bike = b.id;
      world.bikeId = b.id;
      store();
      // The new bike rolls out of the showroom with the rider on it.
      const shop = map.places.find((p) => p.kind === "shop")!;
      const p = world.player;
      const old = p.bike;
      if (old) {
        old.rider = null;
        old.brk = 1;
        old.x += 30;
      }
      p.mode = "foot";
      p.bike = null;
      const v = world.spawnPlayerBike(b.id, shop.x, shop.y, old?.a ?? 0, true);
      v.vx = v.vy = 0;
      renderShop();
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}

$("b-play").addEventListener("click", start);
$("p-resume").addEventListener("click", resume);
$("shop-close").addEventListener("click", closeShop);
$("b-pause").addEventListener("click", () => (mode === "play" ? pause() : resume()));
$("b-mute").addEventListener("click", () => {
  sound.unlock();
  sound.toggle();
});
sound.onMute((m) => $("b-mute").classList.toggle("muted", m));
$("b-fs").addEventListener("click", () => void (isFullscreen() ? exitFullscreen() : enterFullscreen()));
onFullscreenChange(() => setTimeout(() => renderer.resize(), 100));
if (embedded) $("p-menu").classList.add("hidden");
$("p-menu").addEventListener("click", () => {
  store();
  location.href = "./";
});
window.addEventListener("resize", () => renderer.resize());
window.addEventListener("pagehide", store);
// For the embed API and debugging from the console.
(window as unknown as { motoCity: World }).motoCity = world;

// ---------- HUD ----------

const msgs = $("msgs");
function message(text: string, tone: "good" | "bad" | "info") {
  const el = document.createElement("div");
  el.className = `msg ${tone}`;
  el.textContent = text;
  msgs.prepend(el);
  while (msgs.children.length > 3) msgs.lastElementChild!.remove();
  setTimeout(() => el.classList.add("fade"), 3600);
  setTimeout(() => el.remove(), 4300);
}

let bigT = 0;
function big(text: string, cls: string) {
  const el = $("big");
  el.textContent = text;
  el.className = `big ${cls}`;
  bigT = 3;
}

let shownMoney = world.money;
let lastHud = "";
function hud(dt: number) {
  const p = world.player;
  shownMoney += (world.money - shownMoney) * Math.min(1, dt * 6);
  if (Math.abs(world.money - shownMoney) < 1) shownMoney = world.money;
  const money = `$${Math.round(shownMoney).toLocaleString("ru-RU")}`;
  const speed = p.mode === "ride" && p.bike ? Math.round(Math.abs(p.bike.fwd) * 0.45) : 0;
  const job = world.job;
  const tleft = job ? Math.max(0, Math.ceil(job.time)) : 0;
  let hint = "";
  if (p.mode === "foot") {
    const near = world.vehicles.some((v) => v.bike && v.alive && v.burn <= 0 && Math.hypot(v.x - p.body.x, v.y - p.body.y) < 34);
    hint = near ? (isTouch() ? "Жми E — сесть на мотоцикл" : "E — сесть на мотоцикл") : "";
  }
  const key = [money, Math.round(p.health), world.wanted, speed, job?.title, tleft, job?.idx, hint, p.bike?.model.id, Math.floor(world.time * 2) % 2].join("|");
  if (key === lastHud) return;
  lastHud = key;
  $("money").textContent = money;
  $("hp").style.width = `${p.health}%`;
  $("hp").classList.toggle("low", p.health < 30);
  const w = $("wanted");
  const blink = world.wanted > 0 && world.unseen === 0 && Math.floor(world.time * 2) % 2 === 0;
  w.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < world.wanted ? "on" : ""}${blink && i < world.wanted ? " blink" : ""}">★</i>`).join("");
  $("spd").textContent = String(speed);
  $("bike-name").textContent = p.mode === "ride" && p.bike ? p.bike.model.name : "пешком";
  show("job", !!job);
  if (job) {
    const steps = job.points.length > 1 ? ` · ${job.idx + 1}/${job.points.length}` : "";
    $("job-title").textContent = `${job.title}${steps}`;
    const tt = $("job-time");
    tt.textContent = `${Math.floor(tleft / 60)}:${String(tleft % 60).padStart(2, "0")} · $${job.reward}`;
    tt.classList.toggle("low", tleft <= 10);
  }
  const h = $("hint");
  h.textContent = hint;
  h.classList.toggle("hidden", !hint);
  $("t-hb").textContent = p.mode === "ride" ? "Занос" : "Удар";
}

// ---------- events ----------

let lastSave = 0;
function handleEvents() {
  for (const e of world.events) {
    switch (e.type) {
      case "msg":
        message(e.text, e.tone);
        break;
      case "crash":
        sound.crash(e.power);
        break;
      case "ped":
        sound.thud();
        break;
      case "kick":
        sound.kick();
        break;
      case "cash":
        sound.cash();
        message(`+$${e.amount}`, "good");
        break;
      case "health":
        sound.health();
        break;
      case "explode":
        if (Math.hypot(e.x - world.px, e.y - world.py) < 900) sound.explode();
        break;
      case "splash":
        sound.splash();
        break;
      case "checkpoint":
        sound.checkpoint();
        break;
      case "jobDone":
        sound.jobDone();
        store();
        break;
      case "jobFail":
        sound.fail();
        break;
      case "wanted":
        sound.wanted(e.level > 0);
        break;
      case "horn":
        if (Math.hypot(e.x - world.px, e.y - world.py) < 400) sound.horn();
        break;
      case "busted":
        big("Задержан!", "busted");
        sound.fail();
        break;
      case "wasted":
        big("Разбился!", "wasted");
        sound.fail();
        break;
      case "shop":
        if (world.player.mode !== "out") openShop();
        break;
    }
  }
  world.events.length = 0;
}

// ---------- loop ----------

let acc = 0;
let last = performance.now();
let time = 0;
let shake = 0;

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;
  if (mode === "play") {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 6) {
      world.step(DT, readInput());
      acc -= DT;
      steps++;
    }
    if (steps === 6) acc = 0;
    for (const e of world.events) if (e.type === "crash" && e.power > 90) shake = Math.max(shake, Math.min(10, e.power / 30));
    handleEvents();
    const p = world.player;
    if (p.mode === "out" && p.outT <= 0) {
      const how = $("big").classList.contains("busted") ? "busted" : "wasted";
      world.respawn(how);
      handleEvents();
      store();
    }
    if (world.time - lastSave > 10) {
      lastSave = world.time;
      store();
    }
    // Engine and siren.
    const bike = p.mode === "ride" ? p.bike : null;
    sound.engine(!!bike, bike ? bike.fwd / bike.model.vmax : 0, bike ? bike.thr : 0, bike?.model.id ?? "");
    let siren = 0;
    for (const v of world.vehicles)
      if (v.police && v.chase && v.alive) siren = Math.max(siren, 1 - Math.hypot(v.x - world.px, v.y - world.py) / 900);
    sound.sirenLevel(Math.max(0, siren), time);
  }

  // Camera: ahead of the bike, wider at speed.
  const p = world.player;
  const mv = p.mode === "ride" && p.bike ? p.bike : p.body;
  const speed = Math.hypot(mv.vx, mv.vy);
  const k = 1 - Math.exp(-dt * 4);
  cam.x += (world.px + mv.vx * 0.45 - cam.x) * k;
  cam.y += (world.py + mv.vy * 0.45 - cam.y) * k;
  const short = Math.min(renderer.w, renderer.h);
  const base = short / (short < 500 ? 390 : 500);
  const zt = base / (1 + 0.6 * Math.min(1, speed / 380));
  cam.zoom += (zt - cam.zoom) * (1 - Math.exp(-dt * 1.6));
  if (mode === "title") {
    cam.x = world.px + Math.cos(time * 0.1) * 300;
    cam.y = world.py + Math.sin(time * 0.1) * 200;
    cam.zoom = base * 0.8;
  }
  shake *= Math.exp(-dt * 8);
  const view = { ...cam, x: cam.x + (Math.random() - 0.5) * shake, y: cam.y + (Math.random() - 0.5) * shake };
  renderer.draw(world, view, time);
  if (mode !== "title") renderer.drawMinimap($<HTMLCanvasElement>("mini"), world, time);
  if (mode === "play") hud(dt);
  if (bigT > 0) {
    bigT -= dt;
    if (bigT <= 0) $("big").classList.add("hidden");
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Let a hosting page ask for the state or pause the game (postMessage API for embeds).
window.addEventListener("message", (e) => {
  const d = e.data as { type?: string } | null;
  if (!d || typeof d !== "object") return;
  if (d.type === "moto-city:pause" && mode === "play") pause();
  if (d.type === "moto-city:resume" && mode === "pause") resume();
});
