import type { Body } from "planck";
import { BIKE, type Bike, RIDER_HEAD_R } from "./bike.ts";
import { type Pt, type Track, groundY } from "./track.ts";

export interface Camera {
  x: number;
  y: number;
  ppm: number; // pixels per meter
}

const C = {
  skyTop: "#5aa9e6",
  skyBottom: "#cfe8f7",
  far: "#9cc3d9",
  mid: "#7fae8a",
  dirt: "#8a5a35",
  dirtDark: "#5e3b22",
  topsoil: "#b07a4a",
  tire: "#1c1c1c",
  rim: "#9aa3ab",
  plastic: "#f2a516",
  plasticDark: "#c57f06",
  frame: "#2b2b2b",
  jersey: "#1f5fbf",
  jerseyDark: "#163f80",
  pants: "#e9e9e9",
  boots: "#202020",
  helmet: "#f2f2f2",
  visor: "#f2a516",
};

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0;
  h = 0;
  dpr = 1;

  constructor(public canvas: HTMLCanvasElement) {
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

  // Zoom so roughly the same slice of track is visible on any screen.
  basePpm() {
    return Math.min(this.h / 8.5, this.w / 15);
  }

  sx(cam: Camera, x: number) {
    return (x - cam.x) * cam.ppm + this.w / 2;
  }
  sy(cam: Camera, y: number) {
    return this.h * 0.5 - (y - cam.y) * cam.ppm;
  }

  draw(cam: Camera, track: Track, bike: Bike, time: number) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.sky(cam, time);
    this.flags(cam, track);
    this.ground(cam, track);
    this.bike(cam, bike);
  }

  private sky(cam: Camera, time: number) {
    const { ctx, w, h } = this;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(1, C.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Clouds drift slowly and parallax a little.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 6; i++) {
      const span = w + 400;
      const cx = ((((i * 397 - cam.x * cam.ppm * 0.05 + time * 8) % span) + span) % span) - 200;
      const cy = 40 + ((i * 53) % 120);
      const s = 0.7 + ((i * 31) % 10) / 15;
      for (const [dx, dy, rx, ry] of [
        [0, 0, 60, 18],
        [35, -10, 40, 20],
        [-30, -6, 34, 15],
      ]) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.hills(cam, 0.15, C.far, 0.35, 90, 0.004);
    this.hills(cam, 0.35, C.mid, 0.48, 60, 0.009);
  }

  private hills(cam: Camera, parallax: number, color: string, base: number, amp: number, freq: number) {
    const { ctx, w, h } = this;
    const off = cam.x * cam.ppm * parallax;
    const yOff = (cam.y * cam.ppm * parallax) / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let px = 0; px <= w + 20; px += 20) {
      const u = px + off;
      const y =
        h * base + yOff - amp * (0.6 * Math.sin(u * freq) + 0.4 * Math.sin(u * freq * 2.7 + 1.3));
      ctx.lineTo(px, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
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

  private ground(cam: Camera, track: Track) {
    const { ctx, h } = this;
    const pts = track.points;
    const [i0, i1] = this.visibleRange(cam, pts);

    const path = new Path2D();
    path.moveTo(this.sx(cam, pts[i0].x), h + 10);
    for (let i = i0; i <= i1; i++) path.lineTo(this.sx(cam, pts[i].x), this.sy(cam, pts[i].y));
    path.lineTo(this.sx(cam, pts[i1].x), h + 10);
    path.closePath();

    const g = ctx.createLinearGradient(0, this.sy(cam, cam.y + 2), 0, h);
    g.addColorStop(0, C.dirt);
    g.addColorStop(1, C.dirtDark);
    ctx.fillStyle = g;
    ctx.fill(path);

    // Packed top layer of the track.
    ctx.lineJoin = "round";
    ctx.strokeStyle = C.topsoil;
    ctx.lineWidth = Math.max(4, cam.ppm * 0.22);
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const x = this.sx(cam, pts[i].x);
      const y = this.sy(cam, pts[i].y) + ctx.lineWidth / 2;
      if (i === i0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private flags(cam: Camera, track: Track) {
    this.gate(cam, track.startX - 1, groundY(track, track.startX - 1), false);
    this.gate(cam, track.finishX, groundY(track, track.finishX), true);
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

  private bike(cam: Camera, bike: Bike) {
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
    this.poly(cam, ch, [-0.98, 0.42, -0.5, 0.34, -0.2, 0.3, -0.15, 0.22, -0.55, 0.22, -0.9, 0.34], C.plastic);
    this.poly(cam, ch, [-0.15, 0.36, 0.3, 0.4, 0.34, 0.26, 0.05, 0.12, -0.12, 0.16], C.plastic);
    this.poly(cam, ch, [-0.55, 0.4, 0.02, 0.4, 0.04, 0.34, -0.55, 0.34], "#222");
    this.poly(cam, ch, [0.36, 0.5, 0.48, 0.48, 0.5, 0.26, 0.4, 0.24], C.plasticDark);
    this.poly(cam, ch, [0.62, 0.16, 0.95, 0.12, 0.92, 0.07, 0.6, 0.1], C.plastic);
    this.line(L(0.3, 0.62), L(0.44, 0.56), 0.05 * s, "#222");

    this.rider(cam, bike);
  }

  private rider(cam: Camera, bike: Bike) {
    const ch = bike.chassis;
    const s = cam.ppm;
    const l = bike.lean;
    const L = (p: [number, number]) => this.local(cam, ch, p[0], p[1]);

    // Body pose in chassis space; lean shifts hips back/forward and tilts the torso.
    const hip: [number, number] = [-0.24 - 0.16 * l, 0.62 - 0.06 * Math.abs(l)];
    const tilt = 0.5 - 0.45 * l;
    const torso = 0.48;
    const shoulder: [number, number] = [hip[0] + Math.sin(tilt) * torso, hip[1] + Math.cos(tilt) * torso];
    const head: [number, number] = [
      shoulder[0] + Math.sin(tilt - 0.15) * 0.22,
      shoulder[1] + Math.cos(tilt - 0.15) * 0.22,
    ];
    const hand: [number, number] = [0.32, 0.62];
    const foot: [number, number] = [-0.12, 0.02];
    const elbow = ik(shoulder, hand, 0.3, 0.3, -1);
    const knee = ik(hip, foot, 0.45, 0.45, 1);

    this.line(L(hip), L(knee), 0.15 * s, C.pants);
    this.line(L(knee), L(foot), 0.13 * s, C.boots);
    this.line(L(hip), L(shoulder), 0.24 * s, C.jersey);
    this.line(L(shoulder), L(elbow), 0.11 * s, C.jerseyDark);
    this.line(L(elbow), L(hand), 0.1 * s, C.jerseyDark);

    const { ctx } = this;
    const [hx, hy] = L(head);
    const r = RIDER_HEAD_R * s;
    ctx.fillStyle = C.helmet;
    ctx.beginPath();
    ctx.arc(hx, hy, r, 0, Math.PI * 2);
    ctx.fill();
    // Visor and goggles point forward along the bike.
    const a = -ch.getAngle();
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(a);
    ctx.fillStyle = C.visor;
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
