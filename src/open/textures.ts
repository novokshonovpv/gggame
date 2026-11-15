import * as THREE from "three";

// Procedural textures for the open world, painted once on canvases: tileable fractal noise
// for grass, dirt, rock and sand, bark, pine branches and birch leaves with alpha, grass
// blades, a water normal map, advertising boards and flags.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(ix: number, iy: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Value noise that repeats every `period` cells.
function tnoise(x: number, y: number, period: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const m = (k: number) => ((k % period) + period) % period;
  const a = hash(m(ix), m(iy), seed);
  const b = hash(m(ix + 1), m(iy), seed);
  const c = hash(m(ix), m(iy + 1), seed);
  const d = hash(m(ix + 1), m(iy + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tileable fBm over a size×size image, 0..1.
export function fbmField(size: number, base: number, octaves: number, seed: number, gain = 0.5) {
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let amp = 1;
      let sum = 0;
      let norm = 0;
      let p = base;
      for (let o = 0; o < octaves; o++) {
        sum += amp * tnoise((x / size) * p, (y / size) * p, p, seed + o * 17);
        norm += amp;
        amp *= gain;
        p *= 2;
      }
      out[y * size + x] = sum / norm;
    }
  return out;
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

export function tex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

type RGB = [number, number, number];
const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Paint a noise field through a colour ramp.
function rampPaint(size: number, field: Float32Array, stops: [number, string][], detail?: Float32Array, detailAmt = 0) {
  const { c, ctx } = canvas(size, size);
  const img = ctx.createImageData(size, size);
  const cols = stops.map(([t, s]) => [t, hex(s)] as [number, RGB]);
  for (let i = 0; i < size * size; i++) {
    const f = field[i];
    let k = 0;
    while (k < cols.length - 2 && f > cols[k + 1][0]) k++;
    const [t0, c0] = cols[k];
    const [t1, c1] = cols[k + 1];
    let col = mix(c0, c1, Math.max(0, Math.min(1, (f - t0) / (t1 - t0))));
    if (detail) {
      const d = 1 + (detail[i] - 0.5) * detailAmt;
      col = [col[0] * d, col[1] * d, col[2] * d];
    }
    img.data[i * 4] = col[0];
    img.data[i * 4 + 1] = col[1];
    img.data[i * 4 + 2] = col[2];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { c, ctx };
}

// Wrap-around drawing: whatever spills over an edge comes back on the other side.
function wrapDraw(_ctx: CanvasRenderingContext2D, size: number, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size])
    for (const dy of [-size, 0, size]) {
      const px = x + dx;
      const py = y + dy;
      if (px > -40 && px < size + 40 && py > -40 && py < size + 40) draw(px, py);
    }
}

export function grassTexture() {
  const S = 512;
  const { c, ctx } = rampPaint(S, fbmField(S, 4, 5, 3), [
    [0, "#33561c"],
    [0.45, "#466f25"],
    [0.6, "#58802e"],
    [1, "#6f8a3a"],
  ], fbmField(S, 32, 2, 4), 0.35);
  const r = rng(5);
  // Blades: thin strokes, light and dark.
  for (let i = 0; i < 9000; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 3 + r() * 7;
    const a = -Math.PI / 2 + (r() - 0.5) * 0.9;
    const light = r() < 0.5;
    ctx.strokeStyle = light ? `rgba(${150 + r() * 60},${170 + r() * 50},${80 + r() * 40},0.45)` : `rgba(${30 + r() * 20},${55 + r() * 20},${20},0.5)`;
    ctx.lineWidth = 0.8 + r() * 0.8;
    wrapDraw(ctx, S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len);
      ctx.stroke();
    });
  }
  // A few dry patches and clover.
  for (let i = 0; i < 120; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.fillStyle = r() < 0.5 ? "rgba(150,140,80,0.18)" : "rgba(40,80,30,0.22)";
    wrapDraw(ctx, S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.ellipse(px, py, 4 + r() * 10, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return tex(c);
}

export function dirtTexture(wet = false) {
  const S = 512;
  const { c, ctx } = rampPaint(S, fbmField(S, 5, 5, wet ? 41 : 11), wet
    ? [
        [0, "#3b2c1e"],
        [0.5, "#4f3b28"],
        [1, "#6b5038"],
      ]
    : [
        [0, "#5e4329"],
        [0.4, "#7a5a3a"],
        [0.65, "#8f6d48"],
        [1, "#a6835a"],
      ], fbmField(S, 48, 2, 12), 0.4);
  const r = rng(wet ? 43 : 13);
  // Pebbles with a lit top and a shadow.
  for (let i = 0; i < (wet ? 200 : 650); i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 0.8 + r() * r() * 4;
    const g = 95 + r() * 55;
    wrapDraw(ctx, S, x, y, (px, py) => {
      ctx.fillStyle = "rgba(30,20,10,0.45)";
      ctx.beginPath();
      ctx.ellipse(px + rad * 0.3, py + rad * 0.35, rad, rad * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgb(${g},${g * 0.92},${g * 0.82})`;
      ctx.beginPath();
      ctx.ellipse(px, py, rad, rad * 0.8, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (wet)
    for (let i = 0; i < 60; i++) {
      // Glossy puddles.
      const x = r() * S;
      const y = r() * S;
      ctx.fillStyle = "rgba(20,14,8,0.35)";
      wrapDraw(ctx, S, x, y, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, 6 + r() * 18, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  return tex(c);
}

export function rockTexture() {
  const S = 512;
  const { c, ctx } = rampPaint(S, fbmField(S, 6, 6, 21, 0.55), [
    [0, "#55534f"],
    [0.45, "#7c7a74"],
    [0.7, "#96938b"],
    [1, "#b5b1a6"],
  ], fbmField(S, 64, 2, 22), 0.3);
  const r = rng(23);
  ctx.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    let x = r() * S;
    let y = r() * S;
    ctx.strokeStyle = `rgba(30,28,26,${0.35 + r() * 0.3})`;
    ctx.lineWidth = 0.7 + r() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * 30;
      y += (r() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Lichen.
  for (let i = 0; i < 160; i++) {
    const x = r() * S;
    const y = r() * S;
    ctx.fillStyle = r() < 0.6 ? "rgba(150,160,90,0.3)" : "rgba(200,190,140,0.25)";
    wrapDraw(ctx, S, x, y, (px, py) => {
      ctx.beginPath();
      ctx.arc(px, py, 1 + r() * 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  return tex(c);
}

export function sandTexture() {
  const S = 256;
  const { c } = rampPaint(S, fbmField(S, 6, 5, 31), [
    [0, "#8e7a58"],
    [0.5, "#ad9670"],
    [1, "#c7b08a"],
  ], fbmField(S, 64, 2, 32), 0.3);
  return tex(c);
}

export function barkTexture(birch: boolean) {
  const W = 128;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  const r = rng(birch ? 51 : 52);
  if (birch) {
    ctx.fillStyle = "#e9e6dc";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${200 + r() * 40},${195 + r() * 40},${180 + r() * 40},0.5)`;
      ctx.fillRect(r() * W, r() * H, 2 + r() * 20, 1 + r() * 2);
    }
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(25,22,20,${0.6 + r() * 0.4})`;
      const y = r() * H;
      const w = 6 + r() * 34;
      const x = r() * W;
      ctx.fillRect(x, y, w, 1 + r() * 4);
      if (x + w > W) ctx.fillRect(x - W, y, w, 2);
    }
  } else {
    // Pine: rust-brown plates split by dark furrows.
    const f = fbmField(W, 4, 4, 53);
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const n = f[((y >> 2) % W) * W + x];
        const furrow = Math.abs(Math.sin((x / W) * Math.PI * 14 + n * 6));
        const v = 0.35 + 0.65 * Math.pow(furrow, 0.4);
        const o = (y * W + x) * 4;
        img.data[o] = (90 + n * 70) * v;
        img.data[o + 1] = (58 + n * 40) * v;
        img.data[o + 2] = (38 + n * 22) * v;
        img.data[o + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(${150 + r() * 50},${90 + r() * 30},${50},0.35)`;
      ctx.fillRect(r() * W, r() * H, 4 + r() * 10, 6 + r() * 20);
    }
  }
  return tex(c);
}

// A spruce branch seen from above: a stem with needle twigs, on transparent.
export function branchTexture() {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const r = rng(61);
  ctx.lineCap = "round";
  const twig = (x0: number, y0: number, ang: number, len: number, w: number) => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    ctx.strokeStyle = "#3b2a1a";
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const n = Math.floor(len / 2.2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      for (const s of [-1, 1]) {
        const na = ang + s * (0.9 + r() * 0.3);
        const nl = (5 + r() * 4) * (1 - t * 0.5);
        const g = 60 + r() * 50;
        ctx.strokeStyle = `rgb(${g * 0.45},${g},${g * 0.4})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl);
        ctx.stroke();
      }
    }
  };
  // Main stem from the left middle to the right, side twigs, more twigs near the tip.
  twig(4, S / 2, 0, S - 16, 3);
  for (let i = 0; i < 16; i++) {
    const t = 0.08 + (i / 16) * 0.85;
    const x = 4 + t * (S - 20);
    const side = i % 2 ? 1 : -1;
    const len = (1 - t) * 70 + 18;
    twig(x, S / 2, side * (0.55 + r() * 0.25), len, 1.6);
  }
  const t = tex(c, false);
  return t;
}

// A cluster of birch leaves on transparent.
export function leafTexture() {
  const S = 256;
  const { c, ctx } = canvas(S, S);
  const r = rng(71);
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * S * 0.42;
    const x = S / 2 + Math.cos(a) * d;
    const y = S / 2 + Math.sin(a) * d;
    const g = 0.75 + r() * 0.5;
    ctx.fillStyle = `rgb(${(70 + r() * 40) * g},${(120 + r() * 50) * g},${(40 + r() * 20) * g})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r() * Math.PI * 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 7 + r() * 4, 4.5 + r() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(40,70,20,0.5)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(7, 0);
    ctx.stroke();
    ctx.restore();
  }
  return tex(c, false);
}

// Grass blades for the instanced tufts.
export function bladesTexture() {
  const W = 256;
  const H = 128;
  const { c, ctx } = canvas(W, H);
  const r = rng(81);
  for (let i = 0; i < 70; i++) {
    const x = 8 + r() * (W - 16);
    const h = H * (0.45 + r() * 0.55);
    const lean = (r() - 0.5) * 30;
    const w = 2.5 + r() * 3;
    const g = 0.7 + r() * 0.5;
    const grad = ctx.createLinearGradient(0, H, 0, H - h);
    grad.addColorStop(0, `rgb(${40 * g},${70 * g},${25 * g})`);
    grad.addColorStop(1, `rgb(${(85 + r() * 40) * g},${(125 + r() * 40) * g},${(45 + r() * 25) * g})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w, H);
    ctx.quadraticCurveTo(x + lean * 0.3, H - h * 0.6, x + lean, H - h);
    ctx.quadraticCurveTo(x + lean * 0.3 + w * 0.3, H - h * 0.6, x + w, H);
    ctx.closePath();
    ctx.fill();
  }
  // A few seed heads and flowers.
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = r() < 0.5 ? "#d8d2a8" : r() < 0.5 ? "#d9c34a" : "#c8b8e8";
    ctx.beginPath();
    ctx.arc(10 + r() * (W - 20), H * (0.1 + r() * 0.3), 2.5 + r() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c, false);
}

// Water normals from a noise height field.
export function waterNormals() {
  const S = 256;
  const h = fbmField(S, 8, 4, 91, 0.55);
  const { c, ctx } = canvas(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const nx = -dx * 6;
      const ny = -dy * 6;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * S + x) * 4;
      img.data[o] = (nx / l) * 127 + 128;
      img.data[o + 1] = (ny / l) * 127 + 128;
      img.data[o + 2] = (1 / l) * 127 + 128;
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return tex(c, true, false);
}

// Cloud cover for the sky dome: white with alpha from noise.
export function cloudTexture() {
  const W = 512;
  const H = 128;
  const f = fbmField(W, 6, 6, 101, 0.55);
  const { c, ctx } = canvas(W, H);
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = f[(y * 4) * W + x];
      const a = Math.max(0, Math.min(1, (v - 0.5) * 3.2));
      const shade = 235 - Math.max(0, v - 0.6) * 160;
      const o = (y * W + x) * 4;
      img.data[o] = shade;
      img.data[o + 1] = shade;
      img.data[o + 2] = shade + 6;
      img.data[o + 3] = a * 255 * Math.min(1, (y / H) * 2.5);
    }
  ctx.putImageData(img, 0, 0);
  const t = tex(c, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// Advertising boards: made-up sponsors in the style of a race venue.
export const ADS: { text: string; sub?: string; bg: string; fg: string; accent?: string }[] = [
  { text: "MOTO TRIALS", sub: "открытый мир", bg: "#11161f", fg: "#ffb21a", accent: "#ffffff" },
  { text: "ENDURO ZONE", sub: "клуб эндуро", bg: "#e8e2d4", fg: "#1a1a1a", accent: "#d9381e" },
  { text: "BSE", sub: "MOTORCYCLES", bg: "#c8202a", fg: "#ffffff", accent: "#111111" },
  { text: "ТАЙГА ШИНА", sub: "грязевая резина", bg: "#1f3a2a", fg: "#e7f2d8", accent: "#a6d16a" },
  { text: "ГРЯЗЬ & ГАЗ", sub: "масла и смазки", bg: "#f2c418", fg: "#151515", accent: "#151515" },
  { text: "ЛЕСНОЙ КРОСС", sub: "кубок сезона", bg: "#0e4c8a", fg: "#ffffff", accent: "#7ec8ff" },
  { text: "КАМЕНЬ", sub: "защита и экипировка", bg: "#2a2a2e", fg: "#e7e7e7", accent: "#ff6a00" },
  { text: "ЭНДУРО-КРОСС", sub: "стадион", bg: "#ffffff", fg: "#0e4c8a", accent: "#d9381e" },
];

export function adTexture(i: number, w = 1024, h = 384) {
  const ad = ADS[i % ADS.length];
  const { c, ctx } = canvas(w, h);
  ctx.fillStyle = ad.bg;
  ctx.fillRect(0, 0, w, h);
  // Diagonal stripes for energy.
  ctx.fillStyle = ad.accent ?? ad.fg;
  ctx.globalAlpha = 0.18;
  for (let x = -h; x < w; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 40, h);
    ctx.lineTo(x + 40 + h * 0.6, 0);
    ctx.lineTo(x + h * 0.6, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = ad.accent ?? ad.fg;
  ctx.fillRect(0, h - 26, w, 26);
  ctx.fillStyle = ad.fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `italic 900 ${Math.round(h * 0.42)}px system-ui, Arial, sans-serif`;
  ctx.fillText(ad.text, w / 2, h * 0.42, w * 0.9);
  if (ad.sub) {
    ctx.font = `700 ${Math.round(h * 0.13)}px system-ui, Arial, sans-serif`;
    ctx.fillText(ad.sub.toUpperCase(), w / 2, h * 0.75, w * 0.8);
  }
  const t = tex(c, false);
  return t;
}

// Flag designs in a 4×2 atlas.
export function flagAtlas() {
  const W = 1024;
  const H = 512;
  const { c, ctx } = canvas(W, H);
  const cw = W / 4;
  const ch = H / 2;
  const designs: ((x: number, y: number) => void)[] = [
    (x, y) => {
      // Chequered.
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 6; j++) {
          ctx.fillStyle = (i + j) % 2 ? "#111" : "#f4f4f4";
          ctx.fillRect(x + (i * cw) / 8, y + (j * ch) / 6, cw / 8 + 1, ch / 6 + 1);
        }
    },
    (x, y) => {
      ctx.fillStyle = "#ffb21a";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#11161f";
      ctx.font = "italic 900 54px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.fillText("MOTO", x + cw / 2, y + ch * 0.45);
      ctx.fillText("TRIALS", x + cw / 2, y + ch * 0.75);
    },
    (x, y) => {
      ctx.fillStyle = "#c8202a";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#fff";
      ctx.font = "italic 900 96px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.fillText("BSE", x + cw / 2, y + ch * 0.66);
    },
    (x, y) => {
      ctx.fillStyle = "#0e4c8a";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y + ch * 0.4, cw, ch * 0.2);
      ctx.fillStyle = "#d9381e";
      ctx.fillRect(x, y + ch * 0.46, cw, ch * 0.08);
    },
    (x, y) => {
      ctx.fillStyle = "#e8e2d4";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#1a1a1a";
      ctx.font = "italic 900 44px system-ui, Arial";
      ctx.textAlign = "center";
      ctx.fillText("ENDURO", x + cw / 2, y + ch * 0.45);
      ctx.fillStyle = "#d9381e";
      ctx.fillText("ZONE", x + cw / 2, y + ch * 0.75);
    },
    (x, y) => {
      ctx.fillStyle = "#1f3a2a";
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = "#a6d16a";
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(x + 30, y + ch - 30);
      ctx.lineTo(x + cw / 2, y + 40);
      ctx.lineTo(x + cw - 30, y + ch - 30);
      ctx.stroke();
    },
    (x, y) => {
      ctx.fillStyle = "#f2c418";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#151515";
      for (let i = 0; i < 5; i++) ctx.fillRect(x + i * (cw / 5) + 10, y, cw / 10, ch);
    },
    (x, y) => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = "#0e4c8a";
      ctx.beginPath();
      ctx.arc(x + cw / 2, y + ch / 2, ch * 0.32, 0, Math.PI * 2);
      ctx.fill();
    },
  ];
  designs.forEach((d, i) => d((i % 4) * cw, Math.floor(i / 4) * ch));
  return tex(c, false);
}
