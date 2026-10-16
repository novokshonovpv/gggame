import type { Body } from "planck";
import { BIKE, type Bike, RIDER_HEAD, RIDER_HEAD_R } from "./bike.ts";
import type { Look } from "./race.ts";
import { THEMES, type Theme, drawScenery } from "./scenery.ts";
import { type Pt, type Track, groundY } from "./track.ts";

const BAND = 1.0; // visual depth of the riding surface, meters

export interface Camera {
  x: number;
  y: number;
  ppm: number; // pixels per meter
}

const C = {
  tire: "#1c1c1c",
  rim: "#9aa3ab",
  frame: "#2b2b2b",
  boots: "#202020",
};

export interface RiderView {
  bike: Bike;
  look: Look;
  isPlayer: boolean;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;

  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  // Zoom so roughly the same slice of track is visible on any screen:
  // MSM-like wide view, ~12 m tall and ~22 m wide on a 16:9 screen.
  basePpm() {
    return Math.min(this.h / 12, this.w / 22);
  }

  sx(cam: Camera, x: number) {
    return (x - cam.x) * cam.ppm + this.w / 2;
  }
  sy(cam: Camera, y: number) {
    return this.h * 0.5 - (y - cam.y) * cam.ppm;
  }

  draw(cam: Camera, track: Track, riders: RiderView[], time: number) {
    const { ctx } = this;
    const theme = THEMES[track.theme];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawScenery(ctx, theme, { w: this.w, h: this.h, camX: cam.x, camY: cam.y, scale: this.basePpm(), time });
    this.fence(cam, track, theme);
    this.flags(cam, track);
    this.ground(cam, track, theme);
    // Rivals are slightly see-through and labelled; the player is drawn last, on top.
    for (const r of riders) {
      if (r.isPlayer) continue;
      const x = this.sx(cam, r.bike.chassis.getPosition().x);
      if (x < -100 || x > this.w + 100) continue;
      ctx.globalAlpha = 0.82;
      this.bike(cam, r.bike, r.look);
      ctx.globalAlpha = 1;
      this.nameTag(cam, r);
    }
    for (const r of riders) if (r.isPlayer) this.bike(cam, r.bike, r.look);
  }

