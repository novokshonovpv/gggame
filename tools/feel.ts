// Standard maneuvers on flat ground for tuning the bike: `node tools/feel.ts`.
import { Chain, World } from "planck";
import { BIKE, Bike, type FixtureTag, type Input } from "../src/bike.ts";

const DT = 1 / 120;

type Step = [seconds: number, input: Partial<Input>];

function maneuver(name: string, steps: Step[]) {
  const world = new World({ gravity: { x: 0, y: -11 } });
  world.createBody().createFixture(new Chain([{ x: -50, y: 0 }, { x: 2000, y: 0 }]), { friction: 0.9, userData: "ground" });
  const bike = new Bike(world, { x: 0, y: 0 });
  let crashed = false;
  const on = (d: number) => (c: any) => {
    const a = c.getFixtureA().getUserData() as FixtureTag;
    const b = c.getFixtureB().getUserData() as FixtureTag;
    const o = a === "ground" ? b : a;
    if (o === "wheel-rear") bike.rearContacts += d;
    else if (o === "wheel-front") bike.frontContacts += d;
    else if (o === "rider" && d > 0) crashed = true;
  };
  world.on("begin-contact", on(1));
  world.on("end-contact", on(-1));

  const log: string[] = [];
  let t = 0;
  for (const [secs, partial] of steps) {
    const input: Input = { gas: false, brake: false, lean: 0, ...partial };
    for (let i = 0; i < secs / DT; i++) {
      bike.apply(input, DT);
      world.step(DT, 8, 3);
      t += DT;
      if (Math.round(t * 120) % 24 === 0)
        log.push(`${t.toFixed(1)}s ${(bike.speed * 3.6).toFixed(0)}km/h ${((bike.chassis.getAngle() * 180) / Math.PI).toFixed(0)}°`);
      if (crashed) break;
    }
    if (crashed) break;
  }
  console.log(`${name}${crashed ? " → CRASH" : ""}\n  ${log.join(" | ")}`);
}

console.log(`groundLeanTorque=${BIKE.groundLeanTorque} engine=${BIKE.engineTorque} brake=${BIKE.brakeTorque}`);
// Start from a settled bike at speed: the first frames after spawning are airborne.
maneuver("accel", [[3, { gas: true }]]);
maneuver("wheelie hold from riding", [[1, {}], [1, { gas: true }], [5, { gas: true, lean: 1 }]]);
maneuver("wheelie release from riding", [[1, {}], [1, { gas: true }], [1.5, { gas: true, lean: 1 }], [1.5, { gas: true }]]);
maneuver("brake from speed", [[2, { gas: true }], [1.6, { brake: true }]]);
maneuver("wheelie (gas+back)", [[2, { gas: true, lean: 1 }]]);
maneuver("wheelie then release", [[0.9, { gas: true, lean: 1 }], [1.5, { gas: true }]]);
maneuver("wheelie then lean fwd", [[1.1, { gas: true, lean: 1 }], [0.6, { gas: true, lean: -1 }], [1, { gas: true }]]);
maneuver("lean forward at speed", [[1.5, { gas: true }], [1.5, { gas: true, lean: -1 }]]);
