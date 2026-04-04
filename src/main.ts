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

type BackgroundPreset = 'nebula' | 'sunsetGrid' | 'deepVoid';
type HeroAvatarPreset = 'vanguard' | 'spectre' | 'ember';

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
  syncArenaBounds(world, renderer);
  createHudOverlay(app);
  sdkReportProgress(26);

  const saved = await sdkLoadProgress();
  gameStore.getState().setHighScore(saved.highScore);
  gameStore.getState().resetRun();
  sdkReportProgress(42);

  buildEntities(world, renderer.scene);
  createSettingsPage(app, renderer.scene);
  syncArenaBounds(world, renderer);
  registerSystems(world);
  bindInput(world, renderer.rawRenderer.domElement, renderer.camera, app);
  window.addEventListener('resize', () => syncArenaBounds(world, renderer));
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
    new THREE.PointsMaterial({ color: 0x78e2ff, size: 0.035, transparent: true, opacity: 0.8 })
  );
  points.name = 'bgStars';
  scene.add(points);

  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 24),
    new THREE.MeshBasicMaterial({
      color: 0x113247,
      transparent: true,
      opacity: 0.28
    })
  );
  haze.name = 'bgHaze';
  haze.position.z = -6;
  scene.add(haze);

  const ambient = new THREE.AmbientLight(0x7ac8ff, 0.48);
  const key = new THREE.DirectionalLight(0x8ef0ff, 0.82);
  key.position.set(0, 1, 1);
  scene.add(ambient, key);

  const railGeometry = new THREE.PlaneGeometry(0.18, 20);
  const leftRail = new THREE.Mesh(
    railGeometry,
    new THREE.MeshBasicMaterial({ color: 0x8ce8ff, transparent: true, opacity: 0.38 })
  );
  leftRail.name = 'leftRail';
  leftRail.position.set(-8.22, 0, -0.2);
  leftRail.layers.enable(BLOOM_LAYER);

  const rightRail = leftRail.clone();
  rightRail.name = 'rightRail';
  rightRail.position.x = 8.22;
  scene.add(leftRail, rightRail);
}

function syncArenaBounds(world: World, renderer: Renderer): void {
  const camera = renderer.camera;
  const xMargin = 0.75;
  const topMargin = 1.6;
  const bottomMargin = 3.15;
  world.arena.minX = camera.left + xMargin;
  world.arena.maxX = camera.right - xMargin;
  world.arena.minY = camera.bottom + bottomMargin;
  world.arena.maxY = camera.top - topMargin;

  const tanker = world.transforms.get(world.tankerEntity);
  if (tanker) {
    tanker.x = THREE.MathUtils.clamp(tanker.x, world.arena.minX, world.arena.maxX);
    tanker.y = world.arena.minY + 2.35;
  }
  const pulseWave = world.getEntitiesByRole('pulseWave', false)[0];
  const pulseTransform = pulseWave ? world.transforms.get(pulseWave) : undefined;
  if (pulseTransform && tanker) {
    pulseTransform.y = tanker.y;
  }

  const boss = world.transforms.get(world.fabricatorEntity);
  if (boss) {
    boss.x = THREE.MathUtils.clamp(boss.x, world.arena.minX + 1.2, world.arena.maxX - 1.2);
    boss.y = world.arena.maxY - 1.2;
  }

  const leftRail = renderer.scene.getObjectByName('leftRail');
  const rightRail = renderer.scene.getObjectByName('rightRail');
  if (leftRail) {
    leftRail.position.x = world.arena.minX - 0.12;
  }
  if (rightRail) {
    rightRail.position.x = world.arena.maxX + 0.12;
  }
}

