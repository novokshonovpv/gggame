// Synthesised sound (Web Audio): the player's engine, sirens, guns, crashes, pick-ups,
// jingles and the bike radio. Nothing to download.

import { THUMPER_SOURCE, distortion } from "../thumper.ts";
import { Radio, STATIONS, type Station, type Track, WALK_MUSIC } from "./radio.ts";

const KEY = "moto-city-sound";
const RADIO_KEY = "moto-city-radio";

// How each bike sounds: rev range, firing pulses per crank turn, exhaust tone, loudness.
interface EngineProfile {
  idle: number;
  max: number;
  pulses: number; // firings per revolution: 0.5 four-stroke single, 1 two-stroke, 2 four-cylinder
  tone: number;
  vol: number;
}
const PROFILES: Record<string, EngineProfile> = {
  z3: { idle: 1500, max: 9500, pulses: 0.5, tone: 650, vol: 1 },
  ex125: { idle: 1900, max: 11500, pulses: 0.5, tone: 900, vol: 0.8 },
  t5: { idle: 1400, max: 9000, pulses: 0.5, tone: 600, vol: 1.1 },
  "2t": { idle: 2400, max: 11500, pulses: 1, tone: 1300, vol: 1 },
  scooter: { idle: 2200, max: 8500, pulses: 1, tone: 1500, vol: 0.6 },
  chopper: { idle: 900, max: 5500, pulses: 1, tone: 420, vol: 1.2 },
  sport: { idle: 2000, max: 14000, pulses: 2, tone: 1700, vol: 0.9 },
};
// Top road speed of each gear, as a share of the bike's top speed.
const GEARS = [0.17, 0.31, 0.46, 0.62, 0.8, 1.02];

