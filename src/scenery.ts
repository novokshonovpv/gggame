import { type Mark, drawMarks, mix, setLight, tone } from "./landmarks.ts";
import type { ThemeId } from "./track.ts";

// Procedural parallax backgrounds, one Russian city per track: its skyline landmarks and the
// landscape around it (see landmarks.ts).

type LayerKind = "ridge" | "hills" | "pines" | "buildings" | "puffs" | "water" | "stands" | "marks" | "trees" | "clouds";

interface Layer {
  kind: LayerKind;
  parallax: number; // 0 = fixed to the screen, 1 = moves with the track
  base: number; // baseline as a fraction of screen height
  amp: number; // feature height as a fraction of screen height
  color: string;
  color2?: string; // highlight: snow caps, lit windows, strata
  seed: number;
  marks?: Mark[]; // landmarks for kind "marks"
  span?: number; // landmarks repeat every span x screen height
  trunk?: string; // tree trunks (white for birches)
  cover?: number; // clouds: share of the sky with a cloud
  drift?: number; // clouds: drift speed, screen heights per second
  reflect?: string; // landmarks standing on water: the water color, mirrored below the base
}

export interface Theme {
  sky: [string, string, string];
  sun?: { x: number; y: number; r: number; color: string; glow: string };
  stars?: boolean;
  layers: Layer[];
  track: {
    top: string; // riding surface seen from above
    rut: string;
    lip: string; // light front edge
    berm: string; // back edge
    face: [string, string]; // dirt cross-section, top to bottom
    strata: string;
    fence: string;
  };
  // 3D renderer: lighting, fog and what grows beside the track.
  world: {
    hemiSky: string;
    hemiGround: string;
    hemi: number;
    sun: string;
    sunI: number;
    apron: string; // ground between the track and the backdrop
    props: "rocks" | "pines" | "trees" | "cacti" | "lamps";
    propColor: string;
    propColor2: string;
    fogNear: number;
    fogFar: number;
    fg?: "grass" | "snow" | "sand" | "boards"; // foreground in front of the track
  };
}

