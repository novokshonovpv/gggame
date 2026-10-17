import { type Mark, drawMarks } from "./landmarks.ts";
import type { ThemeId } from "./track.ts";

// Procedural parallax backgrounds, one Russian city per track: its skyline landmarks and the
// landscape around it (see landmarks.ts).

type LayerKind = "ridge" | "hills" | "mesa" | "pines" | "buildings" | "puffs" | "rocks" | "water" | "stands" | "marks";

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
  };
}

export const THEMES: Record<ThemeId, Theme> = {
  // Волгоград: закатная степь, Волга и Мамаев курган с «Родина-мать зовёт!».
  volgograd: {
    sky: ["#c9714a", "#eba56f", "#f7d8a8"],
    sun: { x: 0.8, y: 0.22, r: 0.065, color: "#fff0cf", glow: "rgba(255,214,160,0.45)" },
    layers: [
      { kind: "hills", parallax: 0.06, base: 0.52, amp: 0.08, color: "#d9a173", seed: 3 },
      { kind: "marks", parallax: 0.1, base: 0.56, amp: 0.3, color: "#7d4f3b", color2: "#f6c27a", seed: 5, span: 1.6, marks: [{ type: "motherland", at: 0.45, size: 1 }] },
      { kind: "water", parallax: 0.16, base: 0.6, amp: 0.05, color: "#c98e6c", color2: "#f6d2a4", seed: 2 },
      { kind: "buildings", parallax: 0.22, base: 0.66, amp: 0.14, color: "#9a6247", color2: "rgba(255,220,160,0.5)", seed: 11 },
      { kind: "hills", parallax: 0.42, base: 0.8, amp: 0.1, color: "#a86a42", seed: 9 },
    ],
    track: { top: "#d4a874", rut: "rgba(120,78,40,0.45)", lip: "#ecc995", berm: "#a8794a", face: ["#a56d3d", "#5b3720"], strata: "rgba(70,40,20,0.35)", fence: "#6b4a2e" },
    world: { hemiSky: "#ffe2bd", hemiGround: "#8a5634", hemi: 1.6, sun: "#fff0d6", sunI: 2.4, apron: "#b88452", props: "trees", propColor: "#6f7a3c", propColor2: "#86904a", fogNear: 90, fogFar: 520 },
  },
  // Екатеринбург: Уральские хребты, тайга, озеро и небоскрёбы «Исеть» и «Высоцкий».
  ekaterinburg: {
    sky: ["#5d9fd6", "#9fcbea", "#dcefe9"],
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.52, amp: 0.2, color: "#8eaabd", color2: "#c9d9e3", seed: 5 },
      { kind: "marks", parallax: 0.12, base: 0.6, amp: 0.48, color: "#6e8597", color2: "rgba(255,240,200,0.55)", seed: 6, span: 1.6, marks: [{ type: "isetTowers", at: 0.5, size: 1 }] },
      { kind: "water", parallax: 0.18, base: 0.62, amp: 0.04, color: "#9ccbe0", color2: "#d8eef6", seed: 2 },
      { kind: "pines", parallax: 0.3, base: 0.72, amp: 0.09, color: "#3e6e55", color2: "#4f8366", seed: 13 },
      { kind: "pines", parallax: 0.55, base: 0.84, amp: 0.22, color: "#24493a", color2: "#2e5847", seed: 17 },
    ],
    track: { top: "#b58b5a", rut: "rgba(90,60,30,0.45)", lip: "#d2ab7a", berm: "#5f7d45", face: ["#7b5636", "#3d2919"], strata: "rgba(40,25,12,0.35)", fence: "#5a4330" },
    world: { hemiSky: "#d8ecff", hemiGround: "#4c6b3c", hemi: 1.5, sun: "#fffaf0", sunI: 2.3, apron: "#4f7a45", props: "pines", propColor: "#2f5e45", propColor2: "#3d7354", fogNear: 80, fogFar: 480 },
  },
  // Москва ночью: «Москва-Сити», Останкино, Спасская башня, МГУ.
  moscow: {
    sky: ["#0f1530", "#2b2f63", "#8c5a8f"],
    sun: { x: 0.18, y: 0.16, r: 0.04, color: "#fff6e6", glow: "rgba(255,230,200,0.3)" },
    stars: true,
    layers: [
      { kind: "marks", parallax: 0.06, base: 0.56, amp: 0.42, color: "#2a2d55", color2: "rgba(150,200,255,0.75)", seed: 4, span: 1.6, marks: [{ type: "moscowCity", at: 0.3, size: 1 }, { type: "ostankino", at: 0.78, size: 1.25 }] },
      { kind: "buildings", parallax: 0.14, base: 0.64, amp: 0.2, color: "#232448", color2: "rgba(255,214,140,0.7)", seed: 7 },
      { kind: "marks", parallax: 0.2, base: 0.7, amp: 0.36, color: "#3a1d2a", color2: "#ff3b30", seed: 8, span: 1.6, marks: [{ type: "kremlin", at: 0.3, size: 1 }, { type: "msu", at: 0.78, size: 0.9 }] },
      { kind: "puffs", parallax: 0.45, base: 0.84, amp: 0.2, color: "#14142a", color2: "#1b1b36", seed: 19 },
    ],
    track: { top: "#a6714c", rut: "rgba(70,40,30,0.5)", lip: "#c99268", berm: "#3d3f6b", face: ["#6c4232", "#2c1818"], strata: "rgba(30,15,20,0.4)", fence: "#e9e2f0" },
    world: { hemiSky: "#a8b4ff", hemiGround: "#2a2040", hemi: 1.3, sun: "#ffe9d0", sunI: 1.5, apron: "#272744", props: "trees", propColor: "#1b1b36", propColor2: "#25254a", fogNear: 70, fogFar: 420 },
  },
  // Сочи: Красная Поляна — заснеженный Кавказ и трамплины «Русские горки».
  sochi: {
    sky: ["#5d9fe0", "#b4d6f2", "#eef5fb"],
    sun: { x: 0.74, y: 0.17, r: 0.05, color: "#fffdf5", glow: "rgba(255,255,240,0.45)" },
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.5, amp: 0.34, color: "#a9bfd6", color2: "#ffffff", seed: 31 },
      { kind: "ridge", parallax: 0.14, base: 0.6, amp: 0.22, color: "#8aa3bb", color2: "#f4f8fb", seed: 37 },
      { kind: "marks", parallax: 0.16, base: 0.6, amp: 0.4, color: "#5f7387", color2: "#e8eef4", seed: 39, span: 1.6, marks: [{ type: "skiJumps", at: 0.5, size: 1 }] },
      { kind: "pines", parallax: 0.32, base: 0.74, amp: 0.1, color: "#56766f", color2: "#e4edf0", seed: 41 },
      { kind: "pines", parallax: 0.55, base: 0.85, amp: 0.22, color: "#3c5a54", color2: "#d6e3e6", seed: 43 },
    ],
    track: { top: "#86674d", rut: "rgba(60,40,25,0.45)", lip: "#b09073", berm: "#f2f6f8", face: ["#6b503e", "#30231a"], strata: "rgba(30,20,12,0.35)", fence: "#d23c3c" },
    world: { hemiSky: "#e6f2ff", hemiGround: "#c4d2dc", hemi: 1.6, sun: "#ffffff", sunI: 2.2, apron: "#eef3f6", props: "pines", propColor: "#3d6858", propColor2: "#e3ecee", fogNear: 70, fogFar: 420 },
  },
  // Махачкала: бархан Сарыкум, гора Тарки-Тау, Каспий и мечеть.
  makhachkala: {
    sky: ["#3c8ad4", "#8cc4ec", "#f0e0bd"],
    sun: { x: 0.82, y: 0.14, r: 0.06, color: "#fffbe8", glow: "rgba(255,240,200,0.5)" },
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.52, amp: 0.2, color: "#9aa48a", color2: "#b9bea2", seed: 51 },
      { kind: "water", parallax: 0.1, base: 0.56, amp: 0.04, color: "#4f9ec4", color2: "#cfe9f2", seed: 4 },
      { kind: "marks", parallax: 0.14, base: 0.6, amp: 0.28, color: "#a99a7c", color2: "#2f8f86", seed: 53, span: 1.6, marks: [{ type: "mosque", at: 0.6, size: 1 }] },
      { kind: "hills", parallax: 0.24, base: 0.68, amp: 0.2, color: "#dcb57a", seed: 5 },
      { kind: "hills", parallax: 0.42, base: 0.8, amp: 0.16, color: "#c7985d", seed: 9 },
    ],
    track: { top: "#dfba7f", rut: "rgba(150,105,55,0.45)", lip: "#f3d6a3", berm: "#c99b62", face: ["#c48f55", "#7a5230"], strata: "rgba(110,70,35,0.3)", fence: "#5a4330" },
    world: { hemiSky: "#fff3d9", hemiGround: "#c99b62", hemi: 1.6, sun: "#fff6e0", sunI: 2.6, apron: "#d9b277", props: "rocks", propColor: "#b58f62", propColor2: "#9c7a52", fogNear: 100, fogFar: 560 },
  },
  // Казань: ночной суперкросс на «Казань Арене», за трибунами Кул-Шариф и Сююмбике.
  kazan: {
    sky: ["#04060d", "#121833", "#2c3560"],
    stars: true,
    layers: [
      { kind: "marks", parallax: 0.06, base: 0.5, amp: 0.36, color: "#1d2240", color2: "#3d7be0", seed: 61, span: 1.6, marks: [{ type: "kulSharif", at: 0.35, size: 1 }, { type: "suyumbike", at: 0.7, size: 0.85 }] },
      { kind: "stands", parallax: 0.2, base: 0.7, amp: 0.26, color: "#252a40", color2: "#3a4060", seed: 67 },
      { kind: "stands", parallax: 0.35, base: 0.78, amp: 0.26, color: "#2e334c", color2: "#454c70", seed: 71 },
    ],
    track: { top: "#7a5a44", rut: "rgba(40,25,15,0.55)", lip: "#a07b5e", berm: "#3d4566", face: ["#5c4232", "#241812"], strata: "rgba(20,10,5,0.4)", fence: "#f2f2f2" },
    world: { hemiSky: "#9fb0ff", hemiGround: "#2a2236", hemi: 1.2, sun: "#f4f6ff", sunI: 2.6, apron: "#2a2a36", props: "lamps", propColor: "#9aa0b5", propColor2: "#fffbe0", fogNear: 90, fogFar: 460 },
  },
  // Санкт-Петербург: белая ночь, Нева, разведённый мост, Исаакий, Петропавловка, «Лахта».
  spb: {
    sky: ["#7f8fbf", "#d9b4c4", "#f6dcc6"],
    sun: { x: 0.85, y: 0.3, r: 0.045, color: "#fff2e2", glow: "rgba(255,210,190,0.45)" },
    layers: [
      { kind: "marks", parallax: 0.05, base: 0.55, amp: 0.46, color: "#8b8fae", color2: "#b9c3e6", seed: 81, span: 1.6, marks: [{ type: "lakhta", at: 0.5, size: 1 }] },
      { kind: "marks", parallax: 0.12, base: 0.6, amp: 0.36, color: "#6e6c8c", color2: "#e7c35a", seed: 83, span: 1.6, marks: [{ type: "isaac", at: 0.28, size: 0.8 }, { type: "peterPaul", at: 0.72, size: 1 }] },
      { kind: "water", parallax: 0.18, base: 0.64, amp: 0.06, color: "#8f9cc4", color2: "#f3d9d2", seed: 6 },
      { kind: "marks", parallax: 0.24, base: 0.7, amp: 0.3, color: "#4c4c68", color2: "#ffe0a0", seed: 85, span: 1.6, marks: [{ type: "drawbridge", at: 0.5, size: 1 }] },
      { kind: "buildings", parallax: 0.42, base: 0.84, amp: 0.16, color: "#3d3b52", color2: "rgba(255,220,170,0.6)", seed: 87 },
    ],
    track: { top: "#8c7a6a", rut: "rgba(40,30,25,0.5)", lip: "#b3a090", berm: "#6f6f80", face: ["#5f5650", "#2a2624"], strata: "rgba(20,15,15,0.35)", fence: "#2a2a30" },
    world: { hemiSky: "#e6d6f0", hemiGround: "#5c5866", hemi: 1.4, sun: "#ffe6d6", sunI: 2.0, apron: "#6a6876", props: "trees", propColor: "#3d5a48", propColor2: "#4a6a55", fogNear: 70, fogFar: 400 },
  },
};

