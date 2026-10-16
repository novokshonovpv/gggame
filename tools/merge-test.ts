// Checks how cloud save merges two devices' progress: `node tools/merge-test.ts`.
import assert from "node:assert/strict";
import type { Profile } from "../src/garage.ts";
import { type Snapshot, merge } from "../src/progress.ts";

const profile = (p: Partial<Profile>): Profile => ({
  coins: 0,
  levels: { engine: 0, grip: 0, suspension: 0, air: 0 },
  paint: "factory",
  owned: ["factory"],
  updatedAt: 0,
  ...p,
});

// Phone: older save, engine 3, bought lime, record on canyon, mission 0 on canyon.
const phone: Snapshot = {
  profile: profile({ coins: 500, levels: { engine: 3, grip: 0, suspension: 1, air: 0 }, owned: ["factory", "lime"], paint: "lime", updatedAt: 1000 }),
  missions: { canyon: [true, false, false] },
  best: { canyon: 75.2 },
};
// Laptop: newer save, spent coins on grip, bought ice, better forest time, mission 2 on canyon.
const laptop: Snapshot = {
  profile: profile({ coins: 40, levels: { engine: 1, grip: 4, suspension: 0, air: 2 }, owned: ["factory", "ice"], paint: "ice", updatedAt: 2000 }),
  missions: { canyon: [false, false, true], forest: [true, true, false] },
  best: { canyon: 80.1, forest: 90.5 },
};

for (const [a, b] of [
  [phone, laptop],
  [laptop, phone],
]) {
  const m = merge(a, b);
  assert.equal(m.profile.coins, 40, "coins come from the newer save");
  assert.deepEqual(m.profile.levels, { engine: 3, grip: 4, suspension: 1, air: 2 }, "upgrades never go down");
  assert.deepEqual([...m.profile.owned].sort(), ["factory", "ice", "lime"], "purchases are united");
  assert.equal(m.profile.paint, "ice", "paint from the newer save");
  assert.equal(m.profile.updatedAt, 2000);
  assert.deepEqual(m.missions.canyon, [true, false, true], "missions OR-ed");
  assert.deepEqual(m.missions.forest, [true, true, false]);
  assert.equal(m.best.canyon, 75.2, "best time is the minimum");
  assert.equal(m.best.forest, 90.5);
}

// Merging with itself changes nothing.
assert.deepEqual(merge(phone, phone), phone);
console.log("merge: all checks passed");
