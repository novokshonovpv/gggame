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
  | "drawbridge" // St Petersburg: raised bascule bridge
  | "aurora" // St Petersburg: cruiser Aurora
  | "gazpromArena" // St Petersburg: the stadium on Krestovsky island with its masts
  | "whiteTower" // Yekaterinburg: constructivist White Tower (water tower)
  | "ekbArena" // Yekaterinburg: Central Stadium with its colonnade
  | "shukhov" // Moscow: Shukhov radio tower
  | "gondola" // Sochi: Krasnaya Polyana cable car
  | "fisht" // Sochi: Fisht stadium
  | "anjiArena" // Makhachkala (Kaspiysk): Anzhi Arena
  | "farmersPalace" // Kazan: Palace of Farmers with the bronze tree in the arch
  | "smolenskWall" // Smolensk fortress wall with Gromovaya, a square and a round tower
  | "eagles" // Smolensk: monument to the heroes of 1812 with the eagles
  | "smolenskBlonie" // Smolensk: Blonie garden — bandstand and the Glinka monument
  | "smolenskTown" // Smolensk: houses on the hills across the Dnieper
  | "dneprBridge" // Smolensk: the old arched bridge over the Dnieper
  | "monument1812" // Smolensk: cast-iron gothic monument to the defenders of 1812
  | "loveSign" // Smolensk: the "Я ❤ СМОЛЕНСК" letters
  | "nationalLibrary" // Minsk: the "diamond" National Library
  | "minskStela" // Minsk: Hero City stela
  | "minskGates" // Minsk: the Gates of Minsk twin towers
  | "shipGoto" // Voronezh: ship-museum Goto Predestinatsia
  | "riverBridge" // Voronezh: Chernavsky bridge (long beam bridge with lamps)
  | "railwayHQ" // Voronezh: South-Eastern Railway building with the clock tower
  | "russkyBridge" // Vladivostok: Russky Bridge
  | "goldenBridge" // Vladivostok: Golden Bridge
  | "submarine" // Vladivostok: S-56 submarine memorial
  | "operaNsk" // Novosibirsk: Opera and Ballet Theatre with the silver dome
  | "archBridge" // Novosibirsk: Bugrinsky bridge, the red arch over the Ob
  | "nskStation" // Novosibirsk-Glavny railway station
  | "groznyCity" // Grozny-City towers
  | "akhmatArena" // Grozny: Akhmat Arena
  | "nnKremlin" // Nizhny Novgorod: Kremlin wall up the hill and Dmitrievskaya tower
  | "chkalovStairs" // Nizhny Novgorod: Chkalov stairs down to the Volga
  | "nnCableCar" // Nizhny Novgorod: cable car over the Volga
  | "nnStadium"; // Nizhny Novgorod: the white stadium on the Strelka

export interface Mark {
  type: MarkType;
  at: number; // position inside the repeat span, 0..1
  size: number; // height as a share of the layer's amp
}

type Ctx = CanvasRenderingContext2D;

// Lighter/darker variant of a #rrggbb color (the layer colors are hex).
export function tone(hex: string, k: number) {
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

// Which side of the sky the sun is on; blocks light their face on that side.
let lightLeft = false;
export function setLight(left: boolean) {
  lightLeft = left;
}

// A block with one face catching the light.
function block(ctx: Ctx, x: number, y: number, w: number, h: number, c: string, lit = 0.3) {
  rect(ctx, x, y, w, h, c);
  rect(ctx, lightLeft ? x : x + w * (1 - lit), y, w * lit, h, tone(c, 0.12));
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

// Blend of two #rrggbb colors as #rrggbb: tints fixed materials (brick, bronze) toward the
// layer's haze color, so far landmarks fade like the rest of their layer.
export function mix(c1: string, c2: string, t: number) {
  const p = (s: string) => {
    const n = parseInt(s.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const a = p(c1);
  const b = p(c2);
  return "#" + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

// Opening with straight sides up from y = b and a round top.
function arch(ctx: Ctx, x: number, b: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, b);
  ctx.lineTo(x - w / 2, b - h + w / 2);
  ctx.arc(x, b - h + w / 2, w / 2, Math.PI, 0);
  ctx.lineTo(x + w / 2, b);
  ctx.closePath();
  ctx.fill();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

// Fortress wall riding the ground profile g(x): brick body, white-stone plinth, a row of
// loopholes and battlements (swallowtail for Nizhny, plain for Smolensk).
function fortWall(ctx: Ctx, x0: number, x1: number, g: (x: number) => number, wh: number, brick: string, swallow: boolean, h: number) {
  const dx = Math.max(1, h * 0.02);
  ctx.fillStyle = brick;
  ctx.beginPath();
  ctx.moveTo(x0, g(x0) + 2);
  for (let xx = x0; xx <= x1; xx += dx) ctx.lineTo(xx, g(xx) - wh);
  ctx.lineTo(x1, g(x1) - wh);
  ctx.lineTo(x1, g(x1) + 2);
  for (let xx = x1; xx >= x0; xx -= dx) ctx.lineTo(xx, g(xx) + 2);
  ctx.fill();
  const step = h * 0.05;
  for (let m = x0; m < x1 - step * 0.5; m += step) {
    const gy = g(m + step * 0.25);
    const top = gy - wh;
    const w = step * 0.5;
    const mh = h * 0.04;
    if (swallow) poly(ctx, [m, top + 1, m, top - mh, m + w * 0.5, top - mh * 0.6, m + w, top - mh, m + w, top + 1], brick);
    else {
      rect(ctx, m, top - mh, w, mh + 1, brick);
      rect(ctx, m + w * 0.42, top - mh * 0.75, w * 0.16, mh * 0.5, tone(brick, -0.5));
    }
    rect(ctx, m, top, step, Math.max(1, h * 0.006), tone(brick, 0.3)); // lit walkway edge
    rect(ctx, m + step * 0.4, gy - wh * 0.55, step * 0.14, wh * 0.14, tone(brick, -0.55)); // loophole
    rect(ctx, m, gy - wh * 0.12, step + 1, wh * 0.12 + 2, tone(brick, 0.32)); // plinth
  }
}

// Fortress tower: brick body (square or round), machicolation band with loopholes, and a
// wooden tent roof with a weathervane. Returns the roof apex height.
function fortTower(ctx: Ctx, x: number, b: number, w: number, bh: number, roofH: number, brick: string, roof: string, round: boolean, h: number) {
  const top = b - bh;
  if (round) {
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, tone(brick, -0.18));
    g.addColorStop(0.62, tone(brick, 0.14));
    g.addColorStop(1, tone(brick, -0.04));
    ctx.fillStyle = g;
    ctx.fillRect(x - w / 2, top, w, bh);
    for (let k = -2; k <= 2; k++) rect(ctx, x + (k * w) / 5.5, top, Math.max(1, h * 0.003), bh, tone(brick, k > 0 ? 0.22 : -0.25));
  } else block(ctx, x - w / 2, top, w, bh, brick, 0.35);
  rect(ctx, x - w / 2, b - bh * 0.14, w, bh * 0.14, tone(brick, 0.3));
  rect(ctx, x - w * 0.56, top - h * 0.03, w * 1.12, h * 0.035, tone(brick, 0.06));
  for (let k = 0; k < 6; k++) rect(ctx, x - w * 0.52 + (k * w * 1.04) / 5.4, top + h * 0.005, w * 0.07, h * 0.014, tone(brick, -0.35));
  for (const t of [0.3, 0.58])
    for (const s of [-0.24, 0.24]) arch(ctx, x + s * w, top + bh * t + h * 0.03, w * 0.08, h * 0.03, tone(brick, -0.55));
  const rt = top - h * 0.03;
  const rw = w * 0.64;
  if (round) {
    poly(ctx, [x - rw, rt, x, rt - roofH, x + rw, rt], roof);
    poly(ctx, [x + rw * 0.15, rt, x, rt - roofH, x + rw, rt], tone(roof, 0.18));
  } else {
    poly(ctx, [x - rw, rt, x, rt - roofH, x + rw, rt], roof);
    poly(ctx, [x, rt, x, rt - roofH, x + rw, rt], tone(roof, 0.2));
  }
  for (let k = 1; k < 4; k++) {
    const y = rt - (roofH * k) / 4;
    const ww = rw * (1 - k / 4);
    line(ctx, x - ww, y, x + ww, y, tone(roof, -0.25), Math.max(1, h * 0.003));
  }
  const apex = rt - roofH;
  line(ctx, x, apex, x, apex - h * 0.05, tone(roof, -0.3), Math.max(1, h * 0.004));
  poly(ctx, [x, apex - h * 0.05, x + h * 0.03, apex - h * 0.042, x, apex - h * 0.034], "#d9b44a");
  return apex;
}

// Stadium bowl with a facade style: fins, a colonnade, a media screen or a wavy roof.
function stadium(ctx: Ctx, x: number, b: number, h: number, c: string, a: string, style: "ribs" | "columns" | "wave" | "shell") {
  const w = h * 0.9;
  const sh = h * 0.34;
  const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
  g.addColorStop(0, tone(c, -0.05));
  g.addColorStop(0.65, tone(c, 0.16));
  g.addColorStop(1, tone(c, 0.04));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - w, b);
  ctx.lineTo(x - w, b - sh * 0.55);
  ctx.quadraticCurveTo(x - w, b - sh, x - w * 0.68, b - sh);
  ctx.lineTo(x + w * 0.68, b - sh);
  ctx.quadraticCurveTo(x + w, b - sh, x + w, b - sh * 0.55);
  ctx.lineTo(x + w, b);
  ctx.closePath();
  ctx.fill();
  const fx0 = x - w * 0.9;
  const fw = w * 1.8;
  if (style === "ribs") {
    for (let k = 0; k <= 16; k++) rect(ctx, fx0 + (k * fw) / 16, b - sh * 0.92, Math.max(1, h * 0.012), sh * 0.92, tone(c, 0.3));
  } else if (style === "columns") {
    rect(ctx, fx0, b - sh * 0.9, fw, sh * 0.1, tone(c, 0.45));
    for (let k = 0; k <= 20; k++) rect(ctx, fx0 + (k * fw) / 20 - h * 0.006, b - sh * 0.8, Math.max(1.5, h * 0.012), sh * 0.8, tone(c, 0.5));
    rect(ctx, fx0, b - sh * 0.06, fw, sh * 0.06, tone(c, 0.35));
  } else if (style === "shell") {
    // Two white shells sweeping up over the stands (Fisht).
    for (const s of [-1, 1]) {
      ctx.fillStyle = s < 0 ? "rgba(240,244,248,0.92)" : "rgba(255,255,255,0.97)";
      ctx.beginPath();
      ctx.moveTo(x + s * w * 1.02, b - sh * 0.4);
      ctx.quadraticCurveTo(x + s * w * 0.6, b - h * 0.78, x + s * w * 0.05, b - sh * 1.15);
      ctx.lineTo(x + s * w * 0.05, b - sh);
      ctx.quadraticCurveTo(x + s * w * 0.6, b - sh * 1.5, x + s * w * 0.95, b - sh * 0.4);
      ctx.fill();
      for (let k = 1; k < 7; k++) {
        const t = k / 7;
        line(ctx, x + s * w * (0.05 + 0.95 * t), b - sh * (1.1 - 0.7 * t) - h * 0.32 * Math.sin(Math.PI * t), x + s * w * (0.05 + 0.92 * t), b - sh * (1 - 0.6 * t), "rgba(150,170,190,0.6)", Math.max(1, h * 0.004));
      }
    }
  }
  // Roof: overhang with a lit edge (wavy for Akhmat Arena) and lights along it.
  const ry = b - sh;
  if (style === "wave") {
    ctx.fillStyle = tone(c, 0.3);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.95, ry + h * 0.02);
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      ctx.lineTo(x - w * 0.95 + w * 1.9 * t, ry - h * 0.06 - h * 0.05 * Math.sin(t * Math.PI * 3));
    }
    ctx.lineTo(x + w * 0.95, ry + h * 0.02);
    ctx.fill();
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      rect(ctx, x - w * 0.95 + w * 1.9 * t, ry - h * 0.06 - h * 0.05 * Math.sin(t * Math.PI * 3), Math.max(1, w * 0.05), Math.max(1, h * 0.008), a);
    }
    for (let k = 0; k < 18; k++) rect(ctx, x - w * 0.88 + (k * w * 1.76) / 18, b - sh * 0.75, w * 0.05, sh * 0.5, k % 3 ? tone(c, 0.2) : a);
  } else if (style !== "shell") {
    rect(ctx, x - w * 0.8, ry - h * 0.035, w * 1.6, h * 0.04, tone(c, 0.25));
    rect(ctx, x - w * 0.8, ry - h * 0.035, w * 1.6, Math.max(1, h * 0.007), a);
  }
  for (const s of [-1, 1]) {
    line(ctx, x + s * w * 0.75, ry, x + s * w * 0.75, ry - h * 0.3, tone(c, -0.1), Math.max(1, h * 0.008));
    rect(ctx, x + s * w * 0.75 - h * 0.04, ry - h * 0.33, h * 0.08, h * 0.035, tone(c, -0.15));
    for (let k = 0; k < 3; k++) glowDot(ctx, x + s * w * 0.75 - h * 0.025 + k * h * 0.025, ry - h * 0.313, Math.max(1, h * 0.007), "rgba(255,252,225,0.95)");
  }
}

