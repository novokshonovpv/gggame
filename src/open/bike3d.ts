import type RAPIER from "@dimforge/rapier3d-compat";

// Enduro bike for the open world, simulated like the real thing rather than steered on rails:
//
// - Suspension: each wheel is a rounded-cylinder tyre swept down its fork/shock (a shape
//   cast), so it meets logs, steps and rocks with the front of the tyre, not a ray under
//   the hub. Spring with preload and sag, a progressive bump stop at the end of the 300 mm
//   travel, separate compression and rebound damping. The ground pushes along its normal,
//   so a log both lifts the wheel and slows the bike.
// - Tyres: slip ratio from the wheel's own spin, slip angle, camber thrust from the lean, a
//   friction circle shared by both (spin the rear and it steps out; lock it and it slides),
//   grip and rolling drag from the surface (dirt, grass, mud, wood).
// - Engine: torque curve, a six-speed box with automatic shifts and a cut while shifting,
//   a slipping clutch for pull-aways, engine braking, rev limiter. Engine and wheel inertia
//   push back on the frame: gas in the air lifts the nose, the rear brake drops it.
// - Riding: the rider asks for a lean angle; like a real rider the bars countersteer to get
//   there and then hold the turn the lean calls for. At walking pace the rider balances and
//   steers directly. The rider also eases the throttle in a big wheelie or on a spinning
//   rear wheel and the front brake before a stoppie — as a real rider would.
// - Crashes: the helmet touches anything, a hard hit, or the bike lies down.
//
// Body frame: x forward, y up, z to the bike's right. The body origin is the centre of mass.

type R = typeof RAPIER;
type V3 = { x: number; y: number; z: number };
type Q = { x: number; y: number; z: number; w: number };

export interface BikeInput {
  gas: number; // 0..1, the twist grip (the bike eases it open)
  brake: number; // 0..1, both brakes, mostly front
  rearBrake: number; // 0..1, the rear brake alone: locks and slides the rear
  lean: number; // -1 (left) .. 1 (right): where the rider wants the bike to lean
}

export interface Surface {
  mu: number; // tyre grip
  roll: number; // rolling resistance coefficient
}

export const OPEN_BIKE = {
  mass: 190, // kg, bike 110 + rider 80
  inertia: { x: 26, y: 64, z: 74 }, // roll, yaw, pitch about the centre of mass, kg·m²
  wheelR: 0.35,
  wheelX: [0.68, -0.78], // front, rear hub, m ahead of the centre of mass
  hubTop: -0.29, // hub height at full compression, relative to the centre of mass
  travel: 0.3,
  spring: 9000, // N/m at the wheel
  preload: 220, // N
  compDamp: 900, // N·s/m
  rebDamp: 1500,
  maxDamp: 4000, // N, damper force limit (high-speed blow-off)
  wheelI: [0.9, 1.1], // tyre and rim inertia, kg·m²
  brakeFront: 620, // N·m at full lever
  brakeRear: 380,
  slipStiff: 10, // longitudinal force per unit slip ratio, × load
  cornerStiff: 13, // lateral force per radian of slip angle, × load
  camber: 0.85, // camber thrust per radian of lean, × load
  slide: 0.75, // grip left when sliding, × peak
  cdA: 0.55, // m², drag area
  maxSteer: 0.6, // rad, full lock
  steerRate: 7, // rad/s
  crashRoll: 1.25, // rad
  hitSpeed: 6.5, // m/s of speed lost in one step = a crash
  maxLoad: 9000, // N a tyre can push before it squashes flat
};

export interface EngineSpec {
  peak: number; // N·m
  idle: number; // rpm
  redline: number;
  ratios: number[]; // engine turns per rear wheel turn, 1st..6th
  inertia: number; // engine rotating inertia, kg·m²
  twoStroke: boolean;
}

