// Headless checks of the open-world bike: `node tools/open-sim.ts`.
// Pull-away and top speed, braking, leaning into turns, a log, a ramp jump, standing still.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, type BikeInput, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 120;

function setup(extra?: (w: RAPIER.World) => void) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.heightfield(8, 8, new Float32Array(81), { x: 4000, y: 1, z: 4000 }).setFriction(0.9));
  extra?.(world);
  const bike = new Bike3D(RAPIER, world, { x: 0, y: 0.95, z: 0 }, 0);
  return { world, bike };
}

const I = (o: Partial<BikeInput>): BikeInput => ({ gas: 0, brake: 0, rearBrake: 0, lean: 0, ...o });

function run(world: RAPIER.World, bike: Bike3D, seconds: number, input: (t: number) => BikeInput, log?: (t: number) => void) {
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT;
    bike.apply(input(t), DT);
    world.step();
    log?.(t);
  }
}

const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
const fmt = (b: Bike3D) => {
  const p = b.position;
  const u = rotate(b.rotation, { x: 0, y: 1, z: 0 });
  return `x=${p.x.toFixed(1)} y=${p.y.toFixed(2)} z=${p.z.toFixed(1)} v=${(b.speed * 3.6).toFixed(0)}km/h yaw=${deg(b.yaw)} roll=${deg(b.roll)} steer=${deg(b.steer)} up=${u.y.toFixed(2)} gear=${b.gear + 1} rpm=${b.rpm.toFixed(0)} ground=${b.grounded} crashed=${b.crashed}${b.crashReason ? " " + b.crashReason : ""}`;
};

// 1. Settle, then full gas, then brake.
{
  const { world, bike } = setup();
  run(world, bike, 1.5, () => I({}));
  console.log("settled   ", fmt(bike), "comp", bike.wheels[0].x.toFixed(3), bike.wheels[1].x.toFixed(3));
  let t60 = 0;
  let t100 = 0;
  let maxPitch = 0;
  run(world, bike, 14, () => I({ gas: 1 }), (t) => {
    if (!t60 && bike.speed * 3.6 >= 60) t60 = t;
    if (!t100 && bike.speed * 3.6 >= 100) t100 = t;
    maxPitch = Math.max(maxPitch, rotate(bike.rotation, { x: 1, y: 0, z: 0 }).y);
  });
  console.log("14 s gas  ", fmt(bike), "0-60", t60.toFixed(1), "0-100", t100.toFixed(1), "max nose-up", deg(Math.asin(maxPitch)));
  let stop = 0;
  run(world, bike, 8, () => I({ brake: 1 }), (t) => {
    if (!stop && bike.speed < 0.5) stop = t;
  });
  console.log("braking   ", fmt(bike), "stopped in", stop.toFixed(1), "s");
}

// 2. Lean right at speed, then left, then let go.
{
  const { world, bike } = setup();
  run(world, bike, 4, () => I({ gas: 1 }));
  console.log("before    ", fmt(bike));
  let minSteer = 0;
  run(world, bike, 0.4, () => I({ gas: 0.5, lean: 1 }), () => (minSteer = Math.min(minSteer, bike.steer)));
  console.log("0.4s right", fmt(bike), "countersteer", deg(minSteer));
  run(world, bike, 2.6, () => I({ gas: 0.5, lean: 1 }));
  console.log("3s right  ", fmt(bike));
  run(world, bike, 3, () => I({ gas: 0.5, lean: -1 }));
  console.log("3s left   ", fmt(bike));
  run(world, bike, 3, () => I({ gas: 0.3 }));
  console.log("straight  ", fmt(bike));
}

// 3. Slow tight turn.
{
  const { world, bike } = setup();
  run(world, bike, 1, () => I({ gas: 0.4 }));
  run(world, bike, 4, () => I({ gas: 0.25, lean: -1 }));
  console.log("slow left ", fmt(bike));
}

// 4. A log across the path (r = 0.25) at x = 20.
{
  const { world, bike } = setup((w) => {
    w.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.25).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(20, 0.2, 0));
  });
  let minUp = 1;
  run(world, bike, 6, () => I({ gas: 0.6 }), () => {
    minUp = Math.min(minUp, rotate(bike.rotation, { x: 0, y: 1, z: 0 }).y);
  });
  console.log("log       ", fmt(bike), "min up", minUp.toFixed(2));
}

// 5. A ramp: 1.6 m high over 5 m at x = 40..45, flat landing.
{
  const { world, bike } = setup((w) => {
    const pts = new Float32Array([40, 0, -2, 40, 0, 2, 45, 0, -2, 45, 0, 2, 45, 1.6, -2, 45, 1.6, 2]);
    w.createCollider(RAPIER.ColliderDesc.convexHull(pts)!);
  });
  let maxY = 0;
  let air = 0;
  let maxAir = 0;
  run(world, bike, 8, () => I({ gas: 1 }), () => {
    maxY = Math.max(maxY, bike.position.y);
    air = bike.grounded ? 0 : air + DT;
    maxAir = Math.max(maxAir, air);
  });
  console.log("ramp      ", fmt(bike), "max y", maxY.toFixed(1), "air", maxAir.toFixed(2), "s");
}

// 6. Standing still, leaning on the bars: must not fall over.
{
  const { world, bike } = setup();
  run(world, bike, 4, () => I({ lean: 1 }));
  console.log("standing  ", fmt(bike));
}

// 7. Rear brake slide at speed.
{
  const { world, bike } = setup();
  run(world, bike, 3, () => I({ gas: 1 }));
  run(world, bike, 1.5, () => I({ rearBrake: 1, lean: 0.5 }));
  console.log("rear slide", fmt(bike));
}

// 8. The stadium log section: five logs (r 0.10 / 0.13) every 5.5 m, from 16 m back.
for (const gas of [1, 0.6, 0.35]) {
  const { world, bike } = setup((w) => {
    for (let i = 0; i < 5; i++) {
      const r = 0.1 + (i % 2) * 0.03;
      w.createCollider(RAPIER.ColliderDesc.cylinder(4, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(16 + i * 5.5, r * 0.85, 0));
    }
  });
  let maxY = 0;
  run(world, bike, 7, () => I({ gas }), () => (maxY = Math.max(maxY, bike.position.y)));
  console.log(`logs gas ${gas}`, fmt(bike), "max y", maxY.toFixed(2));
}
