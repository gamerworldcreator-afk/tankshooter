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
  bindInput(world, renderer.rawRenderer.domElement, renderer.camera, app);
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
  scene.add(points);

  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 24),
    new THREE.MeshBasicMaterial({
      color: 0x113247,
      transparent: true,
      opacity: 0.28
    })
  );
  haze.position.z = -6;
  scene.add(haze);

  const ambient = new THREE.AmbientLight(0x7ac8ff, 0.48);
  const key = new THREE.DirectionalLight(0x8ef0ff, 0.82);
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
  const tankerMesh = new THREE.Group();
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
  chassis.rotation.z = Math.PI / 2;
  const wingLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.8, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x89dfff, emissive: 0x1f6a88, emissiveIntensity: 0.6 })
  );
  wingLeft.position.set(-0.33, 0.12, 0);
  const wingRight = wingLeft.clone();
  wingRight.position.x = 0.33;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x88f6ff, transparent: true, opacity: 0.92 })
  );
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
    world.input.pulseRequested = true;
  });

  let movePointerId: number | null = null;
  let moveStartX = 0;
  const maxTravel = 80;

  const updateMoveAxis = (clientX: number): void => {
    const delta = clientX - moveStartX;
    const axis = Math.max(-1, Math.min(1, delta / maxTravel));
    world.input.moveAxisX = axis;
    controls.stick.style.transform = `translate(${axis * 28}px, 0px)`;
  };

  controls.movePad.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    controls.movePad.setPointerCapture(event.pointerId);
    movePointerId = event.pointerId;
    moveStartX = event.clientX;
    world.input.useAxisControl = true;
    updateMoveAxis(event.clientX);
  });
  controls.movePad.addEventListener('pointermove', (event) => {
    if (movePointerId !== event.pointerId) {
      return;
    }
    updateMoveAxis(event.clientX);
  });
  const releaseMove = (event: PointerEvent): void => {
    if (movePointerId !== event.pointerId) {
      return;
    }
    movePointerId = null;
    world.input.moveAxisX = 0;
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
      world.input.pulseRequested = true;
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
      world.input.pulseRequested = true;
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
  actionColumn.appendChild(pulseButton);

  const fireButton = document.createElement('button');
  fireButton.textContent = 'FIRE';
  fireButton.style.width = '100px';
  fireButton.style.height = '100px';
  fireButton.style.borderRadius = '999px';
  fireButton.style.border = '1px solid rgba(255, 188, 130, 0.9)';
  fireButton.style.color = '#fff0e2';
  fireButton.style.fontWeight = '700';
  fireButton.style.fontSize = '16px';
  fireButton.style.letterSpacing = '0.09em';
  fireButton.style.background =
    'radial-gradient(circle at 34% 30%, rgba(255, 219, 174, 0.6), rgba(130, 57, 24, 0.58) 72%)';
  fireButton.style.backdropFilter = 'blur(12px)';
  fireButton.style.boxShadow = '0 10px 24px rgba(0, 0, 0, 0.35), inset 0 0 24px rgba(255, 190, 125, 0.15)';
  fireButton.style.pointerEvents = 'auto';
  fireButton.style.touchAction = 'none';
  actionColumn.appendChild(fireButton);

  return { root: controlsRoot, movePad, stick, fireButton, pulseButton };
}

function createHudOverlay(app: HTMLElement): void {
  const hudRoot = document.createElement('div');
  hudRoot.style.position = 'absolute';
  hudRoot.style.left = '0';
  hudRoot.style.right = '0';
  hudRoot.style.top = 'calc(env(safe-area-inset-top, 0px) + 8px)';
  hudRoot.style.padding = '0 10px';
  hudRoot.style.pointerEvents = 'none';
  hudRoot.style.zIndex = '12';
  app.appendChild(hudRoot);

  const hud = document.createElement('div');
  hud.style.borderRadius = '14px';
  hud.style.border = '1px solid rgba(118, 216, 255, 0.6)';
  hud.style.background = 'linear-gradient(150deg, rgba(8, 24, 35, 0.74), rgba(5, 14, 21, 0.64))';
  hud.style.backdropFilter = 'blur(12px)';
  hud.style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.36), inset 0 0 30px rgba(119, 220, 255, 0.08)';
  hud.style.padding = '10px';
  hud.style.display = 'grid';
  hud.style.gap = '8px';
  hudRoot.appendChild(hud);

  const topRow = document.createElement('div');
  topRow.style.display = 'grid';
  topRow.style.gridTemplateColumns = '1fr 1fr 1fr';
  topRow.style.gap = '6px';
  hud.appendChild(topRow);

  const scoreChip = document.createElement('div');
  const highChip = document.createElement('div');
  const stageChip = document.createElement('div');
  for (const chip of [scoreChip, highChip, stageChip]) {
    chip.style.border = '1px solid rgba(130, 224, 255, 0.35)';
    chip.style.borderRadius = '10px';
    chip.style.background = 'rgba(14, 34, 48, 0.55)';
    chip.style.padding = '6px 8px';
    chip.style.color = '#d9f6ff';
    chip.style.fontSize = '11px';
    chip.style.letterSpacing = '0.07em';
    chip.style.textTransform = 'uppercase';
    chip.style.fontWeight = '700';
  }
  topRow.append(scoreChip, highChip, stageChip);

  const barsRow = document.createElement('div');
  barsRow.style.display = 'grid';
  barsRow.style.gap = '6px';
  hud.appendChild(barsRow);

  const createBar = (labelText: string, accent: string): { wrap: HTMLDivElement; fill: HTMLDivElement; value: HTMLSpanElement } => {
    const wrap = document.createElement('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '3px';

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

  const tankerBar = createBar('Tanker', 'linear-gradient(90deg, #91f3ff, #4ab8ff)');
  const bossBar = createBar('Boss', 'linear-gradient(90deg, #9afadf, #42cfaa)');
  barsRow.append(tankerBar.wrap, bossBar.wrap);

  const hint = document.createElement('div');
  hint.style.color = 'rgba(214, 243, 255, 0.8)';
  hint.style.fontSize = '10px';
  hint.style.letterSpacing = '0.06em';
  hint.style.textTransform = 'uppercase';
  hint.style.textAlign = 'center';
  hint.textContent = 'Left pad move • Right fire • Pulse above fire';
  hud.appendChild(hint);

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
    scoreChip.textContent = `Score ${Math.floor(state.score)}`;
    highChip.textContent = `High ${Math.floor(state.highScore)}`;
    stageChip.textContent = `S${state.bossStage} • ${pulseReady}`;
    const tankerPct = Math.max(0, Math.min(100, state.tankerHp));
    tankerBar.fill.style.width = `${tankerPct}%`;
    tankerBar.value.textContent = `${Math.ceil(state.tankerHp)} HP`;
    const bossPct = Math.max(0, Math.min(100, (state.bossHp / Math.max(1, state.bossMaxHp)) * 100));
    bossBar.fill.style.width = `${bossPct}%`;
    bossBar.value.textContent = `${Math.ceil(state.bossHp)} / ${Math.ceil(state.bossMaxHp)}`;
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