export class CitySound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private thump: AudioWorkletNode | null = null;
  private engTone!: BiquadFilterNode;
  private engOut!: GainNode;
  private siren: { o: OscillatorNode; g: GainNode } | null = null;
  private gear = 0;
  private rpm = 0.1;
  private shiftT = 0;
  private lastT = 0;
  radio: Radio | null = null;
  walk: Radio | null = null;
  walkOn = true;
  private radioIndex = 0;
  muted = false;
  private listeners: ((m: boolean) => void)[] = [];

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) === "off";
      const r = Number(localStorage.getItem(RADIO_KEY) ?? 0);
      this.walkOn = localStorage.getItem("moto-city-walk") !== "off";
      this.radioIndex = Number.isInteger(r) && r >= -1 && r < STATIONS.length ? r : 0;
    } catch {
      /* defaults */
    }
    document.addEventListener("visibilitychange", () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(comp);
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // Engine: separate combustion pulses (AudioWorklet) through an exhaust-like chain.
      const grit = ctx.createWaveShaper();
      grit.curve = distortion(1.5);
      const chest = ctx.createBiquadFilter();
      chest.type = "peaking";
      chest.frequency.value = 120;
      chest.gain.value = 5;
      chest.Q.value = 0.9;
      this.engTone = ctx.createBiquadFilter();
      this.engTone.type = "lowpass";
      this.engTone.Q.value = 0.7;
      const hiss = ctx.createBiquadFilter();
      hiss.type = "highshelf";
      hiss.frequency.value = 3500;
      hiss.gain.value = -10;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 35;
      this.engOut = ctx.createGain();
      this.engOut.gain.value = 0;
      grit.connect(chest).connect(this.engTone).connect(hiss).connect(hp).connect(this.engOut).connect(this.master);
      const url = URL.createObjectURL(new Blob([THUMPER_SOURCE], { type: "text/javascript" }));
      ctx.audioWorklet
        ?.addModule(url)
        .then(() => {
          this.thump = new AudioWorkletNode(ctx, "thumper");
          this.thump.connect(grit);
        })
        .catch(() => {
          /* no worklet: the bike rides silently, everything else still sounds */
        });
      const so = ctx.createOscillator();
      so.type = "triangle";
      const sg = ctx.createGain();
      sg.gain.value = 0;
      so.connect(sg);
      sg.connect(this.master);
      so.start();
      this.siren = { o: so, g: sg };
      this.radio = new Radio(ctx, this.master, this.noiseBuf, this.radioIndex);
      this.radio.onTrack = (s, t) => this.onTrack?.(s, t);
      this.walk = new Radio(ctx, this.master, this.noiseBuf, this.walkOn ? 0 : -1, WALK_MUSIC, 0.3);
      this.walk.onTrack = (s, t) => this.onWalkTrack?.(s, t);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem(KEY, m ? "off" : "on");
    } catch {
      /* not saved */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
    for (const f of this.listeners) f(m);
  }
  toggle() {
    this.setMuted(!this.muted);
  }
  onMute(f: (m: boolean) => void) {
    this.listeners.push(f);
    f(this.muted);
  }

  onTrack: ((s: Station, t: Track) => void) | null = null;
  onWalkTrack: ((s: Station, t: Track) => void) | null = null;

  // Background music on foot: on/off.
  walkToggle() {
    this.unlock();
    this.walkOn = !this.walkOn;
    try {
      localStorage.setItem("moto-city-walk", this.walkOn ? "on" : "off");
    } catch {
      /* not saved */
    }
    if (this.walk && (this.walk.index >= 0) !== this.walkOn) this.walk.cycle(1);
    return this.walkOn;
  }
  walkPlaying(on: boolean) {
    this.walk?.setPlaying(on);
  }

  // Next (or previous) radio station, or off; returns what is on now.
  radioCycle(step = 1) {
    this.unlock();
    const name = this.radio?.cycle(step) ?? "Радио выключено";
    try {
      localStorage.setItem(RADIO_KEY, String(this.radio?.index ?? this.radioIndex));
    } catch {
      /* not saved */
    }
    return name;
  }
  get radioName() {
    if (this.radio) return this.radio.name;
    const s = STATIONS[this.radioIndex];
    return s ? `${s.name} — ${s.genre}` : "Радио выключено";
  }
  radioPlaying(on: boolean) {
    this.radio?.setPlaying(on);
  }

  // speed: share of the bike's top speed (negative backwards); throttle 0..1; on = riding.
  engine(on: boolean, speed: number, throttle: number, kind: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    // Gearbox with a little hysteresis; a short throttle cut on each upshift.
    const w = Math.min(1.05, Math.abs(speed));
    if (this.gear < GEARS.length - 1 && w > GEARS[this.gear]) {
      this.gear++;
      this.shiftT = 0.12;
    }
    while (this.gear > 0 && w < GEARS[this.gear - 1] * 0.82) this.gear--;
    const lo = this.gear ? GEARS[this.gear - 1] * 0.72 : 0;
    let target = 0.06 + 0.94 * Math.max(0, (w - lo) / (GEARS[this.gear] - lo));
    if (throttle > 0 && w < 0.04) target = Math.max(target, 0.3); // revving to pull away
    this.rpm += (Math.min(1, target) - this.rpm) * Math.min(1, dt * (target > this.rpm ? 7 : 4));
    this.shiftT = Math.max(0, this.shiftT - dt);
    const P = PROFILES[kind] ?? PROFILES.z3;
    const crank = P.idle + this.rpm * (P.max - P.idle);
    const load = this.shiftT > 0 ? 0.05 : throttle;
    if (this.thump) {
      this.thump.parameters.get("freq")!.setTargetAtTime(Math.min(400, (crank / 60) * P.pulses), t, 0.035);
      this.thump.parameters.get("load")!.setTargetAtTime(load, t, 0.05);
    }
    this.engTone.frequency.setTargetAtTime(P.tone + load * 1500 + this.rpm * 600, t, 0.08);
    this.engOut.gain.setTargetAtTime(on ? 0.075 * P.vol * (0.45 + load * 0.55) : 0, t, on ? 0.08 : 0.2);
  }

  sirenLevel(level: number, time: number) {
    if (!this.ctx || !this.siren) return;
    const t = this.ctx.currentTime;
    const f = 700 + 300 * (0.5 + 0.5 * Math.sin(time * 5));
    this.siren.o.frequency.setTargetAtTime(f, t, 0.02);
    this.siren.g.gain.setTargetAtTime(level * 0.05, t, 0.1);
  }

  private noise(dur: number, freq: number, vol: number, type: BiquadFilterType = "lowpass") {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  private tone(freq: number, at: number, dur: number, vol: number, type: OscillatorType = "square") {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    const t = ctx.currentTime + at;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  crash(power: number) {
    const v = Math.min(1, power / 300);
    this.noise(0.25 + v * 0.4, 600 + v * 2000, 0.25 + v * 0.5);
    this.tone(70 + Math.random() * 30, 0, 0.2, 0.15 * v, "sine");
  }
  thud() {
    this.noise(0.15, 300, 0.4);
  }
  kick() {
    this.noise(0.08, 900, 0.25, "bandpass");
  }
  explode() {
    this.noise(1.6, 400, 1);
    this.tone(45, 0, 0.8, 0.4, "sine");
  }
  splash() {
    this.noise(0.6, 1500, 0.4, "bandpass");
  }
  cash() {
    this.tone(988, 0, 0.08, 0.12);
    this.tone(1319, 0.07, 0.18, 0.12);
  }
  health() {
    this.tone(660, 0, 0.1, 0.1, "triangle");
    this.tone(880, 0.08, 0.2, 0.1, "triangle");
  }
  checkpoint() {
    this.tone(784, 0, 0.1, 0.12);
    this.tone(1047, 0.09, 0.16, 0.12);
  }
  jobDone() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.09, 0.22, 0.13));
  }
  fail() {
    [392, 330, 262].forEach((f, i) => this.tone(f, i * 0.14, 0.25, 0.12, "sawtooth"));
  }
  shot(kind: string) {
    if (kind === "shotgun") {
      this.noise(0.35, 1300, 0.9);
      this.tone(70, 0, 0.18, 0.3, "sine");
    } else if (kind === "smg") this.noise(0.07, 3200, 0.4, "bandpass");
    else if (kind === "police") this.noise(0.14, 2200, 0.3, "bandpass");
    else {
      this.noise(0.14, 2600, 0.6, "bandpass");
      this.tone(150, 0, 0.06, 0.18);
    }
  }
  nitro() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 1.3);
  }
  // An old payphone bell, quieter further away.
  ring(dist: number) {
    const v = Math.max(0, 1 - dist / 900) * 0.12;
    if (v <= 0) return;
    for (let k = 0; k < 2; k++)
      for (let i = 0; i < 8; i++) {
        this.tone(1250, k * 0.45 + i * 0.045, 0.04, v, "square");
        this.tone(1500, k * 0.45 + i * 0.045 + 0.02, 0.03, v * 0.6, "square");
      }
  }
  reload() {
    this.tone(320, 0, 0.04, 0.12);
    this.tone(520, 0.07, 0.05, 0.12);
  }
  horn() {
    this.tone(415, 0, 0.35, 0.05, "sawtooth");
    this.tone(523, 0, 0.35, 0.04, "sawtooth");
  }
  wanted(up: boolean) {
    if (up) [880, 660, 880].forEach((f, i) => this.tone(f, i * 0.1, 0.1, 0.08));
    else this.tone(523, 0, 0.3, 0.08, "triangle");
  }
}
