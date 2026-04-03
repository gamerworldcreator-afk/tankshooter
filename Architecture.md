# Iron Tide: Zero Hour — Architecture.md
> Platform: Facebook Instant Games (SDK v8) · Stack: Three.js + Vite + TypeScript · Pattern: Component-Entity-System (CES)

---

## 1. Directory Structure

```
iron-tide/
├── src/
│   ├── main.ts                   # Entry point — bootstraps SDK, scene, game loop
│   ├── MetaSDK.ts                # Facebook SDK bridge (Zero-Permission)
│   ├── core/
│   │   ├── World.ts              # Entity registry + system scheduler
│   │   ├── GameLoop.ts           # Fixed-step physics decoupled from RAF render
│   │   ├── ObjectPool.ts         # Generic pool for bullets, debris, particles
│   │   └── Renderer.ts           # Three.js WebGL/WebGPU + Bloom post-process
│   ├── components/
│   │   ├── TransformComponent.ts
│   │   ├── VelocityComponent.ts
│   │   ├── HealthComponent.ts
│   │   ├── RenderComponent.ts    # Holds Three.js Mesh + ShaderMaterial ref
│   │   ├── PulseFieldComponent.ts
│   │   ├── BossComponent.ts      # Stage tracking, RefractiveShield, TrackingBeam state
│   │   └── PoolableComponent.ts  # Marks entity as returnable to pool
│   ├── systems/
│   │   ├── MovementSystem.ts     # Tanker X-axis input (touch + mouse)
│   │   ├── PhysicsSystem.ts      # Velocity integration, AABB collision
│   │   ├── PulseFieldSystem.ts   # Distortion wave + inverse-force on obstacles
│   │   ├── SpawnSystem.ts        # Pulls from ObjectPool, initialises entities
│   │   ├── BossEvolutionSystem.ts# Stage_1 → Stage_2 → Stage_3 state machine
│   │   ├── PassiveRegenSystem.ts # Fabricator +2 HP/sec
│   │   ├── ShatterSystem.ts      # Spawns 3-5 debris sub-particles on kill
│   │   ├── FeedbackSystem.ts     # Screen-shake + navigator.vibrate
│   │   └── HUDSystem.ts          # Writes to Zustand store → React HUD overlay
│   ├── shaders/
│   │   ├── PulseField.glsl       # Vertex distortion for the refractive wave
│   │   ├── RefractiveShield.glsl # Stage-2 boss barrier (chromatic aberration)
│   │   └── NeonAura.glsl         # TSL / GLSL selective bloom mask
│   ├── store/
│   │   └── gameStore.ts          # Zustand: HUD state, session, score, boss stage
│   └── assets/                   # Loaded lazily; total budget ≤ 5 MB
├── vite.config.ts                # Code-split, gzip, bundle analyser
├── tsconfig.json
└── index.html
```

---

## 2. Component Definitions

Each component is a **plain data bag** — no behaviour, no methods.

```ts
// TransformComponent
interface TransformComponent {
  type: 'Transform';
  x: number; y: number; z: number;
  rotX: number; rotY: number; rotZ: number;
  scaleX: number; scaleY: number; scaleZ: number;
}

// VelocityComponent
interface VelocityComponent {
  type: 'Velocity';
  vx: number; vy: number; vz: number;
}

// HealthComponent
interface HealthComponent {
  type: 'Health';
  current: number;
  max: number;
  regenRate: number; // HP per second (0 for most, 2 for Fabricator)
}

// RenderComponent
interface RenderComponent {
  type: 'Render';
  mesh: THREE.Mesh;
  bloomLayer: number; // 0 = no bloom, 1 = neon bloom layer
}

// PulseFieldComponent
interface PulseFieldComponent {
  type: 'PulseField';
  radius: number;           // Current wave radius (grows on activation)
  maxRadius: number;        // e.g. 220 units
  strength: number;         // Inverse-force magnitude
  active: boolean;
  cooldownMs: number;
}

// BossComponent
interface BossComponent {
  type: 'Boss';
  stage: 1 | 2 | 3;
  shieldActive: boolean;    // Stage 2: RefractiveShield shader enabled
  beamTargetX: number;      // Stage 3: TrackingBeam follows Tanker X each frame
  beamFiring: boolean;
}

// PoolableComponent
interface PoolableComponent {
  type: 'Poolable';
  poolKey: string;          // e.g. 'bullet' | 'debris' | 'subParticle'
  active: boolean;
}
```

---

## 3. System Execution Order

Systems run inside `World.tick(dt: number)` in this guaranteed order every **physics step**:

