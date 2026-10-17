// Headless full races with AI rivals and the autopilot as the player, on every track and
// difficulty level: `node tools/race.ts [seed] [stock|max] [class]`. The autopilot rides
// cleaner than most people, so "very hard" means it should struggle on Профи.
import { autopilot } from "../src/ai.ts";
import { BASE_STATS } from "../src/bike.ts";
import { type BikeClass, DIFFICULTIES, bikeSpec } from "../src/catalog.ts";
import { PLAYER_LOOK, Race } from "../src/race.ts";
import { TRACKS } from "../src/track.ts";

const DT = 1 / 120;
const seed = Number(process.argv[2] ?? 1);
const maxed = process.argv[3] === "max";
const cls = (process.argv[4] ?? "250") as BikeClass;
const bike = bikeSpec(cls);
const stats = {
  ...BASE_STATS,
  power: bike.power * (maxed ? 1.175 : 1),
  grip: maxed ? BASE_STATS.grip + 0.6 : BASE_STATS.grip,
  suspensionDamping: maxed ? 1 : BASE_STATS.suspensionDamping,
  airSpin: BASE_STATS.airSpin + bike.airSpin + (maxed ? 1.5 : 0),
};

for (const d of DIFFICULTIES) {
  const places: number[] = [];
  let rivalCrashes = 0;
  let playerCrashes = 0;
  for (const track of TRACKS) {
    const race = new Race(track, { look: PLAYER_LOOK, stats }, {}, seed, { difficulty: d.id, cls });
    race.started = true;
    const player = race.player!;
    while (race.time < 300 && !race.racers.every((r) => r.finished)) race.step(DT, autopilot(player.bike, track));
    places.push(race.placeOf(player));
    rivalCrashes += race.racers.filter((r) => !r.isPlayer).reduce((n, r) => n + r.crashes, 0);
    playerCrashes += player.crashes;
  }
  const wins = places.filter((p) => p === 1).length;
  console.log(`${d.name.padEnd(8)} places ${places.join(" ")}  wins ${wins}/${TRACKS.length}  rival crashes ${rivalCrashes}  player crashes ${playerCrashes}`);
}
