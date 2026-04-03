import * as THREE from 'three';
import { GameLoop } from './core/GameLoop';
import { Renderer } from './core/Renderer';
import { World } from './core/World';
import { gameStore } from './store/gameStore';
import {
  sdkInitialize,
  sdkLoadProgress,
  sdkReportProgress,
  sdkSaveProgress,
  sdkStart
} from './MetaSDK';
import { MovementSystem } from './systems/MovementSystem';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { PulseFieldSystem } from './systems/PulseFieldSystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { PassiveRegenSystem } from './systems/PassiveRegenSystem';
import { BossEvolutionSystem } from './systems/BossEvolutionSystem';
import { ShatterSystem } from './systems/ShatterSystem';
import { FeedbackSystem } from './systems/FeedbackSystem';
import { HUDSystem } from './systems/HUDSystem';

const BLOOM_LAYER = 1;

async function bootstrap(): Promise<void> {
  await sdkInitialize();
  sdkReportProgress(8);

  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing #app mount node');
  }

  const world = new World();
  const renderer = new Renderer(world, app);
  createBackdrop(renderer.scene);
  createHudOverlay(app);
  sdkReportProgress(26);

  const saved = await sdkLoadProgress();
  gameStore.getState().setHighScore(saved.highScore);
  gameStore.getState().resetRun();
  sdkReportProgress(42);

  buildEntities(world, renderer.scene);
  registerSystems(world);
  bindInput(world, renderer.rawRenderer.domElement, renderer.camera);
  sdkReportProgress(85);

  await sdkStart();
  sdkReportProgress(100);

  const loop = new GameLoop(world, renderer);
  watchSessionEnd(loop, world, saved);
  loop.start();
}

function createBackdrop(scene: THREE.Scene): void {
  const stars = new THREE.BufferGeometry();
  const count = 320;
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    vertices[i * 3] = (Math.random() - 0.5) * 22;
    vertices[i * 3 + 1] = (Math.random() - 0.5) * 22;
    vertices[i * 3 + 2] = -8 - Math.random() * 16;
  }
  stars.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const points = new THREE.Points(
    stars,
    new THREE.PointsMaterial({ color: 0x4d96cc, size: 0.03, transparent: true, opacity: 0.75 })
  );
  scene.add(points);

  const ambient = new THREE.AmbientLight(0x6ba7ff, 0.35);
  const key = new THREE.DirectionalLight(0x77d4ff, 0.75);
  key.position.set(0, 1, 1);
  scene.add(ambient, key);
}