function buildEntities(world: World, scene: THREE.Scene): void {
  const tanker = world.createEntity('tanker');
  world.tankerEntity = tanker;
  world.addComponent(tanker, {
    type: 'Transform',
    x: 0,
    y: world.arena.minY + 2.35,
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
  const tankerMesh = new THREE.Group();
  tankerMesh.name = 'heroRoot';
  const chassis = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.42, 1.45, 6, 14),
    new THREE.MeshStandardMaterial({
      color: 0xc8f3ff,
      emissive: 0x103a4d,
      emissiveIntensity: 0.45,
      roughness: 0.23,
      metalness: 0.74
    })
  );
  chassis.name = 'heroChassis';
  chassis.rotation.z = Math.PI / 2;
  const wingLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x89dfff, emissive: 0x1f6a88, emissiveIntensity: 0.6 })
  );
  wingLeft.name = 'heroWingLeft';
  wingLeft.position.set(-0.33, 0.12, 0);
  const wingRight = wingLeft.clone();
  wingRight.name = 'heroWingRight';
  wingRight.position.x = 0.33;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x88f6ff, transparent: true, opacity: 0.92 })
  );
  core.name = 'heroCore';
  core.position.set(0, 0.28, 0.16);
  core.layers.enable(BLOOM_LAYER);
  tankerMesh.add(chassis, wingLeft, wingRight, core);
  tankerMesh.layers.enable(BLOOM_LAYER);
  scene.add(tankerMesh);
  world.addComponent(tanker, { type: 'Render', mesh: tankerMesh, bloomLayer: BLOOM_LAYER });
  world.hitboxes.set(tanker, { w: 0.9, h: 0.9 });

  const fabricator = world.createEntity('fabricator');
  world.fabricatorEntity = fabricator;
  world.addComponent(fabricator, {
    type: 'Transform',
    x: 0,
    y: world.arena.maxY - 1.2,
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
  const haloOuter = new THREE.Mesh(
    new THREE.TorusGeometry(2.05, 0.06, 14, 84),
    new THREE.MeshBasicMaterial({
      color: 0x8df7ff,
      transparent: true,
      opacity: 0.45
    })
  );
  haloOuter.name = 'fabricatorHaloOuter';
  haloOuter.rotation.x = Math.PI * 0.25;
  haloOuter.layers.enable(BLOOM_LAYER);

  const haloInner = new THREE.Mesh(
    new THREE.TorusGeometry(1.6, 0.045, 12, 72),
    new THREE.MeshBasicMaterial({
      color: 0xb9ffe8,
      transparent: true,
      opacity: 0.42
    })
  );
  haloInner.name = 'fabricatorHaloInner';
  haloInner.rotation.x = Math.PI * -0.35;
  haloInner.layers.enable(BLOOM_LAYER);

  const crownOrbA = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xa2f4ff, transparent: true, opacity: 0.85 })
  );
  crownOrbA.name = 'fabricatorOrbA';
  crownOrbA.position.set(1.9, 0, 0);
  crownOrbA.layers.enable(BLOOM_LAYER);

  const crownOrbB = crownOrbA.clone();
  crownOrbB.name = 'fabricatorOrbB';
  crownOrbB.position.set(-1.9, 0, 0);

  const coreLight = new THREE.PointLight(0x8cecff, 1.4, 8, 2);
  coreLight.name = 'fabricatorLight';
  coreLight.position.set(0, 0, 0.4);

  fabricatorMesh.add(haloOuter, haloInner, crownOrbA, crownOrbB, coreLight);
  scene.add(fabricatorMesh);
  world.addComponent(fabricator, { type: 'Render', mesh: fabricatorMesh, bloomLayer: 0 });
  world.hitboxes.set(fabricator, { w: 2.2, h: 2.2 });

  const pulseWave = world.createEntity('pulseWave');
  world.addComponent(pulseWave, {
    type: 'Transform',
    x: 0,
    y: world.arena.minY + 2.35,
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
    const geometryOptions = [
      new THREE.DodecahedronGeometry(0.42),
      new THREE.OctahedronGeometry(0.47),
      new THREE.IcosahedronGeometry(0.44),
      new THREE.TetrahedronGeometry(0.5)
    ];
    const mesh = new THREE.Mesh(
      geometryOptions[i % geometryOptions.length],
      new THREE.MeshStandardMaterial({
        color: 0x8fb9d1,
        emissive: 0x1a2d3d,
        emissiveIntensity: 0.6,
        roughness: 0.45,
        metalness: 0.52
      })
    );
    if (i % 2 === 0) {
      const fin = new THREE.Mesh(
        new THREE.ConeGeometry(0.08, 0.46, 6),
        new THREE.MeshStandardMaterial({ color: 0xa6d4eb, emissive: 0x264765, emissiveIntensity: 0.6 })
      );
      fin.position.set(0, 0.42, 0);
      fin.rotation.x = Math.PI;
      mesh.add(fin);
    }
    if (i % 3 === 0) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.03, 8, 24),
        new THREE.MeshBasicMaterial({ color: 0x88d8ff, transparent: true, opacity: 0.6 })
      );
      ring.rotation.x = Math.PI * 0.5;
      ring.layers.enable(BLOOM_LAYER);
      mesh.add(ring);
    }
    const coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x9bf5ff, transparent: true, opacity: 0.75 })
    );
    coreGlow.layers.enable(BLOOM_LAYER);
    mesh.add(coreGlow);
    mesh.visible = false;
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: 0 });
    world.hitboxes.set(e, { w: 0.72, h: 0.72 });
    obstacles.push(e);
  }
  world.registerPool('obstacle', obstacles);

  const enemyBullets: number[] = [];
  for (let i = 0; i < 80; i += 1) {
    const e = world.createEntity('enemyBullet');
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
    world.addComponent(e, { type: 'Poolable', poolKey: 'enemyBullet', active: false });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffbf98 })
    );
    mesh.visible = false;
    mesh.layers.enable(BLOOM_LAYER);
    scene.add(mesh);
    world.addComponent(e, { type: 'Render', mesh, bloomLayer: BLOOM_LAYER });
    world.hitboxes.set(e, { w: 0.22, h: 0.22 });
    enemyBullets.push(e);
  }
  world.registerPool('enemyBullet', enemyBullets);

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
  camera: THREE.OrthographicCamera,
  app: HTMLElement
): void {
  const controls = createTouchControls(app);
  const isTouchDevice =
    'ontouchstart' in window || (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0);

  if (isTouchDevice) {
    world.input.useAxisControl = true;
  } else {
    controls.root.style.display = 'none';
  }

  controls.fireButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    world.input.shootHeld = true;
  });
  const releaseFire = (): void => {
    world.input.shootHeld = false;
  };
  controls.fireButton.addEventListener('pointerup', releaseFire);
  controls.fireButton.addEventListener('pointercancel', releaseFire);
  controls.fireButton.addEventListener('pointerleave', releaseFire);

  controls.pulseButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    world.input.pulseRequested = false;
  });

  let movePointerId: number | null = null;
  const maxTravel = 34;
  const deadZone = 0.09;

  const updateMoveAxis = (clientX: number, clientY: number): void => {
    const rect = controls.movePad.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const rawDx = clientX - centerX;
    const rawDy = clientY - centerY;
    const distance = Math.hypot(rawDx, rawDy);
    const limitedDist = Math.min(distance, maxTravel);
    const nx = distance > 0.0001 ? rawDx / distance : 0;
    const ny = distance > 0.0001 ? rawDy / distance : 0;
    const stickX = nx * limitedDist;
    const stickY = ny * limitedDist;

    const normX = Math.max(-1, Math.min(1, stickX / maxTravel));
    const absX = Math.abs(normX);
    if (absX < deadZone) {
      world.input.moveAxisX = 0;
    } else {
      const eased = (absX - deadZone) / (1 - deadZone);
      world.input.moveAxisX = Math.sign(normX) * Math.pow(eased, 1.08);
    }

    controls.stick.style.transform = `translate(${stickX}px, ${stickY}px)`;
  };

  controls.movePad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    controls.movePad.setPointerCapture(event.pointerId);
    movePointerId = event.pointerId;
    world.input.useAxisControl = true;
    controls.stick.style.transition = 'none';
    updateMoveAxis(event.clientX, event.clientY);
  });
  controls.movePad.addEventListener('pointermove', (event) => {
    if (movePointerId !== event.pointerId) {
      return;
    }
    updateMoveAxis(event.clientX, event.clientY);
  });
  const releaseMove = (event: PointerEvent): void => {
    if (movePointerId !== event.pointerId) {
      return;
    }
    movePointerId = null;
    world.input.moveAxisX = 0;
    controls.stick.style.transition = 'transform 120ms cubic-bezier(0.2, 0.9, 0.2, 1)';
    controls.stick.style.transform = 'translate(0px, 0px)';
  };
  controls.movePad.addEventListener('pointerup', releaseMove);
  controls.movePad.addEventListener('pointercancel', releaseMove);

  const updateX = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    const norm = (event.clientX - rect.left) / rect.width;
    const worldX = camera.left + norm * (camera.right - camera.left);
    world.input.targetX = worldX;
  };

  canvas.addEventListener('pointermove', (event) => {
    if (world.input.useAxisControl) {
      return;
    }
    updateX(event);
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') {
      world.input.useAxisControl = false;
      updateX(event);
    }
    if (event.button === 0 && event.pointerType === 'mouse') {
      world.input.shootHeld = true;
    }
    if (event.button === 2 || (event.pointerType === 'mouse' && event.shiftKey)) {
      world.input.pulseRequested = false;
    }
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 0 && event.pointerType === 'mouse') {
      world.input.shootHeld = false;
    }
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA') {
      world.input.useAxisControl = true;
      world.input.moveAxisX = -1;
    }
    if (event.code === 'ArrowRight' || event.code === 'KeyD') {
      world.input.useAxisControl = true;
      world.input.moveAxisX = 1;
    }
    if (event.code === 'KeyJ' || event.code === 'Enter') {
      world.input.shootHeld = true;
      event.preventDefault();
    }
    if (event.code === 'Space') {
      world.input.pulseRequested = false;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    if (event.code === 'ArrowLeft' || event.code === 'KeyA' || event.code === 'ArrowRight' || event.code === 'KeyD') {
      world.input.moveAxisX = 0;
    }
    if (event.code === 'KeyJ' || event.code === 'Enter') {
      world.input.shootHeld = false;
    }
  });
  window.addEventListener('blur', () => {
    world.input.shootHeld = false;
    world.input.moveAxisX = 0;
  });
}

