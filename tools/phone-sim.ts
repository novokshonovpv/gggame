// Payphone jobs without a browser: picks up each kind of call and plays on, timing every step.
// `node tools/phone-sim.ts`
import { CityMap } from "../src/city/map.ts";
import { type Input, World } from "../src/city/sim.ts";

const map = new CityMap(67);
const idle: Input = { gas: false, brake: false, left: false, right: false, hb: false, action: false, kick: false, fire: false, swap: false, sprint: false };
for (const pick of [0.99, 0.5, 0.1]) for (const ride of [true, false]) {
  const world = new World(map);
  const b = world.player.body;
  world.view = { x0: b.x - 450, y0: b.y - 250, x1: b.x + 450, y1: b.y + 250 };
  world.populate(true);
  if (!ride) world.step(1 / 60, { ...idle, action: true });
  const w = world as unknown as { r: () => number; startPhoneJob: (p: { x: number; y: number }) => void };
  const r = w.r;
  w.r = () => pick;
  w.startPhoneJob({ x: world.px, y: world.py });
  w.r = r;
  let worst = 0;
  const t0 = performance.now();
  for (let i = 0; i < 90 * 60; i++) {
    world.view = { x0: world.px - 450, y0: world.py - 250, x1: world.px + 450, y1: world.py + 250 };
    const s = performance.now();
    world.step(1 / 60, { ...idle, gas: ride && i % 600 < 400, right: i % 300 < 40 });
    worst = Math.max(worst, performance.now() - s);
    world.events.length = 0;
  }
  console.log(`call ${pick} ${ride ? "ride" : "foot"}: ${(performance.now() - t0).toFixed(0)} ms for 90 s, worst step ${worst.toFixed(1)} ms, job ${world.job?.title ?? "—"}, wanted ${world.wanted}, mode ${world.player.mode}`);
}