export function engineSpec(power = 1, twoStroke = false): EngineSpec {
  const redline = twoStroke ? 9800 : 11000;
  const idle = twoStroke ? 1500 : 1700;
  const wRed = (redline * Math.PI) / 30; // rad/s
  const R = OPEN_BIKE.wheelR;
  // 1st tops out at ~47 km/h, 6th at ~125 km/h.
  const first = wRed / (13 / R);
  const sixth = wRed / (34.5 / R);
  const ratios = [0, 1, 2, 3, 4, 5].map((i) => first * (sixth / first) ** (i / 5));
  return { peak: 33 * power, idle, redline, ratios, inertia: 0.014, twoStroke };
}

// Torque at the crank as a share of peak, by rpm from idle (0) to redline (1).
function torqueCurve(e: EngineSpec, x: number) {
  if (e.twoStroke) {
    const s = smooth(0.12, 0.62, x);
    return x < 0.85 ? 0.42 + 0.58 * s : 1 - 0.6 * ((x - 0.85) / 0.15) ** 2;
  }
  return x < 0.7 ? 0.64 + 0.36 * Math.sin((Math.PI / 2) * (x / 0.7)) : 1 - 0.45 * ((x - 0.7) / 0.3) ** 2;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function rotate(q: Q, v: V3): V3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

const qmul = (a: Q, b: Q): Q => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const yawQuat = (yaw: number): Q => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const AXLE: Q = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }; // cylinder axis (y) onto the axle (z)

export interface WheelState {
  x: number; // suspension compression, 0..travel
  contact: boolean;
  omega: number; // spin, rad/s (+ = rolling forward)
  angle: number; // spin angle, for the visuals
  slip: number; // 0 = gripping, 1+ = sliding
  load: number; // N
  point: V3; // contact point
  normal: V3;
}

const newWheel = (): WheelState => ({ x: 0.08, contact: false, omega: 0, angle: 0, slip: 0, load: 0, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });

export class Bike3D {
  static restSag = 0.08; // suspension compression standing still, m (for the visuals)
  body: RAPIER.RigidBody;
  power: number;
  engine: EngineSpec;
  gear = 0; // 0 = 1st
  rpm: number;
  throttle = 0; // eased twist grip, 0..1
  steer = 0; // front wheel angle, rad (+ = right)
  roll = 0; // lean from upright, rad (+ = right)
  airTime = 0;
  crashed = false;
  crashReason = "";
  wheels: WheelState[] = [newWheel(), newWheel()];
  surface: (x: number, z: number) => Surface = () => ({ mu: 1, roll: 0.02 });
  private world: RAPIER.World;
  private R: R;
  private tyre: RAPIER.Shape;
  private head: RAPIER.Shape;
  private brakeF = 0;
  private brakeR = 0;
  private shiftT = 0;
  private lastVel: V3 = { x: 0, y: 0, z: 0 };
  private engaged = true;
  private leanCmd = 0;

  constructor(R: R, world: RAPIER.World, pos: V3, yaw: number, power = 1, twoStroke = false) {
    const B = OPEN_BIKE;
    this.R = R;
    this.world = world;
    this.power = power;
    this.engine = engineSpec(power, twoStroke);
    this.rpm = this.engine.idle;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(yawQuat(yaw))
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setAngularDamping(0.15),
    );
    const collider = (d: RAPIER.ColliderDesc, friction = 0.5) => world.createCollider(d.setDensity(0).setFriction(friction).setRestitution(0.05), this.body);
    // Engine and frame, the rider's body, and stops round the hubs for walls and trees (the
    // tyres themselves are the shape casts).
    collider(R.ColliderDesc.cuboid(0.42, 0.17, 0.13).setTranslation(0, -0.3, 0));
    collider(R.ColliderDesc.cuboid(0.18, 0.34, 0.18).setTranslation(-0.12, 0.38, 0));
    for (const x of B.wheelX) collider(R.ColliderDesc.ball(0.26).setTranslation(x, B.hubTop, 0), 0.3);
    this.body.setAdditionalMassProperties(B.mass, { x: 0, y: 0, z: 0 }, B.inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    // The tyre: a 24-sided hull with a rounded crown (Rapier's round cylinder casts badly
    // against boxes). A vertex sits straight down and straight ahead.
    const pts: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      for (const [r, y] of [
        [B.wheelR, -0.02],
        [B.wheelR, 0.02],
        [B.wheelR - 0.025, -0.06],
        [B.wheelR - 0.025, 0.06],
        [B.wheelR - 0.065, -0.09],
        [B.wheelR - 0.065, 0.09],
      ])
        pts.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
    this.tyre = new R.ConvexPolyhedron(new Float32Array(pts), null);
    this.head = new R.Ball(0.17);
  }