function createTouchControls(app: HTMLElement): {
  root: HTMLDivElement;
  movePad: HTMLDivElement;
  stick: HTMLDivElement;
  fireButton: HTMLButtonElement;
  pulseButton: HTMLButtonElement;
} {
  const controlsRoot = document.createElement('div');
  controlsRoot.style.position = 'absolute';
  controlsRoot.style.left = '0';
  controlsRoot.style.right = '0';
  controlsRoot.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 8px)';
  controlsRoot.style.display = 'flex';
  controlsRoot.style.justifyContent = 'space-between';
  controlsRoot.style.alignItems = 'flex-end';
  controlsRoot.style.padding = '0 12px';
  controlsRoot.style.pointerEvents = 'none';
  controlsRoot.style.zIndex = '12';
  app.appendChild(controlsRoot);

  const movePad = document.createElement('div');
  movePad.style.width = '116px';
  movePad.style.height = '116px';
  movePad.style.borderRadius = '999px';
  movePad.style.border = '1px solid rgba(118, 231, 255, 0.8)';
  movePad.style.background =
    'radial-gradient(circle at 35% 35%, rgba(147, 246, 255, 0.2), rgba(8, 31, 45, 0.5) 68%)';
  movePad.style.backdropFilter = 'blur(12px)';
  movePad.style.boxShadow = '0 10px 26px rgba(0, 0, 0, 0.35), inset 0 0 24px rgba(112, 220, 255, 0.18)';
  movePad.style.pointerEvents = 'auto';
  movePad.style.display = 'grid';
  movePad.style.placeItems = 'center';
  movePad.style.touchAction = 'none';
  controlsRoot.appendChild(movePad);

  const stick = document.createElement('div');
  stick.style.width = '48px';
  stick.style.height = '48px';
  stick.style.borderRadius = '999px';
  stick.style.border = '1px solid rgba(190, 248, 255, 0.96)';
  stick.style.background =
    'radial-gradient(circle at 35% 35%, rgba(212, 251, 255, 0.5), rgba(91, 198, 227, 0.18) 72%)';
  stick.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.35)';
  stick.style.transition = 'transform 90ms ease-out';
  movePad.appendChild(stick);

  const actionColumn = document.createElement('div');
  actionColumn.style.display = 'flex';
  actionColumn.style.flexDirection = 'column';
  actionColumn.style.alignItems = 'flex-end';
  actionColumn.style.gap = '10px';
  actionColumn.style.pointerEvents = 'none';
  controlsRoot.appendChild(actionColumn);

  const pulseButton = document.createElement('button');
  pulseButton.textContent = 'PULSE';
  pulseButton.style.width = '76px';
  pulseButton.style.height = '76px';
  pulseButton.style.borderRadius = '999px';
  pulseButton.style.border = '1px solid rgba(132, 236, 255, 0.9)';
  pulseButton.style.color = '#dff7ff';
  pulseButton.style.fontWeight = '700';
  pulseButton.style.fontSize = '12px';
  pulseButton.style.letterSpacing = '0.08em';
  pulseButton.style.background =
    'radial-gradient(circle at 35% 30%, rgba(170, 241, 255, 0.58), rgba(26, 86, 114, 0.55) 72%)';
  pulseButton.style.backdropFilter = 'blur(12px)';
  pulseButton.style.boxShadow = '0 10px 22px rgba(0, 0, 0, 0.35)';
  pulseButton.style.pointerEvents = 'auto';
  pulseButton.style.touchAction = 'none';
  pulseButton.style.display = 'none';
  actionColumn.appendChild(pulseButton);

  const fireButton = document.createElement('button');
  fireButton.textContent = 'BLAST';
  fireButton.style.width = '104px';
  fireButton.style.height = '104px';
  fireButton.style.borderRadius = '999px';
  fireButton.style.border = '1px solid rgba(255, 195, 128, 0.95)';
  fireButton.style.color = '#fff3e3';
  fireButton.style.fontWeight = '700';
  fireButton.style.fontSize = '15px';
  fireButton.style.letterSpacing = '0.11em';
  fireButton.style.textShadow = '0 0 8px rgba(255, 206, 140, 0.45)';
  fireButton.style.background =
    'radial-gradient(circle at 34% 30%, rgba(255, 222, 167, 0.74), rgba(143, 62, 24, 0.66) 70%, rgba(79, 24, 12, 0.72) 100%)';
  fireButton.style.backdropFilter = 'blur(12px)';
  fireButton.style.boxShadow =
    '0 10px 26px rgba(0, 0, 0, 0.35), 0 0 18px rgba(255, 158, 84, 0.28), inset 0 0 26px rgba(255, 190, 125, 0.18)';
  fireButton.style.pointerEvents = 'auto';
  fireButton.style.touchAction = 'none';
  actionColumn.appendChild(fireButton);

  return { root: controlsRoot, movePad, stick, fireButton, pulseButton };
}