// Cable-stayed bridge: deck, pylons ("A" for Russky, "V" for Golden, "H"), fanned stays.
function stayBridge(ctx: Ctx, x: number, b: number, h: number, c: string, a: string, shape: "A" | "V", half: number, stay: string) {
  const deck = b - h * 0.2;
  // Approach piers and the deck with a lit edge.
  for (let k = -6; k <= 6; k++) {
    const px = x + (k * half) / 6;
    if (Math.abs(k) < 2) continue;
    rect(ctx, px - h * 0.012, deck, h * 0.024, b - deck + 2, tone(c, -0.1));
  }
  rect(ctx, x - half, deck - h * 0.02, half * 2, h * 0.03, c);
  rect(ctx, x - half, deck - h * 0.02, half * 2, Math.max(1, h * 0.006), tone(c, 0.35));
  for (const s of [-1, 1]) {
    const px = x + s * half * 0.42;
    const top = b - h;
    // Stays: a fan from the pylon head to both sides of the deck.
    ctx.strokeStyle = stay;
    ctx.lineWidth = Math.max(1, h * 0.0025);
    ctx.beginPath();
    for (let k = 1; k <= 11; k++) {
      const hy = top + h * 0.06 + k * h * 0.022;
      for (const d of [-1, 1]) {
        ctx.moveTo(px, hy);
        ctx.lineTo(px + d * (h * 0.06 + k * half * 0.035), deck - h * 0.015);
      }
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(2, h * 0.022);
    ctx.strokeStyle = tone(c, 0.25);
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (shape === "A") {
      ctx.moveTo(px - h * 0.09, b);
      ctx.lineTo(px, top);
      ctx.lineTo(px + h * 0.09, b);
      ctx.moveTo(px - h * 0.07, deck + h * 0.03);
      ctx.lineTo(px + h * 0.07, deck + h * 0.03);
    } else {
      ctx.moveTo(px, b);
      ctx.lineTo(px, deck);
      ctx.lineTo(px - h * 0.05, top + h * 0.05);
      ctx.moveTo(px, deck);
      ctx.lineTo(px + h * 0.05, top + h * 0.05);
    }
    ctx.stroke();
    glowDot(ctx, px, top - h * 0.01, Math.max(1, h * 0.008), "rgba(255,70,60,0.95)");
  }
  for (let k = -12; k <= 12; k++) glowDot(ctx, x + (k * half) / 12, deck - h * 0.03, Math.max(1, h * 0.004), a);
}

// Gondola lift: lattice pylons, a sagging cable and cabins.
function cableCar(ctx: Ctx, x: number, b: number, h: number, c: string, a: string, rise: number) {
  const towers = [-0.9, -0.1, 0.8].map((t, i) => ({ x: x + t * h, b: b - rise * h * i * 0.5, th: h * (0.42 + (i === 1 ? 0.25 : 0)) }));
  for (const t of towers) {
    const lw = Math.max(1, h * 0.006);
    line(ctx, t.x - h * 0.04, t.b, t.x - h * 0.012, t.b - t.th, c, lw * 1.5);
    line(ctx, t.x + h * 0.04, t.b, t.x + h * 0.012, t.b - t.th, c, lw * 1.5);
    for (let k = 0; k < 6; k++) {
      const y0 = t.b - (t.th * k) / 6;
      const y1 = t.b - (t.th * (k + 1)) / 6;
      const w0 = h * (0.04 - (0.028 * k) / 6);
      const w1 = h * (0.04 - (0.028 * (k + 1)) / 6);
      line(ctx, t.x - w0, y0, t.x + w1, y1, c, lw);
      line(ctx, t.x + w0, y0, t.x - w1, y1, c, lw);
    }
    rect(ctx, t.x - h * 0.05, t.b - t.th - h * 0.012, h * 0.1, h * 0.014, c);
    glowDot(ctx, t.x, t.b - t.th - h * 0.02, Math.max(1, h * 0.006), "rgba(255,80,70,0.9)");
  }
  for (let i = 0; i < towers.length - 1; i++) {
    const p = towers[i];
    const q = towers[i + 1];
    const y0 = p.b - p.th;
    const y1 = q.b - q.th;
    const sag = h * 0.06;
    const at = (t: number) => [p.x + (q.x - p.x) * t, y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)] as const;
    ctx.strokeStyle = tone(c, -0.2);
    ctx.lineWidth = Math.max(1, h * 0.003);
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      const [cx, cy] = at(k / 20);
      if (k) ctx.lineTo(cx, cy);
      else ctx.moveTo(cx, cy);
    }
    ctx.stroke();
    for (const t of [0.3, 0.68]) {
      const [cx, cy] = at(t);
      line(ctx, cx, cy, cx, cy + h * 0.03, tone(c, -0.2), Math.max(1, h * 0.003));
      ctx.fillStyle = a;
      ctx.beginPath();
      ctx.roundRect(cx - h * 0.022, cy + h * 0.03, h * 0.044, h * 0.04, h * 0.008);
      ctx.fill();
      rect(ctx, cx - h * 0.016, cy + h * 0.037, h * 0.032, h * 0.013, "rgba(30,40,60,0.75)");
    }
  }
}

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
  aurora(ctx, x, b, h, c, a) {
    // Long grey hull with the ram bow, three tall funnels, two masts, bridge and guns.
    const hull = mix("#3b4046", c, 0.35);
    const deck = b - h * 0.14;
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.85, deck - h * 0.02);
    ctx.lineTo(x + h * 0.82, deck);
    ctx.lineTo(x + h * 0.78, b - h * 0.02);
    ctx.lineTo(x - h * 0.78, b - h * 0.02);
    ctx.quadraticCurveTo(x - h * 0.86, b - h * 0.06, x - h * 0.85, deck - h * 0.02);
    ctx.fill();
    rect(ctx, x - h * 0.8, b - h * 0.05, h * 1.58, h * 0.03, mix("#7a2a24", c, 0.3)); // boot topping
    rect(ctx, x - h * 0.84, deck - h * 0.005, h * 1.66, Math.max(1, h * 0.006), tone(hull, 0.4));
    for (let k = 0; k < 14; k++) rect(ctx, x - h * 0.7 + k * h * 0.1, deck + h * 0.035, h * 0.018, h * 0.014, tone(hull, -0.5));
    block(ctx, x - h * 0.42, deck - h * 0.07, h * 0.86, h * 0.07, tone(hull, 0.15), 0.25);
    block(ctx, x + h * 0.36, deck - h * 0.13, h * 0.12, h * 0.06, tone(hull, 0.2));
    for (const fx of [-0.2, 0, 0.2]) {
      block(ctx, x + fx * h - h * 0.035, deck - h * 0.48, h * 0.07, h * 0.41, mix("#2f3338", c, 0.3), 0.35);
      rect(ctx, x + fx * h - h * 0.035, deck - h * 0.48, h * 0.07, h * 0.02, "#1a1a1a");
      rect(ctx, x + fx * h - h * 0.035, deck - h * 0.38, h * 0.07, h * 0.012, tone(hull, 0.35));
    }
    for (const [mx, mh] of [
      [-0.55, 0.8],
      [0.5, 0.86],
    ] as const) {
      line(ctx, x + mx * h, deck, x + mx * h, deck - h * mh, tone(hull, -0.2), Math.max(1, h * 0.008));
      line(ctx, x + mx * h - h * 0.08, deck - h * mh * 0.7, x + mx * h + h * 0.08, deck - h * mh * 0.7, tone(hull, -0.2), Math.max(1, h * 0.005));
      line(ctx, x + mx * h, deck - h * mh, x + (mx < 0 ? -0.85 : 0.82) * h, deck, tone(hull, -0.1), Math.max(1, h * 0.002));
    }
    line(ctx, x - h * 0.55, deck - h * 0.8, x + h * 0.5, deck - h * 0.86, tone(hull, -0.1), Math.max(1, h * 0.002));
    for (const [gx, d] of [
      [0.62, 1],
      [-0.66, -1],
    ] as const) {
      block(ctx, x + gx * h - h * 0.04, deck - h * 0.055, h * 0.08, h * 0.04, tone(hull, 0.1));
      line(ctx, x + gx * h, deck - h * 0.04, x + gx * h + d * h * 0.12, deck - h * 0.05, tone(hull, -0.3), Math.max(1, h * 0.008));
    }
    // Naval ensign at the stern: white with the blue saltire.
    line(ctx, x - h * 0.84, deck - h * 0.02, x - h * 0.84, deck - h * 0.16, tone(hull, -0.3), Math.max(1, h * 0.004));
    rect(ctx, x - h * 0.84, deck - h * 0.16, h * 0.08, h * 0.05, "#f2f2f2");
    line(ctx, x - h * 0.84, deck - h * 0.16, x - h * 0.76, deck - h * 0.11, "#2f5fb3", Math.max(1, h * 0.006));
    line(ctx, x - h * 0.84, deck - h * 0.11, x - h * 0.76, deck - h * 0.16, "#2f5fb3", Math.max(1, h * 0.006));
    for (let k = 0; k < 8; k++) glowDot(ctx, x - h * 0.38 + k * h * 0.11, deck - h * 0.035, Math.max(1, h * 0.004), a);
  },
  gazpromArena(ctx, x, b, h, c, a) {
    // A glass drum under a lens-shaped roof held by eight slanted masts with stays.
    const roofY = b - h * 0.42;
    const g = ctx.createLinearGradient(x - h * 0.7, 0, x + h * 0.7, 0);
    g.addColorStop(0, tone(c, -0.05));
    g.addColorStop(0.6, tone(c, 0.25));
    g.addColorStop(1, tone(c, 0.08));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.62, b);
    ctx.quadraticCurveTo(x - h * 0.68, roofY + h * 0.08, x - h * 0.5, roofY + h * 0.04);
    ctx.lineTo(x + h * 0.5, roofY + h * 0.04);
    ctx.quadraticCurveTo(x + h * 0.68, roofY + h * 0.08, x + h * 0.62, b);
    ctx.fill();
    for (let k = -10; k <= 10; k++) line(ctx, x + k * h * 0.058, b, x + k * h * 0.05, roofY + h * 0.05, tone(c, 0.35), Math.max(1, h * 0.003));
    windows(ctx, x - h * 0.55, roofY + h * 0.08, h * 1.1, b - roofY - h * 0.1, Math.max(1.2, h * 0.01), 17, a, 0.25);
    ellipse(ctx, x, roofY, h * 0.78, h * 0.06, 0, tone(c, 0.3));
    ellipse(ctx, x, roofY - h * 0.01, h * 0.7, h * 0.04, 0, tone(c, 0.45));
    for (const s of [-1, 1])
      for (const k of [0.3, 0.75]) {
        const mx = x + s * h * (0.25 + k * 0.5);
        const tx = mx + s * h * 0.12;
        const ty = b - h * (0.95 - k * 0.15);
        line(ctx, mx, b, tx, ty, tone(c, 0.4), Math.max(1.5, h * 0.012));
        line(ctx, tx, ty, mx - s * h * 0.2, roofY, tone(c, 0.3), Math.max(1, h * 0.003));
        line(ctx, tx, ty, mx - s * h * 0.05, roofY + h * 0.02, tone(c, 0.3), Math.max(1, h * 0.003));
        glowDot(ctx, tx, ty, Math.max(1, h * 0.008), "rgba(255,90,80,0.9)");
      }
  },
  whiteTower(ctx, x, b, h, c, a) {
    // Constructivist water tower: a slender shaft with balconies under a wide drum tank.
    const white = mix("#f1f0ea", c, 0.3);
    const g = ctx.createLinearGradient(x - h * 0.06, 0, x + h * 0.06, 0);
    g.addColorStop(0, tone(white, -0.15));
    g.addColorStop(0.6, white);
    g.addColorStop(1, tone(white, -0.08));
    ctx.fillStyle = g;
    ctx.fillRect(x - h * 0.05, b - h * 0.62, h * 0.1, h * 0.62);
    for (let k = 0; k < 6; k++) rect(ctx, x - h * 0.012, b - h * (0.1 + k * 0.08), h * 0.024, h * 0.04, tone(white, -0.5));
    rect(ctx, x - h * 0.09, b - h * 0.08, h * 0.18, h * 0.08, tone(white, -0.05));
    const tg = ctx.createLinearGradient(x - h * 0.17, 0, x + h * 0.17, 0);
    tg.addColorStop(0, tone(white, -0.2));
    tg.addColorStop(0.62, white);
    tg.addColorStop(1, tone(white, -0.1));
    ctx.fillStyle = tg;
    ctx.fillRect(x - h * 0.17, b - h * 0.86, h * 0.34, h * 0.24);
    ellipse(ctx, x, b - h * 0.62, h * 0.17, h * 0.03, 0, tone(white, -0.25));
    for (let k = 0; k < 9; k++) rect(ctx, x - h * 0.155 + k * h * 0.036, b - h * 0.82, h * 0.022, h * 0.06, k > 2 && k < 7 ? a : tone(white, -0.45));
    rect(ctx, x - h * 0.18, b - h * 0.72, h * 0.36, h * 0.012, tone(white, -0.3));
    rect(ctx, x - h * 0.07, b - h * 0.92, h * 0.14, h * 0.06, white);
    rect(ctx, x - h * 0.08, b - h * 0.93, h * 0.16, h * 0.012, tone(white, -0.2));
    for (const s of [-1, 1]) line(ctx, x + s * h * 0.05, b - h * 0.62, x + s * h * 0.15, b - h * 0.62, tone(white, -0.35), Math.max(1, h * 0.005));
  },
  ekbArena(ctx, x, b, h, c, a) {
    stadium(ctx, x, b, h, c, a, "columns");
    // The temporary stands sticking out of the old walls.
    for (const s of [-1, 1]) {
      const sx = x + s * h * 0.92;
      poly(ctx, [sx, b - h * 0.04, sx, b - h * 0.42, sx + s * h * 0.28, b - h * 0.04], tone(c, 0.05));
      for (let k = 1; k < 8; k++) line(ctx, sx, b - h * (0.04 + k * 0.047), sx + s * h * 0.28 * (1 - k / 8.5), b - h * (0.04 + k * 0.047), tone(c, 0.3), Math.max(1, h * 0.004));
      for (let k = 1; k < 4; k++) line(ctx, sx + s * h * 0.07 * k, b, sx + s * h * 0.07 * k, b - h * (0.38 - k * 0.09), tone(c, -0.2), Math.max(1, h * 0.005));
    }
    star(ctx, x, b - h * 0.48, h * 0.03, "#e6c35a");
  },
  shukhov(ctx, x, b, h, c) {
    // Six stacked hyperboloid sections of crossed steel lattice, rings at the joints.
    let y0 = b;
    let r0 = h * 0.17;
    const lw = Math.max(1, h * 0.003);
    for (let s = 0; s < 6; s++) {
      const sh = h * 0.15;
      const r1 = r0 * 0.78;
      const y1 = y0 - sh;
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const xa = x - r0 + 2 * r0 * u;
        const ub = Math.min(1, u + 0.3);
        const ua = Math.max(0, u - 0.3);
        line(ctx, xa, y0, x - r1 + 2 * r1 * ub, y1, c, lw);
        line(ctx, xa, y0, x - r1 + 2 * r1 * ua, y1, tone(c, 0.2), lw);
      }
      rect(ctx, x - r1, y1 - lw, r1 * 2, Math.max(1.5, h * 0.008), tone(c, 0.15));
      for (let k = 1; k < 3; k++) {
        const t = k / 3;
        const yy = y0 - sh * t;
        const rr = (r0 + (r1 - r0) * t) * (1 - 0.12 * Math.sin(Math.PI * t));
        line(ctx, x - rr, yy, x + rr, yy, tone(c, 0.1), lw);
      }
      y0 = y1;
      r0 = r1 * 0.98;
    }
    line(ctx, x, y0, x, y0 - h * 0.08, c, Math.max(1, h * 0.006));
    glowDot(ctx, x, y0 - h * 0.08, Math.max(1, h * 0.007), "rgba(255,70,60,0.95)");
    rect(ctx, x - h * 0.2, b - h * 0.02, h * 0.4, h * 0.02, tone(c, -0.1));
  },
  gondola(ctx, x, b, h, c, a) {
    cableCar(ctx, x, b, h, c, a, 0.45);
  },
  fisht(ctx, x, b, h, c, a) {
    stadium(ctx, x, b, h, c, a, "shell");
  },
  anjiArena(ctx, x, b, h, c, a) {
    stadium(ctx, x, b, h, c, a, "ribs");
  },
  farmersPalace(ctx, x, b, h, c, a) {
    // Palace of Farmers: wings with colonnades, the giant portal arch holding the bronze tree,
    // and the glass canopy above.
    const stone = mix("#e9e0cc", c, 0.35);
    for (const s of [-1, 1]) {
      block(ctx, x + s * h * 0.5 - h * 0.28, b - h * 0.36, h * 0.56, h * 0.36, stone, 0.25);
      for (let k = 0; k < 9; k++) rect(ctx, x + s * h * 0.5 - h * 0.26 + k * h * 0.064, b - h * 0.32, Math.max(1, h * 0.014), h * 0.26, tone(stone, 0.25));
      rect(ctx, x + s * h * 0.5 - h * 0.29, b - h * 0.37, h * 0.58, h * 0.03, tone(stone, 0.15));
      windows(ctx, x + s * h * 0.5 - h * 0.26, b - h * 0.32, h * 0.52, h * 0.26, Math.max(1.2, h * 0.012), s > 0 ? 3 : 5, a, 0.4);
      ellipse(ctx, x + s * h * 0.5, b - h * 0.4, h * 0.1, h * 0.04, 0, "#3f7a52");
    }
    block(ctx, x - h * 0.24, b - h * 0.62, h * 0.48, h * 0.62, stone, 0.3);
    arch(ctx, x, b, h * 0.34, h * 0.56, tone(stone, -0.5));
    // Bronze tree inside the arch.
    const bronze = "#8a6a3a";
    line(ctx, x, b, x, b - h * 0.25, bronze, Math.max(1.5, h * 0.025));
    for (const [dx, dy, r] of [
      [0, -0.36, 0.1],
      [-0.08, -0.3, 0.07],
      [0.08, -0.3, 0.07],
      [-0.05, -0.43, 0.06],
      [0.05, -0.43, 0.06],
    ] as const)
      ellipse(ctx, x + dx * h, b + dy * h, r * h, r * h * 0.8, 0, dx > 0 ? "#b08a48" : "#9a7840");
    // Glass canopy.
    ctx.fillStyle = "rgba(200,230,240,0.55)";
    ctx.beginPath();
    ctx.moveTo(x - h * 0.3, b - h * 0.62);
    ctx.quadraticCurveTo(x, b - h * 0.86, x + h * 0.3, b - h * 0.62);
    ctx.fill();
    rect(ctx, x - h * 0.26, b - h * 0.64, h * 0.52, h * 0.02, tone(stone, 0.2));
  },
  smolenskWall(ctx, x, b, h, c) {
    // After the photo of the Smolensk fortress from the meadow: a long, tall wall of warm
    // ochre brick crowned with small square merlons, the wide round tower with narrow
    // white-framed windows, a gallery of loopholes under the eaves and a tall cone of grey
    // sheet metal, and square towers along the wall under grey pyramid roofs; trees behind.
    const brick = mix("#cf8d5c", c, 0.12);
    const metal = mix("#8f949a", c, 0.12);
    const dark = tone(brick, -0.45);
    const courses = "rgba(90,40,20,0.12)";
    const ground = b;
    const L = h * 1.45;
    // Trees behind the wall.
    for (let k = 0; k < 14; k++) {
      const tx = x - L * 0.6 + k * h * 0.17 + Math.sin(k * 7.3) * h * 0.04;
      const r = h * (0.07 + ((k * 37) % 5) * 0.012);
      ctx.fillStyle = tone(c, k % 2 ? -0.08 : 0.02);
      ctx.beginPath();
      ctx.arc(tx, ground - h * 0.2 - r * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // The wall: brick courses, a darker crown band, merlons, loopholes, white-stone plinth.
    const wh = h * 0.2;
    const wg = ctx.createLinearGradient(0, ground - wh, 0, ground);
    wg.addColorStop(0, tone(brick, -0.06));
    wg.addColorStop(0.15, brick);
    wg.addColorStop(1, tone(brick, 0.06));
    ctx.fillStyle = wg;
    ctx.fillRect(x - L, ground - wh, L * 2, wh + 2);
    for (let y = ground - wh + h * 0.02; y < ground; y += h * 0.012) rect(ctx, x - L, y, L * 2, Math.max(1, h * 0.002), courses);
    rect(ctx, x - L, ground - wh, L * 2, h * 0.025, tone(brick, -0.12));
    const mw = h * 0.018;
    for (let m = x - L; m < x + L - mw; m += mw * 2.1) {
      rect(ctx, m, ground - wh - h * 0.028, mw, h * 0.03, tone(brick, -0.05));
      rect(ctx, m + mw, ground - wh - h * 0.028, Math.max(1, h * 0.002), h * 0.03, tone(brick, -0.25));
    }
    for (let m = x - L + h * 0.05; m < x + L; m += h * 0.2) rect(ctx, m, ground - wh * 0.55, h * 0.012, h * 0.03, dark);
    rect(ctx, x - L, ground - h * 0.012, L * 2, h * 0.012, tone(brick, 0.15));

    // Square towers along the wall: brick shaft, a gallery of openings, grey pyramid roof.
    const square = (tx: number, w: number, bh: number, rh: number) => {
      const top = ground - bh;
      block(ctx, tx - w / 2, top, w, bh, brick, 0.32);
      for (let y = top + h * 0.02; y < ground; y += h * 0.012) rect(ctx, tx - w / 2, y, w, Math.max(1, h * 0.002), courses);
      rect(ctx, tx - w * 0.54, top, w * 1.08, h * 0.05, tone(brick, -0.04));
      for (let k = 0; k < 4; k++) rect(ctx, tx - w * 0.42 + k * w * 0.25, top + h * 0.012, w * 0.1, h * 0.026, dark);
      for (const t of [0.45, 0.7]) rect(ctx, tx - w * 0.04, top + bh * t, w * 0.08, h * 0.03, dark);
      const ew = w * 0.62;
      poly(ctx, [tx - ew, top + h * 0.002, tx, top - rh, tx + ew, top + h * 0.002], tone(metal, -0.12));
      poly(ctx, [tx, top + h * 0.002, tx, top - rh, tx + ew, top + h * 0.002], tone(metal, 0.12));
      line(ctx, tx, top - rh, tx, top - rh - h * 0.03, tone(metal, -0.4), Math.max(1, h * 0.003));
    };
    square(x + h * 0.6, h * 0.12, h * 0.27, h * 0.15);
    square(x + h * 1.25, h * 0.1, h * 0.24, h * 0.13);

    // The great round tower.
    const rx = x - h * 0.85;
    const w = h * 0.44;
    const bh = h * 0.5;
    const top = ground - bh;
    const tg = ctx.createLinearGradient(rx - w / 2, 0, rx + w / 2, 0);
    tg.addColorStop(0, tone(brick, -0.2));
    tg.addColorStop(0.35, tone(brick, -0.04));
    tg.addColorStop(0.7, tone(brick, 0.12));
    tg.addColorStop(1, tone(brick, 0.02));
    ctx.fillStyle = tg;
    ctx.fillRect(rx - w / 2, top, w, bh);
    for (let y = top + h * 0.02; y < ground; y += h * 0.012) rect(ctx, rx - w / 2, y, w, Math.max(1, h * 0.002), courses);
    for (let k = -3; k <= 3; k++) {
      const fx = rx + (w / 2) * Math.sin((k / 8) * Math.PI);
      rect(ctx, fx, top + h * 0.1, Math.max(1, h * 0.002), bh - h * 0.12, `rgba(90,40,20,${0.08 + Math.abs(k) * 0.02})`);
    }
    rect(ctx, rx - w / 2, ground - h * 0.03, w, h * 0.03, tone(brick, 0.14));
    // Narrow white-framed windows.
    for (const [fx, fy] of [
      [-0.3, 0.42],
      [0.05, 0.5],
      [0.32, 0.4],
      [-0.1, 0.25],
    ]) {
      const wx = rx + fx * w;
      const wy = top + bh * fy;
      arch(ctx, wx, wy, h * 0.026, h * 0.05, "#f0ebe2");
      arch(ctx, wx, wy - h * 0.004, h * 0.013, h * 0.038, dark);
    }
    // Gallery under the eaves: a slightly wider band with two rows of loopholes.
    const gw = w * 1.04;
    const gh = h * 0.085;
    const gg = ctx.createLinearGradient(rx - gw / 2, 0, rx + gw / 2, 0);
    gg.addColorStop(0, tone(brick, -0.16));
    gg.addColorStop(0.7, tone(brick, 0.1));
    gg.addColorStop(1, tone(brick, 0));
    ctx.fillStyle = gg;
    ctx.fillRect(rx - gw / 2, top - gh, gw, gh + 1);
    rect(ctx, rx - gw / 2, top, gw, h * 0.008, tone(brick, -0.25));
    for (let k = 0; k < 11; k++) {
      const u = (k + 0.5) / 11;
      const ox = rx - gw / 2 + u * gw;
      const sq = Math.sin(u * Math.PI); // openings narrow towards the sides of the drum
      rect(ctx, ox - h * 0.009 * sq, top - gh + h * 0.012, h * 0.018 * sq, h * 0.03, dark);
      rect(ctx, ox - h * 0.006 * sq, top - h * 0.03, h * 0.012 * sq, h * 0.02, dark);
    }
    // Tall cone of grey sheet metal with seams, a shadow under the eave, finial and flag.
    const ew = gw * 0.55;
    const eave = top - gh;
    const apex = eave - h * 0.44;
    const cg = ctx.createLinearGradient(rx - ew, 0, rx + ew, 0);
    cg.addColorStop(0, tone(metal, -0.25));
    cg.addColorStop(0.6, tone(metal, 0.18));
    cg.addColorStop(1, tone(metal, 0));
    ctx.fillStyle = cg;
    poly(ctx, [rx - ew, eave + h * 0.004, rx, apex, rx + ew, eave + h * 0.004]);
    for (let k = -5; k <= 5; k++) line(ctx, rx + (k / 5.5) * ew, eave, rx, apex, `rgba(40,45,50,${0.12 + Math.abs(k) * 0.015})`, Math.max(1, h * 0.002));
    rect(ctx, rx - ew, eave, ew * 2, h * 0.01, "rgba(30,25,20,0.35)");
    line(ctx, rx, apex, rx, apex - h * 0.05, tone(metal, -0.4), Math.max(1, h * 0.004));
    poly(ctx, [rx, apex - h * 0.05, rx + h * 0.03, apex - h * 0.044, rx, apex - h * 0.036], tone(metal, 0.2));
  },
  smolenskTown(ctx, x, b, h, c) {
    // Smolensk on its hills across the river: old two- and three-storey houses with red,
    // green and grey roofs, a few five-storey blocks and trees between them.
    const hill = (xx: number) => b - h * 0.22 * Math.max(0, 1 - ((xx - x) / (h * 1.5)) ** 2) - h * 0.05 * Math.sin((xx - x) / (h * 0.35));
    ctx.fillStyle = tone(c, 0.06);
    ctx.beginPath();
    ctx.moveTo(x - h * 1.6, b + 2);
    for (let xx = x - h * 1.6; xx <= x + h * 1.6; xx += h * 0.03) ctx.lineTo(xx, Math.min(b, hill(xx)));
    ctx.lineTo(x + h * 1.6, b + 2);
    ctx.fill();
    const wall = mix("#ece4d4", c, 0.45);
    const roofs = ["#a8503c", "#5f7f6a", "#7a7f88", "#8c5a3c"].map((r) => mix(r, c, 0.4));
    const rnd = (k: number) => {
      const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let k = 0; k < 26; k++) {
      const hx = x - h * 1.3 + k * h * 0.1 + rnd(k) * h * 0.04;
      const gy = Math.min(b, hill(hx)) + h * 0.01;
      if (rnd(k + 50) < 0.25) {
        ctx.fillStyle = tone(c, -0.08 + rnd(k + 9) * 0.1); // trees
        ctx.beginPath();
        ctx.arc(hx, gy - h * 0.035, h * (0.035 + rnd(k + 3) * 0.02), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const tall = rnd(k + 20) < 0.18;
      const w = h * (tall ? 0.11 : 0.06 + rnd(k + 30) * 0.03);
      const hh = h * (tall ? 0.13 : 0.045 + rnd(k + 40) * 0.035);
      block(ctx, hx - w / 2, gy - hh, w, hh, wall, 0.3);
      for (let wy = gy - hh + h * 0.015; wy < gy - h * 0.012; wy += h * 0.022)
        for (let wx = hx - w / 2 + h * 0.01; wx < hx + w / 2 - h * 0.008; wx += h * 0.018) rect(ctx, wx, wy, Math.max(1, h * 0.007), Math.max(1, h * 0.009), tone(wall, -0.35));
      if (!tall) {
        const r = roofs[k % roofs.length];
        poly(ctx, [hx - w * 0.58, gy - hh, hx, gy - hh - w * 0.38, hx + w * 0.58, gy - hh], r);
        poly(ctx, [hx, gy - hh, hx, gy - hh - w * 0.38, hx + w * 0.58, gy - hh], tone(r, 0.12));
      } else rect(ctx, hx - w / 2, gy - hh - h * 0.006, w, h * 0.006, tone(wall, -0.15));
    }
  },
  dneprBridge(ctx, x, b, h, c, a) {
    // The old concrete bridge over the Dnieper: low arches on piers, a railing and lamps.
    const stone = mix("#d9d5ca", c, 0.3);
    const deck = b - h * 0.13;
    const L = h * 1.15;
    const spans = 6;
    const sw = (2 * L) / spans;
    ctx.fillStyle = stone;
    ctx.beginPath();
    ctx.moveTo(x - L, b);
    ctx.lineTo(x - L, deck);
    ctx.lineTo(x + L, deck);
    ctx.lineTo(x + L, b);
    for (let i = spans - 1; i >= 0; i--) {
      const x1 = x - L + (i + 1) * sw - sw * 0.1;
      const x0 = x - L + i * sw + sw * 0.1;
      ctx.lineTo(x1, b);
      ctx.quadraticCurveTo((x0 + x1) / 2, b - h * 0.17, x0, b);
    }
    ctx.closePath();
    ctx.fill();
    rect(ctx, x - L, deck, 2 * L, h * 0.02, tone(stone, 0.15));
    rect(ctx, x - L, deck - h * 0.025, 2 * L, Math.max(1, h * 0.005), tone(stone, -0.2));
    for (let k = 0; k <= 40; k++) line(ctx, x - L + (k * 2 * L) / 40, deck, x - L + (k * 2 * L) / 40, deck - h * 0.025, tone(stone, -0.2), Math.max(1, h * 0.003));
    for (let k = 0; k <= spans; k++) {
      const px = x - L + k * sw;
      line(ctx, px, deck - h * 0.02, px, deck - h * 0.1, tone(stone, -0.35), Math.max(1, h * 0.005));
      glowDot(ctx, px, deck - h * 0.1, Math.max(1, h * 0.007), a);
    }
    const cars = ["#c0392b", "#ecf0f1", "#2c3e50", "#f1c40f"];
    for (let k = 0; k < 5; k++) rect(ctx, x - L * 0.8 + k * L * 0.37, deck - h * 0.035, h * 0.06, h * 0.025, cars[k % cars.length]);
  },
  monument1812(ctx, x, b, h, c) {
    // Cast-iron monument to the defenders of Smolensk in 1812: a gothic tower in three
    // tiers of pointed arches with pinnacles, rising to a gilded finial, on granite steps.
    const iron = mix("#2b2e33", c, 0.15);
    const lit = tone(iron, 0.25);
    const stone = mix("#9a9a94", c, 0.3);
    for (let k = 0; k < 3; k++) block(ctx, x - h * (0.2 - k * 0.04), b - h * (0.03 + k * 0.03), h * (0.4 - k * 0.08), h * 0.03, stone, 0.3);
    const base = b - h * 0.09;
    const tiers = [
      [0.15, 0.26],
      [0.11, 0.2],
      [0.075, 0.14],
    ] as const;
    let y = base;
    for (const [w, th] of tiers) {
      const half = h * w;
      block(ctx, x - half, y - h * th, half * 2, h * th, iron, 0.3);
      // Pointed arches with a lit outline.
      for (const s of [-0.5, 0, 0.5]) {
        const ax = x + s * half;
        const aw = half * 0.32;
        ctx.fillStyle = tone(iron, -0.4);
        ctx.beginPath();
        ctx.moveTo(ax - aw / 2, y - h * th * 0.12);
        ctx.lineTo(ax - aw / 2, y - h * th * 0.6);
        ctx.quadraticCurveTo(ax - aw / 2, y - h * th * 0.85, ax, y - h * th * 0.92);
        ctx.quadraticCurveTo(ax + aw / 2, y - h * th * 0.85, ax + aw / 2, y - h * th * 0.6);
        ctx.lineTo(ax + aw / 2, y - h * th * 0.12);
        ctx.fill();
        line(ctx, ax - aw / 2, y - h * th * 0.6, ax, y - h * th * 0.92, lit, Math.max(1, h * 0.003));
      }
      // Corner pinnacles.
      for (const s of [-1, 1]) {
        const px = x + s * half;
        poly(ctx, [px - h * 0.012, y - h * th, px, y - h * th - h * 0.06, px + h * 0.012, y - h * th], s > 0 ? lit : iron);
      }
      rect(ctx, x - half - h * 0.006, y - h * th, half * 2 + h * 0.012, h * 0.008, lit);
      y -= h * th;
    }
    poly(ctx, [x - h * 0.05, y, x, y - h * 0.26, x + h * 0.05, y], iron);
    poly(ctx, [x, y, x, y - h * 0.26, x + h * 0.05, y], lit);
    for (let k = 1; k < 6; k++) {
      const yy = y - h * 0.045 * k;
      const ww = h * 0.05 * (1 - k / 6);
      line(ctx, x - ww, yy, x - ww - h * 0.012, yy - h * 0.01, iron, Math.max(1, h * 0.003));
      line(ctx, x + ww, yy, x + ww + h * 0.012, yy - h * 0.01, lit, Math.max(1, h * 0.003));
    }
    glowDot(ctx, x, y - h * 0.27, Math.max(1.5, h * 0.012), "rgba(230,190,90,0.95)");
    // Low railing around it.
    for (let k = -6; k <= 6; k++) line(ctx, x + k * h * 0.04, b, x + k * h * 0.04, b - h * 0.03, iron, Math.max(1, h * 0.004));
    line(ctx, x - h * 0.24, b - h * 0.028, x + h * 0.24, b - h * 0.028, iron, Math.max(1, h * 0.004));
  },
  loveSign(ctx, x, b, h) {
    // The big "Я ❤ СМОЛЕНСК" letters on the lawn by the fortress.
    const size = Math.max(8, h * 0.16);
    ctx.font = `900 ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const parts: [string, string][] = [
      ["Я ", "#f4f4f2"],
      ["❤", "#e2453b"],
      [" СМОЛЕНСК", "#f4f4f2"],
    ];
    const total = parts.reduce((s, [t]) => s + ctx.measureText(t).width, 0);
    let px = x - total / 2;
    rect(ctx, x - total / 2 - h * 0.03, b - h * 0.02, total + h * 0.06, h * 0.02, "rgba(0,0,0,0.25)");
    for (const [t, col] of parts) {
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillText(t, px + size * 0.06, b - h * 0.015);
      ctx.fillStyle = col;
      ctx.fillText(t, px, b - h * 0.02);
      px += ctx.measureText(t).width;
    }
  },
  eagles(ctx, x, b, h, c) {
    // Monument to the heroes of 1812: a granite cliff with a bronze eagle guarding its nest.
    const rock = tone(c, 0.12);
    poly(ctx, [x - h * 0.3, b, x - h * 0.26, b - h * 0.2, x - h * 0.13, b - h * 0.33, x + h * 0.02, b - h * 0.38, x + h * 0.17, b - h * 0.31, x + h * 0.27, b - h * 0.17, x + h * 0.32, b], rock);
    poly(ctx, [x + h * 0.02, b - h * 0.38, x + h * 0.17, b - h * 0.31, x + h * 0.27, b - h * 0.17, x + h * 0.32, b, x + h * 0.08, b, x + h * 0.05, b - h * 0.2], tone(c, 0.28));
    for (const [x1, y1, x2, y2] of [
      [-0.2, -0.2, -0.08, -0.05],
      [0.1, -0.3, 0.16, -0.12],
      [-0.05, -0.33, -0.12, -0.18],
    ])
      line(ctx, x + x1 * h, b + y1 * h, x + x2 * h, b + y2 * h, tone(c, -0.15), Math.max(1, h * 0.004));
    const bronze = mix("#3f3a2c", c, 0.2);
    const ey = b - h * 0.38;
    for (const s of [-1, 1]) {
      const wx = x - h * 0.01;
      poly(ctx, [wx, ey - h * 0.15, wx + s * h * 0.12, ey - h * 0.34, wx + s * h * 0.3, ey - h * 0.46, wx + s * h * 0.25, ey - h * 0.36, wx + s * h * 0.31, ey - h * 0.35, wx + s * h * 0.22, ey - h * 0.24, wx + s * h * 0.27, ey - h * 0.22, wx + s * h * 0.12, ey - h * 0.12, wx, ey - h * 0.06], s > 0 ? tone(bronze, 0.15) : bronze);
    }
    // Body, chest and the head turned right with a pale hooked beak.
    ellipse(ctx, x - h * 0.01, ey - h * 0.1, h * 0.055, h * 0.11, 0.2, tone(bronze, -0.15));
    ellipse(ctx, x + h * 0.012, ey - h * 0.13, h * 0.03, h * 0.06, 0.2, tone(bronze, 0.25));
    ellipse(ctx, x + h * 0.03, ey - h * 0.22, h * 0.03, h * 0.026, 0, tone(bronze, 0.1));
    poly(ctx, [x + h * 0.05, ey - h * 0.23, x + h * 0.085, ey - h * 0.215, x + h * 0.06, ey - h * 0.195], "#b9a46a");
    poly(ctx, [x - h * 0.06, ey, x - h * 0.15, ey + h * 0.02, x - h * 0.05, ey - h * 0.04], bronze);
    ellipse(ctx, x - h * 0.12, ey + h * 0.01, h * 0.06, h * 0.015, 0, tone(bronze, -0.2));
  },
  smolenskBlonie(ctx, x, b, h, c, a) {
    // Blonie garden: the round bandstand (rotunda) under trees, and the Glinka monument.
    for (const [tx, r] of [
      [-0.55, 0.16],
      [-0.3, 0.2],
      [0.45, 0.18],
      [0.7, 0.14],
    ] as const) {
      line(ctx, x + tx * h, b, x + tx * h, b - h * r * 1.4, tone(c, -0.3), Math.max(1, h * 0.012));
      ellipse(ctx, x + tx * h, b - h * r * 1.8, h * r, h * r * 0.85, 0, tone(c, 0.05));
      ellipse(ctx, x + tx * h + h * r * 0.3, b - h * r * 1.9, h * r * 0.6, h * r * 0.5, 0, tone(c, 0.18));
    }
    const white = mix("#eeeae0", c, 0.3);
    rect(ctx, x - h * 0.17, b - h * 0.05, h * 0.34, h * 0.05, tone(white, -0.1));
    for (let k = 0; k < 7; k++) rect(ctx, x - h * 0.15 + k * h * 0.048, b - h * 0.3, Math.max(1, h * 0.012), h * 0.25, white);
    rect(ctx, x - h * 0.17, b - h * 0.33, h * 0.34, h * 0.03, white);
    ctx.fillStyle = mix("#5f7f72", c, 0.2);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.18, b - h * 0.33);
    ctx.quadraticCurveTo(x, b - h * 0.48, x + h * 0.18, b - h * 0.33);
    ctx.fill();
    glowDot(ctx, x, b - h * 0.2, Math.max(1, h * 0.008), a);
    // Glinka on a tall pedestal with the music-staff railing.
    const px = x + h * 0.2;
    block(ctx, px - h * 0.03, b - h * 0.2, h * 0.06, h * 0.2, tone(c, -0.2));
    ellipse(ctx, px, b - h * 0.24, h * 0.022, h * 0.04, 0, tone(c, -0.4));
    ellipse(ctx, px, b - h * 0.29, h * 0.012, h * 0.014, 0, tone(c, -0.4));
    for (let k = 0; k < 5; k++) line(ctx, px - h * 0.12, b - h * (0.01 + k * 0.012), px + h * 0.12, b - h * (0.01 + k * 0.012), tone(c, -0.35), Math.max(1, h * 0.002));
  },
  nationalLibrary(ctx, x, b, h, c, a) {
    // The "diamond": a rhombicuboctahedron on a stepped podium, its LED skin glowing.
    block(ctx, x - h * 0.55, b - h * 0.1, h * 1.1, h * 0.1, c, 0.2);
    windows(ctx, x - h * 0.54, b - h * 0.09, h * 1.08, h * 0.08, Math.max(1.2, h * 0.01), 13, WARM, 0.5);
    block(ctx, x - h * 0.34, b - h * 0.18, h * 0.68, h * 0.08, tone(c, 0.05), 0.25);
    const R = h * 0.38;
    const cy = b - h * 0.18 - R * 0.98;
    const k = 0.42;
    const P = (u: number, v: number) => [x + u * R, cy + v * R];
    const face = (pts: number[][], fill: string) => poly(ctx, pts.flat(), fill);
    face([P(-k, -k), P(k, -k), P(k, k), P(-k, k)], tone(c, 0.12));
    face([P(-k, -1), P(k, -1), P(k, -k), P(-k, -k)], tone(c, 0.28));
    face([P(-k, k), P(k, k), P(k, 1), P(-k, 1)], tone(c, -0.05));
    face([P(-1, -k), P(-k, -k), P(-k, k), P(-1, k)], tone(c, -0.02));
    face([P(k, -k), P(1, -k), P(1, k), P(k, k)], tone(c, 0.3));
    face([P(-k, -1), P(-k, -k), P(-1, -k)], tone(c, 0.15));
    face([P(k, -1), P(1, -k), P(k, -k)], tone(c, 0.38));
    face([P(-1, k), P(-k, k), P(-k, 1)], tone(c, -0.1));
    face([P(1, k), P(k, 1), P(k, k)], tone(c, 0.18));
    // LED skin: a color wash and a grid of dots.
    ctx.save();
    ctx.globalAlpha = 0.45;
    const lg = ctx.createLinearGradient(x, cy - R, x, cy + R);
    lg.addColorStop(0, a);
    lg.addColorStop(0.5, "#8d5cff");
    lg.addColorStop(1, "#2fd0ff");
    ctx.fillStyle = lg;
    poly(ctx, [P(-k, -1), P(k, -1), P(1, -k), P(1, k), P(k, 1), P(-k, 1), P(-1, k), P(-1, -k)].flat());
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let v = -0.9; v < 0.9; v += 0.12)
      for (let u = -0.9; u < 0.9; u += 0.1) if (Math.abs(u) + Math.abs(v) < 1.25) ctx.fillRect(x + u * R, cy + v * R, Math.max(1, h * 0.004), Math.max(1, h * 0.004));
    rect(ctx, x - h * 0.06, cy - R - h * 0.03, h * 0.12, h * 0.03, tone(c, 0.2));
    glowDot(ctx, x, cy - R - h * 0.04, Math.max(1, h * 0.006), "rgba(255,80,70,0.9)");
  },
  minskStela(ctx, x, b, h, c) {
    // Hero City stela: a granite bayonet with a golden star, reliefs at its foot, the flame.
    const stone = mix("#d9d6cf", c, 0.35);
    block(ctx, x - h * 0.22, b - h * 0.04, h * 0.44, h * 0.04, tone(stone, -0.15), 0.3);
    block(ctx, x - h * 0.1, b - h * 0.13, h * 0.2, h * 0.09, tone(stone, -0.05), 0.3);
    for (let k = 0; k < 5; k++) rect(ctx, x - h * 0.085 + k * h * 0.036, b - h * 0.115, h * 0.018, h * 0.05, tone(stone, -0.3));
    poly(ctx, [x - h * 0.05, b - h * 0.13, x - h * 0.006, b - h * 0.92, x + h * 0.006, b - h * 0.92, x + h * 0.05, b - h * 0.13], stone);
    poly(ctx, [x + h * 0.004, b - h * 0.13, x + h * 0.002, b - h * 0.92, x + h * 0.006, b - h * 0.92, x + h * 0.05, b - h * 0.13], tone(stone, 0.2));
    line(ctx, x, b - h * 0.15, x, b - h * 0.88, tone(stone, -0.3), Math.max(1, h * 0.003));
    star(ctx, x, b - h * 0.96, h * 0.04, "#e8c35a");
    const fire = ctx.createRadialGradient(x - h * 0.16, b - h * 0.06, 0, x - h * 0.16, b - h * 0.06, h * 0.05);
    fire.addColorStop(0, "rgba(255,220,130,0.95)");
    fire.addColorStop(1, "rgba(255,110,30,0)");
    ctx.fillStyle = fire;
    ctx.fillRect(x - h * 0.21, b - h * 0.11, h * 0.1, h * 0.1);
  },
  minskGates(ctx, x, b, h, c) {
    // Gates of Minsk: two stepped towers framing the station square, one with the big clock,
    // one with the coat of arms, rotundas and spires on top, low wings at the sides.
    const stone = mix("#e2d8c2", c, 0.35);
    for (const s of [-1, 1]) {
      block(ctx, x + s * h * 0.5 - h * 0.25, b - h * 0.3, h * 0.5, h * 0.3, stone, 0.2);
      windows(ctx, x + s * h * 0.5 - h * 0.24, b - h * 0.29, h * 0.48, h * 0.28, Math.max(1.2, h * 0.012), s > 0 ? 3 : 7, WARM, 0.45);
      const tx = x + s * h * 0.18;
      block(ctx, tx - h * 0.1, b - h * 0.62, h * 0.2, h * 0.62, stone, 0.3);
      windows(ctx, tx - h * 0.09, b - h * 0.6, h * 0.18, h * 0.58, Math.max(1.2, h * 0.012), s > 0 ? 11 : 13, WARM, 0.5);
      block(ctx, tx - h * 0.075, b - h * 0.74, h * 0.15, h * 0.12, stone, 0.3);
      rect(ctx, tx - h * 0.105, b - h * 0.625, h * 0.21, h * 0.015, tone(stone, 0.25));
      if (s < 0) {
        ellipse(ctx, tx, b - h * 0.68, h * 0.045, h * 0.045, 0, "#2e2a24");
        ellipse(ctx, tx, b - h * 0.68, h * 0.038, h * 0.038, 0, "#f3ecd6");
        line(ctx, tx, b - h * 0.68, tx, b - h * 0.705, "#222", Math.max(1, h * 0.005));
        line(ctx, tx, b - h * 0.68, tx + h * 0.02, b - h * 0.675, "#222", Math.max(1, h * 0.005));
      } else {
        ellipse(ctx, tx, b - h * 0.68, h * 0.04, h * 0.045, 0, "#b8402f");
        ellipse(ctx, tx, b - h * 0.675, h * 0.022, h * 0.025, 0, "#3f8f4f");
      }
      block(ctx, tx - h * 0.05, b - h * 0.84, h * 0.1, h * 0.1, stone, 0.3);
      for (let k = 0; k < 5; k++) rect(ctx, tx - h * 0.045 + k * h * 0.022, b - h * 0.83, Math.max(1, h * 0.008), h * 0.08, tone(stone, -0.4));
      ctx.fillStyle = tone(stone, 0.1);
      ctx.beginPath();
      ctx.ellipse(tx, b - h * 0.84, h * 0.05, h * 0.03, 0, Math.PI, 0);
      ctx.fill();
      line(ctx, tx, b - h * 0.87, tx, b - h * 0.96, "#d8b24a", Math.max(1, h * 0.006));
      star(ctx, tx, b - h * 0.97, h * 0.015, "#e8c35a");
    }
    rect(ctx, x - h * 0.08, b - h * 0.04, h * 0.16, h * 0.04, tone(stone, -0.25));
  },
  shipGoto(ctx, x, b, h, c, a) {
    // Peter the Great's 58-gun ship: black hull with ochre wales, red gunports, high stern,
    // three masts with yards and furled sails, rigging, flags, the stern lantern.
    const hull = mix("#231d19", c, 0.2);
    const ochre = mix("#c79a3c", c, 0.2);
    const L = h * 0.72;
    const deck = b - h * 0.2;
    ctx.fillStyle = hull;
    ctx.beginPath();
    ctx.moveTo(x - L, deck - h * 0.1);
    ctx.lineTo(x - L * 0.6, deck - h * 0.1);
    ctx.lineTo(x - L * 0.55, deck);
    ctx.lineTo(x + L * 0.72, deck);
    ctx.lineTo(x + L * 0.92, deck - h * 0.05);
    ctx.quadraticCurveTo(x + L * 0.85, b - h * 0.02, x + L * 0.5, b);
    ctx.lineTo(x - L * 0.7, b);
    ctx.quadraticCurveTo(x - L * 0.96, b - h * 0.06, x - L, deck - h * 0.1);
    ctx.fill();
    for (const y of [0.06, 0.13]) {
      ctx.strokeStyle = ochre;
      ctx.lineWidth = Math.max(1, h * 0.008);
      ctx.beginPath();
      ctx.moveTo(x - L * 0.92, deck + h * y - h * 0.02);
      ctx.quadraticCurveTo(x, deck + h * y + h * 0.015, x + L * 0.85, deck + h * y - h * 0.04);
      ctx.stroke();
    }
    for (let k = 0; k < 12; k++) {
      const gx = x - L * 0.75 + k * L * 0.13;
      rect(ctx, gx, deck + h * 0.075, h * 0.022, h * 0.022, "#9a2a20");
      rect(ctx, gx, deck + h * 0.02, h * 0.02, h * 0.02, "#9a2a20");
    }
    rect(ctx, x - L * 0.98, deck - h * 0.1, L * 0.4, h * 0.012, ochre);
    for (let k = 0; k < 4; k++) rect(ctx, x - L * 0.95 + k * L * 0.09, deck - h * 0.075, h * 0.025, h * 0.03, a);
    line(ctx, x + L * 0.85, deck - h * 0.04, x + L * 1.25, deck - h * 0.24, hull, Math.max(1, h * 0.01));
    const masts = [
      [-0.42, 0.8],
      [0.08, 0.92],
      [0.52, 0.74],
    ] as const;
    const lw = Math.max(1, h * 0.002);
    for (const [mx, mh] of masts) {
      const px = x + mx * L;
      const top = deck - h * mh;
      line(ctx, px, deck, px, top, hull, Math.max(1, h * 0.01));
      for (let k = 0; k < 3; k++) {
        const y = deck - h * mh * (0.35 + k * 0.25);
        const yw = h * (0.18 - k * 0.045);
        line(ctx, px - yw, y, px + yw, y, hull, Math.max(1, h * 0.005));
        rect(ctx, px - yw * 0.9, y - h * 0.006, yw * 1.8, h * 0.012, mix("#e6dcc4", c, 0.3));
        line(ctx, px - yw, y, px - L * 0.15, deck, tone(hull, 0.3), lw);
        line(ctx, px + yw, y, px + L * 0.15, deck, tone(hull, 0.3), lw);
      }
      poly(ctx, [px, top, px + h * 0.07, top + h * 0.01, px, top + h * 0.02], "#c8372d");
    }
    line(ctx, x + masts[0][0] * L, deck - h * masts[0][1], x + masts[1][0] * L, deck - h * masts[1][1], tone(hull, 0.3), lw);
    line(ctx, x + masts[1][0] * L, deck - h * masts[1][1], x + masts[2][0] * L, deck - h * masts[2][1], tone(hull, 0.3), lw);
    line(ctx, x + masts[2][0] * L, deck - h * masts[2][1], x + L * 1.25, deck - h * 0.24, tone(hull, 0.3), lw);
    line(ctx, x - L * 0.98, deck - h * 0.1, x - L * 0.98, deck - h * 0.24, hull, Math.max(1, h * 0.004));
    for (const [k, col] of ["#f2f2f2", "#2f5fb3", "#c8372d"].entries()) rect(ctx, x - L * 0.98 - h * 0.09, deck - h * (0.24 - k * 0.016), h * 0.09, h * 0.016, col);
    glowDot(ctx, x - L * 0.99, deck - h * 0.12, Math.max(1, h * 0.008), "rgba(255,220,140,0.95)");
  },
  riverBridge(ctx, x, b, h, c, a) {
    // Long beam bridge on round piers, lamp posts and traffic.
    const deck = b - h * 0.16;
    rect(ctx, x - h * 1.2, deck, h * 2.4, h * 0.035, c);
    rect(ctx, x - h * 1.2, deck, h * 2.4, Math.max(1, h * 0.006), tone(c, 0.35));
    rect(ctx, x - h * 1.2, deck - h * 0.02, h * 2.4, Math.max(1, h * 0.005), tone(c, 0.2));
    for (let k = -5; k <= 5; k++) {
      const px = x + k * h * 0.22;
      rect(ctx, px - h * 0.02, deck + h * 0.035, h * 0.04, b - deck, tone(c, -0.12));
      line(ctx, px, deck - h * 0.02, px, deck - h * 0.1, tone(c, -0.2), Math.max(1, h * 0.004));
      glowDot(ctx, px, deck - h * 0.1, Math.max(1, h * 0.007), a);
    }
    const cars = ["#d8d8d8", "#c0392b", "#2c3e50", "#f1c40f", "#7f8c8d"];
    for (let k = 0; k < 9; k++) rect(ctx, x - h * 1.05 + k * h * 0.25, deck - h * 0.035, h * 0.06, h * 0.025, cars[k % cars.length]);
  },
  railwayHQ(ctx, x, b, h, c) {
    // South-Eastern Railway administration: Stalinist block, central tower with clock and spire.
    const stone = mix("#e4d3b0", c, 0.35);
    block(ctx, x - h * 0.75, b - h * 0.3, h * 1.5, h * 0.3, stone, 0.2);
    windows(ctx, x - h * 0.74, b - h * 0.29, h * 1.48, h * 0.27, Math.max(1.2, h * 0.012), 19, WARM, 0.45);
    rect(ctx, x - h * 0.76, b - h * 0.31, h * 1.52, h * 0.02, tone(stone, 0.2));
    block(ctx, x - h * 0.2, b - h * 0.42, h * 0.4, h * 0.42, stone, 0.25);
    for (let k = 0; k < 6; k++) rect(ctx, x - h * 0.18 + k * h * 0.07, b - h * 0.4, Math.max(1, h * 0.014), h * 0.25, tone(stone, 0.3));
    block(ctx, x - h * 0.1, b - h * 0.6, h * 0.2, h * 0.18, stone, 0.3);
    ellipse(ctx, x, b - h * 0.53, h * 0.05, h * 0.05, 0, "#2e2a24");
    ellipse(ctx, x, b - h * 0.53, h * 0.042, h * 0.042, 0, "#f3ecd6");
    line(ctx, x, b - h * 0.53, x, b - h * 0.56, "#222", Math.max(1, h * 0.005));
    line(ctx, x, b - h * 0.53, x + h * 0.025, b - h * 0.53, "#222", Math.max(1, h * 0.005));
    block(ctx, x - h * 0.06, b - h * 0.7, h * 0.12, h * 0.1, stone, 0.3);
    for (let k = 0; k < 4; k++) rect(ctx, x - h * 0.05 + k * h * 0.03, b - h * 0.69, Math.max(1, h * 0.01), h * 0.08, tone(stone, -0.4));
    poly(ctx, [x - h * 0.035, b - h * 0.7, x, b - h * 0.92, x + h * 0.035, b - h * 0.7], "#cfae58");
    star(ctx, x, b - h * 0.94, h * 0.02, "#e8c35a");
  },
  russkyBridge(ctx, x, b, h, c, a) {
    stayBridge(ctx, x, b, h, c, a, "A", h * 1.35, tone(c, 0.45));
  },
  goldenBridge(ctx, x, b, h, c, a) {
    stayBridge(ctx, x, b, h, c, a, "V", h * 1.1, "rgba(240,200,110,0.8)");
  },
  submarine(ctx, x, b, h, c, a) {
    // S-56 on its embankment pedestal: long hull, conning tower with periscopes, deck gun.
    const steel = mix("#2e343a", c, 0.3);
    block(ctx, x - h * 0.6, b - h * 0.08, h * 1.2, h * 0.08, tone(c, 0.1), 0.2);
    for (const px of [-0.4, 0, 0.4]) rect(ctx, x + px * h - h * 0.04, b - h * 0.12, h * 0.08, h * 0.04, tone(c, -0.05));
    ctx.fillStyle = steel;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.7, b - h * 0.2);
    ctx.quadraticCurveTo(x - h * 0.4, b - h * 0.27, x + h * 0.3, b - h * 0.26);
    ctx.quadraticCurveTo(x + h * 0.72, b - h * 0.24, x + h * 0.75, b - h * 0.18);
    ctx.quadraticCurveTo(x + h * 0.5, b - h * 0.12, x - h * 0.6, b - h * 0.12);
    ctx.closePath();
    ctx.fill();
    rect(ctx, x - h * 0.5, b - h * 0.165, h * 1.1, h * 0.02, mix("#8c2a22", c, 0.3));
    block(ctx, x - h * 0.08, b - h * 0.38, h * 0.18, h * 0.13, tone(steel, 0.05), 0.3);
    poly(ctx, [x - h * 0.08, b - h * 0.38, x - h * 0.12, b - h * 0.26, x - h * 0.08, b - h * 0.26], tone(steel, 0.05));
    line(ctx, x - h * 0.02, b - h * 0.38, x - h * 0.02, b - h * 0.5, steel, Math.max(1, h * 0.008));
    line(ctx, x + h * 0.04, b - h * 0.38, x + h * 0.04, b - h * 0.46, steel, Math.max(1, h * 0.006));
    ctx.fillStyle = "#e9e5d6";
    ctx.font = `bold ${Math.max(6, h * 0.05)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("С-56", x + h * 0.01, b - h * 0.29);
    line(ctx, x + h * 0.22, b - h * 0.27, x + h * 0.3, b - h * 0.3, steel, Math.max(1, h * 0.012));
    glowDot(ctx, x + h * 0.01, b - h * 0.5, Math.max(1, h * 0.006), a);
  },
  operaNsk(ctx, x, b, h, c, a) {
    // Opera and Ballet Theatre: wide main block, colonnaded portico with sculptures, the
    // drum with windows and the great silver dome with ribs and a lantern.
    const stone = mix("#ddd2bc", c, 0.35);
    block(ctx, x - h * 0.85, b - h * 0.28, h * 1.7, h * 0.28, stone, 0.2);
    windows(ctx, x - h * 0.84, b - h * 0.27, h * 1.68, h * 0.25, Math.max(1.2, h * 0.012), 23, WARM, 0.4);
    rect(ctx, x - h * 0.86, b - h * 0.29, h * 1.72, h * 0.02, tone(stone, 0.2));
    const dg = ctx.createLinearGradient(x - h * 0.45, 0, x + h * 0.45, 0);
    dg.addColorStop(0, "#8e979e");
    dg.addColorStop(0.62, "#e8eef2");
    dg.addColorStop(1, "#aab3ba");
    block(ctx, x - h * 0.4, b - h * 0.46, h * 0.8, h * 0.18, stone, 0.25);
    for (let k = 0; k < 14; k++) rect(ctx, x - h * 0.37 + k * h * 0.054, b - h * 0.43, h * 0.022, h * 0.08, k % 2 ? a : tone(stone, -0.45));
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(x, b - h * 0.46, h * 0.44, h * 0.3, 0, Math.PI, 0);
    ctx.fill();
    ctx.strokeStyle = "rgba(90,100,110,0.55)";
    ctx.lineWidth = Math.max(1, h * 0.003);
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath();
      ctx.ellipse(x, b - h * 0.46, h * 0.44 * Math.abs(k / 4.5), h * 0.3, 0, Math.PI, 0);
      ctx.stroke();
    }
    for (const t of [0.35, 0.7]) {
      ctx.beginPath();
      ctx.ellipse(x, b - h * 0.46, h * 0.44 * Math.sqrt(1 - t * t), h * 0.3 * t, 0, Math.PI * 1.02, -0.02);
      ctx.stroke();
    }
    rect(ctx, x - h * 0.04, b - h * 0.8, h * 0.08, h * 0.05, "#d4dadf");
    ellipse(ctx, x, b - h * 0.8, h * 0.04, h * 0.02, 0, "#bfc7cd");
    // Portico in front.
    block(ctx, x - h * 0.3, b - h * 0.36, h * 0.6, h * 0.36, stone, 0.25);
    rect(ctx, x - h * 0.3, b - h * 0.36, h * 0.6, h * 0.05, tone(stone, 0.15));
    for (let k = 0; k < 8; k++) rect(ctx, x - h * 0.27 + k * h * 0.075, b - h * 0.31, h * 0.022, h * 0.27, tone(stone, 0.35));
    rect(ctx, x - h * 0.3, b - h * 0.04, h * 0.6, h * 0.04, tone(stone, -0.1));
    for (let k = 0; k < 5; k++) ellipse(ctx, x - h * 0.24 + k * h * 0.12, b - h * 0.38, h * 0.012, h * 0.025, 0, tone(stone, -0.3));
  },
  archBridge(ctx, x, b, h, c, a) {
    // Bugrinsky bridge: the red arch over the main span, hangers, approach spans on piers.
    const deck = b - h * 0.16;
    rect(ctx, x - h * 1.25, deck, h * 2.5, h * 0.035, c);
    rect(ctx, x - h * 1.25, deck, h * 2.5, Math.max(1, h * 0.006), tone(c, 0.35));
    for (let k = -5; k <= 5; k++) if (Math.abs(k) > 1) rect(ctx, x + k * h * 0.24 - h * 0.018, deck, h * 0.036, b - deck + 2, tone(c, -0.12));
    const red = "#c8402f";
    const at = (t: number) => [x - h * 0.75 + h * 1.5 * t, deck - h * 0.72 * 4 * t * (1 - t)] as const;
    ctx.strokeStyle = red;
    ctx.lineWidth = Math.max(2, h * 0.03);
    ctx.beginPath();
    for (let k = 0; k <= 30; k++) {
      const [ax, ay] = at(k / 30);
      if (k) ctx.lineTo(ax, ay);
      else ctx.moveTo(ax, ay);
    }
    ctx.stroke();
    for (let k = 1; k < 15; k++) {
      const [ax, ay] = at(k / 15);
      line(ctx, ax, ay, ax, deck, "rgba(240,240,240,0.7)", Math.max(1, h * 0.003));
    }
    for (let k = -10; k <= 10; k++) glowDot(ctx, x + k * h * 0.12, deck - h * 0.02, Math.max(1, h * 0.004), a);
  },
  nskStation(ctx, x, b, h, c) {
    // Novosibirsk-Glavny: aquamarine walls, the huge central arch of glass, side towers.
    const aqua = mix("#6fb7a8", c, 0.35);
    const white = mix("#efece4", c, 0.3);
    block(ctx, x - h * 0.9, b - h * 0.24, h * 1.8, h * 0.24, aqua, 0.2);
    windows(ctx, x - h * 0.88, b - h * 0.23, h * 1.76, h * 0.2, Math.max(1.2, h * 0.012), 29, WARM, 0.45);
    rect(ctx, x - h * 0.91, b - h * 0.25, h * 1.82, h * 0.02, white);
    block(ctx, x - h * 0.34, b - h * 0.56, h * 0.68, h * 0.56, aqua, 0.25);
    rect(ctx, x - h * 0.35, b - h * 0.57, h * 0.7, h * 0.03, white);
    arch(ctx, x, b, h * 0.46, h * 0.5, white);
    const gg = ctx.createLinearGradient(0, b - h * 0.48, 0, b);
    gg.addColorStop(0, "rgba(255,226,160,0.95)");
    gg.addColorStop(1, "rgba(150,190,220,0.8)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(x - h * 0.2, b);
    ctx.lineTo(x - h * 0.2, b - h * 0.27);
    ctx.arc(x, b - h * 0.27, h * 0.2, Math.PI, 0);
    ctx.lineTo(x + h * 0.2, b);
    ctx.fill();
    for (let k = -3; k <= 3; k++) line(ctx, x + k * h * 0.055, b, x + k * h * 0.055, b - h * 0.27 - Math.sqrt(Math.max(0, 0.04 - (k * 0.055) ** 2)) * h, "rgba(60,80,90,0.6)", Math.max(1, h * 0.003));
    for (const s of [-1, 1]) {
      const tx = x + s * h * 0.48;
      block(ctx, tx - h * 0.07, b - h * 0.42, h * 0.14, h * 0.42, aqua, 0.3);
      rect(ctx, tx - h * 0.075, b - h * 0.43, h * 0.15, h * 0.02, white);
      poly(ctx, [tx - h * 0.06, b - h * 0.43, tx, b - h * 0.52, tx + h * 0.06, b - h * 0.43], "#3e6f62");
      line(ctx, tx, b - h * 0.52, tx, b - h * 0.57, "#d8b24a", Math.max(1, h * 0.004));
    }
    rect(ctx, x - h * 0.15, b - h * 0.62, h * 0.3, h * 0.05, white);
    ctx.fillStyle = "#3a4a52";
    ctx.font = `bold ${Math.max(6, h * 0.035)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("НОВОСИБИРСК", x, b - h * 0.585);
  },
  groznyCity(ctx, x, b, h, c, a) {
    // Grozny-City: the Olympus tower with its clock and spire among glass towers with
    // LED-lit edges.
    const glass = (x0: number, w: number, th: number, seed: number, edge: string) => {
      const g = ctx.createLinearGradient(x0, 0, x0 + w, 0);
      g.addColorStop(0, tone(c, -0.02));
      g.addColorStop(0.7, tone(c, 0.14));
      g.addColorStop(1, tone(c, 0.24));
      ctx.fillStyle = g;
      ctx.fillRect(x0, b - th, w, th);
      windows(ctx, x0, b - th, w, th, Math.max(1.2, h * 0.009), seed, WARM, 0.32);
      rect(ctx, x0, b - th, Math.max(1, h * 0.005), th, edge);
      rect(ctx, x0 + w - Math.max(1, h * 0.005), b - th, Math.max(1, h * 0.005), th, edge);
      for (let y = b - th + h * 0.08; y < b; y += h * 0.08) rect(ctx, x0, y, w, Math.max(1, h * 0.003), edge);
    };
    glass(x - h * 0.6, h * 0.14, h * 0.5, 3, "rgba(120,255,170,0.7)");
    glass(x - h * 0.42, h * 0.14, h * 0.62, 5, "rgba(170,140,255,0.75)");
    glass(x + h * 0.14, h * 0.15, h * 0.7, 7, "rgba(120,200,255,0.75)");
    glass(x + h * 0.33, h * 0.13, h * 0.48, 9, "rgba(255,200,120,0.75)");
    // Olympus: stepped crown, clock faces, spire.
    const ox = x - h * 0.08;
    glass(ox, h * 0.18, h * 0.8, 11, a);
    block(ctx, ox + h * 0.02, b - h * 0.88, h * 0.14, h * 0.08, tone(c, 0.1), 0.35);
    ellipse(ctx, ox + h * 0.09, b - h * 0.84, h * 0.035, h * 0.035, 0, "#f3ecd6");
    line(ctx, ox + h * 0.09, b - h * 0.84, ox + h * 0.09, b - h * 0.862, "#222", Math.max(1, h * 0.004));
    line(ctx, ox + h * 0.09, b - h * 0.84, ox + h * 0.106, b - h * 0.84, "#222", Math.max(1, h * 0.004));
    block(ctx, ox + h * 0.05, b - h * 0.94, h * 0.08, h * 0.06, tone(c, 0.12), 0.35);
    line(ctx, ox + h * 0.09, b - h * 0.94, ox + h * 0.09, b - h * 1.06, tone(c, 0.35), Math.max(1, h * 0.006));
    glowDot(ctx, ox + h * 0.09, b - h * 1.06, Math.max(1, h * 0.007), "rgba(255,80,70,0.95)");
    rect(ctx, x - h * 0.65, b - h * 0.06, h * 1.15, h * 0.06, tone(c, -0.1));
  },
  akhmatArena(ctx, x, b, h, c, a) {
    stadium(ctx, x, b, h, c, a, "wave");
  },
  nnKremlin(ctx, x, b, h, c, a) {
    // Nizhny Novgorod Kremlin climbing the steep bank: swallowtail wall, round corner tower,
    // the Dmitrievskaya gate tower with its tent roof and golden flag.
    const brick = mix("#a2483a", c, 0.25);
    const roof = mix("#5a4a3e", c, 0.2);
    const g = (xx: number) => b - h * 0.4 * Math.min(1, Math.max(0, (xx - x + h * 0.85) / (h * 1.1))) - h * 0.02;
    ctx.fillStyle = tone(c, 0.06);
    ctx.beginPath();
    ctx.moveTo(x - h * 1.3, b + 2);
    for (let xx = x - h * 1.3; xx <= x + h * 1.3; xx += h * 0.04) ctx.lineTo(xx, g(xx));
    ctx.lineTo(x + h * 1.3, b + 2);
    ctx.fill();
    fortWall(ctx, x - h * 1.2, x + h * 1.2, g, h * 0.17, brick, true, h);
    fortTower(ctx, x - h * 0.95, g(x - h * 0.95), h * 0.16, h * 0.3, h * 0.17, brick, roof, true, h);
    fortTower(ctx, x - h * 0.3, g(x - h * 0.3), h * 0.15, h * 0.28, h * 0.15, brick, roof, false, h);
    const dx = x + h * 0.55;
    const top = fortTower(ctx, dx, g(dx), h * 0.2, h * 0.42, h * 0.16, brick, roof, false, h);
    arch(ctx, dx, g(dx), h * 0.08, h * 0.14, tone(brick, -0.55));
    block(ctx, dx - h * 0.035, top + h * 0.02, h * 0.07, h * 0.06, brick);
    poly(ctx, [dx - h * 0.045, top + h * 0.025, dx, top - h * 0.1, dx + h * 0.045, top + h * 0.025], tone(roof, 0.1));
    glowDot(ctx, dx, g(dx) - h * 0.1, Math.max(1, h * 0.006), a);
  },
  chkalovStairs(ctx, x, b, h, c, a) {
    // A figure-of-eight staircase down the green bank, lamps along it, the Chkalov monument.
    ctx.fillStyle = tone(c, 0.06);
    ctx.beginPath();
    ctx.moveTo(x - h * 0.9, b + 2);
    ctx.lineTo(x - h * 0.9, b - h * 0.5);
    ctx.quadraticCurveTo(x - h * 0.2, b - h * 0.52, x + h * 0.1, b - h * 0.25);
    ctx.quadraticCurveTo(x + h * 0.4, b - h * 0.02, x + h * 0.9, b);
    ctx.fill();
    const stone = mix("#e8e2d2", c, 0.3);
    ctx.strokeStyle = stone;
    ctx.lineWidth = Math.max(1.5, h * 0.016);
    for (const [cx, cy, rx, ry] of [
      [-0.22, -0.36, 0.2, 0.075],
      [0.12, -0.17, 0.24, 0.085],
    ]) {
      ctx.fillStyle = tone(c, 0.2); // lawn inside the loop
      ctx.beginPath();
      ctx.ellipse(x + cx * h, b + cy * h, rx * h, ry * h, 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.strokeStyle = tone(stone, -0.35);
    for (let k = 0; k < 30; k++) {
      const t = (k / 30) * Math.PI * 2;
      for (const [cx, cy, rx, ry] of [
        [-0.22, -0.36, 0.2, 0.075],
        [0.12, -0.17, 0.24, 0.085],
      ]) {
        const ex = x + cx * h + Math.cos(t) * rx * h * Math.cos(0.42) - Math.sin(t) * ry * h * Math.sin(0.42);
        const ey = b + cy * h + Math.cos(t) * rx * h * Math.sin(0.42) + Math.sin(t) * ry * h * Math.cos(0.42);
        line(ctx, ex - h * 0.008, ey, ex + h * 0.008, ey, tone(stone, -0.35), Math.max(1, h * 0.003));
        if (k % 5 === 0) glowDot(ctx, ex, ey - h * 0.03, Math.max(1, h * 0.005), a);
      }
    }
    const px = x - h * 0.55;
    block(ctx, px - h * 0.04, b - h * 0.68, h * 0.08, h * 0.18, tone(c, -0.25));
    ellipse(ctx, px, b - h * 0.73, h * 0.025, h * 0.05, 0, tone(c, -0.45));
    ellipse(ctx, px, b - h * 0.79, h * 0.014, h * 0.016, 0, tone(c, -0.45));
  },
  nnCableCar(ctx, x, b, h, c, a) {
    cableCar(ctx, x, b, h, c, a, -0.25);
  },
  nnStadium(ctx, x, b, h, c, a) {
    stadium(ctx, x, b, h, c, a, "columns");
  },
};

// Paints a layer's landmarks repeating every `span` px (positions wrap so strips tile).
export function drawMarks(ctx: Ctx, marks: Mark[], cells: (cw: number, fn: (i: number, x0: number) => void) => void, span: number, base: number, amp: number, color: string, accent: string) {
  cells(span, (_i, x0) => {
    for (const m of marks) DRAW[m.type](ctx, x0 + m.at * span, base, amp * m.size, color, accent);
  });
}