export const THEMES: Record<ThemeId, Theme> = {
  // Екатеринбург: Уральские хребты, тайга, озеро и небоскрёбы «Исеть» и «Высоцкий», Белая башня, Центральный стадион.
  ekaterinburg: {
    sky: ["#5d9fd6", "#9fcbea", "#dcefe9"],
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.52, amp: 0.2, color: "#8eaabd", color2: "#c9d9e3", seed: 5 },
      { kind: "marks", parallax: 0.12, base: 0.6, amp: 0.48, color: "#6e8597", color2: "rgba(255,240,200,0.55)", seed: 6, span: 1.6, marks: [{ type: "isetTowers", at: 0.3, size: 1 }, { type: "whiteTower", at: 0.62, size: 0.55 }, { type: "ekbArena", at: 0.85, size: 0.45 }] },
      { kind: "water", parallax: 0.18, base: 0.62, amp: 0.04, color: "#9ccbe0", color2: "#d8eef6", seed: 2 },
      { kind: "pines", parallax: 0.3, base: 0.72, amp: 0.09, color: "#3e6e55", color2: "#4f8366", seed: 13 },
      { kind: "pines", parallax: 0.55, base: 0.84, amp: 0.22, color: "#24493a", color2: "#2e5847", seed: 17 },
    ],
    track: { top: "#b58b5a", rut: "rgba(90,60,30,0.45)", lip: "#d2ab7a", berm: "#5f7d45", face: ["#7b5636", "#3d2919"], strata: "rgba(40,25,12,0.35)", fence: "#5a4330" },
    world: { hemiSky: "#d8ecff", hemiGround: "#4c6b3c", hemi: 1.5, sun: "#fffaf0", sunI: 2.3, apron: "#4f7a45", props: "pines", propColor: "#2f5e45", propColor2: "#3d7354", fogNear: 80, fogFar: 480 },
  },
  // Москва ночью: «Москва-Сити», Шуховская башня, Останкино, Спасская башня, МГУ.
  moscow: {
    sky: ["#0f1530", "#2b2f63", "#8c5a8f"],
    sun: { x: 0.18, y: 0.16, r: 0.04, color: "#fff6e6", glow: "rgba(255,230,200,0.3)" },
    stars: true,
    layers: [
      { kind: "marks", parallax: 0.06, base: 0.56, amp: 0.42, color: "#2a2d55", color2: "rgba(150,200,255,0.75)", seed: 4, span: 1.6, marks: [{ type: "moscowCity", at: 0.3, size: 1 }, { type: "shukhov", at: 0.55, size: 0.6 }, { type: "ostankino", at: 0.78, size: 1.1 }] },
      { kind: "buildings", parallax: 0.14, base: 0.64, amp: 0.2, color: "#232448", color2: "rgba(255,214,140,0.7)", seed: 7 },
      { kind: "marks", parallax: 0.2, base: 0.7, amp: 0.36, color: "#3a1d2a", color2: "#ff3b30", seed: 8, span: 1.6, marks: [{ type: "kremlin", at: 0.3, size: 1 }, { type: "msu", at: 0.78, size: 0.9 }] },
      { kind: "puffs", parallax: 0.45, base: 0.84, amp: 0.2, color: "#14142a", color2: "#1b1b36", seed: 19 },
    ],
    track: { top: "#a6714c", rut: "rgba(70,40,30,0.5)", lip: "#c99268", berm: "#3d3f6b", face: ["#6c4232", "#2c1818"], strata: "rgba(30,15,20,0.4)", fence: "#e9e2f0" },
    world: { hemiSky: "#a8b4ff", hemiGround: "#2a2040", hemi: 1.3, sun: "#ffe9d0", sunI: 1.5, apron: "#272744", props: "trees", propColor: "#1b1b36", propColor2: "#25254a", fogNear: 70, fogFar: 420 },
  },
  // Сочи: Красная Поляна — заснеженный Кавказ и трамплины «Русские горки», канатная дорога.
  sochi: {
    sky: ["#5d9fe0", "#b4d6f2", "#eef5fb"],
    sun: { x: 0.74, y: 0.17, r: 0.05, color: "#fffdf5", glow: "rgba(255,255,240,0.45)" },
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.5, amp: 0.34, color: "#a9bfd6", color2: "#ffffff", seed: 31 },
      { kind: "ridge", parallax: 0.14, base: 0.6, amp: 0.22, color: "#8aa3bb", color2: "#f4f8fb", seed: 37 },
      { kind: "marks", parallax: 0.16, base: 0.6, amp: 0.4, color: "#5f7387", color2: "#e8eef4", seed: 39, span: 1.6, marks: [{ type: "skiJumps", at: 0.35, size: 1 }, { type: "gondola", at: 0.8, size: 0.7 }] },
      { kind: "pines", parallax: 0.32, base: 0.74, amp: 0.1, color: "#56766f", color2: "#e4edf0", seed: 41 },
      { kind: "pines", parallax: 0.55, base: 0.85, amp: 0.22, color: "#3c5a54", color2: "#d6e3e6", seed: 43 },
    ],
    track: { top: "#86674d", rut: "rgba(60,40,25,0.45)", lip: "#b09073", berm: "#f2f6f8", face: ["#6b503e", "#30231a"], strata: "rgba(30,20,12,0.35)", fence: "#d23c3c" },
    world: { hemiSky: "#e6f2ff", hemiGround: "#c4d2dc", hemi: 1.6, sun: "#ffffff", sunI: 2.2, apron: "#eef3f6", props: "pines", propColor: "#3d6858", propColor2: "#e3ecee", fogNear: 70, fogFar: 420, fg: "snow" },
  },
  // Махачкала: бархан Сарыкум, гора Тарки-Тау, Каспий, маяк на Анжи-Кале, «Анжи-Арена» и морской порт.
  makhachkala: {
    sky: ["#3c8ad4", "#8cc4ec", "#f0e0bd"],
    sun: { x: 0.82, y: 0.14, r: 0.06, color: "#fffbe8", glow: "rgba(255,240,200,0.5)" },
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.52, amp: 0.2, color: "#9aa48a", color2: "#b9bea2", seed: 51 },
      { kind: "water", parallax: 0.1, base: 0.56, amp: 0.04, color: "#4f9ec4", color2: "#cfe9f2", seed: 4 },
      { kind: "marks", parallax: 0.14, base: 0.6, amp: 0.28, color: "#a99a7c", color2: "#ffe9a8", seed: 53, span: 2, marks: [{ type: "lighthouse", at: 0.25, size: 1 }, { type: "anjiArena", at: 0.5, size: 0.6 }, { type: "portCranes", at: 0.78, size: 0.8 }] },
      { kind: "hills", parallax: 0.24, base: 0.68, amp: 0.2, color: "#dcb57a", seed: 5 },
      { kind: "hills", parallax: 0.42, base: 0.8, amp: 0.16, color: "#c7985d", seed: 9 },
    ],
    track: { top: "#dfba7f", rut: "rgba(150,105,55,0.45)", lip: "#f3d6a3", berm: "#c99b62", face: ["#c48f55", "#7a5230"], strata: "rgba(110,70,35,0.3)", fence: "#5a4330" },
    world: { hemiSky: "#fff3d9", hemiGround: "#c99b62", hemi: 1.6, sun: "#fff6e0", sunI: 2.6, apron: "#d9b277", props: "rocks", propColor: "#b58f62", propColor2: "#9c7a52", fogNear: 100, fogFar: 560, fg: "sand" },
  },
  // Казань: ночной суперкросс на «Казань Арене», за трибунами «Чаша», Сююмбике, Дворец земледельцев и мост «Миллениум».
  kazan: {
    sky: ["#04060d", "#121833", "#2c3560"],
    stars: true,
    layers: [
      { kind: "marks", parallax: 0.06, base: 0.5, amp: 0.36, color: "#1d2240", color2: "#ffd58a", seed: 61, span: 2, marks: [{ type: "kazanBowl", at: 0.15, size: 0.8 }, { type: "suyumbike", at: 0.38, size: 0.85 }, { type: "farmersPalace", at: 0.58, size: 0.7 }, { type: "millenniumBridge", at: 0.85, size: 0.9 }] },
      { kind: "stands", parallax: 0.2, base: 0.7, amp: 0.26, color: "#252a40", color2: "#3a4060", seed: 67 },
      { kind: "stands", parallax: 0.35, base: 0.78, amp: 0.26, color: "#2e334c", color2: "#454c70", seed: 71 },
    ],
    track: { top: "#7a5a44", rut: "rgba(40,25,15,0.55)", lip: "#a07b5e", berm: "#3d4566", face: ["#5c4232", "#241812"], strata: "rgba(20,10,5,0.4)", fence: "#f2f2f2" },
    world: { hemiSky: "#9fb0ff", hemiGround: "#2a2236", hemi: 1.2, sun: "#f4f6ff", sunI: 2.6, apron: "#2a2a36", props: "lamps", propColor: "#9aa0b5", propColor2: "#fffbe0", fogNear: 90, fogFar: 460, fg: "boards" },
  },
  // Санкт-Петербург: белая ночь, Нева, разведённый мост, Адмиралтейство, Ростральная колонна, «Аврора», «Лахта» и стадион на Крестовском.
  spb: {
    sky: ["#7f8fbf", "#d9b4c4", "#f6dcc6"],
    sun: { x: 0.85, y: 0.3, r: 0.045, color: "#fff2e2", glow: "rgba(255,210,190,0.45)" },
    layers: [
      { kind: "marks", parallax: 0.05, base: 0.55, amp: 0.46, color: "#8b8fae", color2: "#b9c3e6", seed: 81, span: 1.6, marks: [{ type: "gazpromArena", at: 0.15, size: 0.45 }, { type: "lakhta", at: 0.5, size: 1 }] },
      { kind: "marks", parallax: 0.12, base: 0.6, amp: 0.36, color: "#6e6c8c", color2: "#e7c35a", seed: 83, span: 1.6, marks: [{ type: "admiralty", at: 0.3, size: 0.9 }, { type: "rostral", at: 0.75, size: 0.8 }] },
      { kind: "water", parallax: 0.18, base: 0.64, amp: 0.06, color: "#8f9cc4", color2: "#f3d9d2", seed: 6 },
      { kind: "marks", parallax: 0.24, base: 0.7, amp: 0.3, color: "#4c4c68", color2: "#ffe0a0", reflect: "#8f9cc4", seed: 85, span: 1.6, marks: [{ type: "aurora", at: 0.15, size: 0.6 }, { type: "drawbridge", at: 0.5, size: 1 }] },
      { kind: "buildings", parallax: 0.42, base: 0.84, amp: 0.16, color: "#3d3b52", color2: "rgba(255,220,170,0.6)", seed: 87 },
    ],
    track: { top: "#8c7a6a", rut: "rgba(40,30,25,0.5)", lip: "#b3a090", berm: "#6f6f80", face: ["#5f5650", "#2a2624"], strata: "rgba(20,15,15,0.35)", fence: "#2a2a30" },
    world: { hemiSky: "#e6d6f0", hemiGround: "#5c5866", hemi: 1.4, sun: "#ffe6d6", sunI: 2.0, apron: "#6a6876", props: "trees", propColor: "#3d5a48", propColor2: "#4a6a55", fogNear: 70, fogFar: 400 },
  },
  // Смоленск: крепостная стена с Громовой башней на холмах над Днепром, «Орлы» и сад Блонье.
  smolensk: {
    sky: ["#5f9fd8", "#a7cdea", "#e6f1e8"],
    sun: { x: 0.8, y: 0.16, r: 0.05, color: "#fffcef", glow: "rgba(255,248,220,0.45)" },
    layers: [
      { kind: "hills", parallax: 0.05, base: 0.56, amp: 0.14, color: "#93ad9f", seed: 3 },
      { kind: "marks", parallax: 0.12, base: 0.62, amp: 0.36, color: "#7a9480", color2: "rgba(255,240,200,0.7)", seed: 7, span: 1.6, marks: [{ type: "smolenskWall", at: 0.5, size: 1 }] },
      { kind: "water", parallax: 0.17, base: 0.66, amp: 0.04, color: "#8db6c8", color2: "#e2f0f4", seed: 3 },
      { kind: "marks", parallax: 0.22, base: 0.73, amp: 0.3, color: "#4f6e48", color2: "#ffe9b0", seed: 9, span: 1.6, marks: [{ type: "eagles", at: 0.25, size: 0.8 }, { type: "smolenskBlonie", at: 0.7, size: 0.85 }] },
      { kind: "trees", parallax: 0.42, base: 0.85, amp: 0.2, color: "#3a5e39", color2: "#4e7846", seed: 11 },
    ],
    track: { top: "#a8805a", rut: "rgba(80,55,30,0.45)", lip: "#c9a27a", berm: "#5f8a48", face: ["#77543a", "#3a281a"], strata: "rgba(40,25,12,0.35)", fence: "#f2f2f2" },
    world: { hemiSky: "#dcefff", hemiGround: "#4f7040", hemi: 1.5, sun: "#fffaf0", sunI: 2.3, apron: "#56813f", props: "trees", propColor: "#3b6a3a", propColor2: "#4f8044", fogNear: 80, fogFar: 480 },
  },
  // Минск вечером: Национальная библиотека-«алмаз» в подсветке, стела «Минск — город-герой», Ворота Минска.
  minsk: {
    sky: ["#1b2450", "#4b4f8f", "#e09a7c"],
    sun: { x: 0.14, y: 0.44, r: 0.05, color: "#ffd9a0", glow: "rgba(255,170,120,0.45)" },
    layers: [
      { kind: "buildings", parallax: 0.06, base: 0.58, amp: 0.14, color: "#575c90", color2: "rgba(255,214,140,0.55)", seed: 23 },
      { kind: "marks", parallax: 0.12, base: 0.65, amp: 0.32, color: "#3b4070", color2: "#4fb0ff", seed: 21, span: 1.6, marks: [{ type: "nationalLibrary", at: 0.3, size: 0.9 }, { type: "minskStela", at: 0.75, size: 1.1 }] },
      { kind: "marks", parallax: 0.2, base: 0.73, amp: 0.34, color: "#2a2c50", color2: "rgba(255,226,160,0.9)", seed: 25, span: 1.6, marks: [{ type: "minskGates", at: 0.5, size: 1 }] },
      { kind: "trees", parallax: 0.42, base: 0.85, amp: 0.18, color: "#1d2a32", color2: "#26363e", seed: 27 },
    ],
    track: { top: "#9c7454", rut: "rgba(60,40,28,0.5)", lip: "#c09474", berm: "#384a52", face: ["#654634", "#2a1c14"], strata: "rgba(25,15,10,0.4)", fence: "#e6e8f2" },
    world: { hemiSky: "#b4b8ff", hemiGround: "#2e2a40", hemi: 1.3, sun: "#ffd9b0", sunI: 1.8, apron: "#2c3342", props: "trees", propColor: "#1f2d36", propColor2: "#2a3c46", fogNear: 70, fogFar: 420 },
  },
  // Воронеж: чернозём, водохранилище, корабль-музей «Гото Предестинация», Чернавский мост, здание ЮВЖД.
  voronezh: {
    sky: ["#4f97dd", "#9cc8ee", "#f2ead0"],
    sun: { x: 0.8, y: 0.15, r: 0.055, color: "#fffbe8", glow: "rgba(255,240,200,0.5)" },
    layers: [
      { kind: "hills", parallax: 0.05, base: 0.56, amp: 0.1, color: "#a7b89c", seed: 2 },
      { kind: "marks", parallax: 0.1, base: 0.6, amp: 0.3, color: "#8a978e", color2: "rgba(255,240,200,0.75)", seed: 31, span: 1.6, marks: [{ type: "railwayHQ", at: 0.25, size: 0.9 }, { type: "riverBridge", at: 0.72, size: 0.8 }] },
      { kind: "water", parallax: 0.15, base: 0.645, amp: 0.05, color: "#6ea3c4", color2: "#d6ecf5", seed: 5 },
      { kind: "marks", parallax: 0.2, base: 0.7, amp: 0.36, color: "#6a9cbb", color2: "rgba(255,220,140,0.9)", reflect: "#6ea3c4", seed: 33, span: 2.4, marks: [{ type: "shipGoto", at: 0.5, size: 1 }] },
      { kind: "trees", parallax: 0.42, base: 0.85, amp: 0.2, color: "#3f6a3a", color2: "#557f45", seed: 35 },
    ],
    track: { top: "#4d3c2f", rut: "rgba(15,10,6,0.5)", lip: "#6d5745", berm: "#5f8a45", face: ["#3b2c22", "#1a120d"], strata: "rgba(0,0,0,0.3)", fence: "#ededed" },
    world: { hemiSky: "#e2f0ff", hemiGround: "#54733d", hemi: 1.55, sun: "#fff6e0", sunI: 2.5, apron: "#5c8a42", props: "trees", propColor: "#3f7038", propColor2: "#558747", fogNear: 90, fogFar: 520 },
  },
  // Владивосток: утренний туман над морем, Русский мост, Золотой мост, подлодка С-56, сопки с домами.
  vladivostok: {
    sky: ["#6d9fcf", "#b9d3e6", "#f3e6da"],
    sun: { x: 0.2, y: 0.24, r: 0.05, color: "#fff5ea", glow: "rgba(255,230,210,0.5)" },
    layers: [
      { kind: "ridge", parallax: 0.05, base: 0.56, amp: 0.16, color: "#a3b6c6", color2: "#c9d6e1", seed: 41 },
      { kind: "marks", parallax: 0.08, base: 0.6, amp: 0.4, color: "#8ea3b6", color2: "rgba(255,240,220,0.9)", seed: 43, span: 1.6, marks: [{ type: "russkyBridge", at: 0.5, size: 0.85 }] },
      { kind: "water", parallax: 0.12, base: 0.63, amp: 0.05, color: "#7fa6c2", color2: "#e3eef5", seed: 7 },
      { kind: "marks", parallax: 0.18, base: 0.71, amp: 0.32, color: "#5f7186", color2: "#ffd68a", reflect: "#7fa6c2", seed: 45, span: 1.6, marks: [{ type: "goldenBridge", at: 0.3, size: 1 }, { type: "submarine", at: 0.8, size: 0.6 }] },
      { kind: "buildings", parallax: 0.35, base: 0.85, amp: 0.2, color: "#4a586a", color2: "rgba(255,220,170,0.6)", seed: 47 },
    ],
    track: { top: "#8f7d68", rut: "rgba(50,40,30,0.45)", lip: "#b3a089", berm: "#6f7f6a", face: ["#635546", "#2c241d"], strata: "rgba(25,20,15,0.35)", fence: "#2c3e50" },
    world: { hemiSky: "#e6f0fa", hemiGround: "#5d6a5e", hemi: 1.5, sun: "#fff4e8", sunI: 2.1, apron: "#66785f", props: "rocks", propColor: "#7e7f78", propColor2: "#6a6c66", fogNear: 60, fogFar: 380 },
  },
  // Новосибирск: золотая осень, Обь, Оперный театр с серебряным куполом, Бугринский мост, вокзал.
  novosibirsk: {
    sky: ["#5a8fcf", "#a9c8e6", "#f0e2c8"],
    sun: { x: 0.75, y: 0.18, r: 0.05, color: "#fffaea", glow: "rgba(255,236,200,0.45)" },
    layers: [
      { kind: "pines", parallax: 0.05, base: 0.56, amp: 0.08, color: "#71907f", color2: "#7d9a88", seed: 51 },
      { kind: "marks", parallax: 0.1, base: 0.61, amp: 0.34, color: "#8a9298", color2: "rgba(255,226,160,0.85)", seed: 53, span: 1.6, marks: [{ type: "operaNsk", at: 0.3, size: 0.9 }, { type: "nskStation", at: 0.78, size: 0.75 }] },
      { kind: "water", parallax: 0.16, base: 0.65, amp: 0.05, color: "#7c9fb8", color2: "#dde9f0", seed: 9 },
      { kind: "marks", parallax: 0.2, base: 0.71, amp: 0.3, color: "#5f6b74", color2: "#ffe0a0", reflect: "#7c9fb8", seed: 55, span: 1.6, marks: [{ type: "archBridge", at: 0.5, size: 0.9 }] },
      { kind: "trees", parallax: 0.42, base: 0.85, amp: 0.21, color: "#b8862c", color2: "#e2b440", trunk: "#eeeae0", seed: 57 },
    ],
    track: { top: "#a07a55", rut: "rgba(70,48,28,0.45)", lip: "#c49e76", berm: "#a3893f", face: ["#715035", "#35241a"], strata: "rgba(40,25,12,0.35)", fence: "#2f6f4f" },
    world: { hemiSky: "#e8f0ff", hemiGround: "#8a7440", hemi: 1.5, sun: "#fff3dc", sunI: 2.3, apron: "#8f8a45", props: "trees", propColor: "#d9a531", propColor2: "#c27f24", fogNear: 80, fogFar: 480 },
  },
  // Грозный в сумерках: снежный Кавказ, башни «Грозный-Сити» с подсветкой, «Ахмат-Арена».
  grozny: {
    sky: ["#1f2a55", "#6a5a8a", "#f0a070"],
    sun: { x: 0.78, y: 0.42, r: 0.05, color: "#ffd2a0", glow: "rgba(255,160,110,0.5)" },
    layers: [
      { kind: "ridge", parallax: 0.04, base: 0.5, amp: 0.32, color: "#7d7fa2", color2: "#f2e6ee", seed: 61 },
      { kind: "ridge", parallax: 0.09, base: 0.58, amp: 0.2, color: "#5e6286", color2: "#8a8db0", seed: 63 },
      { kind: "marks", parallax: 0.14, base: 0.64, amp: 0.44, color: "#3c3f66", color2: "#7fe0ff", seed: 65, span: 1.6, marks: [{ type: "groznyCity", at: 0.35, size: 1 }, { type: "akhmatArena", at: 0.8, size: 0.6 }] },
      { kind: "buildings", parallax: 0.26, base: 0.75, amp: 0.14, color: "#2f3156", color2: "rgba(255,214,150,0.75)", seed: 67 },
      { kind: "trees", parallax: 0.45, base: 0.86, amp: 0.18, color: "#252640", color2: "#2e304e", seed: 69 },
    ],
    track: { top: "#a0664a", rut: "rgba(70,35,25,0.5)", lip: "#c08868", berm: "#3e3f5e", face: ["#6e3f2c", "#2e1812"], strata: "rgba(30,12,8,0.4)", fence: "#e8e8f0" },
    world: { hemiSky: "#c2b4ff", hemiGround: "#3a2a3a", hemi: 1.3, sun: "#ffc9a0", sunI: 1.9, apron: "#3a3446", props: "rocks", propColor: "#6a5a62", propColor2: "#574a52", fogNear: 100, fogFar: 800 },
  },
  // Нижний Новгород: Волга, канатная дорога, кремль на откосе, Чкаловская лестница, стадион на Стрелке.
  nizhny: {
    sky: ["#4c8fd8", "#9cc6ee", "#eaf0f0"],
    sun: { x: 0.2, y: 0.15, r: 0.05, color: "#fffcef", glow: "rgba(255,248,220,0.45)" },
    layers: [
      { kind: "hills", parallax: 0.05, base: 0.56, amp: 0.1, color: "#9ab0ad", seed: 4 },
      { kind: "water", parallax: 0.08, base: 0.6, amp: 0.06, color: "#7fa8c8", color2: "#dcecf6", seed: 11 },
      { kind: "marks", parallax: 0.12, base: 0.63, amp: 0.34, color: "#7c8c96", color2: "#e04e3c", reflect: "#7fa8c8", seed: 71, span: 1.6, marks: [{ type: "nnStadium", at: 0.12, size: 0.55 }, { type: "nnCableCar", at: 0.58, size: 1 }] },
      { kind: "marks", parallax: 0.19, base: 0.72, amp: 0.36, color: "#5d7a55", color2: "#ffe9b0", seed: 73, span: 1.6, marks: [{ type: "nnKremlin", at: 0.3, size: 1 }, { type: "chkalovStairs", at: 0.82, size: 0.8 }] },
      { kind: "trees", parallax: 0.42, base: 0.85, amp: 0.2, color: "#3a6340", color2: "#4c7a4c", seed: 75 },
    ],
    track: { top: "#ad8458", rut: "rgba(85,58,30,0.45)", lip: "#cfa678", berm: "#5a8448", face: ["#7a5636", "#3c2a19"], strata: "rgba(40,25,12,0.35)", fence: "#c8372d" },
    world: { hemiSky: "#dcefff", hemiGround: "#4f7040", hemi: 1.5, sun: "#fffaf0", sunI: 2.3, apron: "#56813f", props: "trees", propColor: "#3a6a3e", propColor2: "#4c7f48", fogNear: 80, fogFar: 480 },
  },
};


