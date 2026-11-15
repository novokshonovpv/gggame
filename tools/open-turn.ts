// Trace a turn at speed: `node tools/open-turn.ts [gasSeconds] [steer]`.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 60;
const gasT = Number(process.argv[2] ?? 4);
const steer = Number(process.argv[3] ?? 1);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.9));
const bike = new Bike3D(RAPIER, world, { x: 0, y: 1.0, z: 0 }, 0);
for (let i = 0; i < (gasT + 2.5) / DT; i++) {
  const t = i * DT;
  bike.apply({ gas: t < gasT ? 1 : 0.6, brake: 0, steer: t < gasT ? 0 : steer }, DT);
  world.step();
  if (t >= gasT - 0.1 && i % 5 === 0) {
    const U = rotate(bike.rotation, { x: 0, y: 1, z: 0 });
    const wy = bike.body.angvel();
    const yawRate = wy.x * U.x + wy.y * U.y + wy.z * U.z;
    const want = Math.atan((bike.speed * yawRate) / 9.81);
    console.log(
      `t=${(t - gasT).toFixed(2)} v=${bike.speed.toFixed(1)} steer=${bike.steer.toFixed(3)} yawRate=${yawRate.toFixed(2)} roll=${((bike.roll * 180) / Math.PI).toFixed(0)} target=${((-want * 180) / Math.PI).toFixed(0)} contact=${bike.vc.wheelIsInContact(0) ? 1 : 0}${bike.vc.wheelIsInContact(1) ? 1 : 0} side=${(bike.vc.wheelSideImpulse(0) ?? 0).toFixed(0)},${(bike.vc.wheelSideImpulse(1) ?? 0).toFixed(0)}`,
    );
  }
}
