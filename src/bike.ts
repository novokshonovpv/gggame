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
  suspensionHz: 4.2,
  suspensionDamping: 0.75,
  maxWheelSpeed: 62, // rad/s → ~21 m/s (~76 km/h)
  engineTorque: 340,
  brakeTorque: 420,
  coastTorque: 6,
  groundLeanTorque: 300,
  groundSpinCap: 1.4, // rad/s: lean on the ground stops pushing past this (controllable wheelies)
  // Share of engine reaction torque removed on the ground. Leaning back keeps more of it,
  // so the rider's weight shift is what pops a wheelie.
  reactionCancelSeated: 0.6,
  reactionCancelLeanBack: 0.3,
  wheelieDamping: 160, // N·m per rad/s while on one wheel: arcade-forgiving balance
  wheelieThrottleCut: 0.3, // engine share on the rear wheel alone unless the rider leans back
  airSpinRate: 5.2, // rad/s target when leaning in the air
  airSpinResponse: 0.12, // fraction of the gap closed per physics step
};

// Local-space points (relative to chassis origin) shared by physics and rendering.
export const RIDER_HEAD = { x: 0.06, y: 1.22 };
export const RIDER_HEAD_R = 0.17;

export type FixtureTag = "ground" | "wheel-rear" | "wheel-front" | "rider" | "chassis";

export interface Input {
  gas: boolean;
  brake: boolean;
  lean: number; // +1 = back (nose up), -1 = forward
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
  }

  get speed() {
    return this.chassis.getLinearVelocity().x;
  }

  apply(input: Input, dt: number) {
    const { rearJoint, frontJoint, chassis } = this;

    if (input.brake) {
      rearJoint.setMotorSpeed(0);
      rearJoint.setMaxMotorTorque(BIKE.brakeTorque);
      frontJoint.setMotorSpeed(0);
      frontJoint.setMaxMotorTorque(BIKE.brakeTorque * 0.4); // soft front: no endos
    } else if (input.gas) {
      const wheelie = this.rearContacts > 0 && this.frontContacts === 0 && chassis.getAngularVelocity() > -0.3;
      const cut = wheelie && input.lean <= 0 ? BIKE.wheelieThrottleCut : 1;
      rearJoint.setMotorSpeed(-BIKE.maxWheelSpeed * this.power);
      rearJoint.setMaxMotorTorque(BIKE.engineTorque * this.power * cut);
      frontJoint.setMaxMotorTorque(0);
    } else {
      rearJoint.setMotorSpeed(0);
      rearJoint.setMaxMotorTorque(BIKE.coastTorque);
      frontJoint.setMaxMotorTorque(0);
    }

    if (input.lean !== 0) {
      if (this.grounded) {
        if (input.lean * chassis.getAngularVelocity() < BIKE.groundSpinCap)
          chassis.applyTorque(input.lean * BIKE.groundLeanTorque, true);
      } else {
        // In the air steer angular velocity directly: crisp, predictable flips.
        const w = chassis.getAngularVelocity();
        const target = input.lean * this.stats.airSpin;
        const impulse = (target - w) * BIKE.airSpinResponse * chassis.getInertia();
        chassis.applyAngularImpulse(impulse, true);
      }
    }

    if (this.rearContacts > 0) {
      const cancel = input.lean > 0 ? BIKE.reactionCancelLeanBack : BIKE.reactionCancelSeated;
      chassis.applyTorque(rearJoint.getMotorTorque(1 / dt) * cancel, true);
    }

    if (this.rearContacts > 0 !== this.frontContacts > 0)
      chassis.applyTorque(-chassis.getAngularVelocity() * BIKE.wheelieDamping, true);

    this.lean += (input.lean - this.lean) * Math.min(1, dt * 10);
  }
}
