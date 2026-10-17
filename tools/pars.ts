// Reference numbers for missions: the autopilot's time, top speed and longest air on every
// track, per engine power. `node tools/pars.ts [power...]` (default 0.9 1 1.1 1.2).
import { autopilot } from "../src/ai.ts";
import { BASE_STATS } from "../src/bike.ts";
import { PLAYER_LOOK, Race } from "../src/race.ts";
import { TRACKS } from "../src/track.ts";

const DT = 1 / 120;
const powers = process.argv.length > 2 ? process.argv.slice(2).map(Number) : [0.9, 1, 1.1, 1.2];

for (const power of powers) {
  console.log(`power ${power}`);
  for (const track of TRACKS) {
    const race = new Race(track, { look: PLAYER_LOOK, stats: { ...BASE_STATS, power } }, {}, 7);
    race.started = true;
    const p = race.player!;
    let vmax = 0;
    let air = 0;
    let maxAir = 0;
    while (race.time < 300 && !p.finished) {
      race.step(DT, autopilot(p.bike, track));
      vmax = Math.max(vmax, p.bike.chassis.getLinearVelocity().x);
      air = p.bike.grounded ? 0 : air + DT;
      maxAir = Math.max(maxAir, air);
    }
    const t = p.finished ? p.finishTime.toFixed(1) : "DNF";
    console.log(`  ${track.id.padEnd(12)} time=${t} vmax=${(vmax * 3.6).toFixed(0)} air=${maxAir.toFixed(2)} crashes=${p.crashes}`);
  }
}
