import * as THREE from 'three';
import type { System, World } from '../core/World';

export class SpawnSystem implements System {
  public readonly priority = 4;
  public readonly name = 'SpawnSystem';

  private bulletCooldownMs = 0;
  private powerBulletCooldownMs = 0;
  private obstacleCooldownMs = 0;
  private volleyFlip = false;
  private vanishPulseMs = 0;

  public update(world: World, dt: number): void {
    if (world.tankerEntity < 0) {
      return;
    }
    const tanker = world.transforms.get(world.tankerEntity);
    if (!tanker) {
      return;
    }

    this.bulletCooldownMs -= dt * 1000;
    this.powerBulletCooldownMs -= dt * 1000;
    this.obstacleCooldownMs -= dt * 1000;
    this.vanishPulseMs = Math.max(0, this.vanishPulseMs - dt * 1000);

    if (world.phase === 'playing' && world.input.shootHeld && this.bulletCooldownMs <= 0) {
      this.bulletCooldownMs = 110;
      const drift = this.volleyFlip ? 0.7 : -0.7;
      this.volleyFlip = !this.volleyFlip;
      world.queueSpawn({
        key: 'bullet',
        role: 'bullet',
        x: tanker.x - 0.24,
        y: tanker.y + 0.85,
        vx: -0.2,
        vy: 19
      });
      world.queueSpawn({
        key: 'bullet',
        role: 'bullet',
        x: tanker.x + 0.24,
        y: tanker.y + 0.85,
        vx: 0.2,
        vy: 19
      });
      world.queueSpawn({
        key: 'bullet',
        role: 'bullet',
        x: tanker.x,
        y: tanker.y + 1.1,
        vx: drift,
        vy: 20
      });
    }

    if (
      world.phase === 'playing' &&
      world.input.powerRequested &&
      world.powerShotsRemaining > 0 &&
      this.powerBulletCooldownMs <= 0
    ) {
      this.powerBulletCooldownMs = 320;
      world.powerShotsRemaining = Math.max(0, world.powerShotsRemaining - 1);
      world.queueSpawn({
        key: 'powerBullet',
        role: 'powerBullet',
        x: tanker.x,
        y: tanker.y + 1.2,
        vx: 0,
        vy: 16.8,
        scale: 1.55
      });
      world.input.powerRequested = false;
    } else if (world.input.powerRequested && world.powerShotsRemaining <= 0) {
      world.input.powerRequested = false;
    }

    if (world.phase === 'playing' && world.input.vanishRequested) {
      world.input.vanishRequested = false;
      if (world.powerVanishCharges > 0 && this.vanishPulseMs <= 0) {
        world.powerVanishCharges -= 1;
        this.vanishPulseMs = 700;
        this.triggerVanish(world);
      }
    }

    const stage = world.currentStage;
    const spawnRate = stage === 1 ? 760 : stage === 2 ? 630 : stage === 3 ? 560 : stage === 4 ? 480 : 430;
    if (world.phase === 'playing' && this.obstacleCooldownMs <= 0) {
      this.obstacleCooldownMs = spawnRate;
      world.queueSpawn({
        key: 'obstacle',
        role: 'obstacle',
        x: world.arena.minX + Math.random() * (world.arena.maxX - world.arena.minX),
        y: world.arena.maxY + 1.3,
        vx: (Math.random() - 0.5) * 2.8,
        vy: -3.9 - Math.random() * 0.75
      });
    }

    this.flushSpawnQueue(world);
  }

  private flushSpawnQueue(world: World): void {
    while (world.spawnQueue.length > 0) {
      const command = world.spawnQueue.shift();
      if (!command) {
        break;
      }
      const entity = world.acquireFromPool(command.key);
      if (!entity) {
        continue;
      }
      const transform = world.transforms.get(entity);
      const velocity = world.velocities.get(entity);
      const render = world.renders.get(entity);
      if (!transform || !velocity || !render) {
        world.releaseToPool(entity);
        continue;
      }
      transform.x = command.x;
      transform.y = command.y;
      transform.z = 0;
      transform.rotX = 0;
      transform.rotY = 0;
      transform.rotZ = Math.random() * Math.PI;
      transform.scaleX = 1;
      transform.scaleY = 1;
      transform.scaleZ = 1;
      if (command.scale) {
        transform.scaleX = command.scale;
        transform.scaleY = command.scale;
      }

      velocity.vx = command.vx;
      velocity.vy = command.vy;
      velocity.vz = 0;

      if (command.ttlMs) {
        world.lifetimesMs.set(entity, command.ttlMs);
      }

      const health = world.health.get(entity);
      if (health) {
        health.current = health.max;
      }

      if (command.role === 'obstacle') {
        this.configureObstacle(world, entity);
      }
      if (command.role === 'subParticle' && command.tint !== undefined && render.mesh instanceof THREE.Mesh) {
        this.tintSubParticle(render.mesh, command.tint);
      }
    }
  }

