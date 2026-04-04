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
  sdkReportProgress(26);

  const saved = await sdkLoadProgress();
  gameStore.getState().setHighScore(saved.highScore);
  gameStore.getState().resetRun();
  sdkReportProgress(42);

  buildEntities(world, renderer.scene);
  const settings = createSettingsPage(app, renderer.scene, world, false);
  syncArenaBounds(world, renderer);
  createHudOverlay(app, world);
  registerSystems(world);
  bindInput(world, renderer.rawRenderer.domElement, renderer.camera, app);
  window.addEventListener('resize', () => syncArenaBounds(world, renderer));
  sdkReportProgress(85);

  await sdkStart();
  sdkReportProgress(100);

  const loop = new GameLoop(world, renderer);
  watchSessionEnd(loop, world, saved);
  createIntroPage(app, world, settings.open, settings.close, () => {
    startStageCountdown(world, true);
    loop.start();
  });
}

function createBackdrop(scene: THREE.Scene): void {
  const stars = new THREE.BufferGeometry();
  const count = 360;
  const vertices = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    vertices[i * 3] = (Math.random() - 0.5) * 26;
    vertices[i * 3 + 1] = (Math.random() - 0.5) * 26;
    vertices[i * 3 + 2] = -8 - Math.random() * 16;
  }
  stars.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const points = new THREE.Points(
    stars,
    new THREE.PointsMaterial({ color: 0x78e2ff, size: 0.035, transparent: true, opacity: 0.8 })
  );
  points.name = 'bgStars';
  scene.add(points);

  const sparks = new THREE.BufferGeometry();
  const sparkCount = 110;
  const sparkVertices = new Float32Array(sparkCount * 3);
  for (let i = 0; i < sparkCount; i += 1) {
    sparkVertices[i * 3] = (Math.random() - 0.5) * 24;
    sparkVertices[i * 3 + 1] = (Math.random() - 0.5) * 24;
    sparkVertices[i * 3 + 2] = -4.8 - Math.random() * 8;
  }
  sparks.setAttribute('position', new THREE.BufferAttribute(sparkVertices, 3));
  const sparkPoints = new THREE.Points(
    sparks,
    new THREE.PointsMaterial({ color: 0xffc79c, size: 0.095, transparent: true, opacity: 0.14 })
  );
  sparkPoints.name = 'bgSparks';
  sparkPoints.layers.enable(BLOOM_LAYER);
  scene.add(sparkPoints);

  const hazeFar = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 28),
    new THREE.MeshBasicMaterial({
      color: 0x0d2842,
      transparent: true,
      opacity: 0.24
    })
  );
  hazeFar.name = 'bgHazeFar';
  hazeFar.position.z = -11.5;
  scene.add(hazeFar);

  const haze = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 24),
    new THREE.MeshBasicMaterial({
      color: 0x113247,
      transparent: true,
      opacity: 0.26
    })
  );
  haze.name = 'bgHaze';
  haze.position.z = -6.8;
  scene.add(haze);

  if (points.material instanceof THREE.PointsMaterial) {
    points.material.blending = THREE.AdditiveBlending;
  }

  const ambient = new THREE.AmbientLight(0x7ac8ff, 0.48);
  const key = new THREE.DirectionalLight(0x8ef0ff, 0.82);
  key.position.set(0, 1, 1);
  scene.add(ambient, key);

}

