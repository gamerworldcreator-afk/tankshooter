import type { System, World } from '../core/World';

export class PassiveRegenSystem implements System {
  public readonly priority = 5;
  public readonly name = 'PassiveRegenSystem';

  public update(world: World, dt: number): void {
    const fabricator = world.fabricatorEntity;
    const health = world.health.get(fabricator);
    if (!health || health.regenRate <= 0) {
      return;
    }
    health.current = Math.min(health.max, health.current + health.regenRate * dt);
  }
}
