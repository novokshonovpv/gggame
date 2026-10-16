export interface Pt {
  x: number;
  y: number;
}

export interface Track {
  id: string;
  name: string;
  points: Pt[];
  startX: number;
  finishX: number;
}

const STEP = 0.4;

// Builds a continuous ground polyline from MX-style features.
class Builder {
  pts: Pt[] = [];
  x = 0;
  y = 0;

  constructor() {
    this.pts.push({ x: -40, y: 30 }, { x: -40, y: 0 }, { x: 0, y: 0 });
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

  // Smooth S-curve change of height (ease in and out).
  slope(len: number, dy: number) {
    return this.shape(len, (t) => (dy * (1 - Math.cos(Math.PI * t))) / 2);
  }

  // Kicker: gets steeper towards the lip.
  lip(len: number, h: number) {
    return this.shape(len, (t) => h * (1 - Math.cos((Math.PI / 2) * t)));
  }

  // Landing: rounded knuckle, then eases to flat.
  landing(len: number, h: number) {
    return this.slope(len, -h);
  }

  bump(len: number, h: number) {
    return this.shape(len, (t) => (h * (1 - Math.cos(2 * Math.PI * t))) / 2);
  }

  rollers(n: number, len: number, h: number) {
    for (let i = 0; i < n; i++) this.bump(len, h);
    return this;
  }

  whoops(n: number) {
    return this.rollers(n, 2.6, 0.55);
  }

  tabletop(h: number, top: number) {
    return this.lip(h * 2.4, h).flat(top).landing(h * 3.2, h);
  }

  // Jump over a pit onto a landing ramp; base level is restored afterwards.
  double(h: number, gap: number) {
    const base = this.y;
    this.lip(h * 2.2, h);
    this.add(this.x + 0.6, base - 1.2);
    this.add(this.x + gap, base - 1.2);
    this.add(this.x + 0.6, base + h * 0.95);
    this.flat(0.8);
    return this.landing(h * 3.6, this.y - base);
  }

  // Kicker onto a higher plateau.
  stepUp(h: number, gap: number) {
    const base = this.y;
    this.lip(2.2, 1.0);
    this.add(this.x + 0.5, base - 0.8);
    this.add(this.x + gap, base - 0.8);
    this.add(this.x + 0.5, base + h);
    return this.flat(4);
  }

  drop(h: number) {
    return this.lip(1.4, 0.35).flat(0.6).add2(1.0, -h * 0.35).landing(h * 3, h * 0.65 + 0.35);
  }

  private add2(dx: number, dy: number) {
    this.add(this.x + dx, this.y + dy);
    return this;
  }

  build(id: string, name: string): Track {
    const finishX = this.x + 6;
    this.flat(60);
    this.add(this.x, this.y + 30);
    return { id, name, points: this.pts, startX: 2, finishX };
  }
}

export const TRACKS: Track[] = [
  new Builder()
    .flat(14)
    .rollers(3, 7, 0.9)
    .flat(6)
    .tabletop(1.6, 5)
    .flat(8)
    .whoops(6)
    .flat(6)
    .tabletop(2.2, 7)
    .flat(5)
    .slope(18, 4)
    .flat(4)
    .slope(16, -4)
    .flat(8)
    .double(1.8, 6)
    .flat(10)
    .build("t1", "Разминка"),

  new Builder()
    .flat(12)
    .tabletop(1.8, 4)
    .flat(6)
    .double(2.0, 7)
    .flat(5)
    .rollers(4, 6, 1.2)
    .flat(4)
    .stepUp(2.5, 4)
    .flat(8)
    .drop(2.5)
    .flat(6)
    .whoops(8)
    .flat(6)
    .double(2.6, 10)
    .flat(4)
    .slope(14, 3)
    .tabletop(1.5, 3)
    .slope(14, -3)
    .flat(10)
    .build("t2", "Карьер"),

  new Builder()
    .flat(14)
    .double(2.4, 9)
    .flat(4)
    .double(2.8, 12)
    .flat(5)
    .stepUp(3, 5)
    .flat(4)
    .stepUp(3, 5)
    .flat(6)
    .drop(3)
    .flat(2)
    .drop(3)
    .flat(8)
    .whoops(10)
    .flat(5)
    .tabletop(3.2, 9)
    .flat(4)
    .double(3.2, 15)
    .flat(12)
    .build("t3", "Большие прыжки"),
];

// Ground height at x (linear interpolation between samples), used for decorations.
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