// Clouds for every city, added as the two farthest layers: a slow high bank and faster,
// lower cumulus. cover is the share of sky cells with a cloud.
const CLOUDS: Record<ThemeId, { cover: number; lit: string; shade: string }> = {
  ekaterinburg: { cover: 0.55, lit: "#ffffff", shade: "#b9c9d8" },
  moscow: { cover: 0.35, lit: "#4a4878", shade: "#2a2a52" },
  sochi: { cover: 0.4, lit: "#ffffff", shade: "#c5d4e4" },
  makhachkala: { cover: 0.3, lit: "#fffaf0", shade: "#d7d2c8" },
  kazan: { cover: 0.25, lit: "#262c4c", shade: "#171b33" },
  spb: { cover: 0.6, lit: "#ffe6dc", shade: "#a99ab8" },
  smolensk: { cover: 0.6, lit: "#ffffff", shade: "#bccbd9" },
  minsk: { cover: 0.5, lit: "#ffc8a8", shade: "#6a5c8c" },
  voronezh: { cover: 0.45, lit: "#ffffff", shade: "#c2d0de" },
  vladivostok: { cover: 0.7, lit: "#fff4ec", shade: "#b5c3d2" },
  novosibirsk: { cover: 0.55, lit: "#ffffff", shade: "#c7cfd8" },
  grozny: { cover: 0.5, lit: "#ffb98c", shade: "#5e4f7a" },
  nizhny: { cover: 0.5, lit: "#ffffff", shade: "#b9cadb" },
};
for (const [id, t] of Object.entries(THEMES) as [ThemeId, Theme][]) {
  const c = CLOUDS[id];
  t.layers.unshift(
    { kind: "clouds", parallax: 0.015, base: 0.27, amp: 0.16, color: c.lit, color2: c.shade, seed: 101, cover: c.cover * 0.8, drift: 0.002 },
    { kind: "clouds", parallax: 0.035, base: 0.42, amp: 0.2, color: c.lit, color2: c.shade, seed: 103, cover: c.cover, drift: 0.005 },
  );
}