function buildEntities(world: World, scene: THREE.Scene): void {
  const tanker = world.createEntity('tanker');
  world.tankerEntity = tanker;
  world.addComponent(tanker, {
    type: 'Transform',
    x: 0,
    y: -7.8,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1
  });
  world.addComponent(tanker, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
  world.addComponent(tanker, { type: 'Health', current: 100, max: 100, regenRate: 0 });
  world.addComponent(tanker, {
    type: 'PulseField',
    radius: 0,
    maxRadius: 7.6,
    strength: 58,
    active: false,
    cooldownMs: 0
  });
  const tankerMesh = new THREE.Mesh(
    new THREE.ConeGeometry(0.68, 1.4, 8),
    new THREE.MeshStandardMaterial({
      color: 0x57bcff,
      emissive: 0x0f4b73,
      roughness: 0.35,
      metalness: 0.65
    })
  );
  tankerMesh.rotation.z = Math.PI;
  tankerMesh.layers.enable(BLOOM_LAYER);
  scene.add(tankerMesh);
  world.addComponent(tanker, { type: 'Render', mesh: tankerMesh, bloomLayer: BLOOM_LAYER });
  world.hitboxes.set(tanker, { w: 0.9, h: 0.9 });

  const fabricator = world.createEntity('fabricator');
  world.fabricatorEntity = fabricator;
  world.addComponent(fabricator, {
    type: 'Transform',
    x: 0,
    y: 7.2,
    z: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1
  });
  world.addComponent(fabricator, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
  world.addComponent(fabricator, { type: 'Health', current: 1250, max: 1250, regenRate: 2 });
  world.addComponent(fabricator, {
    type: 'Boss',
    stage: 1,
    shieldActive: false,
    beamTargetX: 0,
    beamFiring: false
  });
  const shieldMaterial = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec2 vUv;
      void main() {
        float fresnel = 1.0 - max(dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0);
        float arc = abs(sin(vUv.x * 25.0 + uTime * 1.2) * cos(vUv.y * 24.0 - uTime * 0.7));
        vec3 core = vec3(0.03, 0.12, 0.2) + vec3(0.1, 0.45, 0.95) * fresnel;
        core += vec3(0.12, 0.42, 0.95) * arc * uIntensity * 0.32;
        gl_FragColor = vec4(core, 0.7 + 0.2 * fresnel);
      }
    `
  });
  const fabricatorMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 2), shieldMaterial);
  scene.add(fabricatorMesh);
  world.addComponent(fabricator, { type: 'Render', mesh: fabricatorMesh, bloomLayer: 0 });
  world.hitboxes.set(fabricator, { w: 2.2, h: 2.2 });

  const pulseWave = world.createEntity('pulseWave');
  world.addComponent(pulseWave, {
    type: 'Transform',
    x: 0,
    y: -7.8,
    z: 0.03,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 0.01,
    scaleY: 0.01,
    scaleZ: 1
  });
  const pulseMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0x7ed9ff,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide
    })
  );
  pulseMesh.visible = false;
  pulseMesh.layers.enable(BLOOM_LAYER);
  scene.add(pulseMesh);
  world.addComponent(pulseWave, { type: 'Render', mesh: pulseMesh, bloomLayer: BLOOM_LAYER });

  const beam = world.createEntity('beam');
  world.addComponent(beam, {
    type: 'Transform',
    x: 0,
    y: 0,
    z: 0.01,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1
  });
  const beamMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.22, 20),
    new THREE.MeshBasicMaterial({ color: 0x88d8ff, transparent: true, opacity: 0.2 })
  );
  beamMesh.visible = false;
  beamMesh.layers.enable(BLOOM_LAYER);
  scene.add(beamMesh);
  world.addComponent(beam, { type: 'Render', mesh: beamMesh, bloomLayer: BLOOM_LAYER });

  createPooledEntities(world, scene);
}

function createPooledEntities(world: World, scene: THREE.Scene): void {
  const bullets: number[] = [];
  for (let i = 0; i < 72; i += 1) {
    const e = world.createEntity('bullet');
    world.addComponent(e, {
      type: 'Transform',
      x: 0,
      y: -100,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1
    });
    world.addComponent(e, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
    world.addComponent(e, { type: 'Poolable', poolKey: 'bullet', active: false });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x72ccff })
    );
    mesh.visible = false;
    mesh.layers.enable(BLOOM_LAYER);
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: BLOOM_LAYER });
    world.hitboxes.set(e, { w: 0.22, h: 0.22 });
    bullets.push(e);
  }
  world.registerPool('bullet', bullets);

  const obstacles: number[] = [];
  for (let i = 0; i < 60; i += 1) {
    const e = world.createEntity('obstacle');
    world.addComponent(e, {
      type: 'Transform',
      x: 0,
      y: 100,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1
    });
    world.addComponent(e, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
    world.addComponent(e, { type: 'Health', current: 24, max: 24, regenRate: 0 });
    world.addComponent(e, { type: 'Poolable', poolKey: 'obstacle', active: false });
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42),
      new THREE.MeshStandardMaterial({
        color: 0x758599,
        roughness: 0.9,
        metalness: 0.15
      })
    );
    mesh.visible = false;
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: 0 });
    world.hitboxes.set(e, { w: 0.72, h: 0.72 });
    obstacles.push(e);
  }
  world.registerPool('obstacle', obstacles);

  const debris: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const e = world.createEntity('debris');
    world.addComponent(e, {
      type: 'Transform',
      x: 0,
      y: 100,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1
    });
    world.addComponent(e, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
    world.addComponent(e, { type: 'Poolable', poolKey: 'debris', active: false });
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshBasicMaterial({ color: 0x8ca9bd })
    );
    mesh.visible = false;
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: 0 });
    world.hitboxes.set(e, { w: 0.2, h: 0.2 });
    debris.push(e);
  }
  world.registerPool('debris', debris);

  const subParticles: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const e = world.createEntity('subParticle');
    world.addComponent(e, {
      type: 'Transform',
      x: 0,
      y: 100,
      z: 0,
      rotX: 0,
      rotY: 0,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1
    });
    world.addComponent(e, { type: 'Velocity', vx: 0, vy: 0, vz: 0 });
    world.addComponent(e, { type: 'Poolable', poolKey: 'subParticle', active: false });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x9bc7f8 })
    );
    mesh.visible = false;
    mesh.layers.enable(BLOOM_LAYER);
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: BLOOM_LAYER });
    world.hitboxes.set(e, { w: 0.14, h: 0.14 });
    subParticles.push(e);
  }
  world.registerPool('subParticle', subParticles);
}

function registerSystems(world: World): void {
  world.registerSystem(new MovementSystem());
  world.registerSystem(new PhysicsSystem());
  world.registerSystem(new PulseFieldSystem());
  world.registerSystem(new SpawnSystem());
  world.registerSystem(new PassiveRegenSystem());
  world.registerSystem(new BossEvolutionSystem());
  world.registerSystem(new ShatterSystem());
  world.registerSystem(new FeedbackSystem());
  world.registerSystem(new HUDSystem());
}

function bindInput(
  world: World,
  canvas: HTMLCanvasElement,
  camera: THREE.OrthographicCamera
): void {
  const updateX = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const norm = (event.clientX - rect.left) / rect.width;
    const worldX = camera.left + norm * (camera.right - camera.left);
    world.input.targetX = worldX;
  };

  canvas.addEventListener('pointermove', updateX);
  canvas.addEventListener('pointerdown', (event) => {
    updateX(event);
    if (event.button === 2) {
      world.input.pulseRequested = true;
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      world.input.pulseRequested = true;
      event.preventDefault();
    }
  });
}

function createHudOverlay(app: HTMLElement): void {
  const hud = document.createElement('div');
  hud.style.position = 'absolute';
  hud.style.top = '16px';
  hud.style.left = '16px';
  hud.style.padding = '12px 14px';
  hud.style.borderRadius = '14px';
  hud.style.border = '1px solid rgba(118, 200, 255, 0.55)';
  hud.style.background = 'rgba(12, 22, 33, 0.55)';
  hud.style.backdropFilter = 'blur(12px)';
  hud.style.color = '#d2ecff';
  hud.style.letterSpacing = '0.08em';
  hud.style.textTransform = 'uppercase';
  hud.style.fontWeight = '700';
  hud.style.fontSize = '13px';
  hud.style.whiteSpace = 'pre';
  hud.style.pointerEvents = 'none';
  hud.style.boxShadow = '0 0 0 1px rgba(135, 218, 255, 0.15), 0 8px 20px rgba(0, 0, 0, 0.35)';
  app.appendChild(hud);

  const gameOver = document.createElement('div');
  gameOver.style.position = 'absolute';
  gameOver.style.top = '50%';
  gameOver.style.left = '50%';
  gameOver.style.transform = 'translate(-50%, -50%)';
  gameOver.style.padding = '22px 26px';
  gameOver.style.borderRadius = '16px';
  gameOver.style.border = '1px solid rgba(132, 230, 255, 0.6)';
  gameOver.style.background = 'rgba(7, 14, 23, 0.62)';
  gameOver.style.backdropFilter = 'blur(14px)';
  gameOver.style.color = '#f4fbff';
  gameOver.style.fontSize = '22px';
  gameOver.style.fontWeight = '700';
  gameOver.style.letterSpacing = '0.12em';
  gameOver.style.display = 'none';
  gameOver.textContent = 'Session Over';
  app.appendChild(gameOver);

  gameStore.subscribe((state) => {
    const pulseReady = state.pulseCooldownMs <= 10 ? 'Ready' : `${Math.ceil(state.pulseCooldownMs / 1000)}s`;
    hud.textContent =
      `Score ${Math.floor(state.score)}  High ${Math.floor(state.highScore)}\n` +
      `Tanker ${Math.ceil(state.tankerHp)}  Boss ${Math.ceil(state.bossHp)} / ${Math.ceil(state.bossMaxHp)}\n` +
      `Stage ${state.bossStage}  Pulse ${pulseReady}`;
    gameOver.style.display = state.isGameOver ? 'block' : 'none';
  });
}

function watchSessionEnd(loop: GameLoop, world: World, previous: { highScore: number; totalRuns: number }): void {
  let committed = false;
  gameStore.subscribe(async (state) => {
    if (!state.isGameOver || committed) {
      return;
    }
    committed = true;
    loop.stop();
    const high = Math.max(previous.highScore, Math.floor(state.score));
    const stage = world.bosses.get(world.fabricatorEntity)?.stage ?? 1;
    await sdkSaveProgress({
      highScore: high,
      totalRuns: previous.totalRuns + 1,
      lastStageReached: stage
    });
    gameStore.getState().setHighScore(high);
  });
}

void bootstrap();
