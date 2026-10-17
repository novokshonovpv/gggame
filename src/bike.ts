import { Box, Circle, Polygon, WheelJoint } from "planck";
import type { Body, Vec2Value, World } from "planck";

// All tunables in one place: physics feel is the core of the game.
export const BIKE = {
  chassisDensity: 220,
  riderDensity: 80,
  wheelDensity: 45,
  wheelRadius: 0.34,
  wheelFriction: 1.3,
  rearAnchor: { x: -0.7, y: -0.3 },
  frontAnchor: { x: 0.72, y: -0.3 },
  rearAxis: { x: 0, y: 1 },
  frontAxis: { x: -0.42, y: 0.91 }, // ~25° fork rake
  suspensionHz: 5.4,
  suspensionDamping: 0.9,
  suspensionTravel: 0.2, // m: past this the bump stop takes over (wheel joints have no limits)
  maxWheelSpeed: 62, // rad/s → ~21 m/s (~76 km/h)
  engineTorque: 340,
  brakeTorque: 420,
  coastTorque: 6,
  groundLeanTorque: 260,
  wheelieLift: 600, // N·m extra when leaning back on the gas: lets you pull a wheelie at speed
  leanRamp: 6, // 1/s: how fast lean input builds up (taps are gentle, holding is full)
  groundSpinCap: 1.4, // rad/s: lean on the ground stops pushing past this (controllable wheelies)
  // Share of engine reaction torque removed on the ground. Leaning back keeps more of it,
  // so the rider's weight shift is what pops a wheelie.
  reactionCancelSeated: 0.6,
  reactionCancelLeanBack: 0.3,
  wheelieDamping: 160, // N·m per rad/s while on one wheel: arcade-forgiving balance
  // Wheelie assist: on the rear wheel the bike is steered toward a pitch above the ground —
  // ~30° while leaning back on the gas, level otherwise. Past the loop-out angle it lets go.
  wheelieAngle: 0.52,
  wheelieKp: 3200, // N·m per rad of pitch error
  wheelieKd: 450, // N·m per rad/s
  wheelieMaxTorque: 1500,
  wheelieLoopOut: 0.95, // rad above the ground: beyond this you're on your own
  airSpinRate: 4.3, // rad/s target when leaning in the air
  airSpinResponse: 0.06, // fraction of the gap closed per physics step
};

// Local-space points (relative to chassis origin) shared by physics and rendering.
export const RIDER_HEAD = { x: 0.17, y: 1.2 }; // matches riderPose() at rest
export const RIDER_HEAD_R = 0.17;

export type FixtureTag = "ground" | "wheel-rear" | "wheel-front" | "rider" | "chassis";

export interface Input {
  gas: boolean;
  brake: boolean;
  lean: number; // +1 = back (nose up), -1 = forward
}

// What the renderers need from a bike: satisfied by the physics Bike and by a replayed ghost.
export interface P {
  x: number;
  y: number;
}
export interface BodyPose {
  getPosition(): P;
  getAngle(): number;
}
export interface ChassisPose extends BodyPose {
  getWorldPoint(local: P): P;
  getLocalPoint(world: P): P;
}
export interface BikePose {
  chassis: ChassisPose;
  rear: BodyPose;
  front: BodyPose;
  lean: number;
}

// What garage upgrades change on a particular bike.
export interface BikeStats {
  power: number; // engine multiplier: top speed and torque
  grip: number; // tyre friction
  suspensionHz: number; // lower = softer
  suspensionDamping: number;
  airSpin: number; // rad/s rotation when leaning in the air
}

export const BASE_STATS: BikeStats = {
  power: 1,
  grip: BIKE.wheelFriction,
  suspensionHz: BIKE.suspensionHz,
  suspensionDamping: BIKE.suspensionDamping,
  airSpin: BIKE.airSpinRate,
};

const AIR_GRACE = 0.12; // s a wheel may lose contact before the bike counts as airborne

// Bikes share one world but never touch each other (same negative group).
const NO_SELF_COLLIDE = -1;

const spawnHeight = (groundY: number) => groundY + BIKE.wheelRadius - BIKE.rearAnchor.y + 0.05;

export class Bike {
  chassis: Body;
  rear: Body;
  front: Body;
  rearJoint: WheelJoint;
  frontJoint: WheelJoint;
  rearContacts = 0;
  frontContacts = 0;
  lean = 0; // smoothed, used for rider animation
  leanCmd = 0; // ramped lean input actually applied to the physics
  groundAngle = 0; // slope under the bike, tracked while both wheels touch
  sinceRear = 0; // seconds since the rear wheel last touched
  sinceGround = 0; // seconds since any wheel last touched
  power: number; // engine multiplier: AI skill or the player's engine upgrade
  stats: BikeStats;

