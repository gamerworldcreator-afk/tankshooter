import type { System, World } from '../core/World';

export class SpawnSystem implements System {
  public readonly priority = 4;
  public readonly name = 'SpawnSystem';

  private bulletCooldownMs = 0;
  private obstacleCooldownMs = 0;

  public update(world: World, dt: number): void {
    if (world.tankerEntity < 0) {
      return;
    }
    const tanker = world.transforms.get(world.tankerEntity);
    if (!tanker) {
      return;
    }

    this.bulletCooldownMs -= dt * 1000;
    this.obstacleCooldownMs -= dt * 1000;

    if (this.bulletCooldownMs <= 0) {
      this.bulletCooldownMs = 120;
      world.queueSpawn({
        key: 'bullet',
        role: 'bullet',
        x: tanker.x,
        y: tanker.y + 1,
        vx: 0,
        vy: 18
      });
    }

    const stage = world.bosses.get(world.fabricatorEntity)?.stage ?? 1;
    const spawnRate = stage === 1 ? 500 : stage === 2 ? 430 : 330;
    if (this.obstacleCooldownMs <= 0) {
      this.obstacleCooldownMs = spawnRate;
      world.queueSpawn({
        key: 'obstacle',
        role: 'obstacle',
        x: world.arena.minX + Math.random() * (world.arena.maxX - world.arena.minX),
        y: world.arena.maxY + 1.3,
        vx: (Math.random() - 0.5) * 2.2,
        vy: -4 - stage * 0.45
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
      if (!transform || !velocity) {
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
    }
  }
}
