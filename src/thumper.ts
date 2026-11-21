// Shared engine synthesis: the four-stroke "thumper" AudioWorklet (used by Moto Trials and
// Мото-город) and a soft-clip curve.

export function distortion(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// The BSE T5 runs a 300cc four-stroke single: it fires once every two revolutions, so
// the sound is a train of separate exhaust pulses ("thump"), not a steady buzz. This
// worklet makes each combustion an event of its own: a short damped pipe resonance plus
// a noisy blast, with random spread in timing and strength (rougher at idle and off
// throttle), and occasional off-throttle misfires that crackle in the pipe.
export const THUMPER_SOURCE = `
class Thumper extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "freq", defaultValue: 12, minValue: 4, maxValue: 400, automationRate: "k-rate" },
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
