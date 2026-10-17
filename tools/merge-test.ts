// Checks how cloud save merges two devices' progress: `node tools/merge-test.ts`.
import assert from "node:assert/strict";
import { type Profile, normalize } from "../src/garage.ts";
import { type Snapshot, merge } from "../src/progress.ts";

const profile = (p: Partial<Profile>): Profile => normalize({ updatedAt: 0, ...p });

// Phone: older save, engine 3, bought lime paint and the 125, record on forest, mission 0.
const phone: Snapshot = {
  profile: profile({ coins: 500, levels: { engine: 3, grip: 0, suspension: 1, air: 0 }, owned: ["factory", "lime"], paint: "lime", bikes: ["250", "125"], bike: "125", updatedAt: 1000 }),
  missions: { "forest:0": [true, false, false, false, false] },
  best: { forest_0_250: 75.2 },
  places: { forest_0_250: 2 },
  wins: { forest: 0 },
};
// Laptop: newer save, spent coins on grip, bought ice and a red jersey, better smolensk time.
const laptop: Snapshot = {
  profile: profile({ coins: 40, levels: { engine: 1, grip: 4, suspension: 0, air: 2 }, owned: ["factory", "ice", "jersey:red"], paint: "ice", gear: { jersey: "jersey:red", pants: "pants:blue", helmet: "helmet:white", boots: "boots:white" }, updatedAt: 2000 }),
  missions: { "forest:0": [false, false, true, false, true], "smolensk:1": [true, true, false, false, false] },
  best: { forest_0_250: 80.1, smolensk_1_250: 30.5 },
  places: { forest_0_250: 1 },
  wins: { forest: 1, smolensk: 0 },
};

for (const [a, b] of [
  [phone, laptop],
  [laptop, phone],
]) {
  const m = merge(a, b);
  assert.equal(m.profile.coins, 40, "coins come from the newer save");
  assert.deepEqual(m.profile.levels, { engine: 3, grip: 4, suspension: 1, air: 2 }, "upgrades never go down");
  for (const id of ["factory", "ice", "lime", "jersey:red"]) assert.ok(m.profile.owned.includes(id), `owns ${id}`);
  assert.deepEqual([...m.profile.bikes].sort(), ["125", "250"], "bikes are united");
  assert.equal(m.profile.paint, "ice", "paint from the newer save");
  assert.equal(m.profile.gear.jersey, "jersey:red", "gear from the newer save");
  assert.equal(m.profile.updatedAt, 2000);
  assert.deepEqual(m.missions["forest:0"], [true, false, true, false, true], "missions OR-ed");
  assert.deepEqual(m.missions["smolensk:1"], [true, true, false, false, false]);
  assert.equal(m.best.forest_0_250, 75.2, "best time is the minimum");
  assert.equal(m.places!.forest_0_250, 1, "best place is the minimum");
  assert.deepEqual(m.wins, { forest: 1, smolensk: 0 }, "highest level won");
}

// Merging twice changes nothing more.
const once = merge(phone, laptop);
assert.deepEqual(merge(once, once), once);
console.log("merge: all checks passed");
