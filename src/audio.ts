import { BIKE, type Bike } from "./bike.ts";

// All game audio is synthesized with Web Audio: no sound files to load or license.
// Browsers only allow audio after a user gesture, so everything waits for unlock().

const GEARS = [0.28, 0.46, 0.66, 0.84, 1.02]; // top wheel speed of each gear, share of max

function makeNoise(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function distortion(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// Gear and rpm from wheel speed, shared by both engine voices.
abstract class EngineBase {
  abstract out: GainNode;
  rpm = 0.15; // 0..1 inside the current gear
  gear = 0;

  abstract set(ctx: AudioContext, rpm: number, throttle: number, volume: number, pan?: number, twoStroke?: boolean): void;

  // Wheel speed -> gear and rpm, with throttle flaring the revs.
  drive(bike: Bike, gas: boolean, dt: number) {
    const max = BIKE.maxWheelSpeed * bike.power;
    const w = Math.min(1.05, Math.abs(bike.rear.getAngularVelocity()) / max);
    while (this.gear < GEARS.length - 1 && w > GEARS[this.gear]) this.gear++;
    while (this.gear > 0 && w < GEARS[this.gear - 1] * 0.85) this.gear--;
    const lo = this.gear ? GEARS[this.gear - 1] * 0.7 : 0;
    let target = 0.15 + 0.85 * Math.max(0, (w - lo) / (GEARS[this.gear] - lo));
    if (gas && !bike.grounded) target = Math.max(target, 0.95); // free-revving in the air
    if (gas) target = Math.min(1, target + 0.08);
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 9 : 4));
  }
}

// The BSE T5 runs a 300cc four-stroke single: it fires once every two revolutions, so
// the sound is a train of separate exhaust pulses ("thump"), not a steady buzz. This
// worklet makes each combustion an event of its own: a short damped pipe resonance plus
// a noisy blast, with random spread in timing and strength (rougher at idle and off
// throttle), and occasional off-throttle misfires that crackle in the pipe.
const THUMPER_SOURCE = `
class Thumper extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq", defaultValue: 12, minValue: 4, maxValue: 120, automationRate: "k-rate" },
      { name: "load", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }
  constructor() {
    super();
    this.t = 1; this.period = 0.08; this.amp = 1; this.tone = 110; this.pop = 0; this.lp = 0;
    this.seed = (Math.random() * 4294967295) >>> 0;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  process(inputs, outputs, params) {
    const out = outputs[0][0];
    const f = params.freq[0];
    const load = params.load[0];
    const dt = 1 / sampleRate;
    for (let i = 0; i < out.length; i++) {
      if (this.t >= this.period) {
        this.t -= this.period;
        const rough = 0.03 + (1 - load) * 0.09;
        this.period = (1 / f) * (1 + (this.rnd() - 0.5) * rough);
        this.amp = (0.5 + load * 0.5) * (1 + (this.rnd() - 0.5) * (0.25 + (1 - load) * 0.25));
        if (load < 0.2 && f > 28 && this.rnd() < 0.07) { this.amp *= 0.2; this.pop = 0.6 + this.rnd() * 0.4; }
        this.tone = 80 + f * 1.15 + (this.rnd() - 0.5) * 14;
      }
      const t = this.t;
      const env = Math.exp(-t * (150 - load * 50));
      const body = Math.sin(6.2831853 * this.tone * t) * env + 0.5 * Math.sin(6.2831853 * this.tone * 2.03 * t) * env * env;
      const blast = (this.rnd() * 2 - 1) * Math.exp(-t * 700) * (0.25 + load * 0.45);
      let s = this.amp * (body + blast);
      if (this.pop > 0) { s += (this.rnd() * 2 - 1) * this.pop; this.pop *= 0.995; if (this.pop < 0.01) this.pop = 0; }
      this.lp += (s - this.lp) * 0.3;
      out[i] = this.lp;
      this.t += dt;
    }
    return true;
  }
}
registerProcessor("thumper", Thumper);
`;