function syncArenaBounds(world: World, renderer: Renderer): void {
  const camera = renderer.camera;
  const xMargin = 0.75;
  const topMargin = 1.6;
  const bottomMargin = 2.55;
  world.arena.minX = camera.left + xMargin;
  world.arena.maxX = camera.right - xMargin;
  world.arena.minY = camera.bottom + bottomMargin;
  world.arena.maxY = camera.top - topMargin;

  const tanker = world.transforms.get(world.tankerEntity);
  const tankerHitbox = world.hitboxes.get(world.tankerEntity);
  const tankerHalfW = tankerHitbox ? tankerHitbox.w * 0.5 : 0.45;
  if (tanker) {
    tanker.x = THREE.MathUtils.clamp(tanker.x, world.arena.minX + tankerHalfW, world.arena.maxX - tankerHalfW);
    tanker.y = world.arena.minY + 0.82;
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

}

function buildEntities(world: World, scene: THREE.Scene): void {
  const tanker = world.createEntity('tanker');
  world.tankerEntity = tanker;
  world.addComponent(tanker, {
    type: 'Transform',
    x: 0,
    y: world.arena.minY + 0.82,
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
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(0.78, 18, 18),
    new THREE.MeshBasicMaterial({ color: 0x9deeff, transparent: true, opacity: 0.0 })
  );
  shield.name = 'heroShield';
  shield.visible = false;
  shield.layers.enable(BLOOM_LAYER);
  const shieldRingA = new THREE.Mesh(
    new THREE.TorusGeometry(0.88, 0.03, 10, 46),
    new THREE.MeshBasicMaterial({ color: 0xa5f4ff, transparent: true, opacity: 0 })
  );
  shieldRingA.name = 'heroShieldRingA';
  shieldRingA.visible = false;
  shieldRingA.rotation.x = Math.PI * 0.5;
  shieldRingA.layers.enable(BLOOM_LAYER);
  const shieldRingB = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.026, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0 })
  );
  shieldRingB.name = 'heroShieldRingB';
  shieldRingB.visible = false;
  shieldRingB.rotation.y = Math.PI * 0.5;
  shieldRingB.layers.enable(BLOOM_LAYER);
  tankerMesh.add(chassis, wingLeft, wingRight, core, shield, shieldRingA, shieldRingB);
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
    y: world.arena.minY + 0.82,
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

  const powerBullets: number[] = [];
  for (let i = 0; i < 16; i += 1) {
    const e = world.createEntity('powerBullet');
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
    world.addComponent(e, { type: 'Poolable', poolKey: 'powerBullet', active: false });
    const bolt = new THREE.Group();
    const spear = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.72, 10),
      new THREE.MeshBasicMaterial({ color: 0xfff0b7, transparent: true, opacity: 0.96 })
    );
    spear.rotation.z = Math.PI;
    spear.position.y = 0.25;
    const tail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.14, 0.58, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc871, transparent: true, opacity: 0.82 })
    );
    tail.position.y = -0.25;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.23, 0.03, 8, 30),
      new THREE.MeshBasicMaterial({ color: 0xffdf9d, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI * 0.5;
    ring.layers.enable(BLOOM_LAYER);
    bolt.add(spear, tail, ring);
    bolt.visible = false;
    bolt.layers.enable(BLOOM_LAYER);
    scene.add(bolt);
    world.addComponent(e, { type: 'Render', mesh: bolt, bloomLayer: BLOOM_LAYER });
    world.hitboxes.set(e, { w: 0.42, h: 0.42 });
    powerBullets.push(e);
  }
  world.registerPool('powerBullet', powerBullets);

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
      new THREE.IcosahedronGeometry(0.46, 1),
      new THREE.OctahedronGeometry(0.49, 1),
      new THREE.DodecahedronGeometry(0.45, 0)
    ];
    const mesh = new THREE.Mesh(
      geometryOptions[i % geometryOptions.length],
      new THREE.MeshStandardMaterial({
        color: 0x9fcceb,
        emissive: 0x1a3348,
        emissiveIntensity: 0.68,
        roughness: 0.32,
        metalness: 0.74
      })
    );
    const ringOuter = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.035, 10, 42),
      new THREE.MeshBasicMaterial({ color: 0x91e8ff, transparent: true, opacity: 0.6 })
    );
    ringOuter.rotation.set(Math.PI * 0.5, 0, i % 2 === 0 ? Math.PI * 0.2 : Math.PI * -0.2);
    ringOuter.layers.enable(BLOOM_LAYER);
    mesh.add(ringOuter);

    const ringInner = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.022, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xc1ffff, transparent: true, opacity: 0.5 })
    );
    ringInner.rotation.set(Math.PI * 0.16, Math.PI * 0.35, Math.PI * 0.2);
    ringInner.layers.enable(BLOOM_LAYER);
    mesh.add(ringInner);

    for (let s = 0; s < 4; s += 1) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.28, 6),
        new THREE.MeshStandardMaterial({ color: 0xd6f7ff, emissive: 0x28567c, emissiveIntensity: 0.66 })
      );
      const angle = (Math.PI * 2 * s) / 4;
      spike.position.set(Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, 0);
      spike.rotation.z = angle + Math.PI / 2;
      mesh.add(spike);
    }
    const coreGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xaef8ff, transparent: true, opacity: 0.82 })
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

  const enemyJets: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const e = world.createEntity('enemyJet');
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
    world.addComponent(e, { type: 'Health', current: 420, max: 420, regenRate: 0 });
    world.addComponent(e, { type: 'Poolable', poolKey: 'enemyJet', active: false });

    const jet = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.92, 10),
      new THREE.MeshStandardMaterial({
        color: 0x88ffd7,
        emissive: 0x1d6e54,
        emissiveIntensity: 0.75,
        roughness: 0.28,
        metalness: 0.64
      })
    );
    body.rotation.x = Math.PI;
    const wingA = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.07, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x9effdf, emissive: 0x255f4e, emissiveIntensity: 0.64 })
    );
    wingA.name = 'enemyJetWingA';
    wingA.position.y = -0.04;
    const wingB = wingA.clone();
    wingB.name = 'enemyJetWingB';
    wingB.rotation.z = Math.PI / 2;
    const wingCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xc6ffee, transparent: true, opacity: 0.8 })
    );
    wingCore.layers.enable(BLOOM_LAYER);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xb4ffe6, transparent: true, opacity: 0.82 })
    );
    glow.position.y = -0.36;
    glow.layers.enable(BLOOM_LAYER);
    jet.add(body, wingA, wingB, wingCore, glow);
    jet.visible = false;
    jet.layers.enable(BLOOM_LAYER);
    scene.add(jet);

    world.addComponent(e, { type: 'Render', mesh: jet, bloomLayer: BLOOM_LAYER });
    world.hitboxes.set(e, { w: 0.78, h: 0.78 });
    enemyJets.push(e);
  }
  world.registerPool('enemyJet', enemyJets);

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
  controls.powerButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    world.input.powerRequested = true;
  });
  controls.powerButton.addEventListener('pointerup', () => {
    world.input.powerRequested = false;
  });
  controls.powerButton.addEventListener('pointercancel', () => {
    world.input.powerRequested = false;
  });
  controls.powerButton.addEventListener('pointerleave', () => {
    world.input.powerRequested = false;
  });
  controls.lifeButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    world.input.lifeRequested = true;
  });
  controls.vanishButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    world.input.vanishRequested = true;
  });

  let movePointerId: number | null = null;
  const maxTravel = 20;
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
    if (event.code === 'KeyK') {
      world.input.powerRequested = true;
      event.preventDefault();
    }
    if (event.code === 'KeyL') {
      world.input.lifeRequested = true;
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
    if (event.code === 'KeyK') {
      world.input.powerRequested = false;
    }
    if (event.code === 'KeyL') {
      world.input.lifeRequested = false;
    }
  });
  window.addEventListener('blur', () => {
    world.input.shootHeld = false;
    world.input.moveAxisX = 0;
    world.input.powerRequested = false;
    world.input.lifeRequested = false;
    world.input.vanishRequested = false;
  });

  const syncPowerButton = (state: ReturnType<typeof gameStore.getState>): void => {
    if (state.powerShotsRemaining > 0) {
      controls.powerButton.style.display = 'inline-flex';
      controls.powerButton.textContent = `⚡${state.powerShotsRemaining}`;
    } else {
      controls.powerButton.style.display = 'none';
    }
    if (state.powerLives > 0) {
      controls.lifeButton.style.display = 'inline-flex';
      controls.lifeButton.textContent = `🛡${state.powerLives}`;
    } else {
      controls.lifeButton.style.display = 'none';
    }
    if (state.powerVanishCharges > 0) {
      controls.vanishButton.style.display = 'inline-flex';
      controls.vanishButton.textContent = `✦${state.powerVanishCharges}`;
    } else {
      controls.vanishButton.style.display = 'none';
    }
  };
  syncPowerButton(gameStore.getState());
  gameStore.subscribe((state) => syncPowerButton(state));
}

