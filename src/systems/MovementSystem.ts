import type { System, World } from '../core/World';

export class MovementSystem implements System {
  public readonly priority = 1;
  public readonly name = 'MovementSystem';

  public update(world: World): void {
    if (world.tankerEntity < 0) {
      return;
    }
    const tanker = world.tankerEntity;
    if (!world.isEntityActive(tanker)) {
      return;
    }

    const transform = world.transforms.get(tanker);
    const velocity = world.velocities.get(tanker);
    if (!transform || !velocity) {
      return;
    }

    const maxSpeed = 16;
    if (world.input.useAxisControl) {
      velocity.vx = world.input.moveAxisX * maxSpeed;
    } else {
      const clampedTarget = Math.max(world.arena.minX, Math.min(world.arena.maxX, world.input.targetX));
      const deltaX = clampedTarget - transform.x;
      velocity.vx = Math.max(-maxSpeed, Math.min(maxSpeed, deltaX * 8));
    }
    velocity.vy = 0;
  }
}
