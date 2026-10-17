export interface Pt {
  x: number;
  y: number;
}

export type ThemeId =
  | "ekaterinburg"
  | "moscow"
  | "sochi"
  | "makhachkala"
  | "kazan"
  | "spb"
  | "smolensk"
  | "minsk"
  | "voronezh"
  | "vladivostok"
  | "novosibirsk"
  | "grozny"
  | "nizhny";

export interface Track {
  id: string;
  name: string;
  theme: ThemeId;
  laps: number;
  grip: number; // ground friction: dirt 0.9, sand and snow less
  stars: number; // mission stars needed to unlock
  points: Pt[];
  startX: number;
  finishX: number;
}

const STEP = 0.4;

// Deterministic RNG so every track (and its decorations) is the same on every run.
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

// Builds a continuous ground polyline from MX-style features. Heights are in meters;
// the bike with rider is ~2 m tall, so MSM-sized hills are 3–8 m.
class Builder {
  pts: Pt[] = [];
  x = 0;
  y = 0;
  rand: () => number;

  constructor(seed: number) {
    this.rand = rng(seed);
    this.pts.push({ x: -40, y: 40 }, { x: -40, y: 0 }, { x: 0, y: 0 });
  }

  private add(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.pts.push({ x, y });
  }

  // Samples f(t) for t in (0,1], f returns height offset from the feature's start.
  private shape(len: number, f: (t: number) => number) {
    const x0 = this.x;
    const y0 = this.y;
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.add(x0 + len * t, y0 + f(t));
    }
    return this;
  }

  flat(len: number) {
    return this.shape(len, () => 0);
  }

  // Natural uneven ground: a few soft random undulations that start and end level.
  rough(len: number, amp = 0.35) {
    const waves = [0, 1, 2].map(() => ({
      k: 1 + Math.floor(this.rand() * 4),
      p: this.rand() * Math.PI * 2,
      a: amp * (0.4 + this.rand() * 0.6),
    }));
    return this.shape(len, (t) => {
      const w = Math.sin(Math.PI * t);
      return w * waves.reduce((s, v) => s + v.a * Math.sin(v.k * Math.PI * t + v.p) * Math.sin(v.k * Math.PI * t), 0);
    });
  }

  // Smooth S-curve change of height (ease in and out).
  slope(len: number, dy: number) {
    return this.shape(len, (t) => (dy * (1 - Math.cos(Math.PI * t))) / 2);
  }

  // Kicker face: gets steeper towards the lip.
  lip(len: number, h: number) {
    return this.shape(len, (t) => h * (1 - Math.cos((Math.PI / 2) * t)));
  }

  // Landing: rounded knuckle, steep middle, eases to flat.
  landing(len: number, h: number) {
    return this.slope(len, -h);
  }

  // The signature MSM shape: a steep face that kicks you up, a short crest,
  // and a long downslope you can land anywhere on.
  hill(h: number, up: number, down: number, crest = 1.2) {
    return this.lip(up, h).flat(crest).landing(down, h);
  }

  // Rhythm section: rollers of slightly varying height you can jump, double or manual.
  rhythm(n: number, len: number, h: number) {
    for (let i = 0; i < n; i++) {
      const hh = h * (0.75 + this.rand() * 0.5);
      // Faces no steeper than ~35°, so a slow bike can still roll out of the dip.
      const ll = Math.max(len * (0.85 + this.rand() * 0.3), hh * 4.5);
      this.shape(ll, (t) => (hh * (1 - Math.cos(2 * Math.PI * t))) / 2);
    }
    return this;
  }

  whoops(n: number, h = 0.6) {
    return this.rhythm(n, 2.8, h);
  }

  tabletop(h: number, top: number) {
    return this.lip(h * 2.2, h).flat(top).landing(h * 3.4, h);
  }

  // Jump over a dip onto a landing ramp; base level is restored afterwards.
  // The back face of the dip is rideable, so coming up short is a hard case, not a trap.
  double(h: number, gap: number) {
    const base = this.y;
    const top = h * 0.95;
    const face = (top + 0.8) * 2.6;
    this.lip(h * 2, h);
    this.slope(1.4, base - 0.8 - this.y);
    this.flat(Math.max(0.5, gap - face - 1.4));
    this.slope(face, base + top - this.y);
    this.flat(0.8);
    return this.landing(h * 3.8, this.y - base);
  }

  // Kicker onto a higher plateau; the plateau face is steep but rideable.
  stepUp(h: number, gap: number) {
    const base = this.y;
    const face = (h + 0.8) * 2.6;
    this.lip(2.6, 1.3);
    this.slope(1.2, base - 0.8 - this.y);
    this.flat(Math.max(0.5, gap - face * 0.5));
    this.slope(face, base + h - this.y);
    return this.flat(5);
  }

  // Off a ledge onto a long downslope.
  drop(h: number) {
    this.lip(1.6, 0.4).flat(0.6);
    this.add(this.x + 1.2, this.y - h * 0.3);
    return this.landing(h * 3, h * 0.7 + 0.4);
  }

  build(id: string, name: string, theme: ThemeId, opts: { laps?: number; grip?: number; stars?: number } = {}): Track {
    this.flat(4);
    const finishX = this.x + 2;
    this.flat(70);
    this.add(this.x, this.y + 40);
    const { laps = 1, grip = 0.9, stars = 0 } = opts;
    return { id, name, theme, laps, grip, stars, points: this.pts, startX: 2, finishX };
  }
}

