import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

const BULLET_DAMAGE = 22;
const TANKER_COLLISION_DAMAGE = 14;
const FABRICATOR_DAMAGE = 9;

export class PhysicsSystem implements System {
  public readonly priority = 2;
  public readonly name = 'PhysicsSystem';

  public update(world: World, dt: number): void {
    this.tickLifetimes(world, dt);
    this.integrate(world, dt);
    this.resolveCollisions(world);
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

      if (entity === world.tankerEntity) {
        transform.x = Math.max(world.arena.minX, Math.min(world.arena.maxX, transform.x));
      }

      const role = world.roles.get(entity);
      if (
        (role === 'bullet' && transform.y > world.arena.maxY + 2) ||
        ((role === 'obstacle' || role === 'debris' || role === 'subParticle') &&
          transform.y < world.arena.minY - 2)
      ) {
        world.releaseToPool(entity);
      }
    }
  }

  private resolveCollisions(world: World): void {
    const bullets = world.getEntitiesByRole('bullet');
    const obstacles = world.getEntitiesByRole('obstacle');
    const fabricator = world.fabricatorEntity;
    const tanker = world.tankerEntity;

    for (const bullet of bullets) {
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
        world.releaseToPool(bullet);
        world.applyDamage(fabricator, FABRICATOR_DAMAGE);
        world.addScore(2);
      }
    }

    for (const obstacle of obstacles) {
      if (tanker < 0 || !this.intersects(world, obstacle, tanker)) {
        continue;
      }
      world.releaseToPool(obstacle);
      world.applyDamage(tanker, TANKER_COLLISION_DAMAGE);
      world.feedbackQueue.push({ kind: 'hit', magnitude: 0.35, haptics: [30] });
      if ((world.health.get(tanker)?.current ?? 1) <= 0) {
        gameStore.getState().setHud({ isGameOver: true });
      }
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
