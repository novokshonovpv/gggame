// Silhouettes of Russian landmarks for the city backdrops. Each drawer paints one landmark
// standing on baseline y = b, centered at x, about h px tall, in the layer's color c
// (accents such as stars, domes and lit windows in a).

export type MarkType =
  | "motherland" // Volgograd: "The Motherland Calls!" on Mamayev Kurgan
  | "kremlin" // Moscow: Spasskaya tower with the red star and Kremlin wall
  | "msu" // Moscow State University main building
  | "moscowCity" // Moscow-City skyscraper cluster
  | "ostankino" // Ostankino TV tower
  | "isetTowers" // Yekaterinburg: Iset tower and Vysotsky
  | "skiJumps" // Sochi: RusSki Gorki ski jumps
  | "mosque" // Makhachkala: Juma mosque (dome and two minarets)
  | "kulSharif" // Kazan: Kul Sharif mosque
  | "suyumbike" // Kazan: Söyembikä tower
  | "peterPaul" // St Petersburg: Peter and Paul Cathedral spire
  | "isaac" // St Petersburg: St Isaac's Cathedral dome
  | "lakhta" // St Petersburg: Lakhta Center
  | "drawbridge"; // St Petersburg: raised bascule bridge

export interface Mark {
  type: MarkType;
  at: number; // position inside the repeat span, 0..1
  size: number; // height as a share of the layer's amp
}

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, pts: number[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function star(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function dome(ctx: Ctx, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  ctx.bezierCurveTo(x - w / 2, y - h * 0.9, x - w * 0.1, y - h, x, y - h);
  ctx.bezierCurveTo(x + w * 0.1, y - h, x + w / 2, y - h * 0.9, x + w / 2, y);
  ctx.closePath();
  ctx.fill();
}

function windows(ctx: Ctx, x0: number, y0: number, w: number, h: number, cell: number, seed: number, a: string) {
  ctx.fillStyle = a;
  let k = seed;
  for (let y = y0 + cell; y < y0 + h - cell; y += cell * 2.2)
    for (let x = x0 + cell; x < x0 + w - cell; x += cell * 2) {
      k = (k * 9301 + 49297) % 233280;
      if (k / 233280 < 0.4) ctx.fillRect(x, y, cell, cell * 1.1);
    }
}

const DRAW: Record<MarkType, (ctx: Ctx, x: number, b: number, h: number, c: string, a: string) => void> = {
  motherland(ctx, x, b, h, c) {
    ctx.fillStyle = c;
    // Mamayev Kurgan, then the statue: robe, cloak blown back, arm forward, sword raised.
    poly(ctx, [x - h * 1.4, b, x - h * 0.6, b - h * 0.2, x + h * 0.5, b - h * 0.22, x + h * 1.3, b]);
    const t = b - h * 0.24;
    ctx.fillRect(x - h * 0.05, t - h * 0.05, h * 0.1, h * 0.06);
    poly(ctx, [x - h * 0.07, t - h * 0.04, x - h * 0.03, t - h * 0.58, x + h * 0.03, t - h * 0.58, x + h * 0.06, t - h * 0.04]);
    poly(ctx, [x - h * 0.02, t - h * 0.55, x - h * 0.2, t - h * 0.3, x - h * 0.26, t - h * 0.12, x - h * 0.08, t - h * 0.3]);
    poly(ctx, [x - h * 0.02, t - h * 0.55, x - h * 0.22, t - h * 0.5, x - h * 0.22, t - h * 0.47, x - h * 0.02, t - h * 0.5]);
    poly(ctx, [x + h * 0.02, t - h * 0.55, x + h * 0.11, t - h * 0.7, x + h * 0.13, t - h * 0.68, x + h * 0.04, t - h * 0.51]);
    poly(ctx, [x + h * 0.11, t - h * 0.7, x + h * 0.27, t - h * 0.98, x + h * 0.285, t - h * 0.97, x + h * 0.13, t - h * 0.68]);
    ctx.beginPath();
    ctx.arc(x, t - h * 0.62, h * 0.035, 0, Math.PI * 2);
    ctx.fill();
  },
  kremlin(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    // Wall with swallowtail merlons.
    const wallH = h * 0.2;
    ctx.fillRect(x - h * 0.9, b - wallH, h * 1.8, wallH);
    for (let m = x - h * 0.9; m < x + h * 0.9; m += h * 0.06) {
      poly(ctx, [m, b - wallH, m, b - wallH - h * 0.045, m + h * 0.012, b - wallH - h * 0.03, m + h * 0.024, b - wallH - h * 0.045, m + h * 0.024, b - wallH]);
    }
    // Spasskaya tower.
    ctx.fillRect(x - h * 0.09, b - h * 0.48, h * 0.18, h * 0.48);
    ctx.fillRect(x - h * 0.065, b - h * 0.62, h * 0.13, h * 0.15);
    ctx.fillRect(x - h * 0.045, b - h * 0.72, h * 0.09, h * 0.11);
    poly(ctx, [x - h * 0.045, b - h * 0.72, x, b - h * 0.94, x + h * 0.045, b - h * 0.72]);
    ctx.fillStyle = a;
    star(ctx, x, b - h * 0.97, h * 0.035);
    ctx.beginPath();
    ctx.arc(x, b - h * 0.55, h * 0.03, 0, Math.PI * 2);
    ctx.fill();
  },
  msu(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.6, b - h * 0.25, h * 1.2, h * 0.25);
    ctx.fillRect(x - h * 0.38, b - h * 0.36, h * 0.76, h * 0.12);
    for (const s of [-1, 1]) ctx.fillRect(x + s * h * 0.48 - h * 0.06, b - h * 0.42, h * 0.12, h * 0.18);
    ctx.fillRect(x - h * 0.14, b - h * 0.6, h * 0.28, h * 0.25);
    ctx.fillRect(x - h * 0.1, b - h * 0.7, h * 0.2, h * 0.11);
    ctx.fillRect(x - h * 0.065, b - h * 0.78, h * 0.13, h * 0.09);
    poly(ctx, [x - h * 0.04, b - h * 0.78, x, b - h * 0.97, x + h * 0.04, b - h * 0.78]);
    windows(ctx, x - h * 0.6, b - h * 0.25, h * 1.2, h * 0.25, Math.max(1.5, h * 0.015), 7, "rgba(255,214,140,0.75)");
    ctx.fillStyle = a;
    star(ctx, x, b - h * 0.99, h * 0.025);
  },
  moscowCity(ctx, x, b, h, c, a) {
    const towers = [
      [-0.42, 0.11, 0.62],
      [-0.28, 0.1, 0.82],
      [-0.15, 0.12, 0.74],
      [0, 0.13, 1],
      [0.15, 0.1, 0.9],
      [0.28, 0.11, 0.7],
      [0.42, 0.09, 0.55],
    ];
    towers.forEach(([dx, w, th], i) => {
      ctx.fillStyle = c;
      const x0 = x + dx * h - (w * h) / 2;
      if (i === 4) {
        // "Evolution": twisted, drawn as a slanted stack.
        for (let k = 0; k < 8; k++) ctx.fillRect(x0 + Math.sin(k * 0.6) * h * 0.012, b - th * h + (k * th * h) / 8, w * h, (th * h) / 8 + 1);
      } else ctx.fillRect(x0, b - th * h, w * h, th * h);
      if (i === 3) ctx.fillRect(x0 + (w * h) / 2 - 1, b - h * 1.08, 2, h * 0.08);
      windows(ctx, x0, b - th * h, w * h, th * h, Math.max(1.5, h * 0.012), 13 + i, a);
    });
  },
  ostankino(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    poly(ctx, [x - h * 0.07, b, x - h * 0.012, b - h * 0.55, x + h * 0.012, b - h * 0.55, x + h * 0.07, b]);
    ctx.fillRect(x - h * 0.005, b - h, h * 0.01, h * 0.45);
    ctx.beginPath();
    ctx.ellipse(x, b - h * 0.58, h * 0.03, h * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = a;
    ctx.fillRect(x - h * 0.02, b - h * 0.585, h * 0.04, h * 0.008);
  },
  isetTowers(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    // Iset: tall rounded-top tower; Vysotsky: stepped crown; plus lower blocks.
    ctx.fillRect(x - h * 0.06, b - h * 0.92, h * 0.12, h * 0.92);
    dome(ctx, x, b - h * 0.92, h * 0.12, h * 0.08);
    ctx.fillRect(x + h * 0.14, b - h * 0.7, h * 0.13, h * 0.7);
    ctx.fillRect(x + h * 0.16, b - h * 0.76, h * 0.09, h * 0.07);
    ctx.fillRect(x + h * 0.18, b - h * 0.8, h * 0.05, h * 0.05);
    ctx.fillRect(x - h * 0.3, b - h * 0.42, h * 0.16, h * 0.42);
    ctx.fillRect(x + h * 0.32, b - h * 0.36, h * 0.18, h * 0.36);
    windows(ctx, x - h * 0.06, b - h * 0.9, h * 0.12, h * 0.9, Math.max(1.5, h * 0.012), 3, a);
    windows(ctx, x + h * 0.14, b - h * 0.7, h * 0.13, h * 0.7, Math.max(1.5, h * 0.012), 5, a);
  },
  skiJumps(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    // Two jump ramps down the mountainside on stilts.
    for (const [dx, s] of [
      [0, 1],
      [h * 0.35, 0.75],
    ]) {
      const x0 = x + dx - h * 0.5 * s;
      const y0 = b - h * 0.95 * s;
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(2, h * 0.025);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + h * 0.45 * s, y0 + h * 0.5 * s, x0 + h * 0.75 * s, y0 + h * 0.62 * s);
      ctx.stroke();
      ctx.lineWidth = Math.max(1, h * 0.008);
      for (let k = 1; k < 5; k++) {
        const px = x0 + h * 0.15 * s * k;
        const py = y0 + h * 0.12 * s * k * (1 + k * 0.08);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px, b);
        ctx.stroke();
      }
      ctx.fillStyle = a;
      ctx.fillRect(x0 - h * 0.03, y0 - h * 0.06, h * 0.06, h * 0.06);
      ctx.fillStyle = c;
    }
  },
  mosque(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.3, b - h * 0.3, h * 0.6, h * 0.3);
    ctx.fillStyle = a;
    dome(ctx, x, b - h * 0.3, h * 0.36, h * 0.3);
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.01, b - h * 0.68, h * 0.02, h * 0.08);
    for (const s of [-1, 1]) {
      ctx.fillRect(x + s * h * 0.4 - h * 0.025, b - h * 0.85, h * 0.05, h * 0.85);
      poly(ctx, [x + s * h * 0.4 - h * 0.03, b - h * 0.85, x + s * h * 0.4, b - h * 1.0, x + s * h * 0.4 + h * 0.03, b - h * 0.85]);
    }
  },
  kulSharif(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.22, b - h * 0.32, h * 0.44, h * 0.32);
    ctx.fillRect(x - h * 0.1, b - h * 0.42, h * 0.2, h * 0.1);
    ctx.fillStyle = a;
    dome(ctx, x, b - h * 0.42, h * 0.22, h * 0.24);
    ctx.fillStyle = c;
    for (const dx of [-0.32, -0.2, 0.2, 0.32]) {
      ctx.fillRect(x + dx * h - h * 0.018, b - h * 0.88, h * 0.036, h * 0.88);
      ctx.fillRect(x + dx * h - h * 0.028, b - h * 0.6, h * 0.056, h * 0.02);
      ctx.fillStyle = a;
      poly(ctx, [x + dx * h - h * 0.022, b - h * 0.88, x + dx * h, b - h * 1.02, x + dx * h + h * 0.022, b - h * 0.88]);
      ctx.fillStyle = c;
    }
  },
  suyumbike(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    for (let k = 0; k < 6; k++) {
      const w = h * (0.2 - k * 0.025);
      ctx.fillRect(x - w / 2, b - h * (0.13 * (k + 1)), w, h * 0.13 + 1);
    }
    poly(ctx, [x - h * 0.03, b - h * 0.78, x, b - h * 0.97, x + h * 0.03, b - h * 0.78]);
    ctx.fillStyle = a;
    ctx.fillRect(x - h * 0.008, b - h * 1.0, h * 0.016, h * 0.03);
  },
  peterPaul(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.05, b - h * 0.16, h * 0.4, h * 0.16);
    ctx.fillRect(x - h * 0.06, b - h * 0.32, h * 0.12, h * 0.32);
    ctx.fillRect(x - h * 0.045, b - h * 0.42, h * 0.09, h * 0.11);
    ctx.fillStyle = a;
    poly(ctx, [x - h * 0.03, b - h * 0.42, x - h * 0.006, b - h * 0.97, x + h * 0.006, b - h * 0.97, x + h * 0.03, b - h * 0.42]);
    ctx.fillRect(x - h * 0.015, b - h * 1.0, h * 0.03, h * 0.008);
  },
  isaac(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    ctx.fillRect(x - h * 0.42, b - h * 0.3, h * 0.84, h * 0.3);
    poly(ctx, [x - h * 0.2, b - h * 0.3, x, b - h * 0.38, x + h * 0.2, b - h * 0.3]);
    ctx.fillRect(x - h * 0.16, b - h * 0.5, h * 0.32, h * 0.2);
    ctx.fillStyle = a;
    dome(ctx, x, b - h * 0.5, h * 0.34, h * 0.26);
    ctx.fillRect(x - h * 0.025, b - h * 0.85, h * 0.05, h * 0.1);
    for (const s of [-1, 1]) dome(ctx, x + s * h * 0.34, b - h * 0.3, h * 0.08, h * 0.08);
    ctx.fillStyle = c;
    for (let k = -3; k <= 3; k++) ctx.fillRect(x + k * h * 0.045 - 1, b - h * 0.5, Math.max(1, h * 0.008), h * 0.2);
  },
  lakhta(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    poly(ctx, [x - h * 0.07, b, x - h * 0.01, b - h * 0.96, x, b - h * 1.02, x + h * 0.01, b - h * 0.96, x + h * 0.07, b]);
    ctx.strokeStyle = a;
    ctx.lineWidth = Math.max(1, h * 0.006);
    for (let k = 1; k < 8; k++) {
      const y = b - (h * k) / 8;
      const w = h * 0.07 * (1 - k / 8.5);
      ctx.beginPath();
      ctx.moveTo(x - w, y + h * 0.02);
      ctx.lineTo(x + w, y - h * 0.02);
      ctx.stroke();
    }
  },
  drawbridge(ctx, x, b, h, c, a) {
    ctx.fillStyle = c;
    // Piers, the raised leaves and the fixed spans either side.
    ctx.fillRect(x - h * 0.9, b - h * 0.16, h * 0.55, h * 0.06);
    ctx.fillRect(x + h * 0.35, b - h * 0.16, h * 0.55, h * 0.06);
    for (const s of [-1, 1]) {
      ctx.fillRect(x + s * h * 0.32 - h * 0.05, b - h * 0.2, h * 0.1, h * 0.2);
      ctx.save();
      ctx.translate(x + s * h * 0.3, b - h * 0.14);
      ctx.rotate(s * -1.0);
      ctx.fillRect(s > 0 ? -h * 0.42 : 0, -h * 0.025, h * 0.42, h * 0.05);
      ctx.restore();
    }
    ctx.fillStyle = a;
    for (const dx of [-0.75, -0.55, 0.55, 0.75]) ctx.fillRect(x + dx * h, b - h * 0.24, Math.max(1.5, h * 0.01), h * 0.08);
  },
};

// Paints a layer's landmarks repeating every `span` px (positions wrap so strips tile).
export function drawMarks(ctx: Ctx, marks: Mark[], cells: (cw: number, fn: (i: number, x0: number) => void) => void, span: number, base: number, amp: number, color: string, accent: string) {
  cells(span, (_i, x0) => {
    for (const m of marks) DRAW[m.type](ctx, x0 + m.at * span, base, amp * m.size, color, accent);
  });
}
