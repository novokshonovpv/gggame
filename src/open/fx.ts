import * as THREE from "three";

// Dust and roost thrown off the tyres: a pool of soft sprites that rise, spread and fade.

const N = 420;

export class Dust {
  points: THREE.Points;
  private pos = new Float32Array(N * 3);
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private max = new Float32Array(N);
  private size = new Float32Array(N);
  private alpha = new Float32Array(N);
  private col = new Float32Array(N * 3);
  private next = 0;

  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale; varying float vA; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          vA = aAlpha; vC = aColor;
        }`,
      fragmentShader: `
        varying float vA; varying vec3 vC;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          gl_FragColor = vec4(vC, vA * (1.0 - r) * (1.0 - r));
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setViewport(h: number, fov: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
  }

  // One puff at p, flung with velocity v (m/s), colour c.
  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, size = 0.5, life = 1.4) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set([c.r, c.g, c.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
  }

  update(dt: number) {
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.max[i];
      const drag = Math.exp(-dt * 2.2);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * 0.5; // dust drifts up a little
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += dt * 1.1;
      this.alpha[i] = 0.75 * Math.min(1, t * 6) * (1 - t);
    }
    const g = this.points.geometry;
    for (const n of ["position", "aSize", "aAlpha", "aColor"]) g.getAttribute(n).needsUpdate = true;
  }
}