function createTouchControls(app: HTMLElement): {
  root: HTMLDivElement;
  movePad: HTMLDivElement;
  stick: HTMLDivElement;
  fireButton: HTMLButtonElement;
  pulseButton: HTMLButtonElement;
  powerButton: HTMLButtonElement;
  lifeButton: HTMLButtonElement;
  vanishButton: HTMLButtonElement;
} {
  const controlsRoot = document.createElement('div');
  controlsRoot.style.position = 'absolute';
  controlsRoot.style.left = '0';
  controlsRoot.style.right = '0';
  controlsRoot.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 4px)';
  controlsRoot.style.display = 'flex';
  controlsRoot.style.justifyContent = 'space-between';
  controlsRoot.style.alignItems = 'flex-end';
  controlsRoot.style.padding = '0 12px';
  controlsRoot.style.pointerEvents = 'none';
  controlsRoot.style.zIndex = '12';
  app.appendChild(controlsRoot);

  const movePad = document.createElement('div');
  movePad.style.width = '76px';
  movePad.style.height = '76px';
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
  stick.style.width = '28px';
  stick.style.height = '28px';
  stick.style.borderRadius = '999px';
  stick.style.border = '1px solid rgba(190, 248, 255, 0.96)';
  stick.style.background =
    'radial-gradient(circle at 35% 35%, rgba(212, 251, 255, 0.5), rgba(91, 198, 227, 0.18) 72%)';
  stick.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.35)';
  stick.style.transition = 'transform 90ms ease-out';
  movePad.appendChild(stick);

  const actionColumn = document.createElement('div');
  actionColumn.style.display = 'flex';
  actionColumn.style.alignItems = 'flex-end';
  actionColumn.style.gap = '8px';
  actionColumn.style.pointerEvents = 'none';
  controlsRoot.appendChild(actionColumn);

  const pulseButton = document.createElement('button');
  pulseButton.textContent = 'PULSE';
  pulseButton.style.width = '48px';
  pulseButton.style.height = '48px';
  pulseButton.style.borderRadius = '999px';
  pulseButton.style.border = '1px solid rgba(132, 236, 255, 0.9)';
  pulseButton.style.color = '#dff7ff';
  pulseButton.style.fontWeight = '700';
  pulseButton.style.fontSize = '10px';
  pulseButton.style.letterSpacing = '0.08em';
  pulseButton.style.background =
    'radial-gradient(circle at 35% 30%, rgba(170, 241, 255, 0.58), rgba(26, 86, 114, 0.55) 72%)';
  pulseButton.style.backdropFilter = 'blur(12px)';
  pulseButton.style.boxShadow = '0 10px 22px rgba(0, 0, 0, 0.35)';
  pulseButton.style.pointerEvents = 'auto';
  pulseButton.style.touchAction = 'none';
  pulseButton.style.display = 'none';
  actionColumn.appendChild(pulseButton);

  const powerButton = document.createElement('button');
  powerButton.textContent = '⚡';
  powerButton.style.width = '52px';
  powerButton.style.height = '52px';
  powerButton.style.borderRadius = '999px';
  powerButton.style.border = '1px solid rgba(157, 255, 219, 0.94)';
  powerButton.style.color = '#eafff6';
  powerButton.style.fontWeight = '800';
  powerButton.style.fontSize = '20px';
  powerButton.style.letterSpacing = '0';
  powerButton.style.background =
    'radial-gradient(circle at 36% 28%, rgba(182, 255, 233, 0.84), rgba(36, 122, 91, 0.68) 72%, rgba(15, 66, 46, 0.8) 100%)';
  powerButton.style.backdropFilter = 'blur(10px)';
  powerButton.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.35), 0 0 12px rgba(111, 255, 204, 0.3)';
  powerButton.style.pointerEvents = 'auto';
  powerButton.style.touchAction = 'none';
  powerButton.style.display = 'none';
  actionColumn.appendChild(powerButton);

  const lifeButton = document.createElement('button');
  lifeButton.textContent = '🛡';
  lifeButton.style.width = '52px';
  lifeButton.style.height = '52px';
  lifeButton.style.borderRadius = '999px';
  lifeButton.style.border = '1px solid rgba(158, 247, 255, 0.92)';
  lifeButton.style.color = '#e9fcff';
  lifeButton.style.fontWeight = '800';
  lifeButton.style.fontSize = '18px';
  lifeButton.style.letterSpacing = '0';
  lifeButton.style.background =
    'radial-gradient(circle at 36% 28%, rgba(195, 248, 255, 0.82), rgba(34, 116, 137, 0.7) 72%, rgba(14, 59, 70, 0.84) 100%)';
  lifeButton.style.backdropFilter = 'blur(10px)';
  lifeButton.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.35), 0 0 12px rgba(132, 246, 255, 0.3)';
  lifeButton.style.pointerEvents = 'auto';
  lifeButton.style.touchAction = 'none';
  lifeButton.style.display = 'none';
  actionColumn.appendChild(lifeButton);

  const vanishButton = document.createElement('button');
  vanishButton.textContent = '✦';
  vanishButton.style.width = '52px';
  vanishButton.style.height = '52px';
  vanishButton.style.borderRadius = '999px';
  vanishButton.style.border = '1px solid rgba(184, 219, 255, 0.92)';
  vanishButton.style.color = '#f0f8ff';
  vanishButton.style.fontWeight = '800';
  vanishButton.style.fontSize = '20px';
  vanishButton.style.letterSpacing = '0';
  vanishButton.style.background =
    'radial-gradient(circle at 36% 28%, rgba(215, 236, 255, 0.82), rgba(52, 83, 137, 0.7) 72%, rgba(25, 40, 73, 0.84) 100%)';
  vanishButton.style.backdropFilter = 'blur(10px)';
  vanishButton.style.boxShadow = '0 8px 20px rgba(0, 0, 0, 0.35), 0 0 12px rgba(154, 198, 255, 0.3)';
  vanishButton.style.pointerEvents = 'auto';
  vanishButton.style.touchAction = 'none';
  vanishButton.style.display = 'none';
  actionColumn.appendChild(vanishButton);

  const fireButton = document.createElement('button');
  fireButton.textContent = '◎';
  fireButton.style.width = '64px';
  fireButton.style.height = '64px';
  fireButton.style.borderRadius = '999px';
  fireButton.style.border = '1px solid rgba(255, 195, 128, 0.95)';
  fireButton.style.color = '#fff3e3';
  fireButton.style.fontWeight = '700';
  fireButton.style.fontSize = '22px';
  fireButton.style.letterSpacing = '0';
  fireButton.style.textShadow = '0 0 8px rgba(255, 206, 140, 0.45)';
  fireButton.style.background =
    'radial-gradient(circle at 34% 30%, rgba(255, 222, 167, 0.74), rgba(143, 62, 24, 0.66) 70%, rgba(79, 24, 12, 0.72) 100%)';
  fireButton.style.backdropFilter = 'blur(12px)';
  fireButton.style.boxShadow =
    '0 10px 26px rgba(0, 0, 0, 0.35), 0 0 18px rgba(255, 158, 84, 0.28), inset 0 0 26px rgba(255, 190, 125, 0.18)';
  fireButton.style.pointerEvents = 'auto';
  fireButton.style.touchAction = 'none';
  actionColumn.appendChild(fireButton);

  return { root: controlsRoot, movePad, stick, fireButton, pulseButton, powerButton, lifeButton, vanishButton };
}