  private triggerVanish(world: World): void {
    const hazardRoles: Array<'obstacle' | 'enemyBullet'> = ['obstacle', 'enemyBullet'];
    const purged: Array<{ x: number; y: number }> = [];
    for (const role of hazardRoles) {
      for (const entity of world.getEntitiesByRole(role)) {
        const t = world.transforms.get(entity);
        if (t) {
          purged.push({ x: t.x, y: t.y });
        }
        world.releaseToPool(entity);
      }
    }
    for (const pos of purged) {
      for (let i = 0; i < 7; i += 1) {
        const a = (Math.PI * 2 * i) / 7;
        world.queueSpawn({
          key: 'subParticle',
          role: 'subParticle',
          x: pos.x,
          y: pos.y,
          vx: Math.cos(a) * (4.5 + Math.random() * 3.2),
          vy: Math.sin(a) * (4.5 + Math.random() * 3.2),
          ttlMs: 220 + Math.random() * 180,
          tint: 0x9dfff2
        });
      }
    }
    if (purged.length > 0) {
      world.feedbackQueue.push({ kind: 'explosion', magnitude: 0.42, haptics: [26, 18, 26] });
      world.addScore(purged.length * 6);
    }
  }

  private configureObstacle(world: World, entity: number): void {
    const roll = Math.random();
    const stage = world.currentStage;
    const transform = world.transforms.get(entity);
    const velocity = world.velocities.get(entity);
    const health = world.health.get(entity);
    const render = world.renders.get(entity);
    if (!transform || !velocity || !health || !render || !(render.mesh instanceof THREE.Mesh)) {
      return;
    }

    if (roll < 0.4) {
      transform.scaleX = 0.96;
      transform.scaleY = 0.96;
      health.max = 34;
      health.current = 34;
      velocity.vx *= 1.55;
      velocity.vy *= 1.15;
      world.hitboxes.set(entity, { w: 0.72, h: 0.72 });
      world.obstacleSway.set(entity, { amplitude: 0.9, frequency: 6.2, phase: Math.random() * Math.PI * 2 });
      world.angularVelocity.set(entity, (Math.random() - 0.5) * 8);
      world.obstacleFireCooldownMs.set(entity, stage === 1 ? 3200 + Math.random() * 1800 : 1200 + Math.random() * 900);
      this.tintObstacle(render.mesh, 0x9dd7ff, 0x1d3758);
      return;
    }

    if (roll < 0.75) {
      transform.scaleX = 1.1;
      transform.scaleY = 1.1;
      health.max = 44;
      health.current = 44;
      velocity.vx *= 0.55;
      velocity.vy *= 0.7;
      world.hitboxes.set(entity, { w: 0.94, h: 0.94 });
      world.obstacleSway.set(entity, { amplitude: 0.35, frequency: 3.4, phase: Math.random() * Math.PI * 2 });
      world.angularVelocity.set(entity, (Math.random() - 0.5) * 2.5);
      world.obstacleFireCooldownMs.set(entity, stage === 1 ? 2800 + Math.random() * 1500 : 950 + Math.random() * 700);
      this.tintObstacle(render.mesh, 0x85f2d2, 0x0f594f);
      return;
    }

    transform.scaleX = 0.72;
    transform.scaleY = 0.72;
    health.max = 24;
    health.current = 24;
    velocity.vx *= 2.2;
    velocity.vy *= 1.65;
    world.hitboxes.set(entity, { w: 0.56, h: 0.56 });
    world.obstacleSway.set(entity, { amplitude: 1.4, frequency: 8.1, phase: Math.random() * Math.PI * 2 });
    world.angularVelocity.set(entity, (Math.random() - 0.5) * 12);
    world.obstacleFireCooldownMs.set(entity, stage === 1 ? 2200 + Math.random() * 1100 : 760 + Math.random() * 520);
    this.tintObstacle(render.mesh, 0xffb995, 0x6b3314);
  }

  private tintObstacle(mesh: THREE.Mesh, color: number, emissive: number): void {
    const material = mesh.material;
    if (!material || typeof material !== 'object') {
      return;
    }
    if ('color' in material && material.color && typeof material.color === 'object' && 'setHex' in material.color) {
      (material.color as { setHex(v: number): void }).setHex(color);
    }
    if (
      'emissive' in material &&
      material.emissive &&
      typeof material.emissive === 'object' &&
      'setHex' in material.emissive
    ) {
      (material.emissive as { setHex(v: number): void }).setHex(emissive);
    }
    if ('emissiveIntensity' in material && typeof material.emissiveIntensity === 'number') {
      (material as { emissiveIntensity: number }).emissiveIntensity = 0.75;
    }
  }

  private tintSubParticle(mesh: THREE.Mesh, color: number): void {
    const material = mesh.material;
    if (!material || typeof material !== 'object') {
      return;
    }
    if ('color' in material && material.color && typeof material.color === 'object' && 'setHex' in material.color) {
      (material.color as { setHex(v: number): void }).setHex(color);
    }
  }
}