function createSettingsPage(app: HTMLElement, scene: THREE.Scene): void {
  let currentBackground: BackgroundPreset = 'nebula';
  let currentAvatar: HeroAvatarPreset = 'vanguard';

  applyBackgroundPreset(scene, currentBackground);
  applyHeroAvatar(scene, currentAvatar);

  const openButton = document.createElement('button');
  openButton.textContent = 'S';
  openButton.style.position = 'absolute';
  openButton.style.left = '50%';
  openButton.style.transform = 'translateX(-50%)';
  openButton.style.top = 'calc(env(safe-area-inset-top, 0px) + 6px)';
  openButton.style.zIndex = '13';
  openButton.style.width = '34px';
  openButton.style.height = '34px';
  openButton.style.border = '1px solid rgba(128, 231, 255, 0.85)';
  openButton.style.borderRadius = '999px';
  openButton.style.color = '#dff8ff';
  openButton.style.fontWeight = '700';
  openButton.style.fontSize = '12px';
  openButton.style.letterSpacing = '0.02em';
  openButton.style.background = 'rgba(8, 27, 39, 0.68)';
  openButton.style.backdropFilter = 'blur(8px)';
  openButton.style.boxShadow = '0 6px 14px rgba(0, 0, 0, 0.35)';
  openButton.style.touchAction = 'none';
  app.appendChild(openButton);

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.zIndex = '20';
  overlay.style.display = 'none';
  overlay.style.background = 'rgba(4, 10, 16, 0.72)';
  overlay.style.backdropFilter = 'blur(10px)';
  overlay.style.padding = '18px 12px 14px';
  overlay.style.pointerEvents = 'auto';
  app.appendChild(overlay);

  const panel = document.createElement('div');
  panel.style.maxWidth = '460px';
  panel.style.margin = '0 auto';
  panel.style.border = '1px solid rgba(124, 226, 255, 0.6)';
  panel.style.borderRadius = '16px';
  panel.style.padding = '14px';
  panel.style.background = 'linear-gradient(160deg, rgba(8, 26, 38, 0.92), rgba(6, 16, 23, 0.88))';
  panel.style.boxShadow = '0 18px 42px rgba(0, 0, 0, 0.45)';
  panel.style.display = 'grid';
  panel.style.gap = '12px';
  overlay.appendChild(panel);

  const title = document.createElement('div');
  title.textContent = 'Game Settings';
  title.style.color = '#e0f9ff';
  title.style.fontSize = '19px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.04em';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Choose battlefield background and hero avatar';
  subtitle.style.color = 'rgba(198, 235, 247, 0.9)';
  subtitle.style.fontSize = '12px';
  subtitle.style.letterSpacing = '0.03em';
  panel.appendChild(subtitle);

  const sectionBg = document.createElement('div');
  sectionBg.style.display = 'grid';
  sectionBg.style.gap = '8px';
  panel.appendChild(sectionBg);
  const sectionBgTitle = document.createElement('div');
  sectionBgTitle.textContent = 'Background';
  sectionBgTitle.style.color = '#b8f2ff';
  sectionBgTitle.style.fontWeight = '700';
  sectionBgTitle.style.letterSpacing = '0.05em';
  sectionBgTitle.style.fontSize = '12px';
  sectionBg.appendChild(sectionBgTitle);
  const bgGrid = document.createElement('div');
  bgGrid.style.display = 'grid';
  bgGrid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  bgGrid.style.gap = '8px';
  sectionBg.appendChild(bgGrid);

  const sectionAvatar = document.createElement('div');
  sectionAvatar.style.display = 'grid';
  sectionAvatar.style.gap = '8px';
  panel.appendChild(sectionAvatar);
  const sectionAvatarTitle = document.createElement('div');
  sectionAvatarTitle.textContent = 'Hero Avatar';
  sectionAvatarTitle.style.color = '#b8f2ff';
  sectionAvatarTitle.style.fontWeight = '700';
  sectionAvatarTitle.style.letterSpacing = '0.05em';
  sectionAvatarTitle.style.fontSize = '12px';
  sectionAvatar.appendChild(sectionAvatarTitle);
  const avatarGrid = document.createElement('div');
  avatarGrid.style.display = 'grid';
  avatarGrid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
  avatarGrid.style.gap = '8px';
  sectionAvatar.appendChild(avatarGrid);

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  panel.appendChild(footer);
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.border = '1px solid rgba(136, 225, 255, 0.8)';
  closeButton.style.borderRadius = '10px';
  closeButton.style.padding = '8px 12px';
  closeButton.style.background = 'rgba(17, 57, 78, 0.7)';
  closeButton.style.color = '#e1f9ff';
  closeButton.style.fontWeight = '700';
  closeButton.style.letterSpacing = '0.04em';
  footer.appendChild(closeButton);

  const optionStyle = (button: HTMLButtonElement, active: boolean): void => {
    button.style.border = active ? '1px solid rgba(157, 245, 255, 0.95)' : '1px solid rgba(103, 173, 196, 0.6)';
    button.style.boxShadow = active
      ? '0 0 0 1px rgba(173, 252, 255, 0.25), 0 8px 18px rgba(0, 0, 0, 0.35)'
      : '0 6px 14px rgba(0, 0, 0, 0.25)';
  };

  const makeOption = (
    label: string,
    container: HTMLElement,
    selected: () => boolean,
    onSelect: () => void
  ): HTMLButtonElement => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.height = '52px';
    button.style.borderRadius = '12px';
    button.style.background = 'rgba(11, 35, 50, 0.74)';
    button.style.color = '#def6ff';
    button.style.fontWeight = '700';
    button.style.fontSize = '12px';
    button.style.letterSpacing = '0.04em';
    optionStyle(button, selected());
    button.addEventListener('click', () => {
      onSelect();
      refreshButtons();
    });
    container.appendChild(button);
    return button;
  };

  const bgButtons = [
    { preset: 'nebula' as const, button: makeOption('Nebula', bgGrid, () => currentBackground === 'nebula', () => {
      currentBackground = 'nebula';
      applyBackgroundPreset(scene, currentBackground);
    }) },
    { preset: 'sunsetGrid' as const, button: makeOption('Sunset Grid', bgGrid, () => currentBackground === 'sunsetGrid', () => {
      currentBackground = 'sunsetGrid';
      applyBackgroundPreset(scene, currentBackground);
    }) },
    { preset: 'deepVoid' as const, button: makeOption('Deep Void', bgGrid, () => currentBackground === 'deepVoid', () => {
      currentBackground = 'deepVoid';
      applyBackgroundPreset(scene, currentBackground);
    }) }
  ];

  const avatarButtons = [
    { preset: 'vanguard' as const, button: makeOption('Vanguard', avatarGrid, () => currentAvatar === 'vanguard', () => {
      currentAvatar = 'vanguard';
      applyHeroAvatar(scene, currentAvatar);
    }) },
    { preset: 'spectre' as const, button: makeOption('Spectre', avatarGrid, () => currentAvatar === 'spectre', () => {
      currentAvatar = 'spectre';
      applyHeroAvatar(scene, currentAvatar);
    }) },
    { preset: 'ember' as const, button: makeOption('Ember', avatarGrid, () => currentAvatar === 'ember', () => {
      currentAvatar = 'ember';
      applyHeroAvatar(scene, currentAvatar);
    }) }
  ];

  const refreshButtons = (): void => {
    for (const item of bgButtons) {
      optionStyle(item.button, item.preset === currentBackground);
    }
    for (const item of avatarButtons) {
      optionStyle(item.button, item.preset === currentAvatar);
    }
  };
  refreshButtons();

  openButton.addEventListener('click', () => {
    overlay.style.display = 'block';
    openButton.style.display = 'none';
  });
  closeButton.addEventListener('click', () => {
    overlay.style.display = 'none';
    openButton.style.display = 'block';
  });
}