function createSettingsPage(
  app: HTMLElement,
  scene: THREE.Scene,
  world: World,
  showFloatingButton: boolean
): { open: () => void; close: () => void } {
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
  if (showFloatingButton) {
    app.appendChild(openButton);
  }

  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.zIndex = '50';
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

  const previewWrap = document.createElement('div');
  previewWrap.style.border = '1px solid rgba(126, 220, 255, 0.45)';
  previewWrap.style.borderRadius = '12px';
  previewWrap.style.padding = '8px';
  previewWrap.style.background = 'rgba(8, 22, 31, 0.72)';
  previewWrap.style.display = 'grid';
  previewWrap.style.gap = '6px';
  panel.appendChild(previewWrap);
  const previewLabel = document.createElement('div');
  previewLabel.textContent = 'Preview';
  previewLabel.style.color = '#c8f2ff';
  previewLabel.style.fontSize = '11px';
  previewLabel.style.fontWeight = '700';
  previewLabel.style.letterSpacing = '0.05em';
  previewWrap.appendChild(previewLabel);
  const previewScene = document.createElement('div');
  previewScene.style.height = '84px';
  previewScene.style.borderRadius = '10px';
  previewScene.style.position = 'relative';
  previewScene.style.overflow = 'hidden';
  previewWrap.appendChild(previewScene);
  const previewStars = document.createElement('div');
  previewStars.style.position = 'absolute';
  previewStars.style.inset = '0';
  previewStars.style.backgroundSize = '18px 18px';
  previewStars.style.opacity = '0.4';
  previewStars.style.animation = 'previewDrift 7s linear infinite';
  previewScene.appendChild(previewStars);
  const previewHero = document.createElement('div');
  previewHero.textContent = '▲';
  previewHero.style.position = 'absolute';
  previewHero.style.left = '50%';
  previewHero.style.bottom = '10px';
  previewHero.style.transform = 'translateX(-50%)';
  previewHero.style.fontSize = '22px';
  previewHero.style.filter = 'drop-shadow(0 0 8px rgba(180, 240, 255, 0.55))';
  previewHero.style.animation = 'previewBob 1.7s ease-in-out infinite';
  previewScene.appendChild(previewHero);
  const previewTitle = document.createElement('div');
  previewTitle.style.color = '#d8f7ff';
  previewTitle.style.fontSize = '11px';
  previewTitle.style.letterSpacing = '0.04em';
  previewWrap.appendChild(previewTitle);

  const footer = document.createElement('div');
  footer.style.display = 'flex';
  footer.style.justifyContent = 'flex-end';
  panel.appendChild(footer);

  const devRow = document.createElement('div');
  devRow.style.display = 'flex';
  devRow.style.justifyContent = 'space-between';
  devRow.style.alignItems = 'center';
  devRow.style.border = '1px solid rgba(130, 204, 227, 0.5)';
  devRow.style.borderRadius = '12px';
  devRow.style.padding = '9px 10px';
  devRow.style.background = 'rgba(10, 29, 41, 0.55)';
  panel.appendChild(devRow);
  const devLabel = document.createElement('div');
  devLabel.textContent = 'Dev Mode (Unlimited Hero)';
  devLabel.style.color = '#c9f4ff';
  devLabel.style.fontSize = '12px';
  devLabel.style.fontWeight = '700';
  devLabel.style.letterSpacing = '0.04em';
  devRow.appendChild(devLabel);
  const devToggle = document.createElement('button');
  devToggle.style.height = '34px';
  devToggle.style.padding = '0 12px';
  devToggle.style.borderRadius = '999px';
  devToggle.style.fontWeight = '700';
  devToggle.style.letterSpacing = '0.04em';
  devRow.appendChild(devToggle);

  const syncDev = (): void => {
    if (world.unlimitedPowerMode) {
      devToggle.textContent = 'ON';
      devToggle.style.border = '1px solid rgba(154, 255, 216, 0.9)';
      devToggle.style.background = 'rgba(34, 132, 98, 0.7)';
      devToggle.style.color = '#e8fff7';
    } else {
      devToggle.textContent = 'OFF';
      devToggle.style.border = '1px solid rgba(244, 186, 156, 0.9)';
      devToggle.style.background = 'rgba(137, 69, 42, 0.72)';
      devToggle.style.color = '#fff0e5';
    }
  };
  syncDev();
  devToggle.addEventListener('click', () => {
    world.unlimitedPowerMode = !world.unlimitedPowerMode;
    syncDev();
  });
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
    const previewBgMap: Record<BackgroundPreset, string> = {
      nebula:
        'radial-gradient(circle at 18% 22%, rgba(85, 214, 255, 0.45), rgba(85, 214, 255, 0) 44%), radial-gradient(circle at 80% 78%, rgba(255, 164, 98, 0.32), rgba(255, 164, 98, 0) 46%), linear-gradient(165deg, #091823 0%, #060d15 70%, #091019 100%)',
      sunsetGrid:
        'radial-gradient(circle at 18% 22%, rgba(255, 149, 112, 0.48), rgba(255, 149, 112, 0) 44%), radial-gradient(circle at 80% 78%, rgba(255, 201, 122, 0.32), rgba(255, 201, 122, 0) 46%), linear-gradient(165deg, #220f17 0%, #140a10 70%, #111018 100%)',
      deepVoid:
        'radial-gradient(circle at 18% 22%, rgba(107, 146, 255, 0.42), rgba(107, 146, 255, 0) 44%), radial-gradient(circle at 80% 78%, rgba(118, 140, 255, 0.28), rgba(118, 140, 255, 0) 46%), linear-gradient(165deg, #060a18 0%, #050915 70%, #070d17 100%)'
    };
    previewScene.style.background = previewBgMap[currentBackground];
    previewStars.style.backgroundImage =
      'radial-gradient(circle, rgba(218, 245, 255, 0.95) 0 1px, rgba(255,255,255,0) 1.5px)';
    const previewHeroMap: Record<HeroAvatarPreset, { color: string; glow: string }> = {
      vanguard: { color: '#9be8ff', glow: 'rgba(144, 226, 255, 0.65)' },
      spectre: { color: '#aab5ff', glow: 'rgba(160, 170, 255, 0.68)' },
      ember: { color: '#ffd1a0', glow: 'rgba(255, 188, 131, 0.7)' }
    };
    previewHero.style.color = previewHeroMap[currentAvatar].color;
    previewHero.style.filter = `drop-shadow(0 0 8px ${previewHeroMap[currentAvatar].glow})`;
    previewTitle.textContent = `${currentBackground.toUpperCase()} • ${currentAvatar.toUpperCase()}`;
  };
  refreshButtons();

  const open = (): void => {
    overlay.style.display = 'block';
    if (showFloatingButton) {
      openButton.style.display = 'none';
    }
  };
  const close = (): void => {
    overlay.style.display = 'none';
    if (showFloatingButton) {
      openButton.style.display = 'block';
    }
  };
  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  return { open, close };
}