export type { Layer };

// Painted strips: every layer is painted once into a horizontally seamless strip of this
// size (baseline at row BASE, tallest features AMP px), which both renderers scroll.
export const STRIP = { w: 4096, h: 512, base: 400, amp: 360 };

// Light comes from the side of the sky the sun is on (from the right when there is none).
let lightLeft = false;

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Aerial perspective: how much of the horizon color veils a layer at its depth, and the
// mist that pools at its foot, so every plane stands apart from the one in front of it.
function hazeOf(L: Layer) {
  const far = Math.max(0, Math.min(1, (0.42 - L.parallax) / 0.38));
  if (L.kind === "clouds") return { veil: 0.2 * far, mist: 0 };
  return { veil: 0.4 * far ** 1.3, mist: 0.08 + 0.32 * far };
}

// Solid color of the ground below a layer's strip (water for reflecting layers), hazed.
export function groundColor(L: Layer, theme: Theme) {
  const { veil, mist } = hazeOf(L);
  return mix(L.reflect ?? L.color, theme.sky[2], 1 - (1 - veil) * (1 - mist));
}

// Grandstands packed with a crowd, with floodlight masts (stadium backdrop).
function drawStands(ctx: CanvasRenderingContext2D, L: Layer, cells: Cells, base: number, amp: number, S: number, width: number, height: number) {
  ctx.fillStyle = L.color;
  ctx.fillRect(0, base - amp * 0.75, width, height);
  // Tiers with crowd dots.
  const tiers = 6;
  for (let t = 0; t < tiers; t++) {
    const y = base - amp * 0.75 + (t * amp * 0.75) / tiers;
    ctx.fillStyle = L.color2 ?? L.color;
    ctx.fillRect(0, y, width, Math.max(1, amp * 0.012));
  }
  const crowd = ["#e8e2d0", "#d94a3a", "#3a7bd9", "#f2c94c", "#5bbf6a", "#ffffff", "#9b59b6"];
  cells(S * 0.012, (i, x0) => {
    for (let t = 0; t < tiers; t++) {
      if (hash(i * 13 + t, L.seed) < 0.3) continue;
      const y = base - amp * 0.75 + ((t + 0.55) * amp * 0.75) / tiers;
      ctx.fillStyle = crowd[Math.floor(hash(i * 7 + t, L.seed + 1) * crowd.length)];
      ctx.fillRect(x0, y - amp * 0.03, Math.max(1.5, S * 0.006), amp * 0.04);
    }
  });
  // Roof edge and floodlight masts.
  ctx.fillStyle = L.color;
  ctx.fillRect(0, base - amp * 0.8, width, amp * 0.06);
  cells(S * 0.5, (i, x0) => {
    const x = x0 + hash(i, L.seed + 2) * S * 0.2;
    ctx.fillStyle = L.color;
    ctx.fillRect(x, base - amp, Math.max(2, S * 0.006), amp * 0.3);
    ctx.fillStyle = "#fffbe0";
    ctx.fillRect(x - S * 0.02, base - amp, S * 0.045, amp * 0.06);
  });
}