export const TRACKS: Track[] = [
  new Builder(27)
    .flat(16)
    .rough(18, 0.4)
    .slope(36, 9)
    .flat(4)
    .hill(3.5, 8, 18)
    .rough(12, 0.4)
    .drop(4)
    .flat(5)
    .double(3, 11)
    .rough(16, 0.4)
    .rhythm(5, 7, 1.5)
    .flat(5)
    .stepUp(3, 5)
    .rough(14, 0.3)
    .hill(6, 13, 28)
    .flat(6)
    .whoops(10, 0.7)
    .flat(6)
    .slope(30, 8)
    .hill(4, 9, 20)
    .rough(20, 0.4)
    .drop(5)
    .slope(26, -6)
    .flat(6)
    .double(3.4, 13)
    .rough(14, 0.3)
    .build("forest", "Екатеринбург", "ekaterinburg", { laps: 2 }),

  // Smolensk: the city of seven hills — rolling climbs, small doubles, a gentle second track.
  new Builder(131)
    .flat(16)
    .rough(14, 0.35)
    .hill(3, 7, 16)
    .flat(6)
    .rhythm(4, 8, 1.2)
    .flat(4)
    .slope(28, 6)
    .hill(4, 9, 20)
    .rough(12, 0.3)
    .double(2.8, 10)
    .flat(6)
    .whoops(7, 0.45)
    .flat(5)
    .tabletop(2.6, 6)
    .rough(14, 0.35)
    .slope(24, -5)
    .hill(5, 11, 24)
    .flat(5)
    .drop(3.5)
    .rough(12, 0.3)
    .build("smolensk", "Смоленск", "smolensk"),

  new Builder(53)
    .flat(16)
    .tabletop(2.4, 5)
    .flat(5)
    .double(3, 11)
    .flat(4)
    .rhythm(6, 6.5, 1.4)
    .flat(4)
    .hill(5, 10, 22)
    .rough(14, 0.3)
    .stepUp(3.5, 6)
    .stepUp(3.5, 6)
    .flat(5)
    .drop(4)
    .drop(4)
    .rough(10, 0.3)
    .whoops(12, 0.65)
    .flat(5)
    .double(3.6, 15)
    .flat(4)
    .hill(7, 14, 30)
    .rhythm(4, 8, 2)
    .flat(5)
    .tabletop(4, 12)
    .flat(4)
    .double(4, 17)
    .rough(12, 0.3)
    .build("city", "Москва", "moscow"),

  // Minsk: flat and fast — tabletops and rhythm lanes, two laps.
  new Builder(149)
    .flat(16)
    .tabletop(2.2, 5)
    .flat(4)
    .rhythm(5, 6, 1.3)
    .flat(4)
    .double(3, 11)
    .rough(10, 0.3)
    .hill(5, 10, 22)
    .flat(4)
    .whoops(10, 0.6)
    .flat(4)
    .tabletop(3, 9)
    .flat(4)
    .stepUp(3, 5)
    .drop(3)
    .rough(12, 0.3)
    .build("minsk", "Минск", "minsk", { laps: 2, stars: 3 }),

  // Snow: slippery, long climbs and descents, step-downs.
  new Builder(71)
    .flat(16)
    .rough(20, 0.3)
    .slope(40, 9)
    .hill(4, 9, 22)
    .flat(6)
    .drop(5)
    .slope(30, -5)
    .rhythm(4, 8, 1.5)
    .flat(5)
    .double(3, 11)
    .rough(16, 0.35)
    .hill(6, 12, 26)
    .whoops(8, 0.6)
    .flat(6)
    .stepUp(3, 5)
    .flat(4)
    .drop(4)
    .slope(26, -6)
    .tabletop(3, 8)
    .rough(14, 0.3)
    .build("snow", "Сочи", "sochi", { laps: 2, grip: 0.72, stars: 5 }),

  // Voronezh: heavy black earth on the steppe — long rhythm waves and big doubles.
  new Builder(163)
    .flat(16)
    .rough(16, 0.4)
    .rhythm(4, 9, 1.8)
    .flat(5)
    .double(3.2, 12)
    .rough(12, 0.4)
    .hill(6, 12, 26)
    .flat(8)
    .whoops(10, 0.55)
    .flat(5)
    .rhythm(3, 16, 3)
    .flat(4)
    .tabletop(3.5, 10)
    .rough(14, 0.4)
    .double(3.6, 14)
    .rough(12, 0.3)
    .build("voronezh", "Воронеж", "voronezh", { grip: 0.85, stars: 6 }),

  // Dunes: huge smooth sand waves, long airtime, soft sand.
  new Builder(83)
    .flat(16)
    .rough(14, 0.3)
    .rhythm(3, 40, 4.5)
    .flat(6)
    .hill(7, 14, 30)
    .flat(5)
    .rhythm(5, 12, 2.4)
    .flat(5)
    .double(3.5, 14)
    .rough(14, 0.4)
    .rhythm(3, 44, 5)
    .flat(6)
    .tabletop(4, 12)
    .rough(12, 0.3)
    .hill(6, 13, 28)
    .rhythm(4, 10, 2)
    .rough(12, 0.3)
    .build("dunes", "Махачкала", "makhachkala", { grip: 0.8, stars: 8 }),

  // Nizhny Novgorod: up and down the steep Volga bank — step-ups, ledges and long climbs.
  new Builder(179)
    .flat(16)
    .rough(12, 0.3)
    .slope(34, 10)
    .stepUp(3, 5)
    .hill(5, 10, 22)
    .drop(5)
    .slope(28, -6)
    .flat(5)
    .double(3.4, 13)
    .rough(12, 0.35)
    .slope(30, 8)
    .hill(7, 14, 30)
    .flat(5)
    .rhythm(5, 8, 1.8)
    .flat(4)
    .drop(5)
    .slope(26, -6)
    .tabletop(3, 8)
    .rough(12, 0.3)
    .build("nizhny", "Нижний Новгород", "nizhny", { stars: 9 }),

  // Stadium supercross: short, technical, three laps.
  new Builder(97)
    .flat(14)
    .tabletop(2, 4)
    .flat(3)
    .rhythm(6, 5.5, 1.2)
    .flat(3)
    .double(2.6, 8)
    .flat(3)
    .whoops(14, 0.55)
    .flat(3)
    .double(3, 10)
    .flat(3)
    .stepUp(2.5, 4)
    .drop(2.5)
    .rhythm(4, 6, 1.4)
    .flat(3)
    .tabletop(2.4, 6)
    .flat(6)
    .build("stadium", "Казань", "kazan", { laps: 3, stars: 11 }),

  // Novosibirsk: wet autumn leaves (less grip), a long two-lap mix of everything.
  new Builder(191)
    .flat(16)
    .rough(14, 0.35)
    .hill(4, 9, 20)
    .flat(4)
    .double(3.2, 12)
    .rough(10, 0.35)
    .rhythm(6, 7, 1.5)
    .flat(4)
    .hill(6, 12, 26)
    .whoops(10, 0.65)
    .flat(5)
    .stepUp(3.5, 6)
    .drop(4)
    .rough(12, 0.35)
    .tabletop(3.5, 10)
    .flat(4)
    .double(3.8, 15)
    .rough(12, 0.3)
    .build("novosibirsk", "Новосибирск", "novosibirsk", { laps: 2, grip: 0.86, stars: 14 }),

  // St Petersburg: the hardest — big gaps, ledges and rough ground.
  new Builder(113)
    .flat(16)
    .double(3.4, 13)
    .rough(10, 0.4)
    .stepUp(4, 6)
    .stepUp(4, 6)
    .hill(8, 15, 32)
    .drop(5)
    .rough(10, 0.4)
    .double(4, 16)
    .rhythm(5, 9, 2.2)
    .drop(6)
    .whoops(10, 0.7)
    .flat(5)
    .hill(7, 14, 30)
    .double(4.2, 18)
    .rough(12, 0.4)
    .build("volcano", "Санкт-Петербург", "spb", { stars: 15 }),

  // Grozny: mountain track — big climbs, drops and gaps.
  new Builder(211)
    .flat(16)
    .slope(36, 10)
    .hill(6, 12, 26)
    .drop(6)
    .rough(10, 0.45)
    .double(4, 16)
    .rhythm(4, 10, 2.4)
    .flat(4)
    .stepUp(4, 6)
    .hill(8, 15, 32)
    .flat(4)
    .whoops(10, 0.7)
    .drop(5)
    .slope(28, -7)
    .double(4.2, 17)
    .rough(12, 0.4)
    .build("grozny", "Грозный", "grozny", { stars: 18 }),

  // Vladivostok: the hardest — steep sopki, rocky ground and the longest gaps.
  new Builder(227)
    .flat(16)
    .double(3.6, 14)
    .slope(40, 12)
    .hill(7, 14, 30)
    .drop(6)
    .slope(30, -8)
    .rough(10, 0.5)
    .double(4.4, 18)
    .stepUp(4.5, 7)
    .stepUp(4, 6)
    .hill(9, 16, 34)
    .whoops(12, 0.75)
    .flat(4)
    .drop(6)
    .double(4.4, 18)
    .rough(12, 0.45)
    .build("vladivostok", "Владивосток", "vladivostok", { grip: 0.88, stars: 21 }),
];

// Ground height at x (linear interpolation between samples).
export function groundY(track: Track, x: number): number {
  const p = track.points;
  let lo = 2;
  let hi = p.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  const b = p[lo];
  const a = p[lo - 1];
  if (b.x === a.x) return Math.max(a.y, b.y);
  return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
}
