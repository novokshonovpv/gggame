// Headless checks of the open-world bike: `node tools/open-sim.ts`.
// Acceleration and top speed, braking, which way the bars steer, lean in a turn,
// riding over a log, a ramp jump and its landing.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, type BikeInput, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 60;

function setup(extra?: (w: RAPIER.World) => void) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.9));
  extra?.(world);
  const bike = new Bike3D(RAPIER, world, { x: 0, y: 1.0, z: 0 }, 0);
  return { world, bike };
}

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
  return `x=${p.x.toFixed(1)} y=${p.y.toFixed(2)} z=${p.z.toFixed(1)} v=${(b.speed * 3.6).toFixed(0)}km/h yaw=${deg(b.yaw)} roll=${deg(b.roll)} up=${u.y.toFixed(2)} ground=${b.grounded} crashed=${b.crashed}`;
};

// 1. Settle, then full gas.
{
  const { world, bike } = setup();
  run(world, bike, 1.5, () => ({ gas: 0, brake: 0, steer: 0 }));
  console.log("settled   ", fmt(bike), "susp", bike.wheelState(0).travel.toFixed(2), bike.wheelState(1).travel.toFixed(2));
  let t60 = 0;
  run(world, bike, 12, () => ({ gas: 1, brake: 0, steer: 0 }), (t) => {
    if (!t60 && bike.speed * 3.6 >= 60) t60 = t;
  });
  console.log("12 s gas  ", fmt(bike), "0-60 in", t60.toFixed(1), "s");
  let stop = 0;
  run(world, bike, 6, () => ({ gas: 0, brake: 1, steer: 0 }), (t) => {
    if (!stop && bike.speed < 0.5) stop = t;
  });
  console.log("braking   ", fmt(bike), "stopped in", stop.toFixed(1), "s");
}

// 2. Steering: right input at speed should turn right (yaw decreasing) and lean right.
{
  const { world, bike } = setup();
  run(world, bike, 4, () => ({ gas: 1, brake: 0, steer: 0 }));
  run(world, bike, 2, () => ({ gas: 0.6, brake: 0, steer: 1 }));
  console.log("turn right", fmt(bike));
  run(world, bike, 3, () => ({ gas: 0.6, brake: 0, steer: -1 }));
  console.log("turn left ", fmt(bike));
  run(world, bike, 3, () => ({ gas: 0, brake: 0, steer: 0 }));
  console.log("coast     ", fmt(bike));
}

// 3. A log across the path (r = 0.25) at x = 20.
{
  const { world, bike } = setup((w) => {
    w.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.25).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(20, 0.2, 0));
  });
  let minUp = 1;
  run(world, bike, 6, () => ({ gas: 0.7, brake: 0, steer: 0 }), () => {
    minUp = Math.min(minUp, rotate(bike.rotation, { x: 0, y: 1, z: 0 }).y);
  });
  console.log("log       ", fmt(bike), "min up", minUp.toFixed(2));
}

// 4. A ramp: 1.6 m high over 5 m at x = 25..30, flat landing.
{
  const { world, bike } = setup((w) => {
    const pts = new Float32Array([25, 0, -2, 25, 0, 2, 30, 0, -2, 30, 0, 2, 30, 1.6, -2, 30, 1.6, 2]);
    w.createCollider(RAPIER.ColliderDesc.convexHull(pts)!);
  });
  let maxY = 0;
  let air = 0;
  let maxAir = 0;
  run(world, bike, 7, () => ({ gas: 1, brake: 0, steer: 0 }), () => {
    maxY = Math.max(maxY, bike.position.y);
    air = bike.grounded ? 0 : air + DT;
    maxAir = Math.max(maxAir, air);
  });
  console.log("ramp      ", fmt(bike), "max y", maxY.toFixed(1), "air", maxAir.toFixed(2), "s");
}

// 5. Standing still with the bars turned: must not fall over.
{
  const { world, bike } = setup();
  run(world, bike, 4, () => ({ gas: 0, brake: 0, steer: 1 }));
  console.log("standing  ", fmt(bike));
}
