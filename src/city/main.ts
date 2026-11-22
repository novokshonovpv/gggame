// "Мото-город": entry point of city.html. Game loop, camera, keyboard and touch input, HUD,
// the bike shop and saving. Works on its own page and inside an <iframe> on any site.

import { enterFullscreen, exitFullscreen, isFullscreen, isTouch, onFullscreenChange } from "../fullscreen.ts";
import { CitySound } from "./audio.ts";
import { brandUrl } from "./brands.ts";
import { BOARD_LAP, BOARD_MONEY, CityCloud } from "./cloud.ts";
import { initMenu } from "./menu.ts";
import { Navigator, fmtDist } from "./nav.ts";
import { Online } from "./online.ts";
import { MUSIC_CREDIT } from "./radio.ts";
import { type Save, activeSlot, fresh, loadSlot, localNick, removeSlot, setActive, setLocalNick, write } from "./saves.ts";
import { CityMap } from "./map.ts";
import { type Camera, Renderer } from "./render.ts";
import { BIKES, type Input, WEAPONS, World, rub } from "./sim.ts";
import "./style.css";

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;
// Photos of the BSE bikes from the 67MOTO catalogue.
const PHOTOS: Record<string, string> = {
  ex125: new URL("../assets/67moto/bikes/125.jpg", import.meta.url).href,
  z3: new URL("../assets/67moto/bikes/250.jpg", import.meta.url).href,
  t5: new URL("../assets/67moto/bikes/300.jpg", import.meta.url).href,
  "2t": new URL("../assets/67moto/bikes/450.jpg", import.meta.url).href,
};
const BLURB: Record<string, string> = {
  z3: "Надёжный четырёхтактник, с него начинают все курьеры",
  ex125: "Лёгкий и вёрткий: лучше всех в поворотах и по газонам",
  t5: "Мощный эндуро: быстрее и крепче, держит удары",
  "2t": "Двухтактный зверь: самый резкий разгон в городе",
};
const DT = 1 / 60;
const embedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

let slot = activeSlot();
let save: Save = loadSlot(slot) ?? fresh();
let started = false;
let lastMoney = 0;
let sentEarned = 0;
const cloud = new CityCloud();
const PVP_KEY = "moto-city-pvp";

function store() {
  if (!started) return;
  save.money = world.money;
  save.arms = { ...world.arms };
  save.bestLap = world.bestLap;
  save.laps = { mx: world.bestLaps.mx ?? 0, ring: world.bestLaps.ring ?? 0 };
  save.packages = [...world.packagesGot];
  save.savedAt = Date.now();
  write(slot, save);
  // The leaderboard: total money earned (sent when it has grown).
  if (save.earned > sentEarned + 999 && localNick()) {
    sentEarned = save.earned;
    void cloud.init().then(() => cloud.submit(BOARD_MONEY, save.earned, true));
  }
}

const map = new CityMap(67);
const world = new World(map);

// Puts a save into the world: money, guns, records, the rider's colours and own bike.
function applySave(sv: Save) {
  world.money = sv.money;
  lastMoney = sv.money;
  world.bikeId = sv.bike;
  world.arms = { ...sv.arms };
  world.weapon = null;
  world.cycleWeapon();
  world.bestLap = sv.bestLap;
  world.bestLaps = { ...sv.laps, ...(sv.bestLap ? { enduro: sv.bestLap } : {}) };
  world.packagesGot = new Set(sv.packages);
  const b = world.player.body;
  b.helmet = sv.helmet;
  b.shirt = sv.jacket;
  if (world.player.mode === "ride" && world.player.bike) return;
  world.vehicles = world.vehicles.filter((v) => !(v.bike && v.rider === null && Math.hypot(v.x - b.x, v.y - b.y) < 40));
  world.spawnPlayerBike(sv.bike, b.x + Math.cos(b.a + Math.PI / 2) * 16, b.y + Math.sin(b.a + Math.PI / 2) * 16, b.a, false);
}
applySave(save);
try {
  world.pvp = localStorage.getItem(PVP_KEY) !== "off";
} catch {
  /* PvP on */
}

// ---------- navigator ----------

const navi = new Navigator(world);
navi.onArrive = () => {
  message("Вы прибыли — маршрут завершён", "good");
  sound.checkpoint();
};

// ---------- online ----------

