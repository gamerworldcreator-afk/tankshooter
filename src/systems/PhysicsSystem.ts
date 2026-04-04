import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

const BULLET_DAMAGE = 22;
const TANKER_COLLISION_DAMAGE = 14;
const ENEMY_BULLET_DAMAGE = 10;
const FABRICATOR_DAMAGE = 9;

export class PhysicsSystem implements System {
  public readonly priority = 2;
  public readonly name = 'PhysicsSystem';

  public update(world: World, dt: number): void {
    this.tickLifetimes(world, dt);
    this.integrate(world, dt);
    if (world.phase === 'playing') {
      this.resolveCollisions(world);
    }
  }

  private tickLifetimes(world: World, dt: number): void {
    const elapsedMs = dt * 1000;
    for (const [entity, ttl] of world.lifetimesMs) {
      const next = ttl - elapsedMs;
      if (next > 0) {
        world.lifetimesMs.set(entity, next);
      } else {
        world.releaseToPool(entity);
      }
    }
  }

  private integrate(world: World, dt: number): void {
    for (const [entity, velocity] of world.velocities) {
      if (!world.isEntityActive(entity)) {
        continue;
      }
      const transform = world.transforms.get(entity);
      if (!transform) {
        continue;
      }
      transform.x += velocity.vx * dt;
      transform.y += velocity.vy * dt;
      transform.z += velocity.vz * dt;
      const spin = world.angularVelocity.get(entity);
      if (spin) {
        transform.rotZ += spin * dt;
      }
      const sway = world.obstacleSway.get(entity);
      if (sway) {
        transform.x += Math.sin(world.timeMs * 0.001 * sway.frequency + sway.phase) * sway.amplitude * dt;
        transform.rotX += dt * sway.frequency * 0.12;
        transform.rotY += dt * sway.frequency * 0.09;
      }

      if (entity === world.tankerEntity) {
        transform.x = Math.max(world.arena.minX, Math.min(world.arena.maxX, transform.x));
      }

      const role = world.roles.get(entity);
      if (role === 'bullet' && transform.y > world.arena.maxY + 2) {
        world.releaseToPool(entity);
        continue;
      }

      if ((role === 'obstacle' || role === 'debris' || role === 'subParticle' || role === 'enemyBullet') && transform.y < world.arena.minY - 2) {
        world.releaseToPool(entity);
      }
    }
    if (world.phase === 'playing') {
      this.handleObstacleFire(world, dt);
    }
  }

  private resolveCollisions(world: World): void {
    const bullets = world.getEntitiesByRole('bullet');
    const enemyBullets = world.getEntitiesByRole('enemyBullet');
    const obstacles = [...world.getEntitiesByRole('obstacle'), ...world.getEntitiesByRole('enemyJet')];
    const fabricator = world.fabricatorEntity;
    const tanker = world.tankerEntity;

    for (const bullet of bullets) {
      for (const enemyBullet of enemyBullets) {
        if (!world.isEntityActive(enemyBullet) || !this.intersects(world, bullet, enemyBullet)) {
          continue;
        }
        const bt = world.transforms.get(bullet);
        world.releaseToPool(bullet);
        world.releaseToPool(enemyBullet);
        if (bt) {
          this.emitImpactBurst(world, bt.x, bt.y, 0xcdf8ff, 6, 5.2);
        }
        break;
      }
      if (!world.isEntityActive(bullet)) {
        continue;
      }
      for (const obstacle of obstacles) {
        if (!this.intersects(world, bullet, obstacle)) {
          continue;
        }
        world.releaseToPool(bullet);
        world.applyDamage(obstacle, BULLET_DAMAGE);
        if ((world.health.get(obstacle)?.current ?? 1) <= 0) {
          world.feedbackQueue.push({ kind: 'kill', magnitude: 0.18, haptics: [15, 10, 15] });
          world.addScore(20);
        }
        break;
      }
    }

    for (const bullet of bullets) {
      if (!world.isEntityActive(bullet)) {
        continue;
      }
      if (fabricator > 0 && this.intersects(world, bullet, fabricator)) {
        const bulletTransform = world.transforms.get(bullet);
        world.releaseToPool(bullet);
        world.applyDamage(fabricator, FABRICATOR_DAMAGE);
        world.addScore(2);
        if (bulletTransform) {
          this.emitImpactBurst(world, bulletTransform.x, bulletTransform.y, 0x95fff2, 8, 6.5);
        }
      }
    }

    for (const obstacle of obstacles) {
      if (tanker < 0 || !this.intersects(world, obstacle, tanker)) {
        continue;
      }
      world.releaseToPool(obstacle);
      world.applyDamage(tanker, TANKER_COLLISION_DAMAGE);
      world.feedbackQueue.push({ kind: 'hit', magnitude: 0.35, haptics: [30] });
      const tankerTransform = world.transforms.get(tanker);
      if (tankerTransform) {
        this.emitImpactBurst(world, tankerTransform.x, tankerTransform.y, 0xffb38c, 11, 7.5);
      }
      if ((world.health.get(tanker)?.current ?? 1) <= 0) {
        if (!world.unlimitedPowerMode) {
          gameStore.getState().setHud({ isGameOver: true, endState: 'defeat' });
        }
      }
    }

    for (const enemyBullet of enemyBullets) {
      if (tanker < 0 || !this.intersects(world, enemyBullet, tanker)) {
        continue;
      }
      world.releaseToPool(enemyBullet);
      world.applyDamage(tanker, ENEMY_BULLET_DAMAGE);
      world.feedbackQueue.push({ kind: 'hit', magnitude: 0.22, haptics: [24] });
      const tankerTransform = world.transforms.get(tanker);
      if (tankerTransform) {
        this.emitImpactBurst(world, tankerTransform.x, tankerTransform.y, 0xffb993, 9, 6.6);
      }
      if ((world.health.get(tanker)?.current ?? 1) <= 0) {
        if (!world.unlimitedPowerMode) {
          gameStore.getState().setHud({ isGameOver: true, endState: 'defeat' });
        }
      }
    }
  }

