import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { gameStore } from '../store/gameStore';
import type { World } from './World';

const BLOOM_LAYER = 1;
const darkMaterial = new THREE.MeshBasicMaterial({ color: 'black' });
const originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();

const finalVertexShader = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const finalFragmentShader = `
uniform sampler2D baseTexture;
uniform sampler2D bloomTexture;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
}
`;

export class Renderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.OrthographicCamera;
  public readonly rawRenderer: THREE.WebGLRenderer;

  private readonly bloomComposer: EffectComposer;
  private readonly finalComposer: EffectComposer;

  public constructor(private readonly world: World, mountNode: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05080d);

    const aspect = window.innerWidth / window.innerHeight;
    const worldHeight = 20;
    this.camera = new THREE.OrthographicCamera(
      -(worldHeight * aspect) / 2,
      (worldHeight * aspect) / 2,
      worldHeight / 2,
      -worldHeight / 2,
      0.1,
      100
    );
    this.camera.position.set(0, 0, 20);
    this.camera.layers.enable(BLOOM_LAYER);

    this.rawRenderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.rawRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.rawRenderer.setSize(window.innerWidth, window.innerHeight);
    mountNode.appendChild(this.rawRenderer.domElement);

    const renderScene = new RenderPass(this.scene, this.camera);

    this.bloomComposer = new EffectComposer(this.rawRenderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(renderScene);
    this.bloomComposer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.15,
        0.28,
        0.82
      )
    );

    const finalPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture }
        },
        vertexShader: finalVertexShader,
        fragmentShader: finalFragmentShader
      }),
      'baseTexture'
    );
    finalPass.needsSwap = true;

    this.finalComposer = new EffectComposer(this.rawRenderer);
    this.finalComposer.addPass(renderScene);
    this.finalComposer.addPass(finalPass);

    window.addEventListener('resize', this.onResize);
  }

  public render(alpha: number): void {
    void alpha;
    this.syncSceneFromWorld();
    this.animateBackdrop();

    this.scene.traverse(this.darkenNonBloomed);
    this.bloomComposer.render();
    this.scene.traverse(this.restoreMaterial);

    this.finalComposer.render();
  }

  public dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.rawRenderer.dispose();
  }

  private syncSceneFromWorld(): void {
    for (const [entity, render] of this.world.renders) {
      const transform = this.world.transforms.get(entity);
      if (!transform) {
        continue;
      }
      render.mesh.position.set(transform.x, transform.y, transform.z);
      render.mesh.rotation.set(transform.rotX, transform.rotY, transform.rotZ);
      render.mesh.scale.set(transform.scaleX, transform.scaleY, transform.scaleZ);
      render.mesh.layers.set(render.bloomLayer === BLOOM_LAYER ? BLOOM_LAYER : 0);

      if (entity === this.world.tankerEntity) {
        const shield = render.mesh.getObjectByName('heroShield');
        const ringA = render.mesh.getObjectByName('heroShieldRingA');
        const ringB = render.mesh.getObjectByName('heroShieldRingB');
        const active = this.world.heroShieldMs > 0;
        const shieldPulse = 0.18 + Math.sin(this.world.timeMs * 0.012) * 0.12;
        if (shield instanceof THREE.Mesh) {
          shield.visible = active;
          shield.scale.setScalar(1 + Math.sin(this.world.timeMs * 0.01) * 0.03);
          if (shield.material instanceof THREE.MeshBasicMaterial) {
            shield.material.opacity = active ? shieldPulse : 0;
          }
        }
        if (ringA instanceof THREE.Mesh) {
          ringA.visible = active;
          ringA.rotation.z += 0.05;
          ringA.rotation.x += 0.01;
          if (ringA.material instanceof THREE.MeshBasicMaterial) {
            ringA.material.opacity = active ? 0.34 + Math.sin(this.world.timeMs * 0.014) * 0.12 : 0;
          }
        }
        if (ringB instanceof THREE.Mesh) {
          ringB.visible = active;
          ringB.rotation.z -= 0.06;
          ringB.rotation.y += 0.012;
          if (ringB.material instanceof THREE.MeshBasicMaterial) {
            ringB.material.opacity = active ? 0.28 + Math.cos(this.world.timeMs * 0.013) * 0.1 : 0;
          }
        }
      }
    }

    const { shakeDelta } = gameStore.getState();
    this.camera.position.x = shakeDelta.x;
    this.camera.position.y = shakeDelta.y;
  }

  private animateBackdrop(): void {
    const t = this.world.timeMs * 0.001;
    const cameraX = this.camera.position.x;
    const cameraY = this.camera.position.y;
    const thrill = Math.max(0, Math.sin(t * 0.52 + 1.2));

    const stars = this.scene.getObjectByName('bgStars');
    if (stars) {
      const loop = 26;
      const flow = (t * (6.4 + thrill * 2.1)) % loop;
      stars.position.y = -13 + flow + Math.sin(t * 0.7) * 0.35;
      stars.position.x = cameraX * -0.08;
      stars.rotation.z = t * 0.012;
      if (stars instanceof THREE.Points && stars.material instanceof THREE.PointsMaterial) {
        stars.material.opacity = 0.68 + thrill * 0.2;
      }
    }

    const sparks = this.scene.getObjectByName('bgSparks');
    if (sparks) {
      const loop = 24;
      sparks.position.y = -12 + (t * (8.2 + thrill * 3.4)) % loop;
      sparks.position.x = cameraX * -0.14 + Math.sin(t * 1.4) * 0.5;
      sparks.rotation.z = -t * 0.03;
      if (sparks instanceof THREE.Points && sparks.material instanceof THREE.PointsMaterial) {
        const burst = Math.max(0, Math.sin(t * 1.9));
        sparks.material.opacity = 0.1 + burst * 0.22;
        sparks.material.size = 0.085 + burst * 0.08;
      }
    }

    const hazeFar = this.scene.getObjectByName('bgHazeFar');
    if (hazeFar) {
      const loop = 20;
      hazeFar.position.x = Math.sin(t * 0.18) * 0.95 + cameraX * -0.04;
      hazeFar.position.y = -10 + (t * (1.7 + thrill * 0.4)) % loop + cameraY * -0.02;
      hazeFar.rotation.z = Math.sin(t * 0.11) * 0.075;
      if (hazeFar instanceof THREE.Mesh && hazeFar.material instanceof THREE.MeshBasicMaterial) {
        hazeFar.material.opacity = 0.18 + thrill * 0.08;
      }
    }
    const haze = this.scene.getObjectByName('bgHaze');
    if (haze) {
      haze.position.x = Math.cos(t * 0.24) * 0.68 + cameraX * -0.08;
      const loop = 18;
      haze.position.y = -9 + (t * (2.3 + thrill * 0.6)) % loop + cameraY * -0.04;
      haze.rotation.z = Math.cos(t * 0.13) * 0.06;
      if (haze instanceof THREE.Mesh && haze.material instanceof THREE.MeshBasicMaterial) {
        haze.material.opacity = 0.22 + thrill * 0.1;
      }
    }
  }

  private readonly darkenNonBloomed = (obj: THREE.Object3D): void => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }
    if (obj.layers.test(this.camera.layers)) {
      return;
    }
    originalMaterials.set(obj.uuid, obj.material);
    obj.material = darkMaterial;
  };

  private readonly restoreMaterial = (obj: THREE.Object3D): void => {
    if (!(obj instanceof THREE.Mesh)) {
      return;
    }
    const material = originalMaterials.get(obj.uuid);
    if (!material) {
      return;
    }
    obj.material = material;
    originalMaterials.delete(obj.uuid);
  };

  private readonly onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;
    const worldHeight = 20;
    this.camera.left = -(worldHeight * aspect) / 2;
    this.camera.right = (worldHeight * aspect) / 2;
    this.camera.top = worldHeight / 2;
    this.camera.bottom = -worldHeight / 2;
    this.camera.updateProjectionMatrix();

    this.rawRenderer.setSize(w, h);
    this.bloomComposer.setSize(w, h);
    this.finalComposer.setSize(w, h);
  };
}