  private nameTag(cam: Camera, r: RiderView) {
    const { ctx } = this;
    const head = r.bike.chassis.getWorldPoint(RIDER_HEAD);
    const x = this.sx(cam, head.x);
    const y = this.sy(cam, head.y) - RIDER_HEAD_R * cam.ppm - 8;
    ctx.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    const w = ctx.measureText(r.look.name).width + 18;
    ctx.fillStyle = "rgba(10,16,28,0.6)";
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 16, w, 18, 5);
    ctx.fill();
    ctx.fillStyle = r.look.plastic;
    ctx.fillRect(x - w / 2 + 4, y - 12, 3, 10);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(r.look.name, x + 3, y - 7);
  }

  private visibleRange(cam: Camera, pts: Pt[]) {
    const minX = cam.x - this.w / 2 / cam.ppm - 2;
    const maxX = cam.x + this.w / 2 / cam.ppm + 2;
    let i0 = 0;
    while (i0 < pts.length - 1 && pts[i0 + 1].x < minX) i0++;
    let i1 = i0;
    while (i1 < pts.length - 1 && pts[i1].x < maxX) i1++;
    return [i0, i1];
  }

  // Polyline along the profile, shifted vertically by `offset` meters.
  private trace(cam: Camera, pts: Pt[], i0: number, i1: number, offset: number, path: Path2D | CanvasRenderingContext2D, reverse = false) {
    for (let k = 0; k <= i1 - i0; k++) {
      const i = reverse ? i1 - k : i0 + k;
      path.lineTo(this.sx(cam, pts[i].x), this.sy(cam, pts[i].y + offset));
    }
  }

  private strokeAt(cam: Camera, pts: Pt[], i0: number, i1: number, offset: number, color: string, width: number) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(this.sx(cam, pts[i0].x), this.sy(cam, pts[i0].y + offset));
    this.trace(cam, pts, i0, i1, offset, ctx);
    ctx.stroke();
  }

  // The track reads as a 3D dirt road: a lit riding surface BAND meters deep
  // (wheels run along its middle) over a cross-section of layered dirt.
  private ground(cam: Camera, track: Track, theme: Theme) {
    const { ctx, h } = this;
    const t = theme.track;
    const pts = track.points;
    const [i0, i1] = this.visibleRange(cam, pts);
    const s = cam.ppm;
    const half = BAND / 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    const face = new Path2D();
    face.moveTo(this.sx(cam, pts[i0].x), h + 10);
    this.trace(cam, pts, i0, i1, -half, face);
    face.lineTo(this.sx(cam, pts[i1].x), h + 10);
    face.closePath();
    const g = ctx.createLinearGradient(0, h * 0.35, 0, h);
    g.addColorStop(0, t.face[0]);
    g.addColorStop(1, t.face[1]);
    ctx.fillStyle = g;
    ctx.fill(face);
    for (const [o, wd] of [
      [-1.4, 0.06],
      [-2.6, 0.09],
      [-4.2, 0.07],
      [-6.3, 0.12],
    ])
      this.strokeAt(cam, pts, i0, i1, o, t.strata, Math.max(1, s * wd));

    const top = new Path2D();
    top.moveTo(this.sx(cam, pts[i0].x), this.sy(cam, pts[i0].y + half));
    this.trace(cam, pts, i0, i1, half, top);
    this.trace(cam, pts, i0, i1, -half, top, true);
    top.closePath();
    ctx.fillStyle = t.top;
    ctx.fill(top);

    for (const [o, wd] of [
      [-0.3, 0.05],
      [-0.13, 0.08],
      [0.06, 0.06],
      [0.27, 0.05],
    ])
      this.strokeAt(cam, pts, i0, i1, o, t.rut, Math.max(1, s * wd));
    this.strokeAt(cam, pts, i0, i1, half, t.berm, Math.max(2, s * 0.14));
    this.strokeAt(cam, pts, i0, i1, -half, t.lip, Math.max(1.5, s * 0.07));
  }

  // Posts and rails along the far edge of the track, skipped on steep faces.
  private fence(cam: Camera, track: Track, theme: Theme) {
    const { ctx } = this;
    const step = 3.5;
    const s = cam.ppm;
    const x0 = Math.floor((cam.x - this.w / 2 / s) / step) * step;
    const x1 = cam.x + this.w / 2 / s + step;
    ctx.strokeStyle = theme.track.fence;
    ctx.lineCap = "round";
    let prev: [number, number] | null = null;
    for (let x = x0; x <= x1; x += step) {
      const y = groundY(track, x) + BAND / 2 - 0.05;
      const steep = Math.abs(groundY(track, x + 0.6) - groundY(track, x - 0.6)) > 0.7;
      if (steep || x < track.startX - 4 || x > track.finishX + 40) {
        prev = null;
        continue;
      }
      const px = this.sx(cam, x);
      const base = this.sy(cam, y);
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(px, base);
      ctx.lineTo(px, base - 0.95 * s);
      ctx.stroke();
      if (prev) {
        ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath();
        for (const r of [0.45, 0.85]) {
          ctx.moveTo(prev[0], prev[1] - r * s);
          ctx.lineTo(px, base - r * s);
        }
        ctx.stroke();
      }
      prev = [px, base];
    }
  }

  private flags(cam: Camera, track: Track) {
    this.gate(cam, track.startX - 1, groundY(track, track.startX - 1) + BAND / 2, false);
    this.gate(cam, track.finishX, groundY(track, track.finishX) + BAND / 2, true);
  }

  private gate(cam: Camera, x: number, y: number, finish: boolean) {
    const { ctx } = this;
    const px = this.sx(cam, x);
    if (px < -200 || px > this.w + 200) return;
    const s = cam.ppm;
    const top = this.sy(cam, y + 3.2);
    const base = this.sy(cam, y);
    ctx.fillStyle = "#333";
    ctx.fillRect(px - 0.06 * s, top, 0.12 * s, base - top);
    const fw = 1.1 * s;
    const fh = 0.7 * s;
    if (finish) {
      const n = 6;
      const cw = fw / n;
      const rows = 4;
      const ch = fh / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < n; c++) {
          ctx.fillStyle = (r + c) % 2 ? "#111" : "#fff";
          ctx.fillRect(px + c * cw, top + r * ch, cw + 0.5, ch + 0.5);
        }
    } else {
      ctx.fillStyle = "#2fa84f";
      ctx.fillRect(px, top, fw, fh);
    }
  }

  private local(cam: Camera, body: Body, x: number, y: number): [number, number] {
    const p = body.getWorldPoint({ x, y });
    return [this.sx(cam, p.x), this.sy(cam, p.y)];
  }

  private line(a: [number, number], b: [number, number], width: number, color: string) {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  private wheel(cam: Camera, wheel: Body) {
    const { ctx } = this;
    const p = wheel.getPosition();
    const x = this.sx(cam, p.x);
    const y = this.sy(cam, p.y);
    const r = BIKE.wheelRadius * cam.ppm;
    const a = -wheel.getAngle();
    ctx.fillStyle = C.tire;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    // Knobby tread.
    ctx.fillStyle = "#333";
    for (let i = 0; i < 14; i++) {
      const t = a + (i / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(t) * r * 0.97, y + Math.sin(t) * r * 0.97, r * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = C.rim;
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.8, r * 0.03);
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
      const t = a + (i / 12) * Math.PI * 2;
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(t) * r * 0.72, y + Math.sin(t) * r * 0.72);
    }
    ctx.stroke();
    ctx.fillStyle = "#555";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  private poly(cam: Camera, body: Body, pts: number[], color: string) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const [x, y] = this.local(cam, body, pts[i], pts[i + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  private bike(cam: Camera, bike: Bike, look: Look) {
    const { ctx } = this;
    const ch = bike.chassis;
    const s = cam.ppm;
    const L = (x: number, y: number) => this.local(cam, ch, x, y);
    const W = (b: Body): [number, number] => {
      const p = b.getPosition();
      return [this.sx(cam, p.x), this.sy(cam, p.y)];
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Swingarm and wheels.
    this.line(L(-0.08, -0.06), W(bike.rear), 0.09 * s, "#3a3a3a");
    this.wheel(cam, bike.rear);
    this.wheel(cam, bike.front);

    // Engine, frame, exhaust.
    this.poly(cam, ch, [-0.22, 0.12, 0.2, 0.12, 0.22, -0.16, -0.12, -0.2], "#4a4a4a");
    this.line(L(0.38, 0.3), L(-0.1, 0.12), 0.07 * s, C.frame);
    this.line(L(0.36, 0.26), L(0.16, -0.14), 0.06 * s, C.frame);
    this.line(L(0.1, -0.02), L(-0.45, 0.12), 0.07 * s, "#777");
    this.line(L(-0.45, 0.12), L(-0.82, 0.28), 0.08 * s, "#999");

    // Fork (telescopic, follows front suspension).
    this.line(L(0.42, 0.42), W(bike.front), 0.075 * s, "#c9c9c9");
    this.line(L(0.36, 0.3), L(0.48, 0.36), 0.12 * s, "#333");

    // Plastics.
    this.poly(cam, ch, [-0.98, 0.42, -0.5, 0.34, -0.2, 0.3, -0.15, 0.22, -0.55, 0.22, -0.9, 0.34], look.plastic);
    this.poly(cam, ch, [-0.15, 0.36, 0.3, 0.4, 0.34, 0.26, 0.05, 0.12, -0.12, 0.16], look.plastic);
    this.poly(cam, ch, [-0.55, 0.4, 0.02, 0.4, 0.04, 0.34, -0.55, 0.34], "#222");
    this.poly(cam, ch, [0.36, 0.5, 0.48, 0.48, 0.5, 0.26, 0.4, 0.24], look.plasticDark);
    this.poly(cam, ch, [0.62, 0.16, 0.95, 0.12, 0.92, 0.07, 0.6, 0.1], look.plastic);
    this.line(L(0.3, 0.62), L(0.44, 0.56), 0.05 * s, "#222");

    this.rider(cam, bike, look);
  }

  private rider(cam: Camera, bike: Bike, look: Look) {
    const ch = bike.chassis;
    const s = cam.ppm;
    const L = (p: [number, number]) => this.local(cam, ch, p[0], p[1]);
    const { hip, shoulder, head, hand, foot, elbow, knee } = riderPose(bike.lean);

    this.line(L(hip), L(knee), 0.15 * s, look.pants);
    this.line(L(knee), L(foot), 0.13 * s, C.boots);
    this.line(L(hip), L(shoulder), 0.24 * s, look.jersey);
    this.line(L(shoulder), L(elbow), 0.11 * s, look.jerseyDark);
    this.line(L(elbow), L(hand), 0.1 * s, look.jerseyDark);

    const { ctx } = this;
    const [hx, hy] = L(head);
    const r = RIDER_HEAD_R * s;
    ctx.fillStyle = look.helmet;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    // Visor and goggles point forward along the bike.
    const a = -ch.getAngle();
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(a);
    ctx.fillStyle = look.visor;
    ctx.fillRect(r * 0.2, -r * 0.95, r * 1.1, r * 0.35);
    ctx.fillStyle = "#222";
    ctx.fillRect(r * 0.35, -r * 0.3, r * 0.7, r * 0.42);
    ctx.fillStyle = "#666";
    ctx.beginPath();
    ctx.moveTo(r * 0.5, r * 0.25);
    ctx.lineTo(r * 1.25, r * 0.55);
    ctx.lineTo(r * 0.5, r * 0.85);
    ctx.fill();
    ctx.restore();
  }
}

type P2 = [number, number];

// Rider pose in chassis space (shared by the 2D and 3D renderers): lean shifts the
// hips back/forward and tilts the torso; knees and elbows come from two-bone IK.
export function riderPose(l: number) {
  const hip: P2 = [-0.24 - 0.16 * l, 0.62 - 0.06 * Math.abs(l)];
  const tilt = 0.5 - 0.45 * l;
  const shoulder: P2 = [hip[0] + Math.sin(tilt) * 0.48, hip[1] + Math.cos(tilt) * 0.48];
  const head: P2 = [shoulder[0] + Math.sin(tilt - 0.15) * 0.22, shoulder[1] + Math.cos(tilt - 0.15) * 0.22];
  const hand: P2 = [0.32, 0.62];
  const foot: P2 = [-0.12, 0.02];
  return { hip, shoulder, head, hand, foot, tilt, elbow: ik(shoulder, hand, 0.3, 0.3, -1), knee: ik(hip, foot, 0.45, 0.45, 1) };
}

// Two-bone IK: joint position between a and b with given bone lengths.
function ik(a: [number, number], b: [number, number], l1: number, l2: number, bend: number): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-4);
  const base = Math.atan2(dy, dx);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const ang = base + bend * Math.acos(Math.max(-1, Math.min(1, cos)));
  return [a[0] + Math.cos(ang) * l1, a[1] + Math.sin(ang) * l1];
}