// Grandstands packed with a crowd, with floodlight masts (stadium backdrop).
function drawStands(
  ctx: CanvasRenderingContext2D,
  L: Layer,
  cells: (cw: number, fn: (i: number, x0: number) => void) => void,
  base: number,
  amp: number,
  S: number,
  width: number,
  height: number,
) {
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

export type { Layer };

// Paints one backdrop layer as a horizontally seamless strip for the 3D renderer, which
// maps it onto a far-away plane. Proportions match drawLayer: S is the "screen height"
// the 2D layer was designed against, so amp = L.amp * S.
export function paintLayer(L: Layer, w: number, h: number, base: number, amp: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const S = amp / L.amp;
  const TAU = Math.PI * 2;
  const cells = (cw: number, fn: (i: number, x0: number) => void) => {
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
      const g = ctx.createLinearGradient(0, base - amp, 0, base);
      g.addColorStop(0, L.color2 ?? L.color);
      g.addColorStop(0.35, L.color);
      g.addColorStop(1, L.color);
      fillBelow((u) => {
        const n = 0.55 * tri(k1 * u + L.seed) + 0.3 * tri(Math.round(k1 * 2.3) * u + 0.37) + 0.15 * tri(Math.round(k1 * 5.1) * u + 0.71);
        return base - amp * n;
      }, g);
      break;
    }
    case "hills": {
      const k = cyc(4 / TAU);
      fillBelow((u) => base - amp * (0.5 + 0.3 * Math.sin(TAU * k * u + L.seed) + 0.2 * Math.sin(TAU * k * 2 * u + L.seed * 2)), L.color);
      break;
    }
    case "water": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base - amp, w, h);
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
    case "mesa": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      cells(S * 0.55, (i, x0) => {
        if (hash(i, L.seed) < 0.3) return;
        const width = S * (0.25 + hash(i, L.seed + 1) * 0.45);
        const height = amp * (0.45 + hash(i, L.seed + 2) * 0.55);
        const x = x0 + hash(i, L.seed + 3) * S * 0.2;
        const slant = width * 0.14;
        const top = base - height;
        ctx.fillStyle = L.color;
        ctx.beginPath();
        ctx.moveTo(x - slant, base + 1);
        ctx.lineTo(x, top + height * 0.08);
        ctx.lineTo(x + width * 0.08, top);
        ctx.lineTo(x + width - width * 0.08, top);
        ctx.lineTo(x + width, top + height * 0.1);
        ctx.lineTo(x + width + slant, base + 1);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = L.color2 ?? L.color;
        for (let b = 1; b <= 3; b++) {
          const y = top + (height * b) / 4;
          const inset = (slant * b) / 4;
          ctx.fillRect(x - inset, y, width + inset * 2, Math.max(2, height * 0.05));
        }
      });
      break;
    }
    case "rocks": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      cells(S * 0.22, (i, x0) => {
        if (hash(i, L.seed) < 0.35) return;
        const r = amp * (0.35 + hash(i, L.seed + 1) * 0.65);
        const x = x0 + hash(i, L.seed + 2) * S * 0.12;
        ctx.fillStyle = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        ctx.beginPath();
        ctx.moveTo(x - r, base + 2);
        ctx.lineTo(x - r * 0.7, base - r * 0.6);
        ctx.lineTo(x - r * 0.1, base - r);
        ctx.lineTo(x + r * 0.6, base - r * 0.75);
        ctx.lineTo(x + r, base + 2);
        ctx.closePath();
        ctx.fill();
      });
      break;
    }
    case "pines": {
      const k = cyc(3 / TAU);
      const ground = (u: number) => base - amp * 0.15 * (1 + Math.sin(TAU * k * u + L.seed));
      fillBelow(ground, L.color);
      cells(S * 0.045, (i, x0) => {
        if (hash(i, L.seed) < 0.25) return;
        const th = amp * (0.45 + hash(i, L.seed + 1) * 0.55);
        const tw = th * 0.32;
        const x = x0 + hash(i, L.seed + 2) * S * 0.03;
        const gy = ground((((x % w) + w) % w) / w) + 2;
        ctx.fillStyle = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        ctx.beginPath();
        for (let tier = 0; tier < 3; tier++) {
          const ty = gy - th * (tier * 0.28);
          const tw2 = tw * (1 - tier * 0.22);
          ctx.moveTo(x - tw2, ty);
          ctx.lineTo(x, ty - th * 0.5);
          ctx.lineTo(x + tw2, ty);
        }
        ctx.fill();
      });
      break;
    }
    case "buildings": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, base, w, h);
      cells(S * 0.16, (i, x0) => {
        const bw = S * (0.1 + hash(i, L.seed) * 0.08);
        const bh = amp * (0.35 + hash(i, L.seed + 1) * 0.65);
        const x = x0 + hash(i, L.seed + 2) * S * 0.05;
        const top = base - bh;
        ctx.fillStyle = L.color;
        ctx.fillRect(x, top, bw, bh + 2);
        if (hash(i, L.seed + 3) < 0.3) ctx.fillRect(x + bw * 0.45, top - bh * 0.1, Math.max(2, S * 0.003), bh * 0.1);
        ctx.fillStyle = L.color2 ?? "#fc8";
        const ww = Math.max(2, bw * 0.12);
        const wh = Math.max(2, ww * 1.2);
        let k = 0;
        for (let wy = top + wh; wy < base - wh; wy += wh * 2.2)
          for (let wx = x + ww; wx < x + bw - ww; wx += ww * 2.2)
            if (hash(i * 997 + k++, L.seed + 4) < 0.45) ctx.fillRect(wx, wy, ww, wh);
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
  }
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
    const glow = ctx.createRadialGradient(s.x * w, s.y * h, r * 0.5, s.x * w, s.y * h, r * 4);
    glow.addColorStop(0, s.glow);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const layer of theme.layers) drawLayer(ctx, layer, v);
}

