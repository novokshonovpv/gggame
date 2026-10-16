import type { Bike, BikePose, BodyPose, ChassisPose, P } from "./bike.ts";
import type { Look } from "./race.ts";

// Ghost of the player's best run: the bike pose sampled 30 times a second during the
// race, saved per track when a new record is set, and replayed alongside the next race.

const RATE = 30;
const FIELDS = 10; // chassis x y a, rear x y a, front x y a, lean
const VERSION = 1;

export const GHOST_LOOK: Look = {
  name: "Рекорд",
  plastic: "#e8f1ff",
  plasticDark: "#b9c9e0",
  jersey: "#e8f1ff",
  jerseyDark: "#b9c9e0",
  pants: "#e8f1ff",
  helmet: "#ffffff",
  visor: "#9fc3ff",
};

const round = (v: number) => Math.round(v * 100) / 100;

export class GhostRecorder {
  data: number[] = [];

  // Called every physics step with race time; keeps one sample per 1/30 s.
  step(bike: Bike, time: number) {
    while (this.data.length / FIELDS <= time * RATE) {
      const c = bike.chassis.getPosition();
      const r = bike.rear.getPosition();
      const f = bike.front.getPosition();
      this.data.push(
        round(c.x), round(c.y), round(bike.chassis.getAngle()),
        round(r.x), round(r.y), round(bike.rear.getAngle()),
        round(f.x), round(f.y), round(bike.front.getAngle()),
        round(bike.lean),
      );
    }
  }
}

class PoseBody implements ChassisPose {
  x = 0;
  y = 0;
  a = 0;
  getPosition(): P {
    return { x: this.x, y: this.y };
  }
  getAngle() {
    return this.a;
  }
  getWorldPoint(p: P): P {
    const c = Math.cos(this.a);
    const s = Math.sin(this.a);
    return { x: this.x + c * p.x - s * p.y, y: this.y + s * p.x + c * p.y };
  }
  getLocalPoint(p: P): P {
    const c = Math.cos(this.a);
    const s = Math.sin(this.a);
    const dx = p.x - this.x;
    const dy = p.y - this.y;
    return { x: c * dx + s * dy, y: -s * dx + c * dy };
  }
}

export class GhostBike implements BikePose {
  chassis = new PoseBody();
  rear: BodyPose = new PoseBody();
  front: BodyPose = new PoseBody();
  lean = 0;
  private data: number[];

  constructor(data: number[]) {
    this.data = data;
    this.setTime(0);
  }

  get duration() {
    return this.data.length / FIELDS / RATE;
  }

  // Interpolates the recorded pose at race time t (holds the last frame after the end).
  setTime(t: number) {
    const n = this.data.length / FIELDS;
    const pos = Math.max(0, Math.min(n - 1, t * RATE));
    const i = Math.min(n - 2, Math.floor(pos));
    const k = Math.max(0, pos - i);
    const v = (f: number) => {
      const a = this.data[i * FIELDS + f];
      const b = this.data[(i + 1) * FIELDS + f];
      return b === undefined ? a : a + (b - a) * k;
    };
    const set = (body: PoseBody, o: number) => {
      // A lap wraps the bike back to the start: don't sweep it across the whole track.
      const jump = Math.abs(this.data[(i + 1) * FIELDS + o] - this.data[i * FIELDS + o]) > 20;
      body.x = jump ? this.data[i * FIELDS + o] : v(o);
      body.y = jump ? this.data[i * FIELDS + o + 1] : v(o + 1);
      body.a = v(o + 2);
    };
    set(this.chassis, 0);
    set(this.rear as PoseBody, 3);
    set(this.front as PoseBody, 6);
    this.lean = v(9);
  }
}

const key = (trackId: string) => `ghost:${trackId}`;

export function loadGhost(trackId: string): GhostBike | null {
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return null;
    const g = JSON.parse(raw) as { v: number; d: number[] };
    if (g.v !== VERSION || g.d.length < FIELDS * 2) return null;
    return new GhostBike(g.d);
  } catch {
    return null;
  }
}

export function saveGhost(trackId: string, rec: GhostRecorder) {
  try {
    localStorage.setItem(key(trackId), JSON.stringify({ v: VERSION, d: rec.data }));
    return true;
  } catch {
    return false; // storage full or unavailable: the record time still counts
  }
}
