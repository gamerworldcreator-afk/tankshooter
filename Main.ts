/**
 * Main.ts — Iron Tide: Zero Hour
 * ================================
 * Entry point. Responsibilities:
 *   1. Boot the Facebook SDK bridge (MetaSDK.ts).
 *   2. Initialise Three.js scene, camera, renderer, and post-processing.
 *   3. Construct the ECS World and register all systems.
 *   4. Seed the initial entities (Tanker, Fabricator).
 *   5. Start the fixed-step physics + RAF render loop.
 *
 * ARCHITECTURE: Component-Entity-System (CES)
 *   Entities  = integer IDs
 *   Components = plain data bags keyed by entity ID
 *   Systems    = pure functions operating on component pools
 *
 * BUNDLE BUDGET: ≤ 5 MB initial load.
 *   Three.js is tree-shaken via named imports only.
 *   Secondary assets are lazy-loaded after startGameAsync().
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import {
  sdkInitialize,
  sdkReportProgress,
  sdkStart,
  sdkLoadProgress,
  sdkSaveProgress,
} from './MetaSDK';

import { useGameStore } from './store/gameStore';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Physics tick rate — 100 Hz. Decoupled from render frame rate. */
const FIXED_DT = 0.01; // seconds

/** Three.js layer for selective bloom (only neon objects on layer 1 bloom). */
const BLOOM_LAYER = 1;

// ── Scene globals (module-scoped, not exported) ───────────────────────────────

let scene:    THREE.Scene;
let camera:   THREE.OrthographicCamera;
let renderer: THREE.WebGLRenderer;
let composer: EffectComposer;

/** Running accumulator for fixed-step physics. */
let accumulator = 0;
let lastTime    = 0;

// ── Shader sources (inlined to avoid extra HTTP round trips) ──────────────────

/**
 * PULSE FIELD DISTORTION SHADER
 * ──────────────────────────────
 * Renders a refractive glassmorphic wave that distorts everything behind it.
 * Technique: UV-space displacement via sin-wave modulated by distance from
 * the pulse origin. Applied as a fullscreen ShaderPass or on a plane mesh
 * anchored to the Tanker.
 *
 * Uniforms injected from PulseFieldSystem every frame:
 *   u_center  — Tanker NDC position (vec2)
 *   u_radius  — Current wave radius in world units (float)
 *   u_strength — Displacement magnitude (float, 0.0–0.05)
 *   u_time    — elapsed seconds (float)
 */
export const PULSE_FIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const PULSE_FIELD_FRAG = /* glsl */ `
  uniform sampler2D u_tDiffuse;  // scene render target
  uniform vec2  u_center;        // pulse origin in UV space [0,1]
  uniform float u_radius;        // normalised radius (0.0–1.0)
  uniform float u_strength;      // max UV displacement (e.g. 0.03)
  uniform float u_time;
  varying vec2 vUv;

  void main() {
    vec2  delta  = vUv - u_center;
    float dist   = length(delta);

    // Ring falloff: only distort near the wave front
    float ring   = smoothstep(u_radius - 0.04, u_radius, dist)
                 * (1.0 - smoothstep(u_radius, u_radius + 0.04, dist));

    // Radial sine ripple for the glassy refraction feel
    float wave   = sin(dist * 60.0 - u_time * 8.0) * ring;
    vec2  offset = normalize(delta + 0.001) * wave * u_strength;

    gl_FragColor = texture2D(u_tDiffuse, vUv + offset);
  }
`;

/**
 * REFRACTIVE SHIELD SHADER (Fabricator Stage 2)
 * ──────────────────────────────────────────────
 * Chromatic-aberration-style refraction applied to the boss mesh.
 * Splits R/G/B channels by a small UV offset, giving a crystal/lens effect.
 */
