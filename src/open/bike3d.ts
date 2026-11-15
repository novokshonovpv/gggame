import type RAPIER from "@dimforge/rapier3d-compat";

// Enduro bike for the open world, on Rapier's ray-cast vehicle controller: two wheels on
// the bike's centre line with springy suspension, rear-wheel drive, a steered front wheel.
// A real bike stays up by steering into its lean; here a roll controller leans the bike
// to the angle its turn calls for (and holds it up when stopped), which feels right and
// can't be learnt wrong on a phone. In the air the bike pitches gently towards its flight
// path so landings work out; past ~70° of roll or flipped over, it's a crash.
//
// Body frame: x forward, y up, z to the bike's right.

type R = typeof RAPIER;
type V3 = { x: number; y: number; z: number };
type Q = { x: number; y: number; z: number; w: number };

export interface BikeInput {
  gas: number; // 0..1
  brake: number; // 0..1; held at a standstill it reverses
  steer: number; // -1 (left) .. 1 (right)
}

export const OPEN_BIKE = {
  mass: 180, // kg, bike and rider
  wheelbase: 1.46,
  wheelR: 0.34,
  restLength: 0.42, // suspension
  stiffness: 42,
  compression: 4.2,
  relaxation: 5.0,
  travel: 0.3,
  engineForce: 2600, // N at the rear contact, falls to 0 at top speed
  topSpeed: 27, // m/s (~97 km/h) for power 1
  reverseForce: 700,
  brake: 14, // braking impulse per wheel
  grip: 2.2, // friction slip
  sideGrip: 1.4,
  maxSteer: 0.55, // rad at walking pace, less at speed
  maxLateral: 7, // m/s² of cornering the steering may ask for (the lean can hold it)
  steerRate: 4, // rad/s the bars turn
  maxLean: 0.75, // rad
  rollK: 170, // roll controller stiffness and damping, 1/s² and 1/s
  rollD: 24,
  airPitchK: 4,
  crashRoll: 1.2, // rad
  pitchI: 70, // pitch inertia, kg·m²
  yawI: 60,
  yawAssist: 6, // 1/s
  wheelieAngle: 0.25, // rad of nose-up allowed before the throttle fades
  wheelieK: 40,
  wheelieD: 8,
};

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

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const yawQuat = (yaw: number): Q => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

export class Bike3D {
  body: RAPIER.RigidBody;
  vc: RAPIER.DynamicRayCastVehicleController;
  power: number;
  steer = 0; // current front wheel angle, rad (+ = left, Rapier's sense)
  roll = 0; // current lean, rad (+ = right)
  airTime = 0;
  crashed = false;
  private world: RAPIER.World;

