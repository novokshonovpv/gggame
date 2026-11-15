// Frame-by-frame trace of the open-world bike under full gas: `node tools/open-trace.ts [seconds]`.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 60;
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.9));
const bike = new Bike3D(RAPIER, world, { x: 0, y: 1.0, z: 0 }, 0);
const secs = Number(process.argv[2] ?? 3);
for (let i = 0; i < (1.5 + secs) / DT; i++) {
  const t = i * DT;
  bike.apply({ gas: t > 1.5 ? 1 : 0, brake: 0, steer: 0 }, DT);
  world.step();
  if (t > 1.4 && i % 6 === 0) {
    const f = rotate(bike.rotation, { x: 1, y: 0, z: 0 });
    const w = bike.body.angvel();
    console.log(
      `t=${(t - 1.5).toFixed(2)} v=${bike.speed.toFixed(1)} pitch=${((Math.asin(f.y) * 180) / Math.PI).toFixed(0)} roll=${((bike.roll * 180) / Math.PI).toFixed(0)} yaw=${((bike.yaw * 180) / Math.PI).toFixed(0)} ` +
        `w=(${w.x.toFixed(1)},${w.y.toFixed(1)},${w.z.toFixed(1)}) contact=${bike.vc.wheelIsInContact(0) ? 1 : 0}${bike.vc.wheelIsInContact(1) ? 1 : 0} ` +
        `side=${(bike.vc.wheelSideImpulse(0) ?? 0).toFixed(1)},${(bike.vc.wheelSideImpulse(1) ?? 0).toFixed(1)}`,
    );
  }
}