const online = new Online(world, () => localNick() || "Игрок", () => ({ helmet: save.helmet, jacket: save.jacket }));
// ?net=local plays between tabs of one browser (testing); ?net=off stays single-player.
const netMode = new URLSearchParams(location.search).get("net");
{
  // ?t=22 (or ?night) starts at that hour: handy for an embed that wants night straight away.
  const q = new URLSearchParams(location.search);
  const h = q.has("night") ? 22 : Number(q.get("t"));
  if (q.has("night") || (q.has("t") && h >= 0 && h < 24)) world.clock = h;
}
const canvas = $<HTMLCanvasElement>("c");
const renderer = new Renderer(canvas, map);
const sound = new CitySound();
const cam: Camera = { x: world.px, y: world.py, zoom: 1 };
world.view = { x0: cam.x - 500, y0: cam.y - 300, x1: cam.x + 500, y1: cam.y + 300 };
world.populate(true);

type Mode = "title" | "play" | "pause" | "shop" | "map" | "garage";
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
  ControlLeft: "fire",
  ControlRight: "fire",
  KeyJ: "fire",
  KeyX: "fire",
  KeyQ: "swap",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
};
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement | null)?.closest?.("input")) return;
  if (mode === "title") {
    menu.key(e);
    return;
  }
  const k = KEYS[e.code];
  if (k) {
    e.preventDefault();
    if (!held.has(k)) edges.add(k);
    held.add(k);
    return;
  }
  if (e.repeat) return;
  if (e.code === "Tab") {
    e.preventDefault();
    if (mode === "play") openChat("near");
    else if (mode === "map") closeMap();
    return;
  }
  if (e.code === "KeyK") {
    if (mode === "play") openMap();
    else if (mode === "map") closeMap();
    return;
  }
  if (e.code === "Escape" || e.code === "KeyP") {
    if (mode === "map") closeMap();
    else if (mode === "play") pause();
    else if (mode === "pause") resume();
    else if (mode === "shop") closeShop();
    else if (mode === "garage") closeGarage();
  } else if (e.code === "KeyM") sound.toggle();
  else if ((e.code === "KeyT" || e.code === "Slash") && mode === "play") {
    e.preventDefault();
    openChat("all");
  }
  else if (e.code === "KeyR" && mode === "play") {
    if (world.player.mode === "ride") radioNext(e.shiftKey ? -1 : 1);
    else walkMusicToggle();
  }
  else if (e.code === "Period" && mode === "play") radioNext(1);
  else if (e.code === "Comma" && mode === "play") radioNext(-1);
});
window.addEventListener("keyup", (e) => {
  const k = KEYS[e.code];
  if (k) held.delete(k);
});
// Left mouse button fires too.
canvas.addEventListener("pointerdown", (e) => {
  // A click (or tap) on a billboard opens that brand's selection on 67moto.ru.
  const brand = mode === "play" ? renderer.adAt(e.offsetX, e.offsetY) : null;
  if (brand) {
    e.preventDefault();
    message(`Открываю ${brand.name} в каталоге 67МОТО`, "info");
    window.open(brandUrl(brand), "_blank", "noopener");
    return;
  }
  if (e.pointerType === "mouse" && e.button === 0 && mode === "play") {
    held.add("fire");
    edges.add("fire");
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const over = mode === "play" && !!renderer.adAt(e.offsetX, e.offsetY);
  canvas.style.cursor = over ? "pointer" : "";
});
window.addEventListener("pointerup", (e) => {
  if (e.pointerType === "mouse" && e.button === 0) held.delete("fire");
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
    fire: held.has("fire"),
    swap: edges.has("swap"),
    sprint: held.has("sprint"),
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
  if (!started && netMode !== "off") void online.start(netMode === "local" ? "local" : "firebase", cloud);
  started = true;
  mode = "play";
  menu.close();
  show("pause", false);
  show("hud", true);
  show("touch", isTouch());
  window.focus();
  store();
}

// Back to the main menu (from the pause screen): the city keeps its state.
function toMenu() {
  store();
  mode = "title";
  show("pause", false);
  show("hud", false);
  show("touch", false);
  sound.radioPlaying(false);
  sound.walkPlaying(false);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  sound.jet(0);
  menu.open("play");
}

function pause() {
  mode = "pause";
  const owned = save.owned.length;
  const lap = world.bestLap ? ` · рекорд стадиона ${world.bestLap.toFixed(2)} с` : "";
  $("pause-stats").textContent = `Деньги: ${rub(world.money)} · байков BSE: ${owned} из ${BIKES.length} · секретных посылок: ${world.packagesGot.size} из ${map.packages.length}${lap}`;
  show("pause", true);
  sound.radioPlaying(false);
  sound.walkPlaying(false);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  sound.jet(0);
}

function resume() {
  sound.unlock();
  mode = "play";
  show("pause", false);
  window.focus();
}

function openMap() {
  mode = "map";
  sound.radioPlaying(false);
  sound.walkPlaying(false);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  sound.jet(0);
  if (renderer.mapZoom > 1) renderer.centerMap(world.px, world.py);
  show("bigmap", true);
}

function closeMap() {
  mode = "play";
  show("bigmap", false);
  window.focus();
}

function openShop() {
  mode = "shop";
  sound.radioPlaying(false);
  sound.walkPlaying(false);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  sound.jet(0);
  renderShop();
  show("shop", true);
}

function closeShop() {
  mode = "play";
  show("shop", false);
  window.focus();
}

// ---------- the player's garage ----------

function openGarage() {
  mode = "garage";
  sound.radioPlaying(false);
  sound.walkPlaying(false);
  sound.engine(false, 0, 0, "");
  sound.sirenLevel(0, 0);
  sound.jet(0);
  sound.jet(0);
  // Every visit: the bike is mended and the game saved.
  const b = world.player.mode === "ride" ? world.player.bike : null;
  if (b) {
    b.hp = b.model.hp;
    b.burn = 0;
  }
  store();
  renderGarage();
  show("garage", true);
}

function closeGarage() {
  mode = "play";
  show("garage", false);
  window.focus();
}

function renderGarage() {
  const list = $("garage-list");
  list.innerHTML = "";
  $("garage-money").textContent = `У тебя ${rub(world.money)}`;
  const p = world.player;
  const riding = p.mode === "ride" && p.bike ? p.bike : null;
  for (const b of BIKES) {
    if (!save.owned.includes(b.id)) continue;
    const here = riding?.model.id === b.id;
    const card = document.createElement("div");
    card.className = "bike-card" + (here ? " current" : "");
    const stat = (label: string, v: number) => `<div class="stat"><span>${label}</span><i style="width:${Math.round(v * 100)}%"></i></div>`;
    card.innerHTML = `
      <div class="photo" style="background-image:url('${PHOTOS[b.id] ?? ""}')"></div>
      <b>${b.name}</b>
      <small>${BLURB[b.id] ?? ""}</small>
      ${stat("Скорость", b.vmax / 365)}
      ${stat("Разгон", b.accel / 555)}
      ${stat("Управление", (b.turn * b.grip) / (3.8 * 17))}
      ${stat("Прочность", b.hp / 75)}
      <div class="price">${save.bike === b.id ? "Основной байк" : "В гараже"}</div>`;
    const btn = document.createElement("button");
    btn.textContent = here ? "Ты на нём" : "Выехать";
    btn.disabled = here;
    btn.addEventListener("click", () => {
      save.bike = b.id;
      world.bikeId = b.id;
      // What the player came on stays: an own bike goes into the garage, anything else is left outside.
      const home = map.places.find((q) => q.kind === "home")!;
      const old = p.mode === "ride" ? p.bike : null;
      if (old) {
        old.rider = null;
        old.brk = 1;
        if (BIKES.some((m) => m.id === old.model.id)) world.vehicles = world.vehicles.filter((v) => v !== old);
        else old.x += 60;
      }
      p.mode = "foot";
      p.bike = null;
      world.vehicles = world.vehicles.filter((v) => !(v.bike && v.rider === null && Math.hypot(v.x - home.x, v.y - home.y) < 50));
      const v = world.spawnPlayerBike(b.id, home.x, home.y, -Math.PI / 2, true);
      v.vx = v.vy = 0;
      store();
      sound.checkpoint();
      closeGarage();
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}
$("garage-close").addEventListener("click", closeGarage);

function renderShop() {
  const list = $("shop-list");
  list.innerHTML = "";
  $("shop-money").textContent = `У тебя ${rub(world.money)}`;
  for (const b of BIKES) {
    const owned = save.owned.includes(b.id);
    const current = save.bike === b.id;
    const card = document.createElement("div");
    card.className = "bike-card" + (current ? " current" : "");
    const stat = (label: string, v: number) => `<div class="stat"><span>${label}</span><i style="width:${Math.round(v * 100)}%"></i></div>`;
    card.innerHTML = `
      <div class="photo" style="background-image:url('${PHOTOS[b.id] ?? ""}')"></div>
      <b>${b.name}</b>
      <small>${BLURB[b.id] ?? ""}</small>
      ${stat("Скорость", b.vmax / 365)}
      ${stat("Разгон", b.accel / 555)}
      ${stat("Управление", (b.turn * b.grip) / (3.8 * 17))}
      ${stat("Прочность", b.hp / 75)}
      <div class="price">${owned ? "Куплен" : b.price ? rub(b.price) : "Бесплатно"}</div>`;
    const btn = document.createElement("button");
    if (current) {
      btn.textContent = "Твой байк";
      btn.disabled = true;
    } else if (owned) btn.textContent = "Выбрать";
    else {
      btn.textContent = world.money < b.price ? `Не хватает ${rub(b.price - world.money)}` : "Купить";
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

const menu = initMenu({
  slot: () => slot,
  slotInfo: (i) => (i === slot && started ? { ...save, money: world.money } : loadSlot(i)),
  choose(i) {
    if (i === slot) return;
    store();
    setActive(i);
    if (started) {
      // A fresh city for another save: reload straight into the game.
      try {
        sessionStorage.setItem("moto-city-autostart", "1");
      } catch {
        /* the menu will ask again */
      }
      location.reload();
      return;
    }
    slot = i;
    save = loadSlot(i) ?? fresh();
    applySave(save);
  },
  erase(i) {
    removeSlot(i);
    if (i === slot && !started) {
      save = fresh();
      applySave(save);
    }
  },
  newGame() {
    removeSlot(slot);
    save = fresh();
    applySave(save);
  },
  play: start,
  started: () => started,
  embedded,
  nick: localNick,
  setNick: setLocalNick,
  hero: () => ({ helmet: save.helmet, jacket: save.jacket }),
  setHero(helmet, jacket) {
    save.helmet = helmet;
    save.jacket = jacket;
    world.player.body.helmet = helmet;
    world.player.body.shirt = jacket;
    if (started) store();
    else if (save.savedAt) write(slot, save);
  },
  packagesTotal: map.packages.length,
  sound,
  cloud,
  pvp: () => world.pvp,
  setPvp(on) {
    world.pvp = on;
    try {
      localStorage.setItem(PVP_KEY, on ? "on" : "off");
    } catch {
      /* this session only */
    }
    online.onChange();
  },
  onlineText: () =>
    online.status === "online"
      ? `Онлайн: в городе ${online.count} ${online.count === 1 ? "игрок" : online.count < 5 ? "игрока" : "игроков"}`
      : online.status === "connecting"
        ? "Подключаюсь к городу…"
        : online.status === "offline"
          ? "Онлайн недоступен — играешь один"
          : "Онлайн включится, когда начнёшь игру",
});
// The cloud signs in quietly in the background (nickname, leaderboards).
void cloud.init();
try {
  if (sessionStorage.getItem("moto-city-autostart")) {
    sessionStorage.removeItem("moto-city-autostart");
    if (localNick()) setTimeout(start, 0);
    else menu.open("play");
  } else menu.open("play");
} catch {
  menu.open("play");
}
$("b-map").addEventListener("click", () => (mode === "map" ? closeMap() : mode === "play" ? openMap() : undefined));
// A click (or tap) on the minimap opens the city map.
$("mini").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || mode !== "play") return;
  e.preventDefault();
  openMap();
});
$("map-close").addEventListener("click", closeMap);
// The city map: drag to move, wheel / pinch / buttons to zoom, a tap plans a route.
const mapCanvas = $<HTMLCanvasElement>("bigmap-canvas");
const mapPts = new Map<number, { x: number; y: number }>();
let mapMoved = 0; // CSS pixels dragged since the first finger went down
let mapPinch = 0;
const mapXY = (e: PointerEvent | WheelEvent) => {
  const r = mapCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const spread = () => {
  const [a, b] = [...mapPts.values()];
  return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
mapCanvas.addEventListener("pointerdown", (e) => {
  if (mode !== "map") return;
  e.preventDefault();
  mapCanvas.setPointerCapture(e.pointerId);
  if (mapPts.size === 0) mapMoved = 0;
  mapPts.set(e.pointerId, mapXY(e));
  if (mapPts.size === 2) {
    mapPinch = spread().d;
    mapMoved = 99; // a pinch is never a tap
  }
});
mapCanvas.addEventListener("pointermove", (e) => {
  const prev = mapPts.get(e.pointerId);
  if (!prev || mode !== "map") return;
  const pt = mapXY(e);
  mapPts.set(e.pointerId, pt);
  if (mapPts.size >= 2) {
    const s = spread();
    if (mapPinch > 0) renderer.zoomMap(s.d / mapPinch, s.x, s.y);
    mapPinch = s.d;
    return;
  }
  mapMoved += Math.abs(pt.x - prev.x) + Math.abs(pt.y - prev.y);
  if (mapMoved > 6) {
    renderer.panMap(pt.x - prev.x, pt.y - prev.y);
    mapCanvas.classList.add("dragging");
  }
});
const mapUp = (e: PointerEvent) => {
  if (!mapPts.delete(e.pointerId)) return;
  if (mapPts.size === 1) mapPinch = 0;
  if (mapPts.size > 0) return;
  mapCanvas.classList.remove("dragging");
  if (mapMoved <= 6 && e.type === "pointerup") mapTap(mapXY(e));
};
mapCanvas.addEventListener("pointerup", mapUp);
mapCanvas.addEventListener("pointercancel", mapUp);
mapCanvas.addEventListener(
  "wheel",
  (e) => {
    if (mode !== "map") return;
    e.preventDefault();
    const p = mapXY(e);
    renderer.zoomMap(Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0018), p.x, p.y);
  },
  { passive: false },
);
const zoomMid = (f: number) => renderer.zoomMap(f, mapCanvas.clientWidth / 2, mapCanvas.clientHeight / 2);
$("map-in").addEventListener("click", () => zoomMid(1.6));
$("map-out").addEventListener("click", () => zoomMid(1 / 1.6));
$("map-me").addEventListener("click", () => {
  if (renderer.mapZoom < 4) renderer.mapZoom = 4;
  renderer.centerMap(world.px, world.py);
});
window.addEventListener("keydown", (e) => {
  if (mode !== "map") return;
  if (e.key === "+" || e.key === "=") zoomMid(1.6);
  else if (e.key === "-" || e.key === "_") zoomMid(1 / 1.6);
});

// The navigator: a tap on the city map puts a destination there and plans the route.
function mapTap(at: { x: number; y: number }) {
  const pt = renderer.mapToWorld(at.x, at.y);
  if (!pt) return;
  // A click on the current destination removes it.
  const nav = world.nav;
  if (nav && Math.hypot(nav.x - pt.x, nav.y - pt.y) < 200) {
    navi.clear();
    $("map-hint").textContent = "Маршрут сброшен. Нажми на карту, чтобы проложить новый";
    return;
  }
  if (navi.set(pt.x, pt.y)) {
    sound.checkpoint();
    $("map-hint").textContent = `Маршрут проложен: ${fmtDist(world.nav!.dist)}. Нажми на флажок, чтобы сбросить`;
  } else $("map-hint").textContent = "Туда не проехать — выбери точку на улице";
}
$("nav").addEventListener("click", () => {
  navi.clear();
  message("Маршрут сброшен", "info");
});
// Tap the weapon label to switch guns (on a phone there is no Q key).
$("gun").addEventListener("click", () => world.cycleWeapon());
$("radio-prev").addEventListener("click", () => radioNext(-1));
$("radio-next").addEventListener("click", () => radioNext(1));
$("t-radio").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  radioNext(1);
});
$("radio-name").addEventListener("click", () => radioNext(1));
// Mouse wheel tunes the radio while riding.
canvas.addEventListener(
  "wheel",
  (e) => {
    if (mode !== "play" || world.player.mode !== "ride") return;
    e.preventDefault();
    radioNext(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
$("pause-credit").textContent = MUSIC_CREDIT;

let bannerT = 0;
function radioBanner(station: string, song: string) {
  const el = $("radio-banner");
  el.innerHTML = `<b>${station.startsWith("♪") ? "" : "📻 "}${station}</b>${song ? `<span>${song}</span>` : ""}`;
  el.classList.remove("hidden");
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  bannerT = 3.5;
}
sound.onTrack = (s, t) => {
  if (world.player.mode === "ride") radioBanner(`${s.name} · ${s.genre}`, `Kevin MacLeod — «${t.title}»`);
};
let wasRiding = false;
sound.onWalkTrack = (_s, t) => {
  if (world.player.mode !== "ride") radioBanner("♪ Музыка", `Kevin MacLeod — «${t.title}» · R — выключить`);
};
function walkMusicToggle() {
  const on = sound.walkToggle();
  radioBanner(on ? "♪ Музыка включена" : "♪ Музыка выключена", "R — переключить, на мотоцикле — радио");
}
let radioWheel = 0;

function radioNext(step: number) {
  const now = performance.now();
  if (now - radioWheel < 150) return; // a wheel flick is one click
  radioWheel = now;
  const name = sound.radioCycle(step);
  if (name === "Радио выключено") radioBanner("Радио выключено", "");
  else if (world.player.mode !== "ride") radioBanner(name.replace(" — ", " · "), "заиграет, когда сядешь на мотоцикл");
  lastHud = "";
}
// The 67MOTO fonts are drawn on the canvas too (billboards, signs).
void document.fonts?.load("800 12px Unbounded");
void document.fonts?.load("700 12px Manrope");
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
$("p-menu").addEventListener("click", toMenu);
window.addEventListener("resize", () => renderer.resize());
window.addEventListener("pagehide", store);
// For the embed API and debugging from the console.
(window as unknown as { motoCity: World }).motoCity = world;

// ---------- HUD ----------

const msgs = $("msgs");
// ---------- chat and the online badge ----------

const chatLog = $("chat-log");
function chatLine(nick: string, text: string, mine: boolean, near = false) {
  const el = document.createElement("div");
  el.className = `chat-line${mine ? " mine" : ""}${near ? " near" : ""}`;
  const b = document.createElement("b");
  b.textContent = `${nick}: `;
  if (near) {
    const tag = document.createElement("i");
    tag.textContent = "рядом · ";
    el.append(tag);
  }
  el.append(b, document.createTextNode(text));
  chatLog.append(el);
  while (chatLog.children.length > 6) chatLog.firstElementChild!.remove();
  setTimeout(() => el.classList.add("fade"), 20000);
  setTimeout(() => el.remove(), 21000);
}
online.onChat = (c, mine) => chatLine(c.n, c.m, mine);
online.onSay = (nick, text, mine) => chatLine(nick, text, mine, true);
online.onMessage = (text, tone) => message(text, tone);
online.onChange = () => {
  const el = $("net");
  const st = online.status;
  el.className = `net ${st}`;
  el.textContent =
    st === "online" ? `● Онлайн: ${online.count}${world.pvp ? " · PvP" : ""}` : st === "connecting" ? "● Подключение…" : st === "offline" ? "● Офлайн" : "";
  el.classList.toggle("hidden", st === "off");
  menu.refresh();
};

const chatForm = $<HTMLFormElement>("chat-form");
const chatInput = $<HTMLInputElement>("chat-input");
// Two ways to talk: "near" — a bubble over the head that players close by see (Tab),
// "all" — the city-wide chat (T).
let chatTo: "near" | "all" = "near";
const chatMode = $("chat-mode");
function setChatTo(to: "near" | "all") {
  chatTo = to;
  chatMode.textContent = to === "near" ? "Рядом" : "Всем";
  chatMode.classList.toggle("all", to === "all");
  chatInput.placeholder =
    to === "near" ? "Сказать тем, кто рядом… (облачко над головой)" : "Сообщение всем игрокам… (без мата — он заменится звёздочками)";
}
function openChat(to: "near" | "all") {
  if (to === "all" && !online.online) {
    message("Чат со всеми работает, когда игра онлайн", "info");
    return;
  }
  setChatTo(to);
  held.clear();
  chatForm.classList.remove("hidden");
  chatInput.value = "";
  chatInput.focus();
}
function closeChat() {
  chatForm.classList.add("hidden");
  chatInput.blur();
  window.focus();
}
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text && chatTo === "all") online.sendChat(text);
  else if (text) {
    if (!online.say(text)) message("Не так быстро — подожди секунду", "info");
    else if (!online.online) message("Игра офлайн — тебя никто не услышит", "info");
    else if (online.nearby === 0) message("Рядом никого — сказанное никто не услышал", "info");
  }
  closeChat();
});
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeChat();
  else if (e.key === "Tab") {
    // Tab in the box switches who hears it.
    e.preventDefault();
    if (chatTo === "near" && online.online) setChatTo("all");
    else setChatTo("near");
  }
  e.stopPropagation();
});
chatMode.addEventListener("click", () => {
  if (chatTo === "near" && !online.online) message("Чат со всеми работает, когда игра онлайн", "info");
  else setChatTo(chatTo === "near" ? "all" : "near");
  chatInput.focus();
});
const chatOpen = (to: "near" | "all") => (chatForm.classList.contains("hidden") || chatTo !== to ? openChat(to) : closeChat());
$("b-chat").addEventListener("click", () => chatOpen("all"));
$("b-say").addEventListener("click", () => chatOpen("near"));

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
  const money = rub(shownMoney);
  const speed = p.mode === "ride" && p.bike ? Math.round(Math.abs(p.bike.fwd) * 0.45) : 0;
  const job = world.job;
  const tleft = job ? Math.max(0, Math.ceil(job.time)) : 0;
  let hint = "";
  if (p.mode === "foot") {
    const v = world.enterable();
    const what = v ? (v.bike ? "сесть на мотоцикл" : v.police ? "угнать полицейскую машину" : "сесть в машину") : "";
    hint = v ? (isTouch() ? `Жми E — ${what}` : `E — ${what}`) : "";
  }
  const clock = `${String(Math.floor(world.clock)).padStart(2, "0")}:${String(Math.floor((world.clock % 1) * 6) * 10).padStart(2, "0")}`;
  const gun = world.weapon ? `${WEAPONS[world.weapon].name} · ${world.arms[world.weapon] ?? 0}` : "";
  // Bonuses from the "?" crates.
  const perks: string[] = [];
  if (p.nitro > 0) perks.push(`<span class="perk nitro">Нитро ×${p.nitro}</span>`);
  if (world.boostT > 0) perks.push(`<span class="perk nitro on">Нитро!</span>`);
  if (world.streak >= 1) perks.push(`<span class="perk streak">Серия ${world.streak} · ×${(1 + 0.25 * Math.min(world.streak, 4)).toFixed(2).replace(/\.?0+$/, "")}</span>`);
  if (world.job?.kind === "stadium") {
    const best = world.bestLaps[world.job.track?.id ?? "enduro"];
    perks.push(`<span class="perk lap">Круг ${(world.time - (world.job.start ?? world.time)).toFixed(1)} с${best ? ` · рекорд ${best.toFixed(2)}` : ""}</span>`);
  }
  if (world.job?.kind === "circuit" && !(world.job.go! > 0)) {
    const G = world.job.track!.gates.length;
    perks.push(`<span class="perk lap">Место ${world.racePlace()}/4 · круг ${Math.min(world.job.track!.laps, Math.floor(world.job.idx / G) + 1)}/${world.job.track!.laps}</span>`);
  }
  if (world.double > 0) perks.push(`<span class="perk double">Деньги ×2 · ${Math.ceil(world.double)} с</span>`);
  if (world.rush) perks.push(`<span class="perk rush">Монеты ${world.rush.got}/10 · ${Math.ceil(world.rush.t)} с</span>`);
  if (p.jailCard) perks.push(`<span class="perk card">Карта «Выйти из участка»</span>`);
  const perkHtml = perks.join("");
  const radio = sound.radioName;
  const navText = world.nav ? `📍 ${fmtDist(world.nav.dist)}` : "";
  const key = [money, Math.round(p.health), Math.round(p.armor), world.wanted, speed, job?.title, tleft, job?.idx, hint, p.bike?.model.id, p.mode, Math.floor(world.time * 2) % 2, clock, gun, perkHtml, radio, navText].join("|");
  if (key === lastHud) return;
  lastHud = key;
  $("money").textContent = money;
  $("clock").textContent = clock;
  $("gun").textContent = gun;
  $("gun").classList.toggle("hidden", !gun);
  show("t-fire", !!gun);
  $("hp").style.width = `${p.health}%`;
  $("armor").style.width = `${p.armor}%`;
  $("perks").innerHTML = perkHtml;
  $("nav").textContent = navText ? `${navText} ✕` : "";
  $("nav").classList.toggle("hidden", !navText);
  $("radio-name").textContent = `📻 ${radio.split(" — ")[0]}`;
  $("radio").classList.toggle("off", radio === "Радио выключено");
  $("radio").classList.toggle("riding", p.mode === "ride");
  show("t-radio", p.mode === "ride");
  const sprint = $("t-sprint");
  sprint.textContent = p.mode === "ride" ? `Нитро ×${p.nitro}` : "Бег";
  sprint.classList.toggle("hidden", p.mode === "ride" && p.nitro <= 0);
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
    tt.textContent = `${Math.floor(tleft / 60)}:${String(tleft % 60).padStart(2, "0")} · ${rub(job.reward)}`;
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
        message(`+${rub(e.amount)}`, "good");
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
      case "shot":
        if (Math.hypot(e.x - world.px, e.y - world.py) < 700) sound.shot(e.weapon);
        break;
      case "surprise":
        if (e.good) sound.jobDone();
        big(e.text.length > 26 ? "Сюрприз!" : e.text, e.good ? "surprise" : "wasted");
        break;
      case "nitro":
        sound.nitro();
        break;
      case "stunt":
        sound.jobDone();
        big(e.text.split(" ")[0] === "БЕЗУМНЫЙ" ? "Безумный трюк!" : e.text.replace(/ \d.*$/, ""), "surprise");
        message(`${e.text}: +${rub(e.amount)}`, "good");
        break;
      case "ring":
        sound.ring(Math.hypot(e.x - world.px, e.y - world.py));
        break;
      case "package":
        sound.jobDone();
        big(`Посылка ${e.got}/${e.total}`, "surprise");
        store();
        break;
      case "lap":
        if (e.record) big("Рекорд круга!", "surprise");
        store();
        if (e.record && e.track === "enduro" && localNick()) void cloud.init().then(() => cloud.submit(BOARD_LAP, e.time, false));
        break;
      case "garage":
        if (mode === "play") openGarage();
        break;
      case "countdown":
        sound.countdown(e.n);
        big(e.n > 0 ? String(e.n) : "Старт!", "surprise");
        break;
      case "planeHit":
        sound.crash(500);
        shake = 10;
        break;
      case "coin":
        sound.cash();
        break;
      case "weapon":
        sound.reload();
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
      case "pvpDown":
        big("Тебя сбили!", "wasted");
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
  // Next frame first: a bug in one frame must not freeze the whole game.
  requestAnimationFrame(frame);
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
    online.update(dt);
    navi.update(dt);
    handleEvents();
    const p = world.player;
    if (p.mode === "out" && p.outT <= 0) {
      const how = $("big").classList.contains("busted") ? "busted" : "wasted";
      world.respawn(how);
      handleEvents();
      store();
    }
    if (world.money > lastMoney) save.earned += world.money - lastMoney;
    lastMoney = world.money;
    save.playTime += dt;
    if (world.time - lastSave > 10) {
      lastSave = world.time;
      store();
    }
    renderer.lightsT = world.clock * 60;
    // Engine and siren.
    const bike = p.mode === "ride" ? p.bike : null;
    sound.engine(!!bike, bike ? bike.fwd / bike.model.vmax : 0, bike ? bike.thr : 0, bike?.model.id ?? "");
    sound.radioPlaying(!!bike);
    sound.walkPlaying(!bike && p.mode !== "out");
    // Getting on a bike: say what is on and how to change it.
    if (!!bike && !wasRiding) {
      const tip = isTouch() ? "кнопка 📻 — сменить станцию" : "R или колесо мыши — сменить станцию";
      radioBanner(sound.radioName.replace(" — ", " · "), tip);
    }
    wasRiding = !!bike;
    let siren = 0;
    for (const v of world.vehicles)
      if (v.police && v.chase && v.alive) siren = Math.max(siren, 1 - Math.hypot(v.x - world.px, v.y - world.py) / 900);
    sound.sirenLevel(Math.max(0, siren), time);
    // Jets: loud on the runway, a distant roar overhead.
    let jet = 0;
    for (const q of world.planes) jet = Math.max(jet, (q.phase === "approach" || q.phase === "climb" ? 0.7 : q.v > 60 ? 1 : 0.35) * q.fade * Math.max(0, 1 - Math.hypot(q.x - world.px, q.y - world.py) / 2600));
    sound.jet(jet);
  }

  // Camera: ahead of the bike, wider at speed.
  const p = world.player;
  const mv = p.mode === "ride" && p.bike ? p.bike : p.body;
  const speed = Math.hypot(mv.vx, mv.vy);
  const k = 1 - Math.exp(-dt * 4);
  cam.x += (world.px + mv.vx * 0.45 - cam.x) * k;
  cam.y += (world.py + mv.vy * 0.45 - cam.y) * k;
  const short = Math.min(renderer.w, renderer.h);
  const base = short / (short < 500 ? 320 : 410); // view size in world units (smaller = closer)
  const zt = base / (1 + 0.6 * Math.min(1, speed / 380));
  cam.zoom += (zt - cam.zoom) * (1 - Math.exp(-dt * 1.6));
  if (mode === "title" && !started) {
    cam.x = world.px + Math.cos(time * 0.1) * 300;
    cam.y = world.py + Math.sin(time * 0.1) * 200;
    cam.zoom = base * 0.8;
  }
  shake *= Math.exp(-dt * 8);
  const view = { ...cam, x: cam.x + (Math.random() - 0.5) * shake, y: cam.y + (Math.random() - 0.5) * shake };
  renderer.draw(world, view, time);
  if (mode !== "title") renderer.drawMinimap($<HTMLCanvasElement>("mini"), world, time);
  if (mode === "map") renderer.drawFullMap($<HTMLCanvasElement>("bigmap-canvas"), world, time);
  if (mode === "play") hud(dt);
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0) $("radio-banner").classList.remove("show");
  }
  if (bigT > 0) {
    bigT -= dt;
    if (bigT <= 0) $("big").classList.add("hidden");
  }
}
requestAnimationFrame(frame);

// Let a hosting page ask for the state or pause the game (postMessage API for embeds).
window.addEventListener("message", (e) => {
  const d = e.data as { type?: string } | null;
  if (!d || typeof d !== "object") return;
  if (d.type === "moto-city:pause" && mode === "play") pause();
  if (d.type === "moto-city:resume" && mode === "pause") resume();
});