function drawLayer(ctx: CanvasRenderingContext2D, L: Layer, v: View) {
  const { w, h } = v;
  const off = v.camX * v.scale * L.parallax; // layer scroll in px
  const baseY = h * L.base + v.camY * v.scale * L.parallax * 0.5;
  const amp = L.amp * h;
  const toU = (px: number) => px + off;

  const fillBelow = (pts: [number, number][], color: string | CanvasGradient) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h + 2);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], h + 2);
    ctx.closePath();
    ctx.fill();
  };

  // Iterate fixed-width cells overlapping the screen; each cell's content comes from hash(cell).
  const cells = (cw: number, fn: (i: number, x0: number) => void) => {
    const u0 = Math.floor((toU(0) - cw * 2) / cw);
    const u1 = Math.ceil((toU(w) + cw) / cw);
    for (let i = u0; i <= u1; i++) fn(i, i * cw - off);
  };

  switch (L.kind) {
    case "ridge": {
      const pts: [number, number][] = [];
      for (let px = -10; px <= w + 10; px += 6) {
        const u = toU(px) / (h * 0.9) + L.seed;
        const n = 0.55 * tri(u) + 0.3 * tri(u * 2.3 + 0.37) + 0.15 * tri(u * 5.1 + 0.71);
        pts.push([px, baseY - amp * n]);
      }
      const g = ctx.createLinearGradient(0, baseY - amp, 0, baseY);
      g.addColorStop(0, L.color2 ?? L.color);
      g.addColorStop(0.35, L.color);
      g.addColorStop(1, L.color);
      fillBelow(pts, g);
      break;
    }
    case "hills": {
      const pts: [number, number][] = [];
      for (let px = -10; px <= w + 10; px += 10) {
        const u = toU(px) / h;
        pts.push([px, baseY - amp * (0.5 + 0.3 * Math.sin(u * 4 + L.seed) + 0.2 * Math.sin(u * 9.7 + L.seed * 2))]);
      }
      fillBelow(pts, L.color);
      break;
    }
    case "water": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY - amp, w, h);
      ctx.strokeStyle = L.color2 ?? "#fff";
      ctx.lineWidth = 1.5;
      cells(h * 0.16, (i, x0) => {
        const y = baseY - amp + amp * 0.3 + hash(i, L.seed) * amp * 1.4;
        const len = h * (0.03 + hash(i, L.seed + 1) * 0.06);
        const x = x0 + hash(i, L.seed + 2) * h * 0.1 + Math.sin(v.time * 0.8 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + len, y);
        ctx.stroke();
      });
      break;
    }
    case "mesa": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY, w, h);
      cells(h * 0.55, (i, x0) => {
        if (hash(i, L.seed) < 0.3) return;
        const width = h * (0.25 + hash(i, L.seed + 1) * 0.45);
        const height = amp * (0.45 + hash(i, L.seed + 2) * 0.55);
        const x = x0 + hash(i, L.seed + 3) * h * 0.2;
        const slant = width * 0.14;
        const top = baseY - height;
        ctx.fillStyle = L.color;
        ctx.beginPath();
        ctx.moveTo(x - slant, baseY + 1);
        ctx.lineTo(x, top + height * 0.08);
        ctx.lineTo(x + width * 0.08, top);
        ctx.lineTo(x + width - width * 0.08, top);
        ctx.lineTo(x + width, top + height * 0.1);
        ctx.lineTo(x + width + slant, baseY + 1);
        ctx.closePath();
        ctx.fill();
        // Sedimentary bands.
        ctx.fillStyle = L.color2 ?? L.color;
        for (let b = 1; b <= 3; b++) {
          const y = top + (height * b) / 4;
          const inset = (slant * b) / 4;
          ctx.fillRect(x - inset, y, width + inset * 2, Math.max(2, height * 0.05));
        }
      });
      break;
    }
    case "rocks": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY, w, h);
      cells(h * 0.22, (i, x0) => {
        if (hash(i, L.seed) < 0.35) return;
        const r = amp * (0.35 + hash(i, L.seed + 1) * 0.65);
        const x = x0 + hash(i, L.seed + 2) * h * 0.12;
        ctx.fillStyle = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        ctx.beginPath();
        ctx.moveTo(x - r, baseY + 2);
        ctx.lineTo(x - r * 0.7, baseY - r * 0.6);
        ctx.lineTo(x - r * 0.1, baseY - r);
        ctx.lineTo(x + r * 0.6, baseY - r * 0.75);
        ctx.lineTo(x + r, baseY + 2);
        ctx.closePath();
        ctx.fill();
      });
      break;
    }
    case "pines": {
      const pts: [number, number][] = [];
      for (let px = -10; px <= w + 10; px += 12) {
        const u = toU(px) / h;
        pts.push([px, baseY - amp * 0.15 * (1 + Math.sin(u * 3 + L.seed))]);
      }
      fillBelow(pts, L.color);
      cells(h * 0.045, (i, x0) => {
        if (hash(i, L.seed) < 0.25) return;
        const th = amp * (0.45 + hash(i, L.seed + 1) * 0.55);
        const tw = th * 0.32;
        const x = x0 + hash(i, L.seed + 2) * h * 0.03;
        const u = toU(x) / h;
        const gy = baseY - amp * 0.15 * (1 + Math.sin(u * 3 + L.seed)) + 2;
        ctx.fillStyle = hash(i, L.seed + 3) < 0.5 ? L.color : (L.color2 ?? L.color);
        ctx.beginPath();
        for (let tier = 0; tier < 3; tier++) {
          const ty = gy - th * (tier * 0.28);
          const tw2 = tw * (1 - tier * 0.22);
          ctx.moveTo(x - tw2, ty);
          ctx.lineTo(x, ty - th * 0.5);
          ctx.lineTo(x + tw2, ty);
        }
        ctx.fill();
      });
      break;
    }
    case "buildings": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY, w, h);
      cells(h * 0.16, (i, x0) => {
        const bw = h * (0.1 + hash(i, L.seed) * 0.08);
        const bh = amp * (0.35 + hash(i, L.seed + 1) * 0.65);
        const x = x0 + hash(i, L.seed + 2) * h * 0.05;
        const top = baseY - bh;
        ctx.fillStyle = L.color;
        ctx.fillRect(x, top, bw, bh + 2);
        if (hash(i, L.seed + 3) < 0.3) ctx.fillRect(x + bw * 0.45, top - bh * 0.1, 2, bh * 0.1); // antenna
        ctx.fillStyle = L.color2 ?? "#fc8";
        const ww = Math.max(2, bw * 0.12);
        const wh = Math.max(2, ww * 1.2);
        for (let wy = top + wh; wy < baseY - wh; wy += wh * 2.2)
          for (let wx = x + ww; wx < x + bw - ww; wx += ww * 2.2)
            if (hash(Math.floor(wx * 7 + wy * 13), L.seed + 4) < 0.45) ctx.fillRect(wx, wy, ww, wh);
      });
      break;
    }
    case "stands": {
      drawStands(ctx, L, cells, baseY, amp, h, w, h);
      break;
    }
    case "marks": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY, w, h);
      drawMarks(ctx, L.marks ?? [], cells, (L.span ?? 3) * h, baseY, amp, L.color, L.color2 ?? L.color);
      break;
    }
    case "puffs": {
      ctx.fillStyle = L.color;
      ctx.fillRect(0, baseY, w, h);
      cells(h * 0.2, (i, x0) => {
        if (hash(i, L.seed) < 0.3) return;
        const r = amp * (0.25 + hash(i, L.seed + 1) * 0.3);
        const x = x0 + hash(i, L.seed + 2) * h * 0.1;
        const cy = baseY - r * 1.6;
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
  }
}
