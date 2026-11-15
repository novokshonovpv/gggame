// Step-by-step trace of the open-world bike: `node tools/open-trace.ts [scenario]`.
import RAPIER from "@dimforge/rapier3d-compat";
import { Bike3D, type BikeInput, rotate } from "../src/open/bike3d.ts";

await RAPIER.init();
const DT = 1 / 120;
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;
world.createCollider(RAPIER.ColliderDesc.heightfield(8, 8, new Float32Array(81), { x: 4000, y: 1, z: 4000 }));
const sc = process.argv[2] ?? "gas";
if (sc === "log") world.createCollider(RAPIER.ColliderDesc.cylinder(3, 0.25).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(20, 0.2, 0));
if (sc === "logs")
  for (let i = 0; i < 5; i++) {
    const r = 0.1 + (i % 2) * 0.03;
    world.createCollider(RAPIER.ColliderDesc.cylinder(4, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setTranslation(16 + i * 5.5, r * 0.85, 0));
  }
if (sc === "ramp") world.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array([40, 0, -2, 40, 0, 2, 45, 0, -2, 45, 0, 2, 45, 1.6, -2, 45, 1.6, 2]))!);
const bike = new Bike3D(RAPIER, world, { x: 0, y: 0.95, z: 0 }, 0);
const I = (o: Partial<BikeInput>): BikeInput => ({ gas: 0, brake: 0, rearBrake: 0, lean: 0, ...o });
const input = (t: number): BikeInput => {
  if (t < 1) return I({});
  if (sc === "gas" || sc === "ramp") return I({ gas: 1 });
  if (sc === "log") return I({ gas: 0.6 });
  if (sc === "logs") return I({ gas: 1 });
  if (sc === "slide") return t < 4 ? I({ gas: 1 }) : I({ rearBrake: 1, lean: 0.5 });
  if (sc === "turn") return t < 4 ? I({ gas: 1 }) : I({ gas: 0.5, lean: 1 });
  return I({});
};
const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
const T = Number(process.argv[3] ?? 6);
for (let i = 0; i < T / DT; i++) {
  const t = i * DT;
  bike.apply(input(t), DT);
  world.step();
  if (i % 6 === 0) {
    const q = bike.rotation;
    const F = rotate(q, { x: 1, y: 0, z: 0 });
    const p = bike.position;
    const [f, r] = bike.wheels;
    console.log(
      `t=${t.toFixed(2)} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} z=${p.z.toFixed(2)} v=${(bike.speed * 3.6).toFixed(1)} vy=${bike.body.linvel().y.toFixed(2)} wp=${bike.body.angvel().z.toFixed(2)} pitch=${deg(Math.asin(F.y))} roll=${deg(bike.roll)} yaw=${deg(bike.yaw)} steer=${deg(bike.steer)} g=${bike.gear + 1} rpm=${bike.rpm.toFixed(0)} thr=${bike.throttle.toFixed(2)} | F ${f.contact ? "c" : "-"} x=${f.x.toFixed(3)} N=${f.load.toFixed(0)} w=${f.omega.toFixed(1)} s=${f.slip.toFixed(2)} | R ${r.contact ? "c" : "-"} x=${r.x.toFixed(3)} N=${r.load.toFixed(0)} w=${r.omega.toFixed(1)} s=${r.slip.toFixed(2)} ${bike.crashed ? "CRASH " + bike.crashReason : ""}`,
    );
  }
}
