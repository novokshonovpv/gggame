// How deep the suspension compresses over a full autopilot lap: `node tools/suspension.ts`.
import { autopilot } from "../src/ai.ts";
import { PLAYER_LOOK, Race } from "../src/race.ts";
import { BASE_STATS } from "../src/bike.ts";
import { TRACKS } from "../src/track.ts";

const DT = 1 / 120;
for (const track of TRACKS) {
  const race = new Race(track, { look: PLAYER_LOOK, stats: BASE_STATS }, {}, 1);
  race.started = true;
  const p = race.player!;
  let rear = 0;
  let front = 0;
  let rearMax = 0;
  let frontMax = 0;
  const deep: number[] = [];
  while (!p.finished && race.time < 200) {
    race.step(DT, autopilot(p.bike, track));
    // Joint translation is negative when compressed; collect the worst per landing.
    const r = p.bike.rearJoint.getJointTranslation();
    const f = p.bike.frontJoint.getJointTranslation();
    rear = Math.min(rear, r);
    front = Math.min(front, f);
    rearMax = Math.max(rearMax, r);
    frontMax = Math.max(frontMax, f);
    deep.push(Math.min(r, f));
  }
  deep.sort((a, b) => a - b);
  const p95 = deep[Math.floor(deep.length * 0.01)];
  console.log(`${track.name.padEnd(16)} max rear ${(-rear * 100).toFixed(0)} cm, front ${(-front * 100).toFixed(0)} cm, worst 1% ${(-p95 * 100).toFixed(0)} cm | opposite: rear ${(rearMax * 100).toFixed(0)} cm, front ${(frontMax * 100).toFixed(0)} cm`);
}
