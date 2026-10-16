import type { ThemeId } from "./track.ts";

// Procedural parallax backgrounds, one theme per track (after MSM3's locations:
// desert canyon, mountain forest with a river, neon night city).

type LayerKind = "ridge" | "hills" | "mesa" | "pines" | "buildings" | "puffs" | "rocks" | "water";

interface Layer {
  kind: LayerKind;
  parallax: number; // 0 = fixed to the screen, 1 = moves with the track
  base: number; // baseline as a fraction of screen height
  amp: number; // feature height as a fraction of screen height
  color: string;
  color2?: string; // highlight: snow caps, lit windows, strata
  seed: number;
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
}

export const THEMES: Record<ThemeId, Theme> = {
  canyon: {
    sky: ["#d98a52", "#efb67a", "#f8dcb0"],
    sun: { x: 0.78, y: 0.2, r: 0.07, color: "#fff1cf", glow: "rgba(255,226,170,0.45)" },
    layers: [
      { kind: "mesa", parallax: 0.08, base: 0.5, amp: 0.2, color: "#d39a6c", color2: "#c48a5e", seed: 3 },
      { kind: "mesa", parallax: 0.2, base: 0.62, amp: 0.26, color: "#b8744a", color2: "#a4643f", seed: 9 },
      { kind: "rocks", parallax: 0.45, base: 0.8, amp: 0.12, color: "#8c5434", color2: "#7a482c", seed: 21 },
    ],
    track: {
      top: "#d7ab72",
      rut: "rgba(120,78,40,0.45)",
      lip: "#ecc995",
      berm: "#a8794a",
      face: ["#a56d3d", "#5b3720"],
      strata: "rgba(70,40,20,0.35)",
      fence: "#6b4a2e",
    },
  },
  forest: {
    sky: ["#5d9fd6", "#9fcbea", "#dcefe9"],
    layers: [
      { kind: "ridge", parallax: 0.06, base: 0.5, amp: 0.26, color: "#8fb0c8", color2: "#eef5fa", seed: 5 },
      { kind: "ridge", parallax: 0.14, base: 0.58, amp: 0.16, color: "#6f97a8", color2: "#a9c4cf", seed: 8 },
      { kind: "water", parallax: 0.22, base: 0.64, amp: 0.05, color: "#9ccbe0", color2: "#d8eef6", seed: 2 },
      { kind: "pines", parallax: 0.3, base: 0.7, amp: 0.15, color: "#3e6e55", color2: "#4f8366", seed: 13 },
      { kind: "pines", parallax: 0.55, base: 0.84, amp: 0.22, color: "#24493a", color2: "#2e5847", seed: 17 },
    ],
    track: {
      top: "#b58b5a",
      rut: "rgba(90,60,30,0.45)",
      lip: "#d2ab7a",
      berm: "#5f7d45",
      face: ["#7b5636", "#3d2919"],
      strata: "rgba(40,25,12,0.35)",
      fence: "#5a4330",
    },
  },
  city: {
    sky: ["#2a1840", "#7a2f6b", "#e0658e"],
    sun: { x: 0.2, y: 0.18, r: 0.045, color: "#ffe9f0", glow: "rgba(255,180,210,0.35)" },
    stars: true,
    layers: [
      { kind: "buildings", parallax: 0.08, base: 0.62, amp: 0.36, color: "#53305f", color2: "rgba(255,200,140,0.5)", seed: 4 },
      { kind: "buildings", parallax: 0.2, base: 0.7, amp: 0.4, color: "#3b2148", color2: "rgba(255,214,140,0.85)", seed: 7 },
      { kind: "puffs", parallax: 0.45, base: 0.84, amp: 0.2, color: "#23142e", color2: "#2e1b3b", seed: 19 },
    ],
    track: {
      top: "#a6714c",
      rut: "rgba(70,40,30,0.5)",
      lip: "#c99268",
      berm: "#6b3f52",
      face: ["#6c4232", "#2c1818"],
      strata: "rgba(30,15,20,0.4)",
      fence: "#e9e2f0",
    },
  },
};

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