// One city block for "buildings" layers: lit side, cornice, a rooftop detail and window rows.
function building(ctx: CanvasRenderingContext2D, L: Layer, i: number, x: number, bw: number, bh: number, base: number, S: number) {
  const top = base - bh;
  const c = L.color;
  ctx.fillStyle = c;
  ctx.fillRect(x, top, bw, bh + 2);
  ctx.fillStyle = tone(c, 0.07);
  ctx.fillRect(lightLeft ? x : x + bw * 0.74, top, bw * 0.26, bh + 2);
  ctx.fillStyle = tone(c, 0.16);
  ctx.fillRect(x - bw * 0.02, top, bw * 1.04, Math.max(1, bh * 0.025));
  const roof = hash(i, L.seed + 5);
  ctx.fillStyle = c;
  if (roof < 0.22) {
    ctx.fillRect(x + bw * 0.15, top - bh * 0.07, bw * 0.22, bh * 0.07); // water tank / lift room
    ctx.fillRect(x + bw * 0.6, top - bh * 0.04, bw * 0.15, bh * 0.04);
  } else if (roof < 0.42) {
    ctx.fillRect(x + bw * 0.18, top - bh * 0.12, bw * 0.64, bh * 0.12 + 1); // set-back top floor
    ctx.fillRect(x + bw * 0.34, top - bh * 0.2, bw * 0.32, bh * 0.08 + 1);
  } else if (roof < 0.55) {
    ctx.beginPath(); // pitched roof
    ctx.moveTo(x - bw * 0.03, top + 1);
    ctx.lineTo(x + bw * 0.5, top - bw * 0.3);
    ctx.lineTo(x + bw * 1.03, top + 1);
    ctx.fill();
  } else if (roof < 0.72) {
    ctx.fillRect(x + bw * 0.45, top - bh * 0.16, Math.max(2, S * 0.003), bh * 0.16); // antenna
    ctx.fillStyle = "rgba(255,80,70,0.9)";
    ctx.fillRect(x + bw * 0.45 - 1, top - bh * 0.17, Math.max(2, S * 0.004), Math.max(2, S * 0.004));
  }
  ctx.fillStyle = L.color2 ?? "#fc8";
  const ww = Math.max(2, bw * 0.11);
  const wh = Math.max(2, ww * 1.25);
  let k = 0;
  for (let wy = top + wh; wy < base - wh * 1.5; wy += wh * 2.1)
    for (let wx = x + ww; wx < x + bw - ww; wx += ww * 2) if (hash(i * 997 + k++, L.seed + 4) < 0.42) ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = tone(c, -0.25);
  ctx.fillRect(x, base - wh * 1.6, bw, wh * 1.6); // shop floor
}