class ThumperVoice extends EngineBase {
  out: GainNode;
  private node: AudioWorkletNode;
  private tone: BiquadFilterNode;
  private pan: StereoPannerNode;

  constructor(ctx: AudioContext, dest: AudioNode) {
    super();
    this.node = new AudioWorkletNode(ctx, "thumper");
    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(1.5); // a little grit, no fuzz
    const chest = ctx.createBiquadFilter(); // the low "thump" of a big single
    chest.type = "peaking";
    chest.frequency.value = 130;
    chest.gain.value = 5;
    chest.Q.value = 0.9;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.Q.value = 0.7;
    const hiss = ctx.createBiquadFilter();
    hiss.type = "highshelf";
    hiss.frequency.value = 3500;
    hiss.gain.value = -9;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 35;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.node.connect(shaper).connect(chest).connect(this.tone).connect(hiss).connect(hp).connect(this.out);
    this.out.connect(this.pan).connect(dest);
  }

  set(ctx: AudioContext, rpm: number, throttle: number, volume: number, pan = 0, twoStroke = false) {
    const t = ctx.currentTime;
    // A four-stroke fires every 2 revs; a two-stroke every rev, revving higher and brighter.
    const engineRpm = twoStroke ? 2500 + rpm * 10500 : 1500 + rpm * 8000;
    this.node.parameters.get("freq")!.setTargetAtTime(engineRpm / (twoStroke ? 60 : 120), t, 0.04);
    this.node.parameters.get("load")!.setTargetAtTime(throttle, t, 0.06);
    this.tone.frequency.setTargetAtTime((twoStroke ? 1300 : 650) + throttle * 1800 + rpm * 700, t, 0.08);
    this.out.gain.setTargetAtTime(volume * (0.55 + throttle * 0.45), t, 0.08);
    this.pan.pan.setTargetAtTime(pan, t, 0.1);
  }
}

// Fallback for browsers without AudioWorklet: oscillators pulsed at the firing rate.
class EngineVoice extends EngineBase {
  out: GainNode;
  private saw: OscillatorNode;
  private sub: OscillatorNode;
  private pulse: OscillatorNode;
  private filter: BiquadFilterNode;
  private intake: BiquadFilterNode;
  private intakeGain: GainNode;
  private pan: StereoPannerNode;

  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    super();
    this.saw = ctx.createOscillator();
    this.saw.type = "sawtooth";
    this.sub = ctx.createOscillator();
    this.sub.type = "square";
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;

    // Amplitude pulsing at the firing frequency gives the "brap" texture.
    const body = ctx.createGain();
    body.gain.value = 0.6;
    this.pulse = ctx.createOscillator();
    this.pulse.type = "square";
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.4;
    this.pulse.connect(pulseDepth).connect(body.gain);

    const shaper = ctx.createWaveShaper();
    shaper.curve = distortion(2);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.Q.value = 2;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    this.intake = ctx.createBiquadFilter();
    this.intake.type = "bandpass";
    this.intake.Q.value = 3;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.pan = ctx.createStereoPanner();

    this.saw.connect(body);
    this.sub.connect(subGain).connect(body);
    body.connect(shaper).connect(this.filter).connect(this.out);
    src.connect(this.intake).connect(this.intakeGain).connect(this.out);
    this.out.connect(this.pan).connect(dest);
    for (const o of [this.saw, this.sub, this.pulse, src]) o.start();
  }

  // rpm: 0..1 inside the current gear; throttle: 0..1; volume: 0..1.
  set(ctx: AudioContext, rpm: number, throttle: number, volume: number, pan = 0, twoStroke = false) {
    const t = ctx.currentTime;
    const f = twoStroke ? (2500 + rpm * 10500) / 60 : (1500 + rpm * 8000) / 120; // firing frequency, Hz
    this.saw.frequency.setTargetAtTime(f * 2, t, 0.03);
    this.sub.frequency.setTargetAtTime(f, t, 0.03);
    this.pulse.frequency.setTargetAtTime(f, t, 0.03);
    this.filter.frequency.setTargetAtTime(400 + throttle * 1500 + rpm * 600, t, 0.05);
    this.intake.frequency.setTargetAtTime(800 + rpm * 2000, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(0.02 + throttle * 0.05, t, 0.05);
    this.out.gain.setTargetAtTime(volume * 0.6 * (0.5 + throttle * 0.5), t, 0.06);
    this.pan.pan.setTargetAtTime(pan, t, 0.1);
  }
}