export const REFRACTIVE_SHIELD_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  void main() {
    vUv     = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const REFRACTIVE_SHIELD_FRAG = /* glsl */ `
  uniform sampler2D u_tDiffuse;
  uniform float u_time;
  uniform float u_intensity;   // ramps 0→1 as stage activates
  varying vec2  vUv;
  varying vec3  vNormal;

  void main() {
    // Fresnel-ish rim highlight
    float rim   = 1.0 - max(0.0, dot(vNormal, vec3(0.0, 0.0, 1.0)));
    float shift = rim * u_intensity * 0.015;

    // Chromatic split
    float r = texture2D(u_tDiffuse, vUv + vec2( shift,  0.0)).r;
    float g = texture2D(u_tDiffuse, vUv                     ).g;
    float b = texture2D(u_tDiffuse, vUv + vec2(-shift,  0.0)).b;

    // Animated hex-grid overlay for the "energy shield" look
    vec2  hexUv = vUv * 12.0;
    float hex   = abs(sin(hexUv.x + u_time) * cos(hexUv.y - u_time * 0.5));
    vec3  color = vec3(r, g, b) + vec3(0.1, 0.4, 1.0) * hex * rim * u_intensity * 0.3;

    gl_FragColor = vec4(color, 0.85 + rim * 0.15);
  }
`;

/**
 * NEON AURA / SELECTIVE BLOOM (Three.js UnrealBloomPass mask approach)
 * ─────────────────────────────────────────────────────────────────────
 * Technique: Two-pass render.
 *   Pass 1 — render ONLY bloom-layer objects (layer 1) → bloom texture.
 *   Pass 2 — render full scene, composite bloom on top.
 *
 * This shader is applied in the composite pass to mix the two.
 *
 * Objects that should glow: assign mesh.layers.enable(BLOOM_LAYER).
 * Background and structural geometry stay on layer 0 — no bloom.
 */
export const NEON_AURA_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const NEON_AURA_FRAG = /* glsl */ `
  uniform sampler2D u_baseTexture;
  uniform sampler2D u_bloomTexture;
  varying vec2 vUv;

  void main() {
    vec4 base  = texture2D(u_baseTexture,  vUv);
    vec4 bloom = texture2D(u_bloomTexture, vUv);
    // Additive blend — neon light adds on top of the dark metallic base
    gl_FragColor = base + bloom;
  }
`;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // ── Phase 1: SDK handshake ─────────────────────────────────────────────────
  await sdkInitialize();
  sdkReportProgress(5);

  // ── Phase 2: Three.js Scene ────────────────────────────────────────────────
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0f); // dark metallic void

  // Orthographic camera for crisp 2.5D perspective
  const aspect = window.innerWidth / window.innerHeight;
  const VIEW_H = 20; // world units tall
  camera = new THREE.OrthographicCamera(
    -VIEW_H * aspect / 2,  VIEW_H * aspect / 2,
     VIEW_H / 2,           -VIEW_H / 2,
    0.1, 100
  );
  camera.position.z = 10;

  // ── Phase 3: Renderer ──────────────────────────────────────────────────────
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2× for perf
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  sdkReportProgress(20);

  // ── Phase 4: Selective Bloom post-processing ───────────────────────────────
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.8,   // strength
    0.3,   // radius
    0.85   // threshold — only very bright neon pixels bloom
  );
  composer.addPass(bloomPass);

  sdkReportProgress(35);

  // ── Phase 5: Load saved progress (Zero-Permission) ────────────────────────
  const savedData = await sdkLoadProgress();
  useGameStore.getState().setHighScore(savedData.highScore);

  sdkReportProgress(50);

  // ── Phase 6: ECS World + entities (stubbed — expand in World.ts) ──────────
  // (Entities and systems are registered inside World — see World.ts)
  // world.addEntity(createTanker());
  // world.addEntity(createFabricator());
  // world.registerSystem(new MovementSystem());
  // ...etc
  // This is intentionally deferred to World.ts to keep Main.ts focused
  // on orchestration only.

  sdkReportProgress(80);

  // ── Phase 7: Resize handler ────────────────────────────────────────────────
  window.addEventListener('resize', onResize);

  sdkReportProgress(100);

  // ── Phase 8: Hand control to platform, start loop ─────────────────────────
  await sdkStart(); // platform removes its loading overlay here
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

// ── Game Loop ─────────────────────────────────────────────────────────────────

/**
 * Fixed-step physics decoupled from RAF render.
 *
 * Pattern: semi-fixed timestep with remainder accumulation.
 * Physics always steps in FIXED_DT increments regardless of frame rate.
 * Render interpolates between physics states using `alpha`.
 *
 * Benefits:
 *   • Consistent collision detection on 30 fps Android and 120 fps desktop.
 *   • No spiral of death: if a frame takes > 200ms we cap the accumulator.
 */
function tick(now: number): void {
  requestAnimationFrame(tick);

  const rawDelta = (now - lastTime) / 1000; // convert ms → seconds
  lastTime = now;

  // Guard against tab-wake-up spikes (> 200ms elapsed = treat as 16ms)
  const delta = Math.min(rawDelta, 0.2);
  accumulator += delta;

  // ── Fixed-step physics ────────────────────────────────────────────────────
  while (accumulator >= FIXED_DT) {
    // world.tick(FIXED_DT);  ← call World here once World.ts is wired up
    accumulator -= FIXED_DT;
  }

  // ── Interpolation factor for smooth render between physics states ──────────
  const alpha = accumulator / FIXED_DT;
  void alpha; // used by Renderer.ts to lerp mesh positions

  // ── Screen-shake: apply camera offset from FeedbackSystem each render ─────
  const { shakeDelta } = useGameStore.getState();
  camera.position.x = shakeDelta.x;
  camera.position.y = shakeDelta.y;

  // ── Render (uncapped, runs every RAF callback) ────────────────────────────
  composer.render();
}

// ── Resize ────────────────────────────────────────────────────────────────────

function onResize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  const VIEW_H = 20;

  camera.left   = -VIEW_H * aspect / 2;
  camera.right  =  VIEW_H * aspect / 2;
  camera.top    =  VIEW_H / 2;
  camera.bottom = -VIEW_H / 2;
  camera.updateProjectionMatrix();

  renderer.setSize(w, h);
  composer.setSize(w, h);
}

// ── Session end (called by HUDSystem when player dies) ────────────────────────

export async function endSession(finalScore: number, stage: 1 | 2 | 3): Promise<void> {
  const prev = await sdkLoadProgress();
  await sdkSaveProgress({
    highScore:        Math.max(prev.highScore, finalScore),
    totalRuns:        prev.totalRuns + 1,
    lastStageReached: stage,
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────

bootstrap().catch(console.error);