function applyBackgroundPreset(scene: THREE.Scene, preset: BackgroundPreset): void {
  const stars = scene.getObjectByName('bgStars');
  const sparks = scene.getObjectByName('bgSparks');
  const haze = scene.getObjectByName('bgHaze');
  const hazeFar = scene.getObjectByName('bgHazeFar');
  const starMat = stars instanceof THREE.Points ? stars.material : null;
  const sparkMat = sparks instanceof THREE.Points ? sparks.material : null;
  const hazeMat = haze instanceof THREE.Mesh ? haze.material : null;
  const hazeFarMat = hazeFar instanceof THREE.Mesh ? hazeFar.material : null;

  if (
    !(starMat instanceof THREE.PointsMaterial) ||
    !(sparkMat instanceof THREE.PointsMaterial) ||
    !(hazeMat instanceof THREE.MeshBasicMaterial) ||
    !(hazeFarMat instanceof THREE.MeshBasicMaterial)
  ) {
    return;
  }

  if (preset === 'sunsetGrid') {
    scene.background = new THREE.Color(0x120b14);
    starMat.color.setHex(0xffb08a);
    starMat.opacity = 0.72;
    sparkMat.color.setHex(0xffbf93);
    sparkMat.opacity = 0.18;
    hazeMat.color.setHex(0x4f2035);
    hazeMat.opacity = 0.3;
    hazeFarMat.color.setHex(0x3a1831);
    hazeFarMat.opacity = 0.27;
    document.body.style.background =
      'radial-gradient(circle at 15% 20%, #6b2d45 0%, rgba(107, 45, 69, 0) 46%), radial-gradient(circle at 84% 78%, #6b4d2c 0%, rgba(107, 77, 44, 0) 42%), linear-gradient(170deg, #10080f 0%, #040406 70%, #0f1218 100%)';
    return;
  }

  if (preset === 'deepVoid') {
    scene.background = new THREE.Color(0x02040a);
    starMat.color.setHex(0x88b9ff);
    starMat.opacity = 0.64;
    sparkMat.color.setHex(0x9dc6ff);
    sparkMat.opacity = 0.13;
    hazeMat.color.setHex(0x0f1d42);
    hazeMat.opacity = 0.18;
    hazeFarMat.color.setHex(0x0a1331);
    hazeFarMat.opacity = 0.2;
    document.body.style.background =
      'radial-gradient(circle at 20% 12%, #102247 0%, rgba(16, 34, 71, 0) 45%), radial-gradient(circle at 82% 88%, #19264f 0%, rgba(25, 38, 79, 0) 46%), linear-gradient(160deg, #02040a 0%, #040914 62%, #0b1524 100%)';
    return;
  }

  scene.background = new THREE.Color(0x05080d);
  starMat.color.setHex(0x78e2ff);
  starMat.opacity = 0.8;
  sparkMat.color.setHex(0xffc79c);
  sparkMat.opacity = 0.14;
  hazeMat.color.setHex(0x113247);
  hazeMat.opacity = 0.28;
  hazeFarMat.color.setHex(0x0d2842);
  hazeFarMat.opacity = 0.24;
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

function startStageCountdown(world: World, healHero: boolean): void {
  world.phase = 'countdown';
  world.stageCountdownMs = 3000;
  resetActorsForStage(world, world.currentStage, healHero);
  gameStore.getState().setHud({
    overlayMessage: `3`,
    showNextStage: false
  });
}

function prepareNextStage(world: World): void {
  const nextStage = Math.min(world.maxStage, world.currentStage + 1) as 1 | 2 | 3 | 4 | 5;
  world.currentStage = nextStage;
  world.phase = 'countdown';
  world.stageCountdownMs = 3000;
  resetActorsForStage(world, nextStage, true);
  gameStore.getState().setHud({
    showNextStage: false,
    overlayMessage: `3`,
    endState: 'none'
  });
}

function resetActorsForStage(world: World, stage: 1 | 2 | 3 | 4 | 5, healHero: boolean): void {
  const tankerHealth = world.health.get(world.tankerEntity);
  if (tankerHealth && healHero) {
    tankerHealth.current = tankerHealth.max;
  }

  const bossHealth = world.health.get(world.fabricatorEntity);
  if (bossHealth) {
    const maxHpByStage = [0, 1200, 1650, 2300, 3200, 4600];
    bossHealth.max = maxHpByStage[stage];
    bossHealth.current = bossHealth.max;
  }
  const bossTransform = world.transforms.get(world.fabricatorEntity);
  if (bossTransform) {
    bossTransform.y = world.arena.maxY - 1.2;
  }
  const obstacleRoles: Array<'obstacle' | 'enemyBullet' | 'enemyJet' | 'bullet'> = [
    'obstacle',
    'enemyBullet',
    'enemyJet',
    'bullet'
  ];
  for (const entity of world.getEntitiesByRole('powerBullet')) {
    world.releaseToPool(entity);
  }
  for (const role of obstacleRoles) {
    for (const entity of world.getEntitiesByRole(role)) {
      world.releaseToPool(entity);
    }
  }
  world.heroPowerPoints = 0;
  world.powerPointThreshold = 55;
  world.heroHitStreak = 0;
  world.powerShotsRemaining = 0;
  world.powerLives = 0;
  world.powerVanishCharges = 0;
  world.livesGrantedThisStage = 0;
  world.heroShieldMs = 0;
  world.bossExposeMs = 0;
  world.bossRetreatMs = 0;
  world.input.powerRequested = false;
  world.input.lifeRequested = false;
  world.input.vanishRequested = false;
}

function createIntroPage(
  app: HTMLElement,
  world: World,
  openSettings: () => void,
  closeSettings: () => void,
  onStart: () => void
): void {
  const intro = document.createElement('div');
  intro.style.position = 'absolute';
  intro.style.inset = '0';
  intro.style.zIndex = '30';
  intro.style.display = 'grid';
  intro.style.placeItems = 'center';
  intro.style.background =
    'radial-gradient(circle at 20% 25%, rgba(78, 196, 255, 0.14), rgba(10, 25, 36, 0.86) 50%), radial-gradient(circle at 80% 78%, rgba(255, 149, 92, 0.16), rgba(8, 15, 24, 0.94) 52%)';
  intro.style.backdropFilter = 'blur(5px)';
  intro.style.overflow = 'hidden';
  app.appendChild(intro);

  const introStars = document.createElement('div');
  introStars.style.position = 'absolute';
  introStars.style.inset = '-20%';
  introStars.style.backgroundImage =
    'radial-gradient(circle, rgba(209, 240, 255, 0.9) 0 1px, rgba(255,255,255,0) 1.7px)';
  introStars.style.backgroundSize = '18px 18px';
  introStars.style.opacity = '0.34';
  introStars.style.animation = 'introStarDrift 22s linear infinite';
  introStars.style.pointerEvents = 'none';
  intro.appendChild(introStars);

  const parallaxA = document.createElement('div');
  parallaxA.style.position = 'absolute';
  parallaxA.style.width = '480px';
  parallaxA.style.height = '480px';
  parallaxA.style.left = '-140px';
  parallaxA.style.top = '-120px';
  parallaxA.style.borderRadius = '50%';
  parallaxA.style.background = 'radial-gradient(circle, rgba(97, 218, 255, 0.22), rgba(10, 35, 52, 0.05) 70%)';
  parallaxA.style.pointerEvents = 'none';
  parallaxA.style.animation = 'introFloatA 8s ease-in-out infinite';
  intro.appendChild(parallaxA);

  const parallaxB = document.createElement('div');
  parallaxB.style.position = 'absolute';
  parallaxB.style.width = '420px';
  parallaxB.style.height = '420px';
  parallaxB.style.right = '-120px';
  parallaxB.style.bottom = '-130px';
  parallaxB.style.borderRadius = '50%';
  parallaxB.style.background = 'radial-gradient(circle, rgba(255, 172, 120, 0.2), rgba(58, 21, 10, 0.05) 70%)';
  parallaxB.style.pointerEvents = 'none';
  parallaxB.style.animation = 'introFloatB 10s ease-in-out infinite';
  intro.appendChild(parallaxB);

  const heroAccent = document.createElement('div');
  heroAccent.style.position = 'absolute';
  heroAccent.style.width = '140px';
  heroAccent.style.height = '140px';
  heroAccent.style.right = '10%';
  heroAccent.style.top = '14%';
  heroAccent.style.borderRadius = '50%';
  heroAccent.style.border = '1px solid rgba(132, 228, 255, 0.5)';
  heroAccent.style.boxShadow = '0 0 0 2px rgba(126, 225, 255, 0.16), 0 0 28px rgba(115, 220, 255, 0.26)';
  heroAccent.style.animation = 'introHalo 4.2s ease-in-out infinite';
  heroAccent.style.pointerEvents = 'none';
  intro.appendChild(heroAccent);

  const heroGlyph = document.createElement('div');
  heroGlyph.textContent = '▲';
  heroGlyph.style.position = 'absolute';
  heroGlyph.style.left = '50%';
  heroGlyph.style.top = '50%';
  heroGlyph.style.transform = 'translate(-50%, -50%)';
  heroGlyph.style.color = '#c9f6ff';
  heroGlyph.style.fontSize = '34px';
  heroGlyph.style.textShadow = '0 0 18px rgba(131, 226, 255, 0.62)';
  heroGlyph.style.animation = 'introShipBob 2.4s ease-in-out infinite';
  heroAccent.appendChild(heroGlyph);

  const panel = document.createElement('div');
  panel.style.width = 'min(92vw, 520px)';
  panel.style.border = '1px solid rgba(138, 228, 255, 0.62)';
  panel.style.borderRadius = '18px';
  panel.style.padding = '18px 16px';
  panel.style.background = 'linear-gradient(165deg, rgba(7, 24, 34, 0.9), rgba(5, 12, 20, 0.88))';
  panel.style.boxShadow = '0 18px 42px rgba(0, 0, 0, 0.48)';
  panel.style.position = 'relative';
  panel.style.zIndex = '2';
  panel.style.display = 'grid';
  panel.style.gap = '12px';
  intro.appendChild(panel);

  const title = document.createElement('div');
  title.textContent = 'IRON TIDE • ZERO HOUR';
  title.style.color = '#e8fbff';
  title.style.fontSize = '24px';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.08em';
  panel.appendChild(title);

  const subtitle = document.createElement('div');
  subtitle.textContent = '5-stage assault. Customize your hero and environment before launch.';
  subtitle.style.color = 'rgba(203, 237, 248, 0.88)';
  subtitle.style.fontSize = '13px';
  subtitle.style.letterSpacing = '0.04em';
  panel.appendChild(subtitle);

  const actionRow = document.createElement('div');
  actionRow.style.display = 'flex';
  actionRow.style.gap = '10px';
  panel.appendChild(actionRow);

  const startButton = document.createElement('button');
  startButton.textContent = 'Start Mission';
  startButton.style.flex = '1';
  startButton.style.height = '44px';
  startButton.style.borderRadius = '12px';
  startButton.style.border = '1px solid rgba(147, 241, 255, 0.92)';
  startButton.style.background = 'linear-gradient(130deg, rgba(55, 158, 205, 0.6), rgba(22, 66, 98, 0.72))';
  startButton.style.color = '#e7fbff';
  startButton.style.fontWeight = '700';
  startButton.style.letterSpacing = '0.06em';
  actionRow.appendChild(startButton);

  const settingsButton = document.createElement('button');
  settingsButton.textContent = 'Settings';
  settingsButton.style.width = '120px';
  settingsButton.style.height = '44px';
  settingsButton.style.borderRadius = '12px';
  settingsButton.style.border = '1px solid rgba(255, 199, 144, 0.88)';
  settingsButton.style.background = 'linear-gradient(135deg, rgba(140, 68, 26, 0.7), rgba(82, 39, 17, 0.68))';
  settingsButton.style.color = '#fff4e6';
  settingsButton.style.fontWeight = '700';
  settingsButton.style.letterSpacing = '0.05em';
  actionRow.appendChild(settingsButton);

  const stageHint = document.createElement('div');
  stageHint.style.color = 'rgba(189, 233, 247, 0.9)';
  stageHint.style.fontSize = '12px';
  stageHint.style.letterSpacing = '0.03em';
  stageHint.textContent =
    'Stage 1 eases you in. Each stage adds new enemy patterns, boss attacks, and fantasy hazards.';
  panel.appendChild(stageHint);

  const signal = document.createElement('div');
  signal.textContent = 'Signal Stabilized • Fleet Link Active';
  signal.style.fontSize = '11px';
  signal.style.color = 'rgba(176, 240, 255, 0.9)';
  signal.style.letterSpacing = '0.05em';
  signal.style.animation = 'introSignal 1.8s ease-in-out infinite';
  panel.appendChild(signal);

  settingsButton.addEventListener('click', () => openSettings());
  startButton.addEventListener('click', () => {
    closeSettings();
    intro.style.display = 'none';
    world.phase = 'countdown';
    onStart();
  });
}

function createHudOverlay(app: HTMLElement, world: World): void {
  if (!document.getElementById('game-anim-style')) {
    const style = document.createElement('style');
    style.id = 'game-anim-style';
    style.textContent = `
      @keyframes pulse {
        from { transform: translate(-50%, -50%) scale(0.98); }
        to { transform: translate(-50%, -50%) scale(1.04); }
      }
      @keyframes introFloatA {
        0% { transform: translate(0px, 0px); }
        50% { transform: translate(28px, 18px); }
        100% { transform: translate(0px, 0px); }
      }
      @keyframes introFloatB {
        0% { transform: translate(0px, 0px); }
        50% { transform: translate(-24px, -16px); }
        100% { transform: translate(0px, 0px); }
      }
      @keyframes introStarDrift {
        0% { transform: translateY(0px); }
        100% { transform: translateY(60px); }
      }
      @keyframes introHalo {
        0% { transform: scale(0.94); opacity: 0.72; }
        50% { transform: scale(1.06); opacity: 0.95; }
        100% { transform: scale(0.94); opacity: 0.72; }
      }
      @keyframes introShipBob {
        0% { transform: translate(-50%, -50%) translateY(0px); }
        50% { transform: translate(-50%, -50%) translateY(-6px); }
        100% { transform: translate(-50%, -50%) translateY(0px); }
      }
      @keyframes introSignal {
        0% { opacity: 0.55; }
        50% { opacity: 1; }
        100% { opacity: 0.55; }
      }
      @keyframes previewDrift {
        0% { transform: translateY(0px); }
        100% { transform: translateY(14px); }
      }
      @keyframes previewBob {
        0% { transform: translateX(-50%) translateY(0px); }
        50% { transform: translateX(-50%) translateY(-4px); }
        100% { transform: translateX(-50%) translateY(0px); }
      }
      @keyframes blastRing {
        0% { transform: translate(-50%, -50%) scale(0.4); opacity: 0.85; }
        100% { transform: translate(-50%, -50%) scale(1.65); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }
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
  gameOver.style.padding = '26px 28px';
  gameOver.style.borderRadius = '999px';
  gameOver.style.border = '1px solid rgba(132, 230, 255, 0.6)';
  gameOver.style.background = 'radial-gradient(circle, rgba(18, 49, 66, 0.9), rgba(7, 14, 23, 0.72) 68%)';
  gameOver.style.backdropFilter = 'blur(14px)';
  gameOver.style.color = '#f4fbff';
  gameOver.style.fontSize = '20px';
  gameOver.style.fontWeight = '700';
  gameOver.style.letterSpacing = '0.12em';
  gameOver.style.display = 'none';
  gameOver.style.boxShadow = '0 0 0 2px rgba(147, 227, 255, 0.2), 0 0 40px rgba(87, 170, 210, 0.35)';
  gameOver.textContent = '';
  app.appendChild(gameOver);

  const blastRing = document.createElement('div');
  blastRing.style.position = 'absolute';
  blastRing.style.left = '50%';
  blastRing.style.top = '50%';
  blastRing.style.width = '120px';
  blastRing.style.height = '120px';
  blastRing.style.borderRadius = '50%';
  blastRing.style.border = '2px solid rgba(155, 235, 255, 0.85)';
  blastRing.style.pointerEvents = 'none';
  blastRing.style.display = 'none';
  blastRing.style.zIndex = '23';
  app.appendChild(blastRing);

  const centerOverlay = document.createElement('div');
  centerOverlay.style.position = 'absolute';
  centerOverlay.style.left = '50%';
  centerOverlay.style.top = '52%';
  centerOverlay.style.transform = 'translate(-50%, -50%)';
  centerOverlay.style.display = 'none';
  centerOverlay.style.flexDirection = 'column';
  centerOverlay.style.gap = '12px';
  centerOverlay.style.alignItems = 'center';
  centerOverlay.style.zIndex = '24';
  app.appendChild(centerOverlay);

  const centerLabel = document.createElement('div');
  centerLabel.style.padding = '12px 16px';
  centerLabel.style.borderRadius = '999px';
  centerLabel.style.border = '1px solid rgba(126, 226, 255, 0.8)';
  centerLabel.style.background = 'rgba(8, 22, 34, 0.78)';
  centerLabel.style.backdropFilter = 'blur(10px)';
  centerLabel.style.color = '#e8f9ff';
  centerLabel.style.fontWeight = '700';
  centerLabel.style.letterSpacing = '0.08em';
  centerOverlay.appendChild(centerLabel);

  const nextStageButton = document.createElement('button');
  nextStageButton.textContent = 'Next Stage';
  nextStageButton.style.height = '40px';
  nextStageButton.style.padding = '0 16px';
  nextStageButton.style.border = '1px solid rgba(154, 245, 255, 0.9)';
  nextStageButton.style.borderRadius = '999px';
  nextStageButton.style.background = 'linear-gradient(130deg, rgba(61, 162, 208, 0.75), rgba(20, 76, 110, 0.7))';
  nextStageButton.style.color = '#ebfcff';
  nextStageButton.style.fontWeight = '700';
  nextStageButton.style.letterSpacing = '0.06em';
  nextStageButton.style.display = 'none';
  centerOverlay.appendChild(nextStageButton);
  nextStageButton.addEventListener('click', () => {
    centerOverlay.style.display = 'none';
    prepareNextStage(world);
  });

  const gameOverAction = document.createElement('button');
  gameOverAction.style.height = '38px';
  gameOverAction.style.padding = '0 14px';
  gameOverAction.style.border = '1px solid rgba(167, 244, 255, 0.92)';
  gameOverAction.style.borderRadius = '999px';
  gameOverAction.style.background = 'linear-gradient(130deg, rgba(58, 169, 212, 0.75), rgba(20, 75, 110, 0.7))';
  gameOverAction.style.color = '#eaffff';
  gameOverAction.style.fontWeight = '700';
  gameOverAction.style.letterSpacing = '0.06em';
  gameOverAction.style.display = 'none';
  centerOverlay.appendChild(gameOverAction);

  gameStore.subscribe((state) => {
    const tankerPct = Math.max(0, Math.min(100, state.tankerHp));
    tankerBar.fill.style.width = `${tankerPct}%`;
    tankerBar.value.textContent = `${Math.ceil(state.tankerHp)} / 100 • 🛡${state.powerLives}`;
    const bossPct = Math.max(0, Math.min(100, (state.bossHp / Math.max(1, state.bossMaxHp)) * 100));
    bossBar.fill.style.width = `${bossPct}%`;
    bossBar.value.textContent = `${Math.ceil(state.bossHp)} / ${Math.ceil(state.bossMaxHp)}`;
    if (state.endState === 'victory') {
      gameOver.textContent = 'VICTORY';
      gameOver.style.border = '1px solid rgba(129, 255, 214, 0.72)';
      gameOver.style.color = '#defff1';
      gameOver.style.animation = 'pulse 950ms ease-in-out infinite alternate';
      blastRing.style.border = '2px solid rgba(151, 255, 218, 0.9)';
    } else {
      gameOver.textContent = 'DEFEAT';
      gameOver.style.border = '1px solid rgba(132, 230, 255, 0.6)';
      gameOver.style.color = '#f4fbff';
      gameOver.style.animation = 'pulse 700ms ease-in-out infinite alternate';
      blastRing.style.border = '2px solid rgba(255, 178, 136, 0.9)';
    }
    gameOver.style.display = state.isGameOver ? 'block' : 'none';
    if (state.isGameOver) {
      blastRing.style.display = 'block';
      blastRing.style.animation = 'none';
      void blastRing.offsetWidth;
      blastRing.style.animation = 'blastRing 580ms ease-out 1';
    } else {
      blastRing.style.display = 'none';
    }

    if (state.showNextStage || world.phase === 'countdown' || state.isGameOver) {
      centerOverlay.style.display = 'flex';
      if (state.isGameOver) {
        centerLabel.textContent = state.endState === 'victory' ? 'Mission Complete' : 'Mission Failed';
      } else if (world.phase === 'countdown') {
        const sec = Math.max(0, Math.ceil(world.stageCountdownMs / 1000));
        centerLabel.textContent = sec > 0 ? `${sec}` : 'GO';
      } else {
        centerLabel.textContent = state.overlayMessage || `Stage ${world.currentStage} Cleared`;
      }
      nextStageButton.style.display = state.showNextStage ? 'block' : 'none';
      if (state.isGameOver) {
        gameOverAction.style.display = 'block';
        gameOverAction.textContent = state.endState === 'victory' ? 'Back To Intro' : 'Retry Stage';
      } else {
        gameOverAction.style.display = 'none';
      }
    } else {
      centerOverlay.style.display = 'none';
      gameOverAction.style.display = 'none';
    }
  });

  gameOverAction.addEventListener('click', () => {
    if (gameStore.getState().endState === 'victory') {
      window.location.reload();
      return;
    }
    gameStore.getState().setHud({
      isGameOver: false,
      endState: 'none',
      overlayMessage: '',
      showNextStage: false
    });
    startStageCountdown(world, true);
  });
}

function watchSessionEnd(loop: GameLoop, world: World, previous: { highScore: number; totalRuns: number }): void {
  let committed = false;
  gameStore.subscribe(async (state) => {
    if (!state.isGameOver || committed) {
      return;
    }
    committed = true;
    const high = Math.max(previous.highScore, Math.floor(state.score));
    const stage = world.currentStage;
    await sdkSaveProgress({
      highScore: high,
      totalRuns: previous.totalRuns + 1,
      lastStageReached: (stage > 3 ? 3 : stage) as 1 | 2 | 3
    });
    gameStore.getState().setHighScore(high);
  });
}

void bootstrap();


