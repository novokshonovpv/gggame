// The main menu: animated title, player name, save slots, the online leaderboard, the
// rider's colours, options, controls and credits. Keyboard (↑ ↓ Enter Esc) or mouse/touch.

import type { CitySound } from "./audio.ts";
import { isClean } from "./censor.ts";
import { BOARD_LAP, BOARD_MONEY, type CityCloud, NICK_RE, type Row } from "./cloud.ts";
import { MUSIC_CREDIT } from "./radio.ts";
import { HELMETS, JACKETS, SLOTS, type Save } from "./saves.ts";
import { BIKE, BIKES, rub } from "./sim.ts";

export interface MenuApi {
  slot(): number;
  slotInfo(i: number): Save | null;
  choose(i: number): void;
  erase(i: number): void;
  newGame(): void;
  play(): void;
  started(): boolean;
  embedded: boolean;
  nick(): string;
  setNick(n: string): void;
  hero(): { helmet: string; jacket: string };
  setHero(helmet: string, jacket: string): void;
  packagesTotal: number;
  sound: CitySound;
  cloud: CityCloud;
  pvp(): boolean;
  setPvp(on: boolean): void;
  onlineText(): string;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const PAGES = [
  ["play", "Играть"],
  ["saves", "Сохранения"],
  ["board", "Рекорды"],
  ["hero", "Герой"],
  ["options", "Настройки"],
  ["controls", "Управление"],
  ["about", "Об игре"],
] as const;
type Page = (typeof PAGES)[number][0];

export function initMenu(api: MenuApi) {
  const root = $("menu");
  const nav = $("menu-nav");
  const body = $("menu-page");
  let page: Page = "play";
  let boardTab: "money" | "lap" = "money";
  let confirmErase = -1;
  let nickStatus = "";

  nav.innerHTML = PAGES.map(([id, label]) => `<button data-page="${id}"><span>${label}</span></button>`).join("");
  nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      go(b.dataset.page as Page);
      if (b.dataset.page === "play" && page === "play" && document.activeElement === b) return;
    }),
  );

  function go(p: Page) {
    page = p;
    confirmErase = -1;
    render();
  }

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
  };
  const fmtDate = (t: number) =>
    new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  function slotLine(s: Save | null) {
    if (!s || !s.savedAt) return `<i class="empty">Пусто — новая игра</i>`;
    return `<b>${rub(s.money)}</b> · заработано ${rub(s.earned)}<br><small>${s.owned.length} из ${BIKES.length} байков · ${BIKE[s.bike]?.name ?? ""} · посылки ${s.packages.length}/${api.packagesTotal}${s.bestLap ? ` · круг ${s.bestLap.toFixed(2)} с` : ""} · ${fmtTime(s.playTime)} · ${fmtDate(s.savedAt)}</small>`;
  }

  function render() {
    nav.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.page === page));
    const started = api.started();
    if (page === "play") {
      const s = api.slotInfo(api.slot());
      body.innerHTML = `
        <h2>${started ? "Пауза" : "Добро пожаловать в город"}</h2>
        <label class="field"><span>Имя игрока</span>
          <span class="nick-row"><input id="m-nick" maxlength="16" placeholder="3–16 букв или цифр" value="${esc(api.nick())}" autocomplete="off" spellcheck="false" />
          <button id="m-nick-ok" class="okbtn">ОК</button></span>
          <small id="m-nick-st" class="note">${esc(nickStatus || "Под этим именем ты попадёшь в таблицу рекордов")}</small>
        </label>
        <div class="slot-now"><span class="tag">Слот ${api.slot()}</span>${slotLine(s)}</div>
        <button id="m-play" class="primary huge">${started ? "Продолжить" : s?.savedAt ? "Продолжить игру" : "Начать игру"}</button>
        <p class="note online-note">${esc(api.onlineText())}</p>
        <p class="note">Enter — играть · ↑ ↓ — пункты меню</p>`;
      const inp = $("m-nick") as HTMLInputElement;
      const saveNick = () => {
        const v = inp.value.trim();
        if (!NICK_RE.test(v)) {
          setNickStatus("Имя: от 3 до 16 букв, цифр, пробелов, «-» или «_»", true);
          return false;
        }
        if (!isClean(v)) {
          setNickStatus("Такое имя не подойдёт — выбери другое", true);
          return false;
        }
        api.setNick(v);
        setNickStatus(api.cloud.status === "off" ? "Сохранено на этом устройстве" : "Сохраняю…", false);
        void api.cloud.init().then(async () => {
          const r = await api.cloud.claimNick(v);
          setNickStatus(
            r === "ok" ? "Имя сохранено — оно же в Moto Trials" : r === "taken" ? "Это имя уже занято другим игроком — выбери другое" : "Нет связи с сервером: имя сохранено только здесь",
            r === "taken",
          );
        });
        return true;
      };
      $("m-nick-ok").addEventListener("click", saveNick);
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (saveNick()) $("m-play").focus();
        }
        e.stopPropagation();
      });
      $("m-play").addEventListener("click", () => tryPlay());
      if (!api.nick()) inp.focus();
    } else if (page === "saves") {
      const cards = [];
      for (let i = 1; i <= SLOTS; i++) {
        const s = api.slotInfo(i);
        const on = i === api.slot();
        cards.push(`<div class="slot${on ? " on" : ""}">
          <div class="slot-head"><b>Слот ${i}</b>${on ? `<span class="tag">выбран</span>` : ""}</div>
          <div class="slot-info">${slotLine(s)}</div>
          <div class="slot-btns">
            ${on ? "" : `<button data-act="choose" data-i="${i}">${s?.savedAt ? "Загрузить" : "Выбрать"}</button>`}
            ${s?.savedAt ? (confirmErase === i ? `<button class="danger" data-act="erase" data-i="${i}">Точно удалить?</button>` : `<button class="ghost" data-act="ask" data-i="${i}">Удалить</button>`) : ""}
          </div>
        </div>`);
      }
      body.innerHTML = `<h2>Сохранения</h2><p class="note">Игра сохраняется сама каждые 10 секунд и после каждого задания.</p><div class="slots">${cards.join("")}</div>
        ${started ? "" : `<button id="m-new" class="ghost">Начать слот ${api.slot()} заново</button>`}`;
      body.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) =>
        b.addEventListener("click", () => {
          const i = Number(b.dataset.i);
          if (b.dataset.act === "choose") api.choose(i);
          else if (b.dataset.act === "ask") confirmErase = i;
          else if (b.dataset.act === "erase") {
            api.erase(i);
            confirmErase = -1;
          }
          render();
        }),
      );
      document.getElementById("m-new")?.addEventListener("click", () => {
        if (confirmErase !== 0) {
          confirmErase = 0;
          ($("m-new") as HTMLButtonElement).textContent = "Точно? Весь прогресс слота пропадёт";
          return;
        }
        api.newGame();
        confirmErase = -1;
        render();
      });
    } else if (page === "board") {
      body.innerHTML = `<h2>Рекорды</h2>
        <div class="tabs"><button data-tab="money" class="${boardTab === "money" ? "on" : ""}">Заработано всего</button><button data-tab="lap" class="${boardTab === "lap" ? "on" : ""}">Круг на Эндуро-арене</button></div>
        <ol id="m-board" class="board"><li class="note">Загрузка…</li></ol>`;
      body.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
          boardTab = b.dataset.tab as "money" | "lap";
          render();
        }),
      );
      void loadBoard();
    } else if (page === "hero") {
      const h = api.hero();
      const sw = (list: string[], cur: string, kind: string) =>
        list.map((c) => `<button class="swatch${c === cur ? " on" : ""}" data-${kind}="${c}" style="background:${c}" aria-label="${c}"></button>`).join("");
      body.innerHTML = `<h2>Герой</h2>
        <div class="hero">
          <canvas id="m-hero" width="200" height="200"></canvas>
          <div>
            <p class="lbl">Шлем</p><div class="swatches">${sw(HELMETS, h.helmet, "helmet")}</div>
            <p class="lbl">Куртка</p><div class="swatches">${sw(JACKETS, h.jacket, "jacket")}</div>
          </div>
        </div>`;
      body.querySelectorAll<HTMLButtonElement>("[data-helmet]").forEach((b) => b.addEventListener("click", () => (api.setHero(b.dataset.helmet!, api.hero().jacket), render())));
      body.querySelectorAll<HTMLButtonElement>("[data-jacket]").forEach((b) => b.addEventListener("click", () => (api.setHero(api.hero().helmet, b.dataset.jacket!), render())));
      drawHero($("m-hero") as HTMLCanvasElement, h.helmet, h.jacket);
    } else if (page === "options") {
      const snd = api.sound;
      body.innerHTML = `<h2>Настройки</h2>
        <div class="opts">
          <button id="o-sound" class="opt">Звук: <b>${snd.muted ? "выкл" : "вкл"}</b></button>
          <button id="o-walk" class="opt">Музыка пешком: <b>${snd.walkOn ? "вкл" : "выкл"}</b></button>
          <button id="o-radio" class="opt">Радио на байке: <b>${esc(snd.radioName)}</b></button>
          <button id="o-pvp" class="opt">Стрельба по игрокам (PvP): <b>${api.pvp() ? "вкл" : "выкл — мирный режим"}</b></button>
        </div>`;
      $("o-sound").addEventListener("click", () => (snd.toggle(), render()));
      $("o-walk").addEventListener("click", () => (snd.walkToggle(), render()));
      $("o-radio").addEventListener("click", () => (snd.radioCycle(1), render()));
      $("o-pvp").addEventListener("click", () => (api.setPvp(!api.pvp()), render()));
    } else if (page === "controls") {
      body.innerHTML = `<h2>Управление</h2>
        <table class="ctl">
          <tr><td>W A S D / стрелки</td><td>газ, тормоз и задний ход, руль</td></tr>
          <tr><td>Пробел</td><td>занос; пешком — удар</td></tr>
          <tr><td>Shift</td><td>бег; на мотоцикле — нитро</td></tr>
          <tr><td>E</td><td>сесть на мотоцикл / слезть</td></tr>
          <tr><td>Ctrl, J, мышь</td><td>огонь · Q — сменить оружие</td></tr>
          <tr><td>R, колесо мыши</td><td>радио (пешком R — музыка вкл/выкл)</td></tr>
          <tr><td>Tab</td><td>сказать рядом: облачко над головой видят игроки поблизости</td></tr>
          <tr><td>T</td><td>чат со всеми игроками (Enter — отправить, Esc — закрыть)</td></tr>
          <tr><td>K</td><td>карта города · Esc — пауза · M — звук</td></tr>
          <tr><td>В воздухе ← →</td><td>крутить байк (приземляйся ровно)</td></tr>
        </table>
        <p class="note">На телефоне — экранные кнопки: руль слева, газ и тормоз справа, «Бег», «E», «Огонь» и 📻.</p>`;
    } else {
      body.innerHTML = `<h2>Об игре</h2>
        <p>Город 67 — открытый город с видом сверху: курьерские заказы, уличные гонки, Эндуро-арена, трамплины, телефоны-автоматы, погони и секретные посылки. За мостами — аэропорт (гонка с самолётом на взлётной полосе, груз из ангаров) и Мотопарк: трасса мотокросса и Мотодром для гонок с соперниками. Все купленные байки ждут в твоём гараже.</p>
        <p>При поддержке <b>67МОТО</b> — мотосалон и мотосервис в Смоленске: мотоциклы BSE, OXO, KAYO, Regulmoto, PROGASI, DAYUN, Motoland, FX MOTO, ZUUMAV, Ajerra, BENDA, экипировка LEATT, Acerbis, Shark, ROQVI, масла MOTUL. Щиты брендов на крышах кликабельны — открывают подборку бренда на 67moto.ru.</p>
        <p class="note">${MUSIC_CREDIT}: «Rocket Power», «Organic Grunge», «Surf Shimmy», «Brain Dance», «Ouroboros», «Exit the Premises», «Funky Chunk», «Loopster», «Twisted», «Local Forecast», «Night in Venice», «Groundwork», «Late Night Radio».</p>
        ${api.embedded ? "" : `<a class="link" href="./">Moto Trials — мотокросс в той же серии →</a>`}`;
    }
  }

  function setNickStatus(text: string, bad: boolean) {
    nickStatus = text;
    const el = document.getElementById("m-nick-st");
    if (el) {
      el.textContent = text;
      el.classList.toggle("bad", bad);
    }
  }

  async function loadBoard() {
    const tab = boardTab;
    const list = () => document.getElementById("m-board");
    await api.cloud.init();
    const higher = tab === "money";
    const rows: Row[] | null = await api.cloud.top(tab === "money" ? BOARD_MONEY : BOARD_LAP, higher);
    if (page !== "board" || boardTab !== tab || !list()) return;
    const me = api.cloud.user?.uid;
    const fmt = (v: number) => (higher ? rub(v) : `${v.toFixed(2)} с`);
    if (!rows) {
      // Offline: this device's slots.
      const local: string[] = [];
      for (let i = 1; i <= SLOTS; i++) {
        const s = api.slotInfo(i);
        if (!s?.savedAt) continue;
        const v = higher ? s.earned : s.bestLap;
        if (v) local.push(`<li><span>${esc(api.nick() || "Ты")} · слот ${i}</span><b>${fmt(v)}</b></li>`);
      }
      list()!.innerHTML = `<li class="note">Нет связи с сервером — результаты этого устройства</li>${local.join("") || `<li class="note">Пока пусто</li>`}`;
      return;
    }
    list()!.innerHTML = rows.length
      ? rows.map((r, i) => `<li class="${r.uid === me ? "me" : ""}"><span><em>${i + 1}</em>${esc(r.nick)}</span><b>${fmt(r.value)}</b></li>`).join("")
      : `<li class="note">Пока никого — стань первым!</li>`;
  }

  function tryPlay() {
    if (!api.nick()) {
      go("play");
      setNickStatus("Сначала введи имя игрока", true);
      (document.getElementById("m-nick") as HTMLInputElement | null)?.focus();
      return;
    }
    api.play();
  }

  function key(e: KeyboardEvent) {
    const i = PAGES.findIndex(([id]) => id === page);
    if (e.code === "ArrowDown" || e.code === "KeyS") go(PAGES[(i + 1) % PAGES.length][0]);
    else if (e.code === "ArrowUp" || e.code === "KeyW") go(PAGES[(i + PAGES.length - 1) % PAGES.length][0]);
    else if (e.code === "Enter" || e.code === "Space") {
      if (page === "play") tryPlay();
      else go("play");
    } else if (e.code === "Escape" && api.started()) api.play();
    else return;
    e.preventDefault();
  }

  return {
    open(p: Page = "play") {
      root.classList.remove("hidden");
      root.classList.remove("intro");
      void root.offsetWidth;
      root.classList.add("intro");
      go(p);
    },
    close() {
      root.classList.add("hidden");
    },
    refresh: render,
    key,
  };
}

// The rider from above, on a bike, for the "Герой" page.
function drawHero(c: HTMLCanvasElement, helmet: string, jacket: string) {
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, c.width, c.height);
  g.save();
  g.translate(100, 100);
  g.scale(5, 5);
  g.rotate(-Math.PI / 2);
  g.fillStyle = "#121212";
  g.fillRect(-10, -1.6, 6, 3.2);
  g.fillRect(4, -1.5, 6, 3);
  g.fillStyle = "#f2c230";
  g.beginPath();
  g.ellipse(0, 0, 6.4, 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#2a2a2a";
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(5, -4.8);
  g.lineTo(5, 4.8);
  g.stroke();
  g.strokeStyle = jacket;
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-1, -3.5);
  g.lineTo(4, -4.2);
  g.moveTo(-1, 3.5);
  g.lineTo(4, 4.2);
  g.stroke();
  g.fillStyle = jacket;
  g.beginPath();
  g.ellipse(-2.5, 0, 4, 4.6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = helmet;
  g.beginPath();
  g.arc(0.5, 0, 3.4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(20,25,35,0.85)";
  g.beginPath();
  g.arc(0.5, 0, 3.4, -0.9, 0.9);
  g.lineTo(1.6, 0);
  g.fill();
  g.restore();
}
