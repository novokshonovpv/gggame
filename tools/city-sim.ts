// Runs the city without a browser: traffic, pedestrians and the police around a player who
// rides a fixed loop. Prints how much traffic is stuck and why. `node tools/city-sim.ts [seconds]`
import { CityMap } from "../src/city/map.ts";
import { type Input, World } from "../src/city/sim.ts";

const secs = Number(process.argv[2] ?? 120);
const map = new CityMap(67);
const world = new World(map);
const b = world.player.body;
world.view = { x0: b.x - 450, y0: b.y - 250, x1: b.x + 450, y1: b.y + 250 };
world.populate(true);
const idle: Input = { gas: false, brake: false, left: false, right: false, hb: false, action: false, kick: false, fire: false, swap: false, sprint: false };
const dt = 1 / 60;
const stuckFor = new Map<number, number>();
for (let i = 0; i < secs * 60; i++) {
  world.view = { x0: world.px - 450, y0: world.py - 250, x1: world.px + 450, y1: world.py + 250 };
  world.step(dt, idle);
  world.events.length = 0;
  for (const v of world.vehicles) {
    if (!v.ai || v.rider !== "npc") continue;
    stuckFor.set(v.id, v.speed < 5 ? (stuckFor.get(v.id) ?? 0) + dt : 0);
  }
  if (i % (10 * 60) === 0) {
    const ai = world.vehicles.filter((v) => v.ai && v.rider === "npc");
    const long = ai.filter((v) => (stuckFor.get(v.id) ?? 0) > 8);
    console.log(`t=${(i / 60).toFixed(0)} ai=${ai.length} stuck>8s=${long.length} peds=${world.peds.length}`);
    for (const v of long.slice(0, 6)) {
      const tx = Math.floor(v.x / 32);
      const ty = Math.floor(v.y / 32);
      const t = v.ai!.path[0];
      console.log(`  ${v.model.id} #${v.id} tile ${tx},${ty} (${map.at(tx, ty)}) dir ${v.ai!.dir} a=${v.a.toFixed(2)} target ${t ? `${Math.round(t.x - v.x)},${Math.round(t.y - v.y)}` : "-"} wait ${v.ai!.wait.toFixed(1)} thr ${v.thr} brk ${v.brk.toFixed(2)}`);
    }
  }
}
