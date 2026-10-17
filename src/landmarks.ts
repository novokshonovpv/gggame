// Silhouettes of Russian city landmarks for the backdrops (no religious buildings). Each
// drawer paints one landmark on baseline y = b, centered at x, about h px tall, in the
// layer's color c with a lit face, shadows and details; a is the accent (lights, stars).

export type MarkType =
  | "kremlin" // Moscow: Spasskaya tower with the red star and the Kremlin wall
  | "msu" // Moscow State University main building
  | "moscowCity" // Moscow-City skyscraper cluster
  | "ostankino" // Ostankino TV tower
  | "isetTowers" // Yekaterinburg: Iset and Vysotsky towers
  | "skiJumps" // Sochi: RusSki Gorki ski jumps
  | "lighthouse" // Makhachkala lighthouse on Anzhi-Kala hill
  | "portCranes" // Makhachkala sea port
  | "kazanBowl" // Kazan Family Centre, "the Bowl"
  | "millenniumBridge" // Kazan Millennium Bridge with its M-shaped pylon
  | "suyumbike" // Kazan: Söyembikä tower
  | "admiralty" // St Petersburg: the Admiralty and its golden spire
  | "rostral" // St Petersburg: Rostral column
  | "lakhta" // St Petersburg: Lakhta Center
  | "drawbridge"; // St Petersburg: raised bascule bridge

export interface Mark {
  type: MarkType;
  at: number; // position inside the repeat span, 0..1
  size: number; // height as a share of the layer's amp
}

type Ctx = CanvasRenderingContext2D;

