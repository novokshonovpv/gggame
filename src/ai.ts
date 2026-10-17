import type { Bike, Input } from "./bike.ts";
import { groundY, type Track } from "./track.ts";

// Simple rider AI: full gas, keeps the bike parallel to the landing while airborne.
// `angleError` (radians) makes it misjudge landings, which is how rivals make mistakes.
export function autopilot(bike: Bike, track: Track, angleError = 0): Input {
  const p = bike.chassis.getPosition();
  const v = bike.chassis.getLinearVelocity();
  let lean = 0;
  if (!bike.grounded) {
    const ahead = p.x + Math.max(1, v.x * 0.35);
    const slope = Math.atan2(groundY(track, ahead + 0.5) - groundY(track, ahead - 0.5), 1);
    // Proportional lean (not full on/off): lean input ramps up over ~0.15 s, so a bang-bang
    // controller would overshoot and wobble.
    const err = slope + angleError - bike.chassis.getAngle();
    const cmd = err * 2 - bike.chassis.getAngularVelocity() * 0.55;
    lean = Math.abs(cmd) < 0.05 ? 0 : Math.max(-1, Math.min(1, cmd));
  }
  return { gas: true, brake: false, lean };
}