const SETTINGS_KEY = "audio";

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private engines = new Map<Bike, EngineBase>();
  private engineKind: "pending" | "thumper" | "fallback" = "pending";
  private nextStep = 0;
  private step = 0;
  private musicLevel = 0.35;
  sfxOn = true;
  musicOn = true;
  private airTime = 0;
  private lastVy = 0;
  private wasGrounded = true;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { sfx?: boolean; music?: boolean };
      this.sfxOn = s.sfx ?? true;
      this.musicOn = s.music ?? true;
    } catch {
      /* defaults */
    }
    const unlock = () => this.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    // A hidden tab or a backgrounded app stops the game loop; stop the engines droning too.
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  private save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sfx: this.sfxOn, music: this.musicOn }));
    } catch {
      /* not persisted */
    }
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.noise = makeNoise(ctx);
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(comp);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.music = ctx.createGain();
      this.music.connect(this.master);
      this.applyToggles();
      window.setInterval(() => this.scheduleMusic(), 25);
      // The four-stroke engine runs in an AudioWorklet loaded from an inline module.
      const url = URL.createObjectURL(new Blob([THUMPER_SOURCE], { type: "text/javascript" }));
      ctx.audioWorklet
        ?.addModule(url)
        .then(() => (this.engineKind = "thumper"))
        .catch(() => (this.engineKind = "fallback"));
      if (!ctx.audioWorklet) this.engineKind = "fallback";
      this.nextStep = ctx.currentTime + 0.1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    this.save();
    this.applyToggles();
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    this.save();
    this.applyToggles();
  }

  // Music is louder in menus and sits under the engines during a race.
  setMusicLevel(level: number) {
    this.musicLevel = level;
    this.applyToggles();
  }

  private applyToggles() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfx.gain.setTargetAtTime(this.sfxOn ? 1 : 0, t, 0.05);
    this.music.gain.setTargetAtTime(this.musicOn ? this.musicLevel : 0, t, 0.3);
  }

  // ---------- engines ----------

  // Called every frame. `racing` is false in menus; rivals fade with distance from the player.
  updateEngines(bikes: { bike: Bike; isPlayer: boolean; gas: boolean; active: boolean }[], playerX: number, racing: boolean, dt: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const live = new Set<Bike>();
    for (const b of bikes) {
      live.add(b.bike);
      let v = this.engines.get(b.bike);
      if (!v) {
        if (this.engineKind === "pending") continue;
        v = this.engineKind === "thumper" ? new ThumperVoice(ctx, this.sfx) : new EngineVoice(ctx, this.sfx, this.noise);
        this.engines.set(b.bike, v);
      }
      v.drive(b.bike, b.gas && b.active, dt);
      const dx = b.bike.chassis.getPosition().x - playerX;
      const near = b.isPlayer ? 1 : Math.max(0, 1 - Math.abs(dx) / 45) * 0.3;
      const vol = racing && b.active ? 0.14 * near : racing ? 0.06 * near : 0;
      v.set(ctx, v.rpm, b.gas && b.active ? 1 : 0.1, vol, b.isPlayer ? 0 : Math.max(-0.8, Math.min(0.8, dx / 25)), b.bike.twoStroke);
    }
    for (const [bike, v] of this.engines)
      if (!live.has(bike)) {
        v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        const voice = v;
        setTimeout(() => voice.out.disconnect(), 400);
        this.engines.delete(bike);
      }
  }

  // Landing thumps for the player's bike, scaled by how hard it came down.
  watchLanding(bike: Bike, dt: number) {
    const g = bike.grounded;
    const vy = bike.chassis.getLinearVelocity().y;
    if (!g) {
      this.airTime += dt;
      this.lastVy = vy;
    } else if (!this.wasGrounded && this.airTime > 0.25) {
      this.land(Math.min(1, Math.abs(this.lastVy) / 14));
    }
    if (g) this.airTime = 0;
    this.wasGrounded = g;
  }

  // ---------- one-shot effects ----------

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private noiseBurst(t: number, type: BiquadFilterType, freq: number, peak: number, decay: number, dest: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.004, decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, peak: number, decay: number, dest: AudioNode = this.sfx) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  land(intensity: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, "sine", 110, 45, 0.25 + intensity * 0.35, 0.18);
    this.noiseBurst(t, "lowpass", 600 + intensity * 900, 0.1 + intensity * 0.25, 0.16);
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, "sine", 90, 35, 0.8, 0.3);
    this.noiseBurst(t, "lowpass", 1200, 0.7, 0.45);
    this.noiseBurst(t + 0.05, "bandpass", 2600, 0.4, 0.25);
    this.tone(t + 0.08, "square", 1400, 900, 0.08, 0.12);
    this.tone(t + 0.2, "square", 1100, 700, 0.06, 0.1);
  }

  beep(go = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, "square", go ? 880 : 440, go ? 880 : 440, 0.12, go ? 0.5 : 0.18);
  }

  private arp(notes: number[], gap: number, peak: number, type: OscillatorType = "triangle") {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    notes.forEach((f, i) => this.tone(t + i * gap, type, f, f, peak, 0.35));
  }

  chime() {
    this.arp([784, 988, 1319], 0.07, 0.18);
  }

  lap() {
    this.arp([659, 880], 0.09, 0.16);
  }

  finish(win: boolean) {
    this.arp(win ? [523, 659, 784, 1047, 1319] : [523, 659, 784], 0.11, 0.2, "square");
  }

  coin() {
    this.arp([1319, 1976], 0.06, 0.15, "square");
  }

  click() {
    if (!this.ctx) return;
    this.tone(this.ctx.currentTime, "triangle", 1200, 900, 0.08, 0.04);
  }

  // ---------- music ----------

  // A driving 120 BPM loop: kick/snare/hats, a saw bass and a filtered pad over Am-F-C-G.
  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const stepDur = 60 / 120 / 4; // sixteenth notes
    const roots = [110, 87.31, 130.81, 98]; // A2 F2 C3 G2
    const chords = [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [261.63, 329.63, 392],
      [196, 246.94, 293.66],
    ];
    while (this.nextStep < ctx.currentTime + 0.12) {
      const t = this.nextStep;
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % 4;
      const m = this.music;
      if (s % 4 === 0 || s === 10) this.tone(t, "sine", 140, 42, 0.9, 0.22, m);
      if (s === 4 || s === 12) {
        this.noiseBurst(t, "highpass", 1400, 0.45, 0.14, m);
        this.tone(t, "triangle", 190, 140, 0.25, 0.08, m);
      }
      if (s % 2 === 0) this.noiseBurst(t, "highpass", 7000, s % 4 === 2 ? 0.18 : 0.08, s % 4 === 2 ? 0.08 : 0.03, m);
      if (s % 2 === 0 && s !== 6 && s !== 14) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = roots[bar] * (s === 8 ? 2 : 1);
        const f = ctx.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 420;
        f.Q.value = 6;
        const g = ctx.createGain();
        this.env(g, t, 0.28, 0.005, stepDur * 1.8);
        o.connect(f).connect(g).connect(m);
        o.start(t);
        o.stop(t + stepDur * 2);
      }
      if (s === 0)
        for (const f0 of chords[bar]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth";
          o.frequency.value = f0;
          o.detune.value = (Math.random() - 0.5) * 14;
          const f = ctx.createBiquadFilter();
          f.type = "lowpass";
          f.frequency.value = 900;
          const g = ctx.createGain();
          const len = stepDur * 16;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.05, t + 0.25);
          g.gain.setValueAtTime(0.05, t + len - 0.3);
          g.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(f).connect(g).connect(m);
          o.start(t);
          o.stop(t + len + 0.05);
        }
      this.nextStep += stepDur;
      this.step++;
    }
  }
}