function applyBackgroundPreset(scene: THREE.Scene, preset: BackgroundPreset): void {
  const stars = scene.getObjectByName('bgStars');
  const haze = scene.getObjectByName('bgHaze');
  const leftRail = scene.getObjectByName('leftRail');
  const rightRail = scene.getObjectByName('rightRail');
  const starMat = stars instanceof THREE.Points ? stars.material : null;
  const hazeMat = haze instanceof THREE.Mesh ? haze.material : null;
  const leftMat = leftRail instanceof THREE.Mesh ? leftRail.material : null;
  const rightMat = rightRail instanceof THREE.Mesh ? rightRail.material : null;

  if (!(starMat instanceof THREE.PointsMaterial) || !(hazeMat instanceof THREE.MeshBasicMaterial)) {
    return;
  }

  if (preset === 'sunsetGrid') {
    scene.background = new THREE.Color(0x120b14);
    starMat.color.setHex(0xffb08a);
    starMat.opacity = 0.7;
    hazeMat.color.setHex(0x4f2035);
    hazeMat.opacity = 0.3;
    if (leftMat instanceof THREE.MeshBasicMaterial) {
      leftMat.color.setHex(0xff9a75);
      leftMat.opacity = 0.42;
    }
    if (rightMat instanceof THREE.MeshBasicMaterial) {
      rightMat.color.setHex(0xff9a75);
      rightMat.opacity = 0.42;
    }
    document.body.style.background =
      'radial-gradient(circle at 15% 20%, #6b2d45 0%, rgba(107, 45, 69, 0) 46%), radial-gradient(circle at 84% 78%, #6b4d2c 0%, rgba(107, 77, 44, 0) 42%), linear-gradient(170deg, #10080f 0%, #040406 70%, #0f1218 100%)';
    return;
  }

  if (preset === 'deepVoid') {
    scene.background = new THREE.Color(0x02040a);
    starMat.color.setHex(0x88b9ff);
    starMat.opacity = 0.62;
    hazeMat.color.setHex(0x0f1d42);
    hazeMat.opacity = 0.18;
    if (leftMat instanceof THREE.MeshBasicMaterial) {
      leftMat.color.setHex(0x7fb3ff);
      leftMat.opacity = 0.32;
    }
    if (rightMat instanceof THREE.MeshBasicMaterial) {
      rightMat.color.setHex(0x7fb3ff);
      rightMat.opacity = 0.32;
    }
    document.body.style.background =
      'radial-gradient(circle at 20% 12%, #102247 0%, rgba(16, 34, 71, 0) 45%), radial-gradient(circle at 82% 88%, #19264f 0%, rgba(25, 38, 79, 0) 46%), linear-gradient(160deg, #02040a 0%, #040914 62%, #0b1524 100%)';
    return;
  }

  scene.background = new THREE.Color(0x05080d);
  starMat.color.setHex(0x78e2ff);
  starMat.opacity = 0.8;
  hazeMat.color.setHex(0x113247);
  hazeMat.opacity = 0.28;
  if (leftMat instanceof THREE.MeshBasicMaterial) {
    leftMat.color.setHex(0x8ce8ff);
    leftMat.opacity = 0.38;
  }
  if (rightMat instanceof THREE.MeshBasicMaterial) {
    rightMat.color.setHex(0x8ce8ff);
    rightMat.opacity = 0.38;
  }
  document.body.style.background =
    'radial-gradient(circle at 15% 20%, #1f4a5d 0%, rgba(31, 74, 93, 0) 45%), radial-gradient(circle at 80% 85%, #53341f 0%, rgba(83, 52, 31, 0) 42%), linear-gradient(165deg, #04090d 0%, #020406 65%, #070f15 100%)';
}