  constructor(world: World, start: Vec2Value, stats: BikeStats = BASE_STATS) {
    this.stats = stats;
    this.power = stats.power;
    const cy = spawnHeight(start.y);

    this.chassis = world.createDynamicBody({
      position: { x: start.x, y: cy },
      angularDamping: 0.4,
      userData: this,
    });
    this.chassis.createFixture(new Box(0.62, 0.16, { x: 0, y: 0.04 }), {
      density: BIKE.chassisDensity,
      friction: 0.5,
      filterGroupIndex: NO_SELF_COLLIDE,
      userData: "chassis" satisfies FixtureTag,
    });
    // Rider torso and head: touching the ground with these means a crash.
    this.chassis.createFixture(
      new Polygon([
        { x: -0.36, y: 0.5 },
        { x: -0.12, y: 0.5 },
        { x: 0.1, y: 1.04 },
        { x: -0.12, y: 1.06 },
      ]),
      {
        density: BIKE.riderDensity,
        friction: 0.6,
        filterGroupIndex: NO_SELF_COLLIDE,
        userData: "rider" satisfies FixtureTag,
      },
    );
    this.chassis.createFixture(new Circle(RIDER_HEAD, RIDER_HEAD_R), {
      density: BIKE.riderDensity,
      friction: 0.6,
      filterGroupIndex: NO_SELF_COLLIDE,
      userData: "rider" satisfies FixtureTag,
    });

    const makeWheel = (anchor: Vec2Value, tag: FixtureTag) => {
      const body = world.createDynamicBody({
        position: { x: start.x + anchor.x, y: cy + anchor.y },
        angularDamping: 0.2,
        userData: this,
      });
      body.createFixture(new Circle(BIKE.wheelRadius), {
        density: BIKE.wheelDensity,
        friction: stats.grip,
        restitution: 0.05,
        filterGroupIndex: NO_SELF_COLLIDE,
        userData: tag,
      });
      return body;
    };
    this.rear = makeWheel(BIKE.rearAnchor, "wheel-rear");
    this.front = makeWheel(BIKE.frontAnchor, "wheel-front");

    const suspension = {
      frequencyHz: stats.suspensionHz,
      dampingRatio: stats.suspensionDamping,
      enableMotor: true,
      maxMotorTorque: BIKE.coastTorque,
      motorSpeed: 0,
    };
    this.rearJoint = world.createJoint(
      new WheelJoint(suspension, this.chassis, this.rear, this.rear.getPosition(), BIKE.rearAxis),
    )!;
    this.frontJoint = world.createJoint(
      new WheelJoint(
        { ...suspension, maxMotorTorque: 0 },
        this.chassis,
        this.front,
        this.front.getPosition(),
        BIKE.frontAxis,
      ),
    )!;
  }

  get grounded() {
    return this.rearContacts > 0 || this.frontContacts > 0;
  }

  get bodies() {
    return [this.chassis, this.rear, this.front];
  }

  // Shifts the whole bike keeping its motion (seamless jump back to the start for the next lap).
  translate(dx: number, dy: number) {
    for (const b of this.bodies) {
      const p = b.getPosition();
      b.setTransform({ x: p.x + dx, y: p.y + dy }, b.getAngle());
    }
  }

  // Puts the bike upright and at rest on the ground at x (respawn after a crash).
  placeAt(x: number, groundY: number) {
    const cy = spawnHeight(groundY);
    this.chassis.setTransform({ x, y: cy }, 0);
    this.rear.setTransform({ x: x + BIKE.rearAnchor.x, y: cy + BIKE.rearAnchor.y }, 0);
    this.front.setTransform({ x: x + BIKE.frontAnchor.x, y: cy + BIKE.frontAnchor.y }, 0);
    for (const b of this.bodies) {
      b.setLinearVelocity({ x: 0, y: 0 });
      b.setAngularVelocity(0);
      b.setAwake(true);
    }
    this.lean = 0;
    this.leanCmd = 0;
  }

  get speed() {
    return this.chassis.getLinearVelocity().x;
  }

