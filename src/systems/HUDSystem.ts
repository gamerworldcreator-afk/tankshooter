import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

export class HUDSystem implements System {
  public readonly priority = 9;
  public readonly name = 'HUDSystem';

  public update(world: World): void {
    const tankerHealth = world.health.get(world.tankerEntity);
    const bossHealth = world.health.get(world.fabricatorEntity);
    const boss = world.bosses.get(world.fabricatorEntity);
    const state = gameStore.getState();

    state.setHud({
      tankerHp: Math.max(0, tankerHealth?.current ?? 0),
      bossHp: Math.max(0, bossHealth?.current ?? 0),
      bossMaxHp: bossHealth?.max ?? 1,
      bossStage: boss?.stage ?? world.currentStage,
      powerShotsRemaining: world.powerShotsRemaining,
      powerLives: world.powerLives,
      powerVanishCharges: world.powerVanishCharges,
      heroShieldActive: world.heroShieldMs > 0,
      score: world.score
    });
  }
}