function applyHeroAvatar(scene: THREE.Scene, preset: HeroAvatarPreset): void {
  const chassis = scene.getObjectByName('heroChassis');
  const wingLeft = scene.getObjectByName('heroWingLeft');
  const wingRight = scene.getObjectByName('heroWingRight');
  const core = scene.getObjectByName('heroCore');
  if (!(chassis instanceof THREE.Mesh) || !(wingLeft instanceof THREE.Mesh) || !(wingRight instanceof THREE.Mesh) || !(core instanceof THREE.Mesh)) {
    return;
  }

  const chassisMat = chassis.material;
  const leftMat = wingLeft.material;
  const rightMat = wingRight.material;
  const coreMat = core.material;
  if (
    !(chassisMat instanceof THREE.MeshStandardMaterial) ||
    !(leftMat instanceof THREE.MeshStandardMaterial) ||
    !(rightMat instanceof THREE.MeshStandardMaterial) ||
    !(coreMat instanceof THREE.MeshBasicMaterial)
  ) {
    return;
  }

  if (preset === 'spectre') {
    chassisMat.color.setHex(0xc1d6ff);
    chassisMat.emissive.setHex(0x1a2f62);
    leftMat.color.setHex(0x89a7ff);
    leftMat.emissive.setHex(0x2d3d8a);
    rightMat.color.setHex(0x89a7ff);
    rightMat.emissive.setHex(0x2d3d8a);
    coreMat.color.setHex(0x9aa8ff);
    wingLeft.scale.y = 1.08;
    wingRight.scale.y = 1.08;
    return;
  }

  if (preset === 'ember') {
    chassisMat.color.setHex(0xffd9b1);
    chassisMat.emissive.setHex(0x73391d);
    leftMat.color.setHex(0xffb585);
    leftMat.emissive.setHex(0x89411a);
    rightMat.color.setHex(0xffb585);
    rightMat.emissive.setHex(0x89411a);
    coreMat.color.setHex(0xffd38b);
    wingLeft.scale.y = 1.2;
    wingRight.scale.y = 1.2;
    return;
  }

  chassisMat.color.setHex(0xc8f3ff);
  chassisMat.emissive.setHex(0x103a4d);
  leftMat.color.setHex(0x89dfff);
  leftMat.emissive.setHex(0x1f6a88);
  rightMat.color.setHex(0x89dfff);
  rightMat.emissive.setHex(0x1f6a88);
  coreMat.color.setHex(0x88f6ff);
  wingLeft.scale.y = 1;
  wingRight.scale.y = 1;
}