  constructor(R: R, world: RAPIER.World, pos: V3, yaw: number, power = 1) {
    const B = OPEN_BIKE;
    this.world = world;
    this.power = power;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation(yawQuat(yaw))
        .setCanSleep(false)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.6),
    );
    // Bike: a low box between the wheels; rider: a box above it. Mass set explicitly with a
    // low centre of mass and inertia of a 180 kg bike with rider.
    world.createCollider(R.ColliderDesc.cuboid(0.55, 0.16, 0.15).setTranslation(0, 0.2, 0).setDensity(0).setFriction(0.6), this.body);
    // Slippery spheres where the wheels sit: on logs, steps and rocks taller than the
    // suspension can soak up they roll the bike up and over, like real tyres would.
    // Only the front-lower quarter of each tyre: an obstacle pushes it up and back, never
    // just back, and the lowest point stays clear of flat ground so the suspension works.
    // An invisible frictionless ski ahead of the front tyre, sloping up at 35°: logs, steps
    // and rocks lift the bike onto them instead of stopping it dead (arcade, but fun). The
    // rear wheel follows over them on its suspension.
    {
      const hx = B.wheelbase / 2;
      const hy = 0.12 - 0.31; // front hub at rest
      const pts: number[] = [];
      for (const z of [-0.12, 0.12])
        pts.push(hx - 0.05, hy - 0.27, z, hx + 0.15, hy - 0.27, z, hx + 0.62, hy + 0.06, z, hx - 0.05, hy + 0.06, z);
      const desc = R.ColliderDesc.convexHull(new Float32Array(pts));
      if (desc) world.createCollider(desc.setDensity(0).setFriction(0).setRestitution(0), this.body);
    }
    world.createCollider(R.ColliderDesc.cuboid(0.22, 0.38, 0.2).setTranslation(-0.12, 0.72, 0).setDensity(0).setFriction(0.6), this.body);
    this.body.setAdditionalMassProperties(B.mass, { x: 0, y: 0.02, z: 0 }, { x: 22, y: 60, z: OPEN_BIKE.pitchI }, { x: 0, y: 0, z: 0, w: 1 }, true);

    this.vc = world.createVehicleController(this.body);
    for (const x of [B.wheelbase / 2, -B.wheelbase / 2]) {
      this.vc.addWheel({ x, y: 0.12, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: -1 }, B.restLength, B.wheelR);
    }
    for (let i = 0; i < 2; i++) {
      this.vc.setWheelSuspensionStiffness(i, B.stiffness);
      this.vc.setWheelSuspensionCompression(i, B.compression);
      this.vc.setWheelSuspensionRelaxation(i, B.relaxation);
      this.vc.setWheelMaxSuspensionTravel(i, B.travel);
      this.vc.setWheelMaxSuspensionForce(i, 40000);
      this.vc.setWheelFrictionSlip(i, B.grip);
      this.vc.setWheelSideFrictionStiffness(i, B.sideGrip);
    }
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
    return this.vc.wheelIsInContact(0) || this.vc.wheelIsInContact(1);
  }

  // Heading on the ground plane, radians (0 = +x, CCW from above).
  get yaw() {
    const f = rotate(this.rotation, { x: 1, y: 0, z: 0 });
    return Math.atan2(-f.z, f.x);
  }

  // Call once per physics step, before world.step().
  apply(input: BikeInput, dt: number) {
    const B = OPEN_BIKE;
    const q = this.rotation;
    const F = rotate(q, { x: 1, y: 0, z: 0 });
    const U = rotate(q, { x: 0, y: 1, z: 0 });
    const Rt = cross(F, U); // to the bike's right
    const v = this.speed;
    const grounded = this.grounded;
    this.airTime = grounded ? 0 : this.airTime + dt;

    // Steering: quick at walking pace, a few degrees at full speed.
    const max = Math.min(B.maxSteer / (1 + Math.abs(v) / 8), Math.atan((B.wheelbase * B.maxLateral) / Math.max(1, v * v)));
    const target = -input.steer * max;
    const step = B.steerRate * dt;
    this.steer += Math.max(-step, Math.min(step, target - this.steer));
    this.vc.setWheelSteering(0, this.steer);

    // Throttle, brakes, reverse.
    const top = B.topSpeed * this.power;
    let force = 0;
    let brake = 0;
    if (input.gas > 0 && v > -0.5) force = B.engineForce * this.power * input.gas * Math.max(0, 1 - v / top);
    if (input.brake > 0) {
      if (v > 0.8) brake = B.brake * input.brake;
      else force = -B.reverseForce * input.brake * Math.max(0, 1 + v / 4); // reverse up to 4 m/s
    }
    if (input.gas > 0 && v < -0.5) brake = B.brake;
    // Anti-wheelie: the drive acts at the tyre, far below the centre of mass, so full gas
    // lifts the front. Past a small wheelie the throttle fades and a torque brings it down.
    const w0 = this.body.angvel();
    const Rt0 = cross(F, U);
    if (this.vc.wheelIsInContact(1)) {
      const n = this.vc.wheelContactNormal(1) ?? { x: 0, y: 1, z: 0 };
      const pitchRel = Math.asin(Math.max(-1, Math.min(1, dot(F, n)))); // nose above the ground plane
      const over = pitchRel - B.wheelieAngle;
      if (over > -0.1) force *= Math.max(0, Math.min(1, 1 - (over + 0.1) / 0.2));
      if (over > 0 || (!this.vc.wheelIsInContact(0) && dot(w0, Rt0) > 0)) {
        const tp = -(B.wheelieK * Math.max(0, over) + B.wheelieD * Math.max(0, dot(w0, Rt0))) * B.pitchI * dt;
        this.body.applyTorqueImpulse(scale(Rt0, tp), true);
      }
    }
    this.vc.setWheelEngineForce(1, -force); // Rapier drives along -forward for a positive force
    this.vc.setWheelBrake(0, brake); // mostly front brake: a locked rear wheel would swap ends
    this.vc.setWheelBrake(1, brake * 0.4);
    if (!input.gas && !input.brake) {
      this.vc.setWheelBrake(0, 0.15); // engine braking and rolling resistance
      this.vc.setWheelBrake(1, 0.25);
    }

    // Yaw assist: on the ground the bike turns as much as the bars ask for, no more, so it
    // can't swap ends when braking hard or landing crooked.
    if (grounded) {
      const wy = dot(this.body.angvel(), U);
      const want = (v * Math.tan(this.steer)) / B.wheelbase;
      this.body.applyTorqueImpulse(scale(U, (want - wy) * B.yawAssist * B.yawI * dt), true);
    }

    // Roll controller: lean into the turn the bike is actually making.
    const w = this.body.angvel();
    const yawRate = dot(w, U);
    const targetRoll = Math.max(-B.maxLean, Math.min(B.maxLean, Math.atan((v * yawRate) / 9.81)));
    this.roll = Math.atan2(-Rt.y, U.y);
    const rollRate = dot(w, F);
    const k = grounded || this.airTime < 0.3 ? 1 : 0.5;
    const tau = (B.rollK * (-targetRoll - this.roll) - B.rollD * rollRate) * 22 * k * dt;
    this.body.applyTorqueImpulse(scale(F, tau), true);

    // In the air: nose follows the flight path, so the wheels meet the ground first.
    if (!grounded && this.airTime > 0.15) {
      const vel = this.body.linvel();
      const sp = Math.hypot(vel.x, vel.y, vel.z);
      if (sp > 3) {
        const pitchErr = Math.asin(Math.max(-1, Math.min(1, vel.y / sp))) - Math.asin(Math.max(-1, Math.min(1, F.y)));
        const pitchRate = dot(w, Rt);
        // Rotating about +right (z) by a positive angle lifts the nose.
        const tp = (B.airPitchK * pitchErr * 4 - 2.5 * pitchRate) * B.pitchI * dt;
        this.body.applyTorqueImpulse(scale(Rt, tp), true);
      }
    }

    this.vc.updateVehicle(dt);

    // Crash: lying on its side or upside down.
    if (Math.abs(this.roll) > B.crashRoll || U.y < 0.1) this.crashed = true;
  }

  // Back on its wheels at a spot, standing still.
  placeAt(pos: V3, yaw: number) {
    this.body.setTranslation(pos, true);
    this.body.setRotation(yawQuat(yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steer = 0;
    this.crashed = false;
    this.airTime = 0;
  }

  // Suspension length and wheel spin for the visuals.
  wheelState(i: number) {
    return { travel: this.vc.wheelSuspensionLength(i) ?? OPEN_BIKE.restLength, spin: this.vc.wheelRotation(i) ?? 0 };
  }

  dispose() {
    this.world.removeVehicleController(this.vc);
  }
}