// Lighter/darker variant of a #rrggbb color (the layer colors are hex).
function tone(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

function poly(ctx: Ctx, pts: number[], fill?: string) {
  if (fill) ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

// A block with its right face catching the light.
function block(ctx: Ctx, x: number, y: number, w: number, h: number, c: string, lit = 0.3) {
  rect(ctx, x, y, w, h, c);
  rect(ctx, x + w * (1 - lit), y, w * lit, h, tone(c, 0.12));
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function star(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  glow.addColorStop(0, "rgba(255,80,60,0.45)");
  glow.addColorStop(1, "rgba(255,80,60,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function glowDot(ctx: Ctx, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function windows(ctx: Ctx, x0: number, y0: number, w: number, h: number, cell: number, seed: number, color: string, density = 0.45) {
  ctx.fillStyle = color;
  let k = seed;
  for (let y = y0 + cell; y < y0 + h - cell; y += cell * 2.2)
    for (let x = x0 + cell * 0.8; x < x0 + w - cell; x += cell * 1.9) {
      k = (k * 9301 + 49297) % 233280;
      if (k / 233280 < density) ctx.fillRect(x, y, cell, cell * 1.2);
    }
}

const WARM = "rgba(255,214,150,0.8)";

const DRAW: Record<MarkType, (ctx: Ctx, x: number, b: number, h: number, c: string, a: string) => void> = {
  kremlin(ctx, x, b, h, c, a) {
    const brick = c;
    // Wall with swallowtail merlons and a lit top edge.
    const wall = h * 0.2;
    block(ctx, x - h * 0.95, b - wall, h * 1.9, wall, brick, 0.1);
    for (let m = x - h * 0.95; m < x + h * 0.95; m += h * 0.055)
      poly(ctx, [m, b - wall, m, b - wall - h * 0.045, m + h * 0.011, b - wall - h * 0.03, m + h * 0.022, b - wall - h * 0.045, m + h * 0.022, b - wall], brick);
    // Tower: base with a gate arch, white-stone trim, clock tier, octagon, tent roof, star.
    block(ctx, x - h * 0.1, b - h * 0.46, h * 0.2, h * 0.46, brick);
    ctx.fillStyle = tone(brick, -0.45);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.04, b);
    ctx.lineTo(x - h * 0.04, b - h * 0.1);
    ctx.arc(x, b - h * 0.1, h * 0.04, Math.PI, 0);
    ctx.lineTo(x + h * 0.04, b);
    ctx.fill();
    for (const y of [0.3, 0.46]) rect(ctx, x - h * 0.105, b - h * y, h * 0.21, h * 0.012, tone(brick, 0.45));
    block(ctx, x - h * 0.075, b - h * 0.6, h * 0.15, h * 0.14, brick);
    // Clock face.
    ctx.fillStyle = tone(brick, -0.5);
    ctx.beginPath();
    ctx.arc(x, b - h * 0.53, h * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9e2cf";
    ctx.beginPath();
    ctx.arc(x, b - h * 0.53, h * 0.035, 0, Math.PI * 2);
    ctx.fill();
    line(ctx, x, b - h * 0.53, x, b - h * 0.555, "#222", Math.max(1, h * 0.006));
    line(ctx, x, b - h * 0.53, x + h * 0.018, b - h * 0.53, "#222", Math.max(1, h * 0.006));
    for (const s of [-1, 1]) poly(ctx, [x + s * h * 0.075, b - h * 0.6, x + s * h * 0.06, b - h * 0.66, x + s * h * 0.045, b - h * 0.6], tone(brick, 0.2));
    block(ctx, x - h * 0.05, b - h * 0.72, h * 0.1, h * 0.12, brick);
    rect(ctx, x - h * 0.05, b - h * 0.68, h * 0.1, h * 0.01, tone(brick, 0.45));
    // Tent roof with horizontal bands.
    poly(ctx, [x - h * 0.05, b - h * 0.72, x, b - h * 0.93, x + h * 0.05, b - h * 0.72], tone(brick, -0.2));
    poly(ctx, [x, b - h * 0.72, x, b - h * 0.93, x + h * 0.05, b - h * 0.72], tone(brick, 0));
    for (let k = 1; k < 4; k++) {
      const y = b - h * (0.72 + k * 0.05);
      const w = h * 0.05 * (1 - (k * 0.05) / 0.21);
      line(ctx, x - w, y, x + w, y, tone(brick, 0.35), Math.max(1, h * 0.005));
    }
    star(ctx, x, b - h * 0.965, h * 0.035, a);
  },
  msu(ctx, x, b, h, c) {
    // Stepped wings with corner towers, the main tower, clock, spire and star in a wreath.
    for (const s of [-1, 1]) {
      block(ctx, x + s * h * 0.35 - h * 0.25, b - h * 0.24, h * 0.5, h * 0.24, c);
      block(ctx, x + s * h * 0.55 - h * 0.06, b - h * 0.36, h * 0.12, h * 0.12, c);
      poly(ctx, [x + s * h * 0.55 - h * 0.03, b - h * 0.36, x + s * h * 0.55, b - h * 0.46, x + s * h * 0.55 + h * 0.03, b - h * 0.36], tone(c, 0.15));
      windows(ctx, x + s * h * 0.35 - h * 0.24, b - h * 0.23, h * 0.48, h * 0.22, Math.max(1.2, h * 0.012), s > 0 ? 7 : 9, WARM, 0.35);
    }
    block(ctx, x - h * 0.17, b - h * 0.36, h * 0.34, h * 0.36, c);
    block(ctx, x - h * 0.13, b - h * 0.55, h * 0.26, h * 0.2, c);
    block(ctx, x - h * 0.09, b - h * 0.68, h * 0.18, h * 0.14, c);
    for (const s of [-1, 1]) poly(ctx, [x + s * h * 0.13, b - h * 0.55, x + s * h * 0.11, b - h * 0.6, x + s * h * 0.09, b - h * 0.55], tone(c, 0.15));
    windows(ctx, x - h * 0.16, b - h * 0.55, h * 0.32, h * 0.55, Math.max(1.2, h * 0.012), 11, WARM, 0.4);
    ctx.fillStyle = "#f0d48a";
    ctx.beginPath();
    ctx.arc(x, b - h * 0.62, h * 0.025, 0, Math.PI * 2);
    ctx.fill();
    block(ctx, x - h * 0.06, b - h * 0.77, h * 0.12, h * 0.1, c);
    poly(ctx, [x - h * 0.04, b - h * 0.77, x, b - h * 0.96, x + h * 0.04, b - h * 0.77], tone(c, 0.1));
    ctx.strokeStyle = "#e6c35a";
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.beginPath();
    ctx.arc(x, b - h * 0.985, h * 0.028, 0, Math.PI * 2);
    ctx.stroke();
    star(ctx, x, b - h * 0.985, h * 0.02, "#f0d48a");
  },
  moscowCity(ctx, x, b, h, c, a) {
    const glass = (x0: number, w: number, th: number, seed: number, tint: number) => {
      const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      g.addColorStop(0, tone(c, tint));
      g.addColorStop(0.7, tone(c, tint + 0.12));
      g.addColorStop(1, tone(c, tint + 0.25));
      ctx.fillStyle = g;
      ctx.fillRect(x0, b - th, w, th);
      windows(ctx, x0, b - th, w, th, Math.max(1.2, h * 0.009), seed, a, 0.38);
      for (let k = 1; k < 4; k++) rect(ctx, x0 + (w * k) / 4, b - th, Math.max(1, h * 0.003), th, tone(c, tint - 0.15));
    };
    // City of Capitals (stacked), OKO twins, Federation (with spire), Mercury, Evolution.
    for (let k = 0; k < 5; k++) glass(x - h * 0.5 + k * h * 0.012, h * 0.1, h * (0.45 + k * 0.04), 3 + k, -0.05);
    glass(x - h * 0.34, h * 0.08, h * 0.72, 21, 0);
    glass(x - h * 0.25, h * 0.08, h * 0.62, 22, 0.05);
    glass(x - h * 0.13, h * 0.12, h * 0.95, 23, 0.02);
    poly(ctx, [x - h * 0.13, b - h * 0.95, x + h * 0.01, b - h * 1.02, x - h * 0.01, b - h * 0.95], tone(c, 0.2));
    line(ctx, x - h * 0.07, b - h * 0.98, x - h * 0.07, b - h * 1.1, tone(c, 0.3), Math.max(1, h * 0.004));
    glowDot(ctx, x - h * 0.07, b - h * 1.1, Math.max(1, h * 0.006), "rgba(255,70,60,0.9)");
    // Mercury: bronze, stepped crown.
    const mx = x + h * 0.02;
    ctx.fillStyle = "#7a5a3f";
    ctx.fillRect(mx, b - h * 0.78, h * 0.11, h * 0.78);
    poly(ctx, [mx, b - h * 0.78, mx + h * 0.055, b - h * 0.86, mx + h * 0.11, b - h * 0.78], "#8f6c4c");
    windows(ctx, mx, b - h * 0.78, h * 0.11, h * 0.78, Math.max(1.2, h * 0.009), 31, WARM, 0.35);
    // Evolution: twisted, drawn as a slanting stack of floors.
    for (let k = 0; k < 14; k++) {
      const y = b - h * 0.68 + (k * h * 0.68) / 14;
      rect(ctx, x + h * 0.16 + Math.sin(k * 0.45) * h * 0.02, y, h * 0.09, (h * 0.68) / 14 + 1, tone(c, 0.05 + (k % 2) * 0.06));
    }
    glass(x + h * 0.28, h * 0.1, h * 0.5, 41, -0.05);
  },
  ostankino(ctx, x, b, h, c, a) {
    // Legs with arched openings, the tapering shaft with rings, the pod, the striped mast.
    poly(ctx, [x - h * 0.08, b, x - h * 0.03, b - h * 0.12, x + h * 0.03, b - h * 0.12, x + h * 0.08, b], c);
    ctx.fillStyle = tone(c, -0.4);
    for (const s of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.ellipse(x + s * h * 0.035, b - h * 0.025, h * 0.012, h * 0.03, 0, Math.PI, 0);
      ctx.fill();
    }
    poly(ctx, [x - h * 0.03, b - h * 0.12, x - h * 0.012, b - h * 0.56, x + h * 0.012, b - h * 0.56, x + h * 0.03, b - h * 0.12], c);
    poly(ctx, [x, b - h * 0.12, x, b - h * 0.56, x + h * 0.012, b - h * 0.56, x + h * 0.03, b - h * 0.12], tone(c, 0.15));
    for (const y of [0.25, 0.37, 0.47]) rect(ctx, x - h * 0.02, b - h * y, h * 0.04, h * 0.008, tone(c, 0.3));
    rect(ctx, x - h * 0.032, b - h * 0.6, h * 0.064, h * 0.045, c);
    rect(ctx, x - h * 0.032, b - h * 0.585, h * 0.064, h * 0.012, a);
    for (let k = 0; k < 8; k++) rect(ctx, x - h * 0.006, b - h * (0.6 + k * 0.05), h * 0.012, h * 0.05, k % 2 ? "#d9d9d9" : "#c9382b");
    glowDot(ctx, x, b - h * 1.0, Math.max(1, h * 0.007), "rgba(255,70,60,0.95)");
  },
  isetTowers(ctx, x, b, h, c, a) {
    // Iset: cylinder with a lit crown ring; Vysotsky: stepped crown and vertical fins.
    const g = ctx.createLinearGradient(x - h * 0.07, 0, x + h * 0.07, 0);
    g.addColorStop(0, tone(c, -0.05));
    g.addColorStop(0.65, tone(c, 0.18));
    g.addColorStop(1, tone(c, 0.05));
    ctx.fillStyle = g;
    ctx.fillRect(x - h * 0.07, b - h * 0.9, h * 0.14, h * 0.9);
    ctx.beginPath();
    ctx.ellipse(x, b - h * 0.9, h * 0.07, h * 0.03, 0, Math.PI, 0);
    ctx.fill();
    for (let y = b - h * 0.88; y < b; y += h * 0.03) rect(ctx, x - h * 0.07, y, h * 0.14, Math.max(1, h * 0.003), tone(c, -0.12));
    rect(ctx, x - h * 0.07, b - h * 0.88, h * 0.14, h * 0.012, a);
    windows(ctx, x - h * 0.065, b - h * 0.86, h * 0.13, h * 0.86, Math.max(1.2, h * 0.01), 3, a, 0.3);
    const vx = x + h * 0.15;
    block(ctx, vx, b - h * 0.7, h * 0.14, h * 0.7, c, 0.35);
    block(ctx, vx + h * 0.02, b - h * 0.76, h * 0.1, h * 0.06, c);
    block(ctx, vx + h * 0.04, b - h * 0.8, h * 0.06, h * 0.04, c);
    for (let k = 1; k < 5; k++) rect(ctx, vx + (h * 0.14 * k) / 5, b - h * 0.7, Math.max(1, h * 0.004), h * 0.7, tone(c, 0.25));
    windows(ctx, vx, b - h * 0.68, h * 0.14, h * 0.66, Math.max(1.2, h * 0.01), 5, a, 0.3);
    block(ctx, x - h * 0.34, b - h * 0.4, h * 0.18, h * 0.4, tone(c, -0.08));
    windows(ctx, x - h * 0.34, b - h * 0.4, h * 0.18, h * 0.4, Math.max(1.2, h * 0.01), 7, a, 0.35);
    block(ctx, x + h * 0.33, b - h * 0.34, h * 0.2, h * 0.34, tone(c, -0.08));
    windows(ctx, x + h * 0.33, b - h * 0.34, h * 0.2, h * 0.34, Math.max(1.2, h * 0.01), 9, a, 0.35);
  },
  skiJumps(ctx, x, b, h, c, a) {
    // Two jumps: steel-truss inruns on stilts, start huts on top, floodlight masts.
    for (const [dx, s] of [
      [0, 1],
      [h * 0.4, 0.72],
    ] as const) {
      const x0 = x + dx - h * 0.5 * s;
      const y0 = b - h * 0.95 * s;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push([x0 + h * 0.78 * s * t, y0 + h * 0.72 * s * (t * 0.85 + t * t * 0.15)]);
      }
      // Truss: top and bottom chords with zig-zag web.
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(1.5, h * 0.012);
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py + h * 0.035 * s) : ctx.moveTo(px, py + h * 0.035 * s)));
      ctx.stroke();
      ctx.lineWidth = Math.max(1, h * 0.005);
      ctx.beginPath();
      for (let k = 0; k < pts.length - 1; k++) {
        ctx.moveTo(pts[k][0], pts[k][1] + (k % 2 ? h * 0.035 * s : 0));
        ctx.lineTo(pts[k + 1][0], pts[k + 1][1] + (k % 2 ? 0 : h * 0.035 * s));
      }
      ctx.stroke();
      for (let k = 2; k < pts.length; k += 2) line(ctx, pts[k][0], pts[k][1] + h * 0.035 * s, pts[k][0], b, c, Math.max(1, h * 0.008));
      block(ctx, x0 - h * 0.05 * s, y0 - h * 0.08 * s, h * 0.1 * s, h * 0.08 * s, c);
      poly(ctx, [x0 - h * 0.06 * s, y0 - h * 0.08 * s, x0, y0 - h * 0.12 * s, x0 + h * 0.06 * s, y0 - h * 0.08 * s], tone(c, 0.2));
      rect(ctx, x0 - h * 0.03 * s, y0 - h * 0.06 * s, h * 0.06 * s, h * 0.02 * s, a);
    }
    for (const mx of [x - h * 0.7, x + h * 0.7]) {
      line(ctx, mx, b, mx, b - h * 0.45, c, Math.max(1, h * 0.008));
      glowDot(ctx, mx, b - h * 0.46, Math.max(1, h * 0.012), "rgba(255,250,220,0.9)");
    }
  },
  lighthouse(ctx, x, b, h, c, a) {
    // Anzhi-Kala hill, the tapering white octagonal tower, galleries, lit lantern, beam.
    poly(ctx, [x - h * 0.9, b, x - h * 0.4, b - h * 0.2, x + h * 0.25, b - h * 0.24, x + h * 0.85, b], tone(c, -0.15));
    const top = b - h * 0.24;
    const beam = ctx.createLinearGradient(x, 0, x + h * 1.2, 0);
    beam.addColorStop(0, "rgba(255,245,200,0.5)");
    beam.addColorStop(1, "rgba(255,245,200,0)");
    ctx.fillStyle = beam;
    poly(ctx, [x, top - h * 0.66, x + h * 1.2, top - h * 0.75, x + h * 1.2, top - h * 0.55]);
    poly(ctx, [x - h * 0.07, top, x - h * 0.045, top - h * 0.58, x + h * 0.045, top - h * 0.58, x + h * 0.07, top], "#e8e6e0");
    poly(ctx, [x + h * 0.01, top, x + h * 0.01, top - h * 0.58, x + h * 0.045, top - h * 0.58, x + h * 0.07, top], "#c9c5bd");
    for (const y of [0.18, 0.36]) rect(ctx, x - h * 0.06, top - h * y, h * 0.12, h * 0.012, "#b04a3a");
    for (let k = 0; k < 4; k++) rect(ctx, x - h * 0.012, top - h * (0.1 + k * 0.12), h * 0.024, h * 0.04, tone(c, -0.4));
    rect(ctx, x - h * 0.07, top - h * 0.6, h * 0.14, h * 0.02, tone(c, -0.3));
    rect(ctx, x - h * 0.04, top - h * 0.68, h * 0.08, h * 0.08, a);
    poly(ctx, [x - h * 0.05, top - h * 0.68, x, top - h * 0.76, x + h * 0.05, top - h * 0.68], "#b04a3a");
    glowDot(ctx, x, top - h * 0.64, Math.max(1.5, h * 0.025), "rgba(255,240,180,0.95)");
  },
  portCranes(ctx, x, b, h, c, a) {
    // Quay, two portal cranes with booms, a container ship.
    rect(ctx, x - h * 0.9, b - h * 0.06, h * 1.8, h * 0.06, tone(c, -0.2));
    for (const [dx, ang] of [
      [-0.45, -0.5],
      [0.05, -0.75],
    ] as const) {
      const cx = x + dx * h;
      line(ctx, cx - h * 0.08, b - h * 0.06, cx, b - h * 0.32, c, Math.max(1.5, h * 0.012));
      line(ctx, cx + h * 0.08, b - h * 0.06, cx, b - h * 0.32, c, Math.max(1.5, h * 0.012));
      block(ctx, cx - h * 0.05, b - h * 0.42, h * 0.1, h * 0.1, c);
      line(ctx, cx, b - h * 0.4, cx + Math.cos(ang) * h * 0.6, b - h * 0.4 + Math.sin(ang) * h * 0.6, c, Math.max(1.5, h * 0.01));
      line(ctx, cx + Math.cos(ang) * h * 0.6, b - h * 0.4 + Math.sin(ang) * h * 0.6, cx + Math.cos(ang) * h * 0.6, b - h * 0.2, tone(c, 0.2), Math.max(1, h * 0.004));
      glowDot(ctx, cx + Math.cos(ang) * h * 0.6, b - h * 0.4 + Math.sin(ang) * h * 0.6, Math.max(1, h * 0.008), "rgba(255,90,70,0.9)");
    }
    const sx = x + h * 0.35;
    poly(ctx, [sx, b - h * 0.06, sx + h * 0.55, b - h * 0.06, sx + h * 0.6, b - h * 0.16, sx - h * 0.03, b - h * 0.16], tone(c, -0.25));
    const boxes = ["#b0503c", "#3c6fb0", "#c8a03c", "#4f8f5a"];
    for (let k = 0; k < 6; k++) rect(ctx, sx + h * (0.04 + k * 0.07), b - h * 0.22, h * 0.065, h * 0.06, boxes[k % 4]);
    block(ctx, sx + h * 0.45, b - h * 0.3, h * 0.08, h * 0.14, tone(c, 0.1));
    rect(ctx, sx + h * 0.46, b - h * 0.28, h * 0.06, h * 0.015, a);
  },
  kazanBowl(ctx, x, b, h, c, a) {
    // Kazan Family Centre: a giant bowl on a stem, terrace below, lit rim.
    block(ctx, x - h * 0.3, b - h * 0.08, h * 0.6, h * 0.08, c, 0.4);
    for (let k = 0; k < 4; k++) rect(ctx, x - h * (0.28 - k * 0.04), b - h * (0.08 + k * 0.02), h * (0.56 - k * 0.08), h * 0.02, tone(c, 0.05 * k));
    block(ctx, x - h * 0.06, b - h * 0.5, h * 0.12, h * 0.42, c);
    for (const s of [-1, 1]) line(ctx, x + s * h * 0.05, b - h * 0.16, x + s * h * 0.03, b - h * 0.5, tone(c, 0.3), Math.max(1, h * 0.005));
    // Bowl.
    ctx.fillStyle = tone(c, 0.05);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.42, b - h * 0.92);
    ctx.lineTo(x + h * 0.42, b - h * 0.92);
    ctx.quadraticCurveTo(x + h * 0.36, b - h * 0.55, x + h * 0.08, b - h * 0.5);
    ctx.lineTo(x - h * 0.08, b - h * 0.5);
    ctx.quadraticCurveTo(x - h * 0.36, b - h * 0.55, x - h * 0.42, b - h * 0.92);
    ctx.fill();
    ctx.fillStyle = tone(c, 0.22);
    ctx.beginPath();
    ctx.moveTo(x + h * 0.1, b - h * 0.92);
    ctx.lineTo(x + h * 0.42, b - h * 0.92);
    ctx.quadraticCurveTo(x + h * 0.36, b - h * 0.55, x + h * 0.08, b - h * 0.5);
    ctx.fill();
    for (let k = -3; k <= 3; k++) line(ctx, x + k * h * 0.11, b - h * 0.92, x + k * h * 0.025, b - h * 0.52, tone(c, -0.15), Math.max(1, h * 0.004));
    rect(ctx, x - h * 0.44, b - h * 0.95, h * 0.88, h * 0.03, a);
    for (let k = 0; k < 9; k++) glowDot(ctx, x - h * 0.4 + k * h * 0.1, b - h * 0.935, Math.max(1, h * 0.006), "rgba(255,240,200,0.9)");
  },
  millenniumBridge(ctx, x, b, h, c, a) {
    // Deck over the water and the M-shaped pylon with fanned stays.
    rect(ctx, x - h * 0.95, b - h * 0.14, h * 1.9, h * 0.035, c);
    for (const px of [-0.7, -0.25, 0.25, 0.7]) rect(ctx, x + px * h - h * 0.015, b - h * 0.14, h * 0.03, h * 0.14, tone(c, -0.15));
    const legs: [number, number][] = [
      [-0.16, 0],
      [-0.12, -0.92],
      [0, -0.6],
      [0.12, -0.92],
      [0.16, 0],
    ];
    ctx.strokeStyle = tone(c, 0.15);
    ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.lineJoin = "miter";
    ctx.beginPath();
    legs.forEach(([lx, ly], k) => {
      const px = x + lx * h;
      const py = b - h * 0.14 + ly * h;
      if (k) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.lineWidth = Math.max(1, h * 0.003);
    ctx.strokeStyle = tone(c, 0.4);
    for (const top of [-0.12, 0.12]) {
      for (let k = 1; k <= 6; k++) {
        const tx = x + top * h;
        const ty = b - h * 0.14 - h * (0.92 - k * 0.07);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x + (top < 0 ? -1 : 1) * h * (0.2 + k * 0.11), b - h * 0.13);
        ctx.stroke();
      }
    }
    for (const lx of [-0.12, 0.12]) glowDot(ctx, x + lx * h, b - h * 1.07, Math.max(1, h * 0.008), "rgba(255,80,70,0.9)");
    for (let k = -8; k <= 8; k++) glowDot(ctx, x + k * h * 0.11, b - h * 0.15, Math.max(1, h * 0.004), a);
  },
  suyumbike(ctx, x, b, h, c) {
    // Seven-tiered brick tower with arched windows and a green tent spire.
    for (let k = 0; k < 6; k++) {
      const w = h * (0.22 - k * 0.027);
      const y = b - h * (0.13 * (k + 1));
      block(ctx, x - w / 2, y, w, h * 0.13 + 1, c, 0.35);
      rect(ctx, x - w / 2 - h * 0.006, y, w + h * 0.012, h * 0.012, tone(c, 0.35));
      ctx.fillStyle = tone(c, -0.45);
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.075, w * 0.12, h * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    poly(ctx, [x - h * 0.035, b - h * 0.78, x, b - h * 0.99, x + h * 0.035, b - h * 0.78], "#3f7a52");
    poly(ctx, [x, b - h * 0.78, x, b - h * 0.99, x + h * 0.035, b - h * 0.78], "#57996c");
  },
  admiralty(ctx, x, b, h, c, a) {
    // Long colonnaded wings, the central tower with arch and colonnade, gilded cupola and
    // the thin golden spire with the little ship on top.
    block(ctx, x - h * 0.9, b - h * 0.16, h * 1.8, h * 0.16, c, 0.15);
    for (let k = -16; k <= 16; k++) rect(ctx, x + k * h * 0.052 - 1, b - h * 0.15, Math.max(1, h * 0.008), h * 0.12, tone(c, 0.3));
    rect(ctx, x - h * 0.9, b - h * 0.17, h * 1.8, h * 0.012, tone(c, 0.35));
    block(ctx, x - h * 0.1, b - h * 0.34, h * 0.2, h * 0.34, c);
    ctx.fillStyle = tone(c, -0.45);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.045, b);
    ctx.lineTo(x - h * 0.045, b - h * 0.12);
    ctx.arc(x, b - h * 0.12, h * 0.045, Math.PI, 0);
    ctx.lineTo(x + h * 0.045, b);
    ctx.fill();
    block(ctx, x - h * 0.075, b - h * 0.44, h * 0.15, h * 0.1, c);
    for (let k = -3; k <= 3; k++) rect(ctx, x + k * h * 0.02 - 0.5, b - h * 0.44, Math.max(1, h * 0.005), h * 0.1, tone(c, 0.35));
    ctx.fillStyle = a;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.06, b - h * 0.44);
    ctx.bezierCurveTo(x - h * 0.06, b - h * 0.52, x - h * 0.02, b - h * 0.54, x, b - h * 0.54);
    ctx.bezierCurveTo(x + h * 0.02, b - h * 0.54, x + h * 0.06, b - h * 0.52, x + h * 0.06, b - h * 0.44);
    ctx.fill();
    poly(ctx, [x - h * 0.012, b - h * 0.54, x, b - h * 0.97, x + h * 0.012, b - h * 0.54], a);
    poly(ctx, [x - h * 0.02, b - h * 0.985, x + h * 0.025, b - h * 0.985, x + h * 0.018, b - h * 0.97, x - h * 0.014, b - h * 0.97], a);
    line(ctx, x, b - h * 0.97, x, b - h * 1.01, a, Math.max(1, h * 0.004));
  },
  rostral(ctx, x, b, h, c, a) {
    // Granite base with seated figures, the column with ship prows, the fire bowl on top.
    block(ctx, x - h * 0.12, b - h * 0.14, h * 0.24, h * 0.14, tone(c, 0.05));
    for (const s of [-1, 1]) {
      ctx.fillStyle = tone(c, -0.1);
      ctx.beginPath();
      ctx.ellipse(x + s * h * 0.1, b - h * 0.17, h * 0.025, h * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    block(ctx, x - h * 0.04, b - h * 0.78, h * 0.08, h * 0.64, "#8c3a2c", 0.35);
    for (let k = 0; k < 4; k++) {
      const y = b - h * (0.24 + k * 0.13);
      const s = k % 2 ? 1 : -1;
      poly(ctx, [x + s * h * 0.04, y - h * 0.02, x + s * h * 0.13, y - h * 0.04, x + s * h * 0.12, y + h * 0.01, x + s * h * 0.04, y + h * 0.02], tone(c, 0.15));
    }
    rect(ctx, x - h * 0.06, b - h * 0.8, h * 0.12, h * 0.025, tone(c, 0.2));
    poly(ctx, [x - h * 0.07, b - h * 0.84, x + h * 0.07, b - h * 0.84, x + h * 0.04, b - h * 0.8, x - h * 0.04, b - h * 0.8], tone(c, 0.1));
    const fire = ctx.createRadialGradient(x, b - h * 0.9, 0, x, b - h * 0.9, h * 0.12);
    fire.addColorStop(0, "rgba(255,210,120,0.95)");
    fire.addColorStop(0.4, "rgba(255,120,40,0.7)");
    fire.addColorStop(1, "rgba(255,80,20,0)");
    ctx.fillStyle = fire;
    ctx.fillRect(x - h * 0.12, b - h * 1.02, h * 0.24, h * 0.2);
    poly(ctx, [x - h * 0.03, b - h * 0.84, x, b - h * 0.95, x + h * 0.03, b - h * 0.84], a);
  },
  lakhta(ctx, x, b, h, c, a) {
    // Five twisting glass facets narrowing to the needle, lit at the top.
    const g = ctx.createLinearGradient(x - h * 0.08, 0, x + h * 0.08, 0);
    g.addColorStop(0, tone(c, -0.05));
    g.addColorStop(0.6, tone(c, 0.25));
    g.addColorStop(1, tone(c, 0.08));
    ctx.fillStyle = g;
    poly(ctx, [x - h * 0.08, b, x - h * 0.012, b - h * 0.95, x, b - h * 1.02, x + h * 0.012, b - h * 0.95, x + h * 0.08, b]);
    for (let k = 1; k < 12; k++) {
      const y = b - (h * 0.95 * k) / 12;
      const w = h * 0.08 * (1 - k / 12.6);
      line(ctx, x - w, y + h * 0.015, x + w, y - h * 0.015, a, Math.max(1, h * 0.003));
    }
    for (const s of [-0.5, 0, 0.5]) line(ctx, x + s * h * 0.08, b, x + s * h * 0.01, b - h * 0.95, tone(c, -0.1), Math.max(1, h * 0.003));
    glowDot(ctx, x, b - h * 1.02, Math.max(1, h * 0.008), "rgba(255,255,255,0.95)");
  },
  drawbridge(ctx, x, b, h, c, a) {
    // Fixed spans on granite piers, the two raised leaves with trusses, lamp posts.
    for (const s of [-1, 1]) {
      block(ctx, x + s * h * 0.62 - h * 0.28, b - h * 0.17, h * 0.56, h * 0.05, c, 0.2);
      for (let k = 0; k < 5; k++) line(ctx, x + s * h * (0.36 + k * 0.11), b - h * 0.17, x + s * h * (0.41 + k * 0.11), b - h * 0.21, tone(c, 0.25), Math.max(1, h * 0.004));
      block(ctx, x + s * h * 0.32 - h * 0.05, b - h * 0.2, h * 0.1, h * 0.2, tone(c, -0.1));
      ctx.save();
      ctx.translate(x + s * h * 0.3, b - h * 0.15);
      ctx.rotate(s * -1.0);
      const lx = s > 0 ? -h * 0.42 : 0;
      ctx.fillStyle = c;
      ctx.fillRect(lx, -h * 0.03, h * 0.42, h * 0.06);
      ctx.strokeStyle = tone(c, 0.3);
      ctx.lineWidth = Math.max(1, h * 0.004);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        ctx.moveTo(lx + k * h * 0.07, -h * 0.03);
        ctx.lineTo(lx + (k + 0.5) * h * 0.07, h * 0.03);
      }
      ctx.stroke();
      ctx.restore();
      for (const dx of [0.45, 0.75]) {
        line(ctx, x + s * dx * h, b - h * 0.17, x + s * dx * h, b - h * 0.27, tone(c, -0.2), Math.max(1, h * 0.006));
        glowDot(ctx, x + s * dx * h, b - h * 0.28, Math.max(1, h * 0.01), a);
      }
    }
  },
};

// Paints a layer's landmarks repeating every `span` px (positions wrap so strips tile).
export function drawMarks(ctx: Ctx, marks: Mark[], cells: (cw: number, fn: (i: number, x0: number) => void) => void, span: number, base: number, amp: number, color: string, accent: string) {
  cells(span, (_i, x0) => {
    for (const m of marks) DRAW[m.type](ctx, x0 + m.at * span, base, amp * m.size, color, accent);
  });
}
