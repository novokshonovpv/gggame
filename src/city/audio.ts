// Synthesised sound (Web Audio): the player's engine with gear changes, sirens, crashes,
// pick-ups and jingles. Nothing to download.

const KEY = "moto-city-sound";

export class CitySound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  private eng: { o1: OscillatorNode; o2: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private siren: { o: OscillatorNode; g: GainNode } | null = null;
  muted = false;
  private listeners: ((m: boolean) => void)[] = [];

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) === "off";
    } catch {
      /* default on */
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
      // Engine: two detuned saws through a low-pass.
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      o1.type = "sawtooth";
      o2.type = "square";
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 500;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.value = 0;
      const g2 = ctx.createGain();
      g2.gain.value = 0.4;
      o1.connect(f);
      o2.connect(g2);
      g2.connect(f);
      f.connect(g);
      g.connect(this.master);
      o1.start();
      o2.start();
      this.eng = { o1, o2, f, g };
      const so = ctx.createOscillator();
      so.type = "triangle";
      const sg = ctx.createGain();
      sg.gain.value = 0;
      so.connect(sg);
      sg.connect(this.master);
      so.start();
      this.siren = { o: so, g: sg };
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

  // speed 0..1 of top speed, throttle 0..1; on = riding at all.
  engine(on: boolean, speed: number, throttle: number, kind: string) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime;
    // Six gears: pitch climbs through each and drops at the shift.
    const gears = 6;
    const pos = Math.min(0.999, Math.abs(speed)) * gears;
    const gear = Math.floor(pos);
    const inGear = pos - gear;
    const rpm = 0.22 + (gear === 0 ? inGear * 0.75 : 0.35 + inGear * 0.6);
    const base = kind === "chopper" ? 34 : kind === "scooter" ? 70 : kind === "sport" ? 62 : 48;
    const freq = base * (0.6 + rpm * 2.4);
    this.eng.o1.frequency.setTargetAtTime(freq, t, 0.04);
    this.eng.o2.frequency.setTargetAtTime(freq * 0.5, t, 0.04);
    this.eng.f.frequency.setTargetAtTime(300 + rpm * 1400 + throttle * 600, t, 0.05);
    this.eng.g.gain.setTargetAtTime(on ? 0.05 + throttle * 0.07 + rpm * 0.03 : 0, t, 0.08);
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
  horn() {
    this.tone(415, 0, 0.35, 0.05, "sawtooth");
    this.tone(523, 0, 0.35, 0.04, "sawtooth");
  }
  wanted(up: boolean) {
    if (up) [880, 660, 880].forEach((f, i) => this.tone(f, i * 0.1, 0.1, 0.08));
    else this.tone(523, 0, 0.3, 0.08, "triangle");
  }
}
