import type { BikePose } from "./bike.ts";
import { WHEEL_R } from "./bikeShape.ts";
import type { RiderView } from "./render.ts";
import { type Track, groundY } from "./track.ts";

// Dirt kicked up by the bikes: a roost from the rear wheel while it drives hard (launch,
// acceleration, wheelspin) and a cloud from both wheels on a heavy landing. A fixed pool
// of particles simulated in world meters; both renderers draw it.

const MAX = 700;

interface BikeState {
  x: number;
  angle: number;
  v: number;
  accel: number;
  air: number;
  carry: number; // fractional particles owed from the last frames
}

export class Dust {
  readonly max = MAX;
  x = new Float32Array(MAX);
  y = new Float32Array(MAX);
  z = new Float32Array(MAX);
  vx = new Float32Array(MAX);
  vy = new Float32Array(MAX);
  vz = new Float32Array(MAX);
  age = new Float32Array(MAX).fill(1e9);
  life = new Float32Array(MAX).fill(1);
  size = new Float32Array(MAX);
  shade = new Float32Array(MAX);
  private head = 0;
  private lastTime = -1;
  private bikes = new Map<BikePose, BikeState>();
  private seed = 1;

  private rand() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  // Current size (m) and opacity of particle i; opacity 0 means dead.
  look(i: number): [number, number] {
    const t = this.age[i] / this.life[i];
    if (t >= 1) return [0, 0];
    const fadeIn = Math.min(1, this.age[i] / 0.06);
    return [this.size[i] * (1 + 2.6 * t), 0.75 * fadeIn * (1 - t) ** 1.4];
  }

  reset() {
    this.age.fill(1e9);
    this.bikes.clear();
    this.lastTime = -1;
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const i = this.head;
    this.head = (this.head + 1) % MAX;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.shade[i] = 0.8 + this.rand() * 0.35;
  }

  // Advances the particles and emits new ones. lane(i) gives rider i's depth (z) in 3D.
  update(riders: RiderView[], track: Track, time: number, lane: (i: number) => number) {
    const dt = this.lastTime < 0 ? 0 : Math.min(0.05, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    if (dt === 0) return;

    for (let i = 0; i < MAX; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const drag = Math.exp(-2.2 * dt);
      this.vx[i] *= drag;
      this.vz[i] *= drag;
      this.vy[i] = this.vy[i] * drag - 1.6 * dt; // dust hangs in the air
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.z[i] += this.vz[i] * dt;
    }

    riders.forEach((r, idx) => {
      const bike = r.bike;
      if (r.ghost || bike.rearContacts === undefined) return;
      const rear = bike.rear.getPosition();
      const cx = bike.chassis.getPosition().x;
      const angle = bike.rear.getAngle();
      let s = this.bikes.get(bike);
      if (!s) {
        s = { x: cx, angle, v: 0, accel: 0, air: 0, carry: 0 };
        this.bikes.set(bike, s);
      }
      const dx = cx - s.x;
      // A lap wrap or respawn teleports the bike: skip that frame.
      const v = Math.abs(dx) > 3 ? s.v : dx / dt;
      const spin = Math.abs(angle - s.angle) > 3 ? 0 : (-(angle - s.angle) / dt) * WHEEL_R.rear;
      s.accel += ((v - s.v) / dt - s.accel) * Math.min(1, dt * 6);
      s.v = v;
      s.x = cx;
      s.angle = angle;
      const z = lane(idx);
      const grounded = (bike.rearContacts ?? 0) > 0;

      if (grounded && s.air > 0.35) {
        // Landing: a low cloud squirting out both ways from under the wheels.
        const n = Math.min(26, 8 + s.air * 10);
        const front = bike.front.getPosition();
        for (let k = 0; k < n; k++) {
          const w = k % 2 ? rear : front;
          const side = this.rand() < 0.5 ? -1 : 1;
          this.spawn(w.x + (this.rand() - 0.5) * 0.4, groundY(track, w.x) + 0.08, z + (this.rand() - 0.5) * 0.4, v * 0.3 + side * (1 + this.rand() * 2.5), 0.4 + this.rand() * 1.4, (this.rand() - 0.5) * 2.2, 0.7 + this.rand() * 0.6, 0.28 + this.rand() * 0.2);
        }
      }
      s.air = grounded ? 0 : s.air + dt;

      if (!grounded || !bike.gas) {
        s.carry = 0;
        return;
      }
      // Roost: harder acceleration, wheelspin and launches throw more dirt.
      const slip = Math.max(0, spin - v);
      const drive = Math.min(1, Math.max(0, (s.accel - 0.6) / 5)) + Math.min(1, slip / 3) + (Math.abs(v) < 5 ? 0.35 : 0);
      const rate = 70 * Math.min(1.6, drive);
      s.carry += rate * dt;
      const gy = groundY(track, rear.x);
      while (s.carry >= 1) {
        s.carry -= 1;
        const kick = 1.5 + Math.min(6, slip + Math.max(0, s.accel) * 0.4) * this.rand();
        this.spawn(
          rear.x - WHEEL_R.rear * 0.6 - this.rand() * 0.2,
          gy + 0.06 + this.rand() * 0.1,
          z + (this.rand() - 0.5) * 0.25,
          v * 0.35 - kick,
          0.8 + kick * 0.45 + this.rand() * 0.8,
          (this.rand() - 0.5) * 1.6,
          0.6 + this.rand() * 0.6,
          0.24 + this.rand() * 0.18,
        );
      }
    });
    for (const bike of this.bikes.keys()) if (!riders.some((r) => r.bike === bike)) this.bikes.delete(bike);
  }
}
