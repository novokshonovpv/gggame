// Headless full race with AI rivals (and the autopilot as the player): `node tools/race.ts [seed]`.
import { autopilot } from "../src/ai.ts";
import { BASE_STATS, type BikeStats } from "../src/bike.ts";
import { PLAYER_LOOK, Race } from "../src/race.ts";
import { TRACKS } from "../src/track.ts";

const DT = 1 / 120;
const seed = Number(process.argv[2] ?? 1);
// `node tools/race.ts <seed> max` races the autopilot on a fully upgraded bike.
const maxed: BikeStats = { power: 1.175, grip: 1.9, suspensionHz: 3.5, suspensionDamping: 0.95, airSpin: 6.7 };
const stats = process.argv[3] === "max" ? maxed : BASE_STATS;

for (const track of TRACKS) {
  const race = new Race(track, { look: PLAYER_LOOK, stats }, {}, seed);
  race.started = true;
  const player = race.player!;
  while (race.time < 300 && !race.racers.every((r) => r.finished)) race.step(DT, autopilot(player.bike, track));
  const rows = race.standings().map((r, i) => {
    const t = r.finished ? r.finishTime.toFixed(1) + "s" : `DNF lap ${r.lap} x=${r.x.toFixed(0)}`;
    return `${i + 1}. ${r.look.name.padEnd(6)} ${t.padStart(7)} crashes=${r.crashes}`;
  });
  console.log(`${track.name} (${track.laps} кр.)\n  ${rows.join("\n  ")}`);
}
