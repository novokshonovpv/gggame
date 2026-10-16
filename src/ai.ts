import type { Bike, Input } from "./bike.ts";
import { groundY, type Track } from "./track.ts";

// Simple rider AI: full gas, keeps the bike parallel to the landing while airborne.
export function autopilot(bike: Bike, track: Track): Input {
  const p = bike.chassis.getPosition();
  const v = bike.chassis.getLinearVelocity();
  let lean = 0;
  if (!bike.grounded) {
    const ahead = p.x + Math.max(1, v.x * 0.35);
    const slope = Math.atan2(groundY(track, ahead + 0.5) - groundY(track, ahead - 0.5), 1);
    const err = slope - bike.chassis.getAngle();
    const cmd = err * 2.5 - bike.chassis.getAngularVelocity() * 0.4;
    lean = Math.abs(cmd) < 0.3 ? 0 : Math.sign(cmd);
  }
  return { gas: true, brake: false, lean };
}
