import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

export class ShatterSystem implements System {
  public readonly priority = 7;
  public readonly name = 'ShatterSystem';

  public update(world: World): void {
    while (world.deathQueue.length > 0) {
      const entity = world.deathQueue.shift();
      if (!entity) {
        continue;
      }
      const role = world.roles.get(entity);
      const transform = world.transforms.get(entity);
      if (!role || !transform) {
        continue;
      }

      if (role === 'obstacle') {
        world.releaseToPool(entity);
        const chunks = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < chunks; i += 1) {
          world.queueSpawn({
            key: i % 2 === 0 ? 'debris' : 'subParticle',
            role: i % 2 === 0 ? 'debris' : 'subParticle',
            x: transform.x,
            y: transform.y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.3) * 8,
            ttlMs: 520 + Math.random() * 400
          });
        }
        world.feedbackQueue.push({ kind: 'kill', magnitude: 0.08, haptics: [15, 10, 15] });
      }

      if (role === 'fabricator') {
        if (world.currentStage < world.maxStage) {
          world.phase = 'stageClear';
          gameStore.getState().setHud({
            showNextStage: true,
            overlayMessage: `Stage ${world.currentStage} Cleared`,
            endState: 'none'
          });
        } else {
          world.phase = 'victory';
          gameStore.getState().setHud({
            isGameOver: true,
            endState: 'victory',
            overlayMessage: 'Final Victory',
            showNextStage: false
          });
        }
        world.feedbackQueue.push({ kind: 'explosion', magnitude: 0.8, haptics: [30, 30, 40] });
        world.addScore(5000);
      }

      if (role === 'tanker') {
        world.phase = 'defeat';
        gameStore.getState().setHud({
          isGameOver: true,
          endState: 'defeat',
          overlayMessage: 'Defeat',
          showNextStage: false
        });
      }
    }
  }
}