// One park tree for "trees" layers: trunk and a crown of overlapping blobs, lit on the sun side.
function tree(ctx: CanvasRenderingContext2D, L: Layer, i: number, x: number, gy: number, th: number) {
  const r = th * 0.3;
  const tw = Math.max(2, th * 0.06);
  ctx.fillStyle = L.trunk ?? tone(L.color, -0.4);
  ctx.fillRect(x - tw / 2, gy - th * 0.6, tw, th * 0.6 + 2);
  if (L.trunk) {
    ctx.fillStyle = "rgba(30,30,30,0.6)"; // birch bark marks
    for (let k = 0; k < 4; k++) ctx.fillRect(x - tw / 2, gy - th * (0.1 + k * 0.12) - hash(i + k, L.seed) * th * 0.05, tw * 0.7, Math.max(1, th * 0.012));
  }
  const hi = L.color2 ?? L.color;
  const lean = (hash(i, L.seed + 7) - 0.5) * r * 0.4;
  const side = lightLeft ? -1 : 1;
  for (const [dx, dy, rr, lit] of [
    [0, -0.72, 1, 0],
    [-0.6, -0.55, 0.72, 0],
    [0.58, -0.6, 0.75, 1],
    [0.2, -1.0, 0.68, 1],
    [-0.25, -0.95, 0.55, 0],
  ]) {
    ctx.fillStyle = lit ? hi : L.color;
    ctx.beginPath();
    ctx.arc(x + side * dx * r + lean * -dy, gy + dy * th, rr * r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Sunlit and shaded flanks under a terrain profile y = f(u): faces turned to the sun
// brighten, the others darken, fading out down the slope.
function shadeTerrain(ctx: CanvasRenderingContext2D, f: (u: number) => number, w: number, amp: number, strength: number) {
  const step = 3;
  for (let px = 0; px < w; px += step) {
    const top = f(px / w);
    const slope = (f((px + step) / w) - top) / step; // > 0: ground falls to the right
    const k = Math.max(-1, Math.min(1, ((lightLeft ? -slope : slope) * 4) / Math.max(0.2, amp / 360)));
    if (Math.abs(k) < 0.05) continue;
    const g = ctx.createLinearGradient(0, top, 0, top + amp * 0.6);
    const c = k > 0 ? "255,250,235" : "20,25,40";
    const a = (k > 0 ? 0.22 : 0.2) * Math.abs(k) * strength;
    g.addColorStop(0, `rgba(${c},${a})`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(px, top, step, amp * 0.6);
  }
}

// Mirror of everything painted above the waterline, squashed, rippled and fading with depth.
function reflect(ctx: CanvasRenderingContext2D, water: string, base: number, w: number, h: number, S: number) {
  const depth = h - base;
  const src = document.createElement("canvas");
  src.width = w;
  src.height = depth * 2;
  src.getContext("2d")!.drawImage(ctx.canvas, 0, base - depth * 2, w, depth * 2, 0, 0, w, depth * 2);
  ctx.fillStyle = water;
  ctx.fillRect(0, base, w, depth);
  for (let r = 0; r < depth; r++) {
    const dx = Math.sin(r * 0.9) * S * 0.0025 * (1 + (r / depth) * 3);
    ctx.globalAlpha = 0.5 * (1 - r / depth);
    for (const off of [dx, dx - w, dx + w]) ctx.drawImage(src, 0, depth * 2 - 1 - r * 2, w, 1, off, base + r, w, 1);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.3)";
  ctx.lineWidth = Math.max(1, S * 0.002);
  for (let k = 0; k < w / 30; k++) {
    const y = base + 3 + hash(k, 77) * depth * 0.9;
    const x = hash(k, 78) * w;
    const len = S * (0.01 + hash(k, 79) * 0.04) * (1 - (y - base) / depth);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    ctx.stroke();
  }
}

type Cells = (cw: number, fn: (i: number, x0: number) => void) => void;

// Paints one backdrop layer as a horizontally seamless strip (see STRIP). S is the "screen
// height" the layer was designed against, so amp = L.amp * S.
export function paintLayer(L: Layer, theme: Theme, w = STRIP.w, h = STRIP.h, base = STRIP.base, amp = STRIP.amp): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  lightLeft = (theme.sun?.x ?? 0.7) < 0.5;
  setLight(lightLeft);
  const S = amp / L.amp;
  const TAU = Math.PI * 2;
  const cells: Cells = (cw, fn) => {
    const n = Math.max(1, Math.round(w / cw));
    const step = w / n;
    for (let i = -2; i <= n + 1; i++) fn(((i % n) + n) % n, i * step);
  };
  const fillBelow = (f: (u: number) => number, color: string | CanvasGradient) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let px = 0; px <= w; px += 4) ctx.lineTo(px, f(px / w));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  const cyc = (k: number) => Math.max(1, Math.round((w / S) * k)); // whole cycles per strip

  switch (L.kind) {
    case "ridge": {
      const k1 = cyc(1 / 0.9);
      const f = (u: number) => {
        const n = 0.55 * tri(k1 * u + L.seed) + 0.3 * tri(Math.round(k1 * 2.3) * u + 0.37) + 0.15 * tri(Math.round(k1 * 5.1) * u + 0.71);
        return base - amp * n;
      };
      const g = ctx.createLinearGradient(0, base - amp, 0, base);
      g.addColorStop(0, L.color2 ?? L.color);
      g.addColorStop(0.35, L.color);
      g.addColorStop(1, tone(L.color, -0.08));
      fillBelow(f, g);
      shadeTerrain(ctx, f, w, amp, 1);
      // Gullies: faint streaks running down from the crest.
      ctx.lineWidth = Math.max(1, S * 0.0015);
      cells(S * 0.05, (i, x0) => {
        const x = x0 + hash(i, L.seed + 9) * S * 0.04;
        const top = f((((x % w) + w) % w) / w);
        if (base - top < amp * 0.35) return;
        ctx.strokeStyle = `rgba(20,25,40,${0.06 + hash(i, L.seed + 10) * 0.08})`;
        ctx.beginPath();
        ctx.moveTo(x, top + amp * 0.03);
        ctx.lineTo(x + (lightLeft ? 1 : -1) * amp * 0.06, top + amp * (0.2 + hash(i, L.seed + 11) * 0.25));
        ctx.stroke();
      });
      break;
    }
    case "hills": {
      const k = cyc(4 / TAU);
      const f = (u: number) => base - amp * (0.5 + 0.3 * Math.sin(TAU * k * u + L.seed) + 0.2 * Math.sin(TAU * k * 2 * u + L.seed * 2));
      const g = ctx.createLinearGradient(0, base - amp, 0, base);
      g.addColorStop(0, tone(L.color, 0.1));
      g.addColorStop(1, tone(L.color, -0.08));
      fillBelow(f, g);
      shadeTerrain(ctx, f, w, amp, 0.7);
      break;
    }
    case "water": {
      const g = ctx.createLinearGradient(0, base - amp, 0, h);
      g.addColorStop(0, tone(L.color, 0.12));
      g.addColorStop(1, tone(L.color, -0.1));
      ctx.fillStyle = g;
      ctx.fillRect(0, base - amp, w, h);
      ctx.fillStyle = rgba("#ffffff", 0.35);
      ctx.fillRect(0, base - amp, w, Math.max(1, amp * 0.06)); // bright far shore line
      ctx.strokeStyle = L.color2 ?? "#fff";
      ctx.lineWidth = Math.max(1.5, S * 0.003);
      cells(S * 0.16, (i, x0) => {
        const y = base - amp + amp * 0.3 + hash(i, L.seed) * amp * 1.4;
        const len = S * (0.03 + hash(i, L.seed + 1) * 0.06);
        const x = x0 + hash(i, L.seed + 2) * S * 0.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      });
      break;
    }
    case "pines": {
      const k = cyc(3 / TAU);
      const ground = (u: number) => base - amp * 0.15 * (1 + Math.sin(TAU * k * u + L.seed));
      fillBelow(ground, L.color);
      const side = lightLeft ? -1 : 1;
      cells(S * 0.045, (i, x0) => {
        if (hash(i, L.seed) < 0.25) return;
        const th = amp * (0.45 + hash(i, L.seed + 1) * 0.55);
        const tw = th * 0.32;
        const x = x0 + hash(i, L.seed + 2) * S * 0.03;
        const gy = ground((((x % w) + w) % w) / w) + 2;
        const col = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        for (const lit of [false, true]) {
          ctx.fillStyle = lit ? tone(col, 0.14) : tone(col, -0.06);
          ctx.beginPath();
          for (let tier = 0; tier < 3; tier++) {
            const ty = gy - th * (tier * 0.28);
            const tw2 = tw * (1 - tier * 0.22);
            ctx.moveTo(lit ? x : x - tw2, ty);
            ctx.lineTo(x, ty - th * 0.5);
            ctx.lineTo(lit ? x + side * tw2 : x + tw2, ty);
          }
          ctx.fill();
        }
      });
      break;
    }
    case "buildings": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      cells(S * 0.16, (i, x0) => {
        const bw = S * (0.1 + hash(i, L.seed) * 0.08);
        const bh = amp * (0.35 + hash(i, L.seed + 1) * 0.65);
        building(ctx, L, i, x0 + hash(i, L.seed + 2) * S * 0.05, bw, bh, base, S);
      });
      break;
    }
    case "trees": {
      const k = cyc(2 / TAU);
      const ground = (u: number) => base - amp * 0.12 * (1 + Math.sin(TAU * k * u + L.seed));
      fillBelow(ground, L.color);
      cells(S * 0.07, (i, x0) => {
        if (hash(i, L.seed) < 0.2) return;
        const x = x0 + hash(i, L.seed + 2) * S * 0.04;
        tree(ctx, L, i, x, ground((((x % w) + w) % w) / w) + 2, amp * (0.5 + hash(i, L.seed + 1) * 0.5));
      });
      break;
    }
    case "stands": {
      drawStands(ctx, L, cells, base, amp, S, w, h);
      break;
    }
    case "marks": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      drawMarks(ctx, L.marks ?? [], cells, (L.span ?? 3) * S, base, amp, L.color, L.color2 ?? L.color);
      if (L.reflect) reflect(ctx, L.reflect, base, w, h, S);
      break;
    }
    case "puffs": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      cells(S * 0.2, (i, x0) => {
        if (hash(i, L.seed) < 0.3) return;
        const r = amp * (0.25 + hash(i, L.seed + 1) * 0.3);
        const x = x0 + hash(i, L.seed + 2) * S * 0.1;
        const cy = base - r * 1.6;
        ctx.fillStyle = L.color;
        ctx.fillRect(x - r * 0.08, cy, r * 0.16, r * 1.7);
        ctx.fillStyle = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        for (const [dx, dy, rr] of [
          [0, 0, 1],
          [-0.7, 0.25, 0.7],
          [0.7, 0.2, 0.75],
          [0.1, -0.55, 0.7],
        ]) {
          ctx.beginPath();
          ctx.arc(x + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      break;
    }
    case "clouds": {
      // Cumulus: a row of puffs, shaded underneath and lit on top toward the sun, flat bottom.
      const side = lightLeft ? -1 : 1;
      ctx.filter = `blur(${Math.max(1, Math.round(S * 0.0025))}px)`;
      cells(S * 0.42, (i, x0) => {
        if (hash(i, L.seed) > (L.cover ?? 0.5)) return;
        const cw = S * (0.1 + hash(i, L.seed + 1) * 0.2);
        const ch = amp * (0.22 + hash(i, L.seed + 2) * 0.22);
        const cx = x0 + hash(i, L.seed + 3) * S * 0.2;
        const cy = base - amp * hash(i, L.seed + 4) * 0.5;
        // Overlapping puffs, biggest in the middle, on a flat shaded base.
        const n = Math.max(4, Math.ceil(cw / (ch * 0.4)));
        const puffs: [number, number, number][] = [[cx, cy - ch * 0.12, 0]];
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1);
          const r = ch * (0.32 + 0.42 * Math.sin(Math.PI * t)) * (0.8 + 0.4 * hash(i * 31 + k, L.seed + 6));
          puffs.push([cx + cw * (t - 0.5), cy - r * 0.5, r]);
        }
        ctx.fillStyle = L.color2 ?? L.color;
        ctx.beginPath();
        ctx.ellipse(cx, cy - ch * 0.12, cw * 0.58, ch * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - cw, cy - ch * 3, cw * 2, ch * 3);
        ctx.clip();
        ctx.fillStyle = L.color2 ?? L.color;
        for (const [px, py, r] of puffs) {
          if (!r) continue;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = L.color;
        for (const [px, py, r] of puffs) {
          if (!r) continue;
          ctx.beginPath();
          ctx.arc(px + side * r * 0.12, py - r * 0.22, r * 0.82, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
      ctx.filter = "none";
      break;
    }
  }

  // Atmosphere: veil the whole layer with the horizon color and pool mist at its foot.
  const { veil, mist } = hazeOf(L);
  const hz = theme.sky[2];
  ctx.globalCompositeOperation = "source-atop";
  if (veil > 0) {
    ctx.fillStyle = rgba(hz, veil);
    ctx.fillRect(0, 0, w, h);
  }
  if (mist > 0) {
    const g = ctx.createLinearGradient(0, base - amp * 0.45, 0, base);
    g.addColorStop(0, rgba(hz, 0));
    g.addColorStop(1, rgba(hz, mist));
    ctx.fillStyle = g;
    ctx.fillRect(0, base - amp * 0.45, w, amp * 0.45);
    ctx.fillStyle = rgba(hz, mist);
    ctx.fillRect(0, base, w, h - base);
  }
  ctx.globalCompositeOperation = "source-over";
  return c;
}

// Foreground: blurred grass tufts and bushes (or snow, dry grass, advertising boards) that
// pass in front of the track faster than it, painted as a seamless strip.
export function paintForeground(theme: Theme, w = 2048, h = 256): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const kind = theme.world.fg ?? "grass";
  const dark = mix(theme.world.apron, "#000000", theme.stars ? 0.6 : 0.45);
  const lit = mix(theme.world.apron, "#000000", theme.stars ? 0.45 : 0.25);
  ctx.filter = "blur(3px)";
  const cells = (cw: number, fn: (i: number, x0: number) => void) => {
    const n = Math.round(w / cw);
    for (let i = -1; i <= n; i++) fn(((i % n) + n) % n, (i * w) / n);
  };
  if (kind === "boards") {
    const colors = ["#1f5fbf", "#e8641e", "#f4d10f", "#2fa84f", "#c8372d"];
    const words = ["МОТОКРОСС", "КАЗАНЬ", "ФИНИШ", "ГАЗ!", "АРЕНА"];
    ctx.fillStyle = "#15151a";
    ctx.fillRect(0, h * 0.62, w, h);
    cells(w / 5, (i, x0) => {
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x0 + 6, h * 0.66, w / 5 - 12, h * 0.3);
      ctx.fillStyle = "#ffffff";
      ctx.font = `900 ${Math.round(h * 0.17)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(words[i % words.length], x0 + w / 10, h * 0.82, w / 5 - 30);
    });
    if (theme.stars) {
      ctx.fillStyle = "rgba(5,8,20,0.35)"; // boards in the dark, lit only by the floodlights
      ctx.fillRect(0, 0, w, h);
    }
    return c;
  }
  // Bushes and drifts.
  cells(w / 5, (i, x0) => {
    if (hash(i, 501) < 0.35) return;
    const x = x0 + hash(i, 502) * (w / 5) * 0.6;
    const r = h * (0.18 + hash(i, 503) * 0.2);
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = k > 2 ? lit : dark;
      ctx.beginPath();
      ctx.arc(x + (k - 2) * r * 0.55, h - r * (0.4 + (k % 2) * 0.35 + (k === 2 ? 0.3 : 0)), r * (0.6 + (k === 2 ? 0.25 : 0)), 0, Math.PI * 2);
      ctx.fill();
    }
  });
  if (kind === "snow") {
    ctx.fillStyle = "#e9f0f4";
    cells(w / 3, (i, x0) => {
      ctx.beginPath();
      ctx.ellipse(x0 + hash(i, 511) * (w / 3), h, w * 0.12, h * (0.15 + hash(i, 512) * 0.15), 0, Math.PI, 0);
      ctx.fill();
    });
  }
  // Grass tufts.
  const blade = kind === "sand" ? mix("#8a6a40", "#000000", 0.25) : dark;
  cells(w / 70, (i, x0) => {
    if (hash(i, 521) < (kind === "sand" ? 0.6 : 0.15)) return;
    const n = 5 + Math.floor(hash(i, 522) * 8);
    const th = h * (0.12 + hash(i, 523) * 0.32) * (kind === "snow" ? 0.6 : 1);
    ctx.strokeStyle = hash(i, 524) < 0.5 ? blade : lit;
    ctx.lineWidth = 3;
    for (let k = 0; k < n; k++) {
      const bx = x0 + (k - n / 2) * 3;
      const lean = (hash(i * 13 + k, 525) - 0.5) * th * 0.6;
      ctx.beginPath();
      ctx.moveTo(bx, h);
      ctx.quadraticCurveTo(bx + lean * 0.3, h - th * 0.6, bx + lean, h - th * (0.7 + hash(i * 7 + k, 526) * 0.3));
      ctx.stroke();
    }
  });
  ctx.fillStyle = dark;
  ctx.fillRect(0, h * 0.94, w, h * 0.06);
  return c;
}

function hash(i: number, seed: number) {
  let t = (Math.imul(i, 374761393) + Math.imul(seed, 668265263)) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177);
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

const tri = (t: number) => 1 - 2 * Math.abs(t - Math.floor(t) - 0.5);

export interface View {
  w: number;
  h: number;
  camX: number; // meters
  camY: number;
  scale: number; // stable pixels-per-meter (not affected by zoom) for parallax
  time: number;
}

// 2D renderer: the same painted strips as the 3D backdrop, scrolled with parallax.
const strips = new WeakMap<Layer, HTMLCanvasElement>();
const foregrounds = new WeakMap<Theme, HTMLCanvasElement>();

export function drawScenery(ctx: CanvasRenderingContext2D, theme: Theme, v: View) {
  const { w, h } = v;
  const g = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  g.addColorStop(0, theme.sky[0]);
  g.addColorStop(0.55, theme.sky[1]);
  g.addColorStop(1, theme.sky[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (theme.stars) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let i = 0; i < 70; i++) {
      const x = hash(i, 1) * w;
      const y = hash(i, 2) * h * 0.45;
      const r = 0.5 + hash(i, 3) * 1.1;
      ctx.fillRect(x, y, r, r);
    }
  }
  if (theme.sun) {
    const s = theme.sun;
    const r = s.r * h;
    const glow = ctx.createRadialGradient(s.x * w, s.y * h, r * 0.5, s.x * w, s.y * h, r * 6);
    glow.addColorStop(0, s.glow);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const L of theme.layers) {
    let img = strips.get(L);
    if (!img) strips.set(L, (img = paintLayer(L, theme)));
    const k = (L.amp * h) / STRIP.amp; // screen px per strip px
    const sw = STRIP.w * k;
    const off = v.camX * v.scale * L.parallax + v.time * (L.drift ?? 0) * h;
    const baseY = h * L.base + v.camY * v.scale * L.parallax * 0.5;
    const top = baseY - STRIP.base * k;
    for (let x = -(((off % sw) + sw) % sw); x < w; x += sw) ctx.drawImage(img, x, top, sw + 1, STRIP.h * k);
    if (L.kind !== "clouds") {
      ctx.fillStyle = groundColor(L, theme);
      ctx.fillRect(0, top + STRIP.h * k - 1, w, h);
    }
  }
}

// Foreground strip along the bottom of the screen, scrolling 1.5x faster than the track.
export function drawForeground(ctx: CanvasRenderingContext2D, theme: Theme, v: View) {
  let img = foregrounds.get(theme);
  if (!img) foregrounds.set(theme, (img = paintForeground(theme)));
  const fh = v.h * FOREGROUND.height;
  const fw = (img.width * fh) / img.height;
  const off = v.camX * v.scale * FOREGROUND.parallax;
  for (let x = -(((off % fw) + fw) % fw); x < v.w; x += fw) ctx.drawImage(img, x, v.h - fh, fw + 1, fh);
}

export const FOREGROUND = { height: 0.2, parallax: 1.5 };