  apply(input: Input, dt: number) {
    const { rearJoint, frontJoint, chassis } = this;

    // Wheels skip off bumps for a few milliseconds; count the bike as airborne only after
    // a short grace time so ground lean and wheelie control don't flip to air spin.
    this.sinceRear = this.rearContacts > 0 ? 0 : this.sinceRear + dt;
    this.sinceGround = this.grounded ? 0 : this.sinceGround + dt;
    const onGround = this.sinceGround < AIR_GRACE;
    const angle = chassis.getAngle();
    const w = chassis.getAngularVelocity();

    // Lean builds up over ~0.15 s instead of snapping to full, so a quick tap is a small
    // correction and only holding the button gives the full rotation.
    const step = BIKE.leanRamp * dt;
    this.leanCmd += Math.max(-step, Math.min(step, input.lean - this.leanCmd));
    const lean = this.leanCmd;

    // Wheelie: pitch is measured from the slope remembered while both wheels were down.
    // On the back wheel an assist steers toward ~30° while leaning back on the gas and
    // back to level otherwise; past the loop-out angle the rider is on their own.
    if (this.rearContacts > 0 && this.frontContacts > 0) this.groundAngle += (angle - this.groundAngle) * Math.min(1, dt * 10);
    const pitch = angle - this.groundAngle;
    const wheelie = this.sinceRear < AIR_GRACE && this.frontContacts === 0 && pitch > 0 && pitch < BIKE.wheelieLoopOut;
    const want = input.gas && lean > 0.2 ? BIKE.wheelieAngle : 0;

    if (input.brake) {
      rearJoint.setMotorSpeed(0);
      rearJoint.setMaxMotorTorque(BIKE.brakeTorque);
      frontJoint.setMotorSpeed(0);
      frontJoint.setMaxMotorTorque(BIKE.brakeTorque * 0.4); // soft front: no endos
    } else if (input.gas) {
      // Like a rider feathering the clutch: drive fades as the nose rises past the target.
      const cut = wheelie ? Math.max(0.15, Math.min(1, 1 - (pitch - want) / 0.2)) : 1;
      rearJoint.setMotorSpeed(-BIKE.maxWheelSpeed * this.power);
      rearJoint.setMaxMotorTorque(BIKE.engineTorque * this.power * cut);
      frontJoint.setMaxMotorTorque(0);
    } else {
      rearJoint.setMotorSpeed(0);
      rearJoint.setMaxMotorTorque(BIKE.coastTorque);
      frontJoint.setMaxMotorTorque(0);
    }

    if (wheelie) {
      const tq = BIKE.wheelieKp * (want - pitch) - BIKE.wheelieKd * w;
      chassis.applyTorque(Math.max(-BIKE.wheelieMaxTorque, Math.min(BIKE.wheelieMaxTorque, tq)), true);
    } else if (Math.abs(lean) > 0.01) {
      if (onGround) {
        if (lean * w < BIKE.groundSpinCap) {
          // Popping the front up from two wheels; once it's up the wheelie assist takes over.
          const lift = lean > 0 && input.gas && this.rearContacts > 0 && this.frontContacts > 0 ? BIKE.wheelieLift * lean : 0;
          chassis.applyTorque(lean * BIKE.groundLeanTorque + lift, true);
        }
      } else {
        // In the air steer angular velocity directly: predictable flips.
        const impulse = (lean * this.stats.airSpin - w) * BIKE.airSpinResponse * chassis.getInertia();
        chassis.applyAngularImpulse(impulse, true);
      }
    }
    if (!wheelie && this.rearContacts > 0 !== this.frontContacts > 0) chassis.applyTorque(-w * BIKE.wheelieDamping, true);

    if (this.rearContacts > 0) {
      const cancel = input.lean > 0 ? BIKE.reactionCancelLeanBack : BIKE.reactionCancelSeated;
      chassis.applyTorque(rearJoint.getMotorTorque(1 / dt) * cancel, true);
    }

    // Progressive spring and bump stop: wheel joints have no travel limit, so stiffen the
    // spring as it compresses and stop the wheel at the end of its travel.
    for (const [joint, wheel] of [
      [rearJoint, this.rear],
      [frontJoint, this.front],
    ] as const) {
      const t = joint.getJointTranslation();
      const k = Math.min(1, Math.max(0, (t - 0.08) / (BIKE.suspensionTravel - 0.08)));
      const hz = this.stats.suspensionHz * (1 + 2 * k);
      if (hz !== joint.getSpringFrequencyHz()) {
        joint.setSpringFrequencyHz(hz);
        joint.setSpringDampingRatio(Math.min(1, this.stats.suspensionDamping + 0.1 * k));
      }
      const over = t - BIKE.suspensionTravel;
      if (over <= 0) continue;
      const axis = chassis.getWorldVector(joint.getLocalAxisA());
      const mW = wheel.getMass();
      const mC = chassis.getMass();
      const j = ((mW * mC) / (mW + mC)) * (Math.max(0, joint.getJointSpeed()) + over * 30);
      const at = wheel.getWorldCenter();
      wheel.applyLinearImpulse({ x: -axis.x * j, y: -axis.y * j }, at, true);
      chassis.applyLinearImpulse({ x: axis.x * j, y: axis.y * j }, at, true);
    }

    this.lean += (input.lean - this.lean) * Math.min(1, dt * 10);
  }
}