  get position() {
    return this.body.translation();
  }

  get rotation(): Q {
    return this.body.rotation();
  }

  // Signed speed along the bike, m/s.
  get speed() {
    return dot(this.body.linvel(), rotate(this.rotation, { x: 1, y: 0, z: 0 }));
  }

  get grounded() {
    return this.wheels[0].contact || this.wheels[1].contact;
  }

  // Heading on the ground plane, radians (0 = +x, CCW from above).
  get yaw() {
    const f = rotate(this.rotation, { x: 1, y: 0, z: 0 });
    return Math.atan2(-f.z, f.x);
  }

  // Engine speed from idle (0) to redline (1), for the sound and the tacho.
  get rpm01() {
    return clamp((this.rpm - this.engine.idle) / (this.engine.redline - this.engine.idle), 0, 1.05);
  }

  // 1 / mass the body shows to a push along d at r (from the centre of mass), world frame.
  private invMass(q: Q, r: V3, d: V3) {
    const I = OPEN_BIKE.inertia;
    const c = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, cross(r, d));
    return 1 / OPEN_BIKE.mass + (c.x * c.x) / I.x + (c.y * c.y) / I.y + (c.z * c.z) / I.z;
  }

  // Sweep a tyre down its suspension from full compression.
  private cast(i: number, q: Q, p: V3, U: V3) {
    const B = OPEN_BIKE;
    const mount = add(p, rotate(q, { x: B.wheelX[i], y: B.hubTop, z: 0 }));
    const rot = i === 0 ? qmul(q, qmul(yawQuat(-this.steer), AXLE)) : qmul(q, AXLE);
    const hit = this.world.castShape(mount, rot, scale(U, -1), this.tyre, 0, B.travel + 0.04, true, this.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.body);
    if (!hit || hit.time_of_impact > B.travel) return null;
    return { toi: hit.time_of_impact, point: hit.witness1, normal: norm(hit.normal1), mount };
  }

  // Call once per physics step, before world.step().
  apply(inp: BikeInput, dt: number) {
    const B = OPEN_BIKE;
    const body = this.body;
    const q = body.rotation();
    const p = body.translation();
    const lv = body.linvel();
    const av = body.angvel();
    const F = rotate(q, { x: 1, y: 0, z: 0 });
    const U = rotate(q, { x: 0, y: 1, z: 0 });
    const Rg = rotate(q, { x: 0, y: 0, z: 1 });
    const fh = norm({ x: F.x, y: 0, z: F.z });
    const v = dot(lv, fh);
    const av2 = Math.abs(v);
    this.roll = Math.atan2(-Rg.y, U.y);
    const rollRate = dot(av, F);
    const surf = this.surface(p.x, p.z);
    const live = !this.crashed;

    const g = 9.81;
    // ----- Controls, eased like hands on levers -----
    const ease = (cur: number, target: number, up: number, down: number) => cur + clamp(target - cur, -dt / down, dt / up);
    let gas = live ? inp.gas : 0;
    this.brakeF = ease(this.brakeF, live ? inp.brake : 0, 0.12, 0.08);
    this.brakeR = ease(this.brakeR, live ? Math.max(inp.rearBrake, inp.brake * 0.3) : 0, 0.08, 0.08);

    const hits = [this.cast(0, q, p, U), this.cast(1, q, p, U)];
    const grounded = !!(hits[0] || hits[1]);
    this.airTime = grounded ? 0 : this.airTime + dt;
    const [front, rear] = this.wheels;

    // Rider: eases off in a big wheelie or when the rear spins up, and off the front brake
    // when the rear goes light.
    let frontBrake = this.brakeF;
    let wheelieBrake = 0;
    if (hits[1]) {
      // Nose-up against the ground under the rear, looking a quarter second ahead.
      const n = hits[1].normal;
      const pitchRel = Math.asin(clamp(dot(F, n), -1, 1)) + 0.25 * dot(av, Rg);
      gas *= 1 - smooth(0.02, 0.14, pitchRel);
      wheelieBrake = smooth(0.2, 0.4, pitchRel);
      gas *= 1 - 0.6 * smooth(0.3, 0.9, rear.slip);
      // Keep weight on the front once moving: a light front wheel can't steer.
      if (av2 > 4) gas *= 0.15 + 0.85 * smooth(0.1, 0.4, front.load / (B.mass * g * 0.5));
    }
    if (hits[0]) {
      const n = hits[0].normal;
      const pitchRel = Math.asin(clamp(dot(F, n), -1, 1));
      if (!hits[1]) frontBrake *= 1 - smooth(-0.12, -0.3, pitchRel);
      else frontBrake *= smooth(0.08, 0.3, rear.load / (B.mass * 9.81 * 0.5));
    }
    this.throttle = ease(this.throttle, gas, 0.18, 0.08);
    this.brakeR = Math.max(this.brakeR, wheelieBrake);

    // ----- Steering: countersteer to the lean the rider wants, then hold the turn -----
    const L = B.wheelX[0] - B.wheelX[1];
    const leanMax = 0.85 * Math.atan(surf.mu) * smooth(0.5, 6, av2);
    // The rider tips the bike in progressively, not all at once.
    // ...and stands it up a little while the rear slides.
    const leanWant = clamp(inp.lean, -1, 1) * (live ? leanMax : 0) * (1 - 0.45 * smooth(0.4, 1.4, rear.slip));
    this.leanCmd += clamp(leanWant - this.leanCmd, -2.2 * dt, 2.2 * dt);
    const want = this.leanCmd;
    let target: number;
    {
      const vs = Math.max(3, av2);
      const eq = Math.atan((L * g * Math.tan(clamp(this.roll, -1.2, 1.2))) / (vs * vs));
      const kp = 67 / (vs * vs);
      const kd = 14 / (vs * vs);
      const lock = Math.min(B.maxSteer, Math.atan((L * 1.3 * surf.mu * g) / (vs * vs)));
      const ride = clamp(eq + kp * (this.roll - want) + kd * rollRate, -lock, lock);
      const walk = clamp(inp.lean, -1, 1) * B.maxSteer * (live ? 1 : 0);
      const b = v > 0 ? smooth(1.5, 4.5, v) : 0;
      target = walk + (ride - walk) * b;
      if (!grounded) target *= 0.3;
    }
    const step = B.steerRate * dt;
    this.steer += clamp(target - this.steer, -step, step);

    // ----- Engine and gearbox -----
    const E = this.engine;
    const ratio = E.ratios[this.gear];
    const toRpm = (w: number) => (Math.max(0, w) * ratio * 30) / Math.PI;
    const wheelRpm = toRpm(rear.omega);
    const clutchRpm = E.idle * 1.8;
    const x01 = (r: number) => (r - E.idle) / (E.redline - E.idle);
    let drive = 0;
    this.engaged = grounded || this.throttle > 0.05;
    if (this.shiftT > 0) this.shiftT -= dt;
    if (wheelRpm < clutchRpm) {
      // Pulling away: the clutch slips and passes the engine's torque.
      const launch = E.idle + this.throttle * (clutchRpm * 1.6 - E.idle);
      this.rpm += (Math.max(launch, wheelRpm) - this.rpm) * Math.min(1, dt * 8);
      drive = this.throttle * torqueCurve(E, x01(this.rpm)) * E.peak * ratio * 0.9;
      this.engaged = false;
      if (this.gear > 0) this.gear = 0;
    } else if (this.engaged) {
      this.rpm = wheelRpm;
      const x = x01(wheelRpm);
      const engineBrake = -E.peak * (0.05 + 0.12 * x) * ratio * 0.9;
      if (x > 1) drive = engineBrake; // limiter
      else if (this.throttle > 0.02) drive = this.throttle * torqueCurve(E, x) * E.peak * ratio * 0.9 + (1 - this.throttle) * engineBrake;
      else drive = engineBrake;
      if (this.shiftT <= 0) {
        if (x > 0.93 && this.gear < 5 && this.throttle > 0.3 && rear.slip < 0.4 && grounded) {
          this.gear++;
          this.shiftT = 0.1;
        } else if (x < 0.3 && this.gear > 0) {
          this.gear--;
          this.shiftT = 0.06;
        }
      }
    } else this.rpm += (E.idle + this.throttle * 3000 - this.rpm) * Math.min(1, dt * 3);
    if (this.shiftT > 0) drive = Math.min(0, drive) * 0.3;

    // ----- Wheels: suspension and tyres -----
    let landed = 0;
    const pushes: { j: V3; at: V3 }[] = []; // ground pushes up through the suspension (impulses)
    for (let i = 0; i < 2; i++) {
      const w = this.wheels[i];
      const hit = hits[i];
      const isFront = i === 0;
      const I = isFront ? B.wheelI[0] : B.wheelI[1] + (this.engaged ? E.inertia * ratio * ratio : 0);
      const Td = isFront ? 0 : drive;
      const Tb = isFront ? frontBrake * B.brakeFront : this.brakeR * B.brakeRear;
      const omega0 = w.omega;
      const a = dt / I;
      const brakeOn = (om: number) => {
        const d = a * Tb;
        return Math.abs(om) <= d ? 0 : om - Math.sign(om) * d;
      };
      if (!hit) {
        w.contact = false;
        w.x = Math.max(0, w.x - dt * 2);
        w.load = 0;
        w.slip = 0;
        w.omega = brakeOn(w.omega + a * (Td - 0.3 * Math.sign(w.omega)));
      } else {
        const x = clamp(B.travel - hit.toi, 0, B.travel);
        const hub = add(hit.mount, scale(U, -hit.toi));
        const hubVel = add(lv, cross(av, sub(hub, p)));
        // Compression speed from how the hub moves against the surface (a log face shoves the
        // wheel up at the speed the bike hits it, not at the jump in cast distance).
        const nU = Math.max(0.5, dot(hit.normal, U));
        const xdotK = -dot(hubVel, hit.normal) / nU;
        const xdot = w.contact ? Math.min((x - w.x) / dt, Math.max(xdotK, (x - w.x) / dt * 0.25)) : Math.max(0, xdotK);
        if (!w.contact && hit.normal.y > 0.75) landed = Math.max(landed, -dot(hubVel, hit.normal));
        const bump = x > B.travel - 0.06 ? 1.5e6 * (x - (B.travel - 0.06)) ** 2 : 0;
        const damp = clamp(xdot * (xdot > 0 ? B.compDamp : B.rebDamp), -B.maxDamp, B.maxDamp);
        const fs = Math.max(0, B.preload + B.spring * x + bump + damp);
        const n = hit.normal;
        const N = Math.min(B.maxLoad, fs / nU); // the tyre squashes past this
        w.contact = true;
        w.x = x;
        w.load = N;
        w.point = hit.point;
        w.normal = n;

        // Tyre frame on the ground.
        const head = isFront ? add(scale(F, Math.cos(this.steer)), scale(Rg, Math.sin(this.steer))) : F;
        const fl = norm(sub(head, scale(n, dot(head, n))));
        const sl = cross(fl, n);
        const r = sub(hit.point, p);
        const vc = add(lv, cross(av, r));
        const vx = dot(vc, fl);
        const vy = dot(vc, sl);
        const mu = surf.mu;
        const Rw = B.wheelR;
        const vdx = Math.max(Math.abs(vx), 1);
        const vdy = Math.max(Math.abs(vx), 1);
        // Tyre stiffness in N per m/s of slip, capped so one step can't overshoot: at walking
        // pace a stiff tyre would otherwise shake the bike (the contact sees little mass).
        const kx = Math.min((B.slipStiff * N) / vdx, 0.4 / (this.invMass(q, r, fl) * dt));
        const ky = Math.min((B.cornerStiff * N) / vdy, 0.4 / (this.invMass(q, r, sl) * dt));
        const sy = N > 1 ? (ky * vy) / N : 0; // lateral slip force per unit load, before saturation
        const rollT = -surf.roll * N * Rw * Math.tanh(w.omega * 4);
        // Wheel spin: implicit while the tyre grips (it's stiff), explicit once it slides.
        const implicit = (T: number) => (w.omega + a * (T + kx * Rw * vx)) / (1 + a * kx * Rw * Rw);
        let om = implicit(Td + rollT);
        let locked = false;
        if (Tb > 0) {
          const ob = implicit(Td + rollT - Tb * Math.sign(om || vx));
          if (Math.sign(ob) !== Math.sign(om) || Math.abs(om) < 0.5) {
            om = 0;
            locked = Tb * 1.0 > Math.abs(Td);
          } else om = ob;
        }
        const forces = (omega: number) => {
          const sx = N > 1 ? (kx * (omega * Rw - vx)) / N : 0;
          const m = Math.hypot(sx, sy) / mu;
          const k = m > 1 ? (1 - (1 - B.slide) * Math.min(1, (m - 1) / 1.5)) / m : 1;
          return { fx: sx * k, fy: -sy * k, m };
        };
        let f = forces(om);
        if (f.m > 1 && !locked) {
          // Sliding: the tyre force is fixed by the grip, so step the spin explicitly.
          om = w.omega + a * (Td + rollT - f.fx * N * Rw);
          if (Tb > 0) om = brakeOn(om);
          f = forces(om);
        }
        w.omega = om;
        w.slip = Math.max(0, f.m - 0.8) * 2;
        // Camber thrust: a leaned tyre pushes towards its lean.
        let fy = f.fy + (Math.abs(vx) > 0.5 ? B.camber * dot(U, sl) : 0);
        let fx = f.fx;
        const tot = Math.hypot(fx, fy);
        if (tot > mu) {
          fx *= mu / tot;
          fy *= mu / tot;
        }
        body.applyImpulseAtPoint(scale(add(scale(fl, fx * N), scale(sl, fy * N)), dt), hit.point, true);
        pushes.push({ j: scale(n, N * dt), at: hit.point });
        // Bottomed out: the stop soaks up the rest of the hit instead of bouncing off it.
        if (x > B.travel - 0.015) {
          const vn = dot(add(lv, cross(av, r)), n) + N * dt * this.invMass(q, r, n);
          if (vn < 0) pushes.push({ j: scale(n, (-vn * 0.6) / this.invMass(q, r, n)), at: hit.point });
        }
      }
      // Spinning a wheel up or down turns the frame the other way (about the axle).
      // Angular momentum of wheel (and crank, geared up but not squared) about the axle.
      const reaction = (isFront ? B.wheelI[0] : B.wheelI[1] + (this.engaged ? E.inertia * ratio : 0)) * (w.omega - omega0);
      if (reaction) body.applyTorqueImpulse(scale(Rg, reaction), true);
      w.angle += w.omega * dt;
    }

    // The rider's legs: hits beyond ~2.5 g (a log, a flat landing) are mostly soaked up by
    // the 80 kg on top bending its knees, not passed on to bounce the whole bike.
    {
      const jy = pushes.reduce((sum, p) => sum + p.j.y, 0);
      const limit = 2.2 * B.mass * g * dt;
      const k = jy > limit ? (limit + 0.22 * (jy - limit)) / jy : 1;
      for (const p of pushes) body.applyImpulseAtPoint(scale(p.j, k), p.at, true);
    }

    // ----- Rider -----
    const Ix = B.inertia.x;
    if (grounded && live) {
      // A real bike steadies itself at speed (spinning wheels, trail): roll damping.
      body.applyTorqueImpulse(scale(F, -Math.min(8, 0.35 * av2) * rollRate * Ix * dt), true);
    }
    if (grounded) {
      // Balancing at walking pace (feet, body), fading out as the bike gets going.
      const k = live ? 1 - 0.9 * smooth(1, 6, av2) : 0;
      if (k > 0) {
        const yawRate = dot(av, U);
        const eqLean = Math.atan((v * yawRate) / g);
        const tau = -(90 * (this.roll - eqLean) + 18 * rollRate) * Ix * k * dt;
        body.applyTorqueImpulse(scale(F, tau), true);
      }
    } else if (live && this.airTime > 0.04) {
      // In the air: the rider keeps the bike upright and shifts his weight (gas = back,
      // brake = forward) on top of what the spinning rear wheel does.
      const tauRoll = -(25 * (this.roll - inp.lean * 0.2) + 7 * rollRate) * Ix * dt;
      body.applyTorqueImpulse(scale(F, tauRoll), true);
      body.applyTorqueImpulse(scale(Rg, (inp.gas - Math.max(inp.brake, inp.rearBrake)) * 110 * dt), true);
      // ...and by instinct keeps the bike roughly along its flight path.
      const spd = Math.hypot(lv.x, lv.y, lv.z);
      if (this.airTime > 0.04 && spd > 3) {
        const pitchErr = Math.asin(clamp(lv.y / spd, -1, 1)) - Math.asin(clamp(F.y, -1, 1));
        body.applyTorqueImpulse(scale(Rg, (5 * pitchErr - 4.5 * dot(av, Rg)) * B.inertia.z * dt), true);
      }
      body.applyTorqueImpulse(scale(U, -inp.lean * 40 * dt), true);
    }

    // Air drag.
    const sp = Math.hypot(lv.x, lv.y, lv.z);
    if (sp > 1) body.applyImpulse(scale(lv, -0.6 * B.cdA * sp * dt), true);

    // ----- Crashes -----
    if (live) {
      const headPos = add(p, rotate(q, { x: -0.06, y: 0.84, z: 0 }));
      const hitHead = this.world.intersectionWithShape(headPos, q, this.head, this.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, this.body);
      const dvx = lv.x - this.lastVel.x;
      const dvz = lv.z - this.lastVel.z;
      const lean = Math.abs(this.roll);
      if (hitHead) this.crash("Падение!");
      else if (Math.hypot(dvx, dvz) > B.hitSpeed) this.crash("Удар!");
      else if (lean > B.crashRoll || U.y < 0.15) this.crash("Падение!");
      else if (landed > 11) this.crash("Жёсткое приземление!");
    }
    this.lastVel = lv;
  }

  private crash(reason: string) {
    this.crashed = true;
    this.crashReason = reason;
    this.throttle = 0;
  }

  // Back on its wheels at a spot, standing still.
  placeAt(pos: V3, yaw: number) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.crashed = false;
    this.crashReason = "";
    this.airTime = 0;
    this.throttle = 0;
    this.gear = 0;
    this.rpm = this.engine.idle;
    this.lastVel = { x: 0, y: 0, z: 0 };
    this.leanCmd = 0;
    for (const w of this.wheels) Object.assign(w, newWheel());
  }

  dispose() {
    /* the body goes with the world */
  }
}
