// Trace riding at a log: `node tools/open-log.ts [radius] [gas]`.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 60;
const r = Number(process.argv[2] ?? 0.25);
const gas = Number(process.argv[3] ?? 0.7);
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.cuboid(500, 0.5, 500).setTranslation(0, -0.5, 0).setFriction(0.9));
world.createCollider(RAPIER.ColliderDesc.cylinder(3, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(20, r * 0.8, 0));
const bike = new Bike3D(RAPIER, world, { x: 0, y: 1.0, z: 0 }, 0);
for (let i = 0; i < 6 / DT; i++) {
  bike.apply({ gas, brake: 0, steer: 0 }, DT);
  world.step();
  const p = bike.position;
  if (p.x > 17.5 && p.x < 23 && i % 2 === 0) {
    const f = rotate(bike.rotation, { x: 1, y: 0, z: 0 });
    console.log(`x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} v=${bike.speed.toFixed(1)} pitch=${((Math.asin(f.y) * 180) / Math.PI).toFixed(0)} contact=${bike.vc.wheelIsInContact(0) ? 1 : 0}${bike.vc.wheelIsInContact(1) ? 1 : 0} susp=${bike.wheelState(0).travel.toFixed(2)},${bike.wheelState(1).travel.toFixed(2)}`);
  }
}
console.log("end x", bike.position.x.toFixed(1), "crashed", bike.crashed);