function createHudOverlay(app: HTMLElement): void {
  const root = document.createElement('div');
  root.style.position = 'absolute';
  root.style.left = '0';
  root.style.right = '0';
  root.style.top = 'calc(env(safe-area-inset-top, 0px) + 8px)';
  root.style.padding = '0 8px';
  root.style.display = 'flex';
  root.style.justifyContent = 'space-between';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '12';
  app.appendChild(root);

  const createBar = (labelText: string, accent: string): { wrap: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement } => {
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '3px';
    wrap.style.width = 'min(38vw, 170px)';
    wrap.style.borderRadius = '10px';
    wrap.style.border = '1px solid rgba(126, 220, 255, 0.45)';
    wrap.style.background = 'linear-gradient(155deg, rgba(7, 21, 30, 0.68), rgba(5, 14, 20, 0.5))';
    wrap.style.backdropFilter = 'blur(8px)';
    wrap.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.28)';
    wrap.style.padding = '6px 8px';

    const label = document.createElement('div');
    label.style.display = 'flex';
    label.style.justifyContent = 'space-between';
    label.style.alignItems = 'center';
    label.style.color = '#c9f0ff';
    label.style.fontSize = '10px';
    label.style.letterSpacing = '0.08em';
    label.style.textTransform = 'uppercase';
    label.style.fontWeight = '700';
    const name = document.createElement('span');
    name.textContent = labelText;
    const value = document.createElement('span');
    label.append(name, value);

    const track = document.createElement('div');
    track.style.height = '7px';
    track.style.borderRadius = '999px';
    track.style.background = 'rgba(106, 164, 190, 0.25)';
    track.style.overflow = 'hidden';
    const fill = document.createElement('div');
    fill.style.height = '100%';
    fill.style.width = '0%';
    fill.style.background = accent;
    fill.style.boxShadow = '0 0 10px rgba(124, 220, 255, 0.55)';
    track.appendChild(fill);

    wrap.append(label, track);
    return { wrap, fill, value };
  };

  const tankerBar = createBar('Hero', 'linear-gradient(90deg, #85f4ff, #3ba6ff)');
  const bossBar = createBar('Villian', 'linear-gradient(90deg, #9dffd8, #31c692)');
  root.append(tankerBar.wrap, bossBar.wrap);

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
    const tankerPct = Math.max(0, Math.min(100, state.tankerHp));
    tankerBar.fill.style.width = `${tankerPct}%`;
    tankerBar.value.textContent = `${Math.ceil(state.tankerHp)} / 100`;
    const bossPct = Math.max(0, Math.min(100, (state.bossHp / Math.max(1, state.bossMaxHp)) * 100));
    bossBar.fill.style.width = `${bossPct}%`;
    bossBar.value.textContent = `${Math.ceil(state.bossHp)} / ${Math.ceil(state.bossMaxHp)}`;
    if (state.endState === 'victory') {
      gameOver.textContent = 'Victory';
      gameOver.style.border = '1px solid rgba(129, 255, 214, 0.72)';
      gameOver.style.color = '#defff1';
    } else {
      gameOver.textContent = 'Session Over';
      gameOver.style.border = '1px solid rgba(132, 230, 255, 0.6)';
      gameOver.style.color = '#f4fbff';
    }
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