| Priority | System | Role |
|---|---|---|
| 1 | `MovementSystem` | Read input → set Tanker velocity |
| 2 | `PhysicsSystem` | Integrate velocity, resolve collisions |
| 3 | `PulseFieldSystem` | Grow pulse radius, apply inverse forces |
| 4 | `SpawnSystem` | Create / recycle entities from pool |
| 5 | `PassiveRegenSystem` | Tick Fabricator HP regen |
| 6 | `BossEvolutionSystem` | Advance stage state machine |
| 7 | `ShatterSystem` | Spawn sub-particles on destruction events |
| 8 | `FeedbackSystem` | Vibrate + add screen-shake delta |
| 9 | `HUDSystem` | Flush dirty state to Zustand store |

**Render** (`Renderer.ts`) runs on the RAF callback, **independent** of physics steps.

---

## 4. Game Loop: Fixed-Step Physics + RAF Render

```
┌─────────────────────────────────────────────────┐
│  requestAnimationFrame (render loop, ~60fps)    │
│    accumulator += realDelta                     │
│    while (accumulator >= FIXED_DT) {           │
│      World.tick(FIXED_DT)   ← physics step     │
│      accumulator -= FIXED_DT                   │
│    }                                            │
│    alpha = accumulator / FIXED_DT              │
│    Renderer.render(alpha)   ← interpolated     │
└─────────────────────────────────────────────────┘
FIXED_DT = 10ms (100Hz physics)
```

This ensures physics behaves identically on 30fps low-end Android and 120fps desktop.

---

## 5. Object Pool

All runtime entities — bullets, scrap debris, sub-particles — are **never garbage collected during gameplay**.

```ts
// ObjectPool<T> generic — acquire / release
const pool = new ObjectPool<BulletEntity>(() => createBulletEntity(), 64);
const bullet = pool.acquire(); // reuses dormant entity
// ...on destroy:
pool.release(bullet);          // mark inactive, return to pool
```

---

## 6. Pulse Field Mechanic

```ts
// PulseFieldSystem core logic (runs inside physics tick)
for (const obstacle of obstacles) {
  const dist = distance(obstacle.transform, pulseField.transform);
  if (dist < pulse.radius) {
    const dir = normalise(subtract(obstacle.transform, pulseField.transform));
    const force = pulse.strength * (1 - dist / pulse.radius); // falloff
    applyInverseForce(obstacle.velocity, dir, force);
  }
}
```

The visual wave is rendered via `PulseField.glsl` — a vertex shader displacing a fullscreen quad in UV space.

---

## 7. Boss Evolution State Machine

```
Stage_1  ────── HP < 66% ──────►  Stage_2  ────── HP < 33% ──────►  Stage_3
Spawns basic                      Activates                           Deploys
physics scrap                     RefractiveShield                    TrackingBeam
                                  shader on mesh                      targeting Tanker X
```

`PassiveRegenSystem` runs at all stages (+2 HP/sec), making sustained DPS essential.

---

## 8. Zero-Permission Data Handling

```ts
// ✅ CORRECT — Zero-Permission pattern (MetaSDK.ts)
await FBInstant.player.setDataAsync({
  highScore: newScore,   // Only game-owned, non-PII data
  stage: currentStage,
});

// ❌ NEVER — these violate Zero-Permission protocol
// FBInstant.player.getID()          → do not store or transmit
// FBInstant.player.getName()        → do not log or display externally
// document.cookie / localStorage    → forbidden; use setDataAsync only
```

All session state lives in the **Zustand store** (in-memory). Persistence uses only `FBInstant.player.setDataAsync` and `getDataAsync`. No cookies, no `localStorage`, no external analytics endpoints.

---

## 9. Bundle Budget (5 MB Hard Limit)

| Asset | Budgeted Size |
|---|---|
| Three.js (tree-shaken) | ~280 KB gzip |
| Game code + shaders | ~180 KB gzip |
| Zustand | ~3 KB gzip |
| FB SDK (external CDN) | 0 KB (not bundled) |
| Textures + audio | ~4.5 MB combined |
| **Total initial load** | **≤ 5 MB** |

Secondary assets (boss Stage 3 textures, music) are lazy-loaded after `startGameAsync()`.

---

## 10. Aesthetic Constraints

- **Glassmorphism UI:** `backdrop-filter: blur(12px)` panels, 1px neon borders, `rgba` fills.
- **Selective Bloom:** Three.js `UnrealBloomPass` on Layer 1 only. Background and geometry on Layer 0 are unaffected — only neon projectiles and the Fabricator core bloom.
- **Screen-shake:** `FeedbackSystem` accumulates a `shakeDelta` vector per explosion (proportional to magnitude) and applies it to `camera.position` each render frame with exponential decay.
- **Haptics:** `navigator.vibrate([30])` on Tanker hit; `navigator.vibrate([15, 10, 15])` on kill.