  private handleObstacleFire(world: World, dt: number): void {
    const obstacles = [...world.getEntitiesByRole('obstacle'), ...world.getEntitiesByRole('enemyJet')];
    const tankerTransform = world.transforms.get(world.tankerEntity);
    if (!tankerTransform) {
      return;
    }
    for (const obstacle of obstacles) {
      const obstacleTransform = world.transforms.get(obstacle);
      if (!obstacleTransform || obstacleTransform.y > world.arena.maxY - 0.3) {
        continue;
      }
      const prev = world.obstacleFireCooldownMs.get(obstacle) ?? 999;
      const next = prev - dt * 1000;
      if (next > 0) {
        world.obstacleFireCooldownMs.set(obstacle, next);
        continue;
      }
      const dx = tankerTransform.x - obstacleTransform.x;
      const dy = tankerTransform.y - obstacleTransform.y;
      const mag = Math.hypot(dx, dy) || 1;
      const cadenceFactor = world.currentStage === 1 ? 1.9 : world.currentStage === 2 ? 1.3 : 1;
      world.queueSpawn({
        key: 'enemyBullet',
        role: 'enemyBullet',
        x: obstacleTransform.x,
        y: obstacleTransform.y - 0.5,
        vx: (dx / mag) * (world.currentStage >= 4 ? 7.1 : 5.8),
        vy: Math.min(-5.4, (dy / mag) * (world.currentStage >= 4 ? 7.1 : 5.8))
      });
      world.obstacleFireCooldownMs.set(obstacle, (840 + Math.random() * 920) * cadenceFactor);
    }
  }

  private emitImpactBurst(
    world: World,
    x: number,
    y: number,
    tint: number,
    count: number,
    velocityScale: number
  ): void {
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.32;
      const speed = velocityScale * (0.65 + Math.random() * 0.9);
      world.queueSpawn({
        key: 'subParticle',
        role: 'subParticle',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        ttlMs: 180 + Math.random() * 180,
        scale: 0.9 + Math.random() * 0.8,
        tint
      });
    }
  }

  private intersects(world: World, a: number, b: number): boolean {
    const ta = world.transforms.get(a);
    const tb = world.transforms.get(b);
    const ha = world.hitboxes.get(a);
    const hb = world.hitboxes.get(b);
    if (!ta || !tb || !ha || !hb) {
      return false;
    }
    const dx = Math.abs(ta.x - tb.x);
    const dy = Math.abs(ta.y - tb.y);
    return dx < (ha.w + hb.w) * 0.5 && dy < (ha.h + hb.h) * 0.5;
  }
}
