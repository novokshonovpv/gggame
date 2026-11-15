import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { cloudTexture } from "./textures.ts";

// A physically based summer sky (Preetham) with a dome of drifting clouds, and the same sky
// baked into an environment map so every material picks up its light and reflections.

export const SUN_DIR = new THREE.Vector3(0.55, 0.62, 0.42).normalize();

export class SkyDome {
  group = new THREE.Group();
  private clouds: THREE.Mesh;

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    const make = () => {
      const sky = new Sky();
      sky.scale.setScalar(780);
      const u = sky.material.uniforms;
      u.turbidity.value = 5.5;
      u.rayleigh.value = 1.25;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
      return sky;
    };
    const sky = make();
    sky.renderOrder = -2;
    this.group.add(sky);

    const ct = cloudTexture();
    ct.repeat.set(2, 1);
    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(370, 48, 12, 0, Math.PI * 2, 0, Math.PI * 0.47),
      new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, color: "#ffffff" }),
    );
    this.clouds.renderOrder = -1;
    this.group.add(this.clouds);
    scene.add(this.group);

    // Environment light from the sky (and its clouds).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(make());
    const ground = new THREE.Mesh(new THREE.CircleGeometry(700, 16), new THREE.MeshBasicMaterial({ color: "#3d5a2c" }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    envScene.add(ground);
    scene.environment = pmrem.fromScene(envScene, 0.02, 0.1, 1500).texture;
    pmrem.dispose();
  }

  update(cam: THREE.Vector3, time: number) {
    this.group.position.set(cam.x, Math.min(cam.y, 40) - 20, cam.z);
    (this.clouds.material as THREE.MeshBasicMaterial).map!.offset.x = time * 0.0015;
  }
}
