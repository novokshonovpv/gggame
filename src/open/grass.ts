import * as THREE from "three";

// Grass tufts round the camera, placed and swayed on the GPU: a fixed scatter of instances
// tiles the world every `patch` metres, the vertex shader moves each to its copy nearest
// the camera, sits it on the terrain (heights from a float texture) and drops it where the
// density mask says bare (trail, stadium, water, rock).

export interface GrassOptions {
  heights: Float32Array; // N × N, row-major by z
  N: number;
  half: number;
  step: number;
  mask: Uint8Array; // M × M density over the world, 0..255
  maskSize: number;
  count: number;
  patch: number; // metres
  map: THREE.Texture;
}

export class Grass {
  mesh: THREE.Mesh;
  private uniforms: Record<string, THREE.IUniform>;

  constructor(o: GrassOptions) {
    // A tuft: three crossed quads.
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI;
      const cx = Math.cos(a) * 0.4;
      const cz = Math.sin(a) * 0.4;
      const b = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 0.4, cz, -cx, 0.4, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const off = new Float32Array(o.count * 4);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < o.count; i++) {
      off[i * 4] = rnd() * o.patch;
      off[i * 4 + 1] = rnd() * o.patch;
      off[i * 4 + 2] = rnd();
      off[i * 4 + 3] = rnd() * Math.PI * 2;
    }
    geo.setAttribute("aOff", new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = o.count;

    const hTex = new THREE.DataTexture(o.heights, o.N, o.N, THREE.RedFormat, THREE.FloatType);
    hTex.minFilter = hTex.magFilter = THREE.NearestFilter;
    hTex.needsUpdate = true;
    const mTex = new THREE.DataTexture(o.mask, o.maskSize, o.maskSize, THREE.RedFormat, THREE.UnsignedByteType);
    mTex.minFilter = mTex.magFilter = THREE.LinearFilter;
    mTex.needsUpdate = true;

    this.uniforms = {
      uCam: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uPatch: { value: o.patch },
      uHeight: { value: hTex },
      uMask: { value: mTex },
      uHalf: { value: o.half },
      uStep: { value: o.step },
      uN: { value: o.N },
    };
    const mat = new THREE.MeshStandardMaterial({ map: o.map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute vec4 aOff;
          uniform vec2 uCam; uniform float uTime, uPatch, uHalf, uStep, uN;
          uniform sampler2D uHeight, uMask;
          varying vec3 vTint; varying float vGy;
          float hAt(ivec2 i) { return texelFetch(uHeight, clamp(i, ivec2(0), ivec2(int(uN) - 1)), 0).r; }
          float terrainH(vec2 p) {
            vec2 f = clamp((p + uHalf) / uStep, 0.0, uN - 1.001);
            ivec2 i = ivec2(floor(f)); vec2 t = f - vec2(i);
            float a = hAt(i), b = hAt(i + ivec2(1, 0)), c = hAt(i + ivec2(0, 1)), d = hAt(i + ivec2(1, 1));
            return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
          }`,
        )
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(0.0, 1.0, 0.0);")
        .replace(
          "#include <begin_vertex>",
          `vec2 wp = aOff.xy + uPatch * floor((uCam - aOff.xy) / uPatch + 0.5);
          float dist = length(wp - uCam);
          float fade = 1.0 - smoothstep(uPatch * 0.3, uPatch * 0.48, dist);
          float m = texture2D(uMask, (wp + uHalf) / (2.0 * uHalf)).r;
          float r2 = fract(aOff.z * 7.31);
          float sc = step(aOff.z, m) * fade * (0.6 + r2 * 0.75);
          float c = cos(aOff.w), s = sin(aOff.w);
          vec3 p = position * sc;
          p.xz = mat2(c, -s, s, c) * p.xz;
          float sway = sin(uTime * 1.6 + wp.x * 0.31 + wp.y * 0.23) * 0.1 + sin(uTime * 3.3 + wp.x * 0.9 + wp.y * 0.7) * 0.035;
          p.x += sway * position.y * sc * 1.6;
          p.z += sway * position.y * sc * 0.8;
          vec3 transformed = vec3(wp.x + p.x, terrainH(wp) + p.y - 0.04, wp.y + p.z);
          vTint = mix(vec3(0.62, 0.8, 0.45), vec3(0.92, 0.98, 0.62), r2);
          vGy = uv.y;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vTint; varying float vGy;")
        .replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= vTint * mix(0.5, 1.0, vGy);")
        .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);");
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  update(cam: THREE.Vector3, time: number) {
    (this.uniforms.uCam.value as THREE.Vector2).set(cam.x, cam.z);
    this.uniforms.uTime.value = time;
  }
}
