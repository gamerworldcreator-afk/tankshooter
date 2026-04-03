import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

export class FeedbackSystem implements System {
  public readonly priority = 8;
  public readonly name = 'FeedbackSystem';

  public update(world: World, dt: number): void {
    const store = gameStore.getState();
    while (world.feedbackQueue.length > 0) {
      const event = world.feedbackQueue.shift();
      if (!event) {
        continue;
      }
      store.addShake(event.magnitude);
      if (event.haptics && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(event.haptics);
      }
    }
    store.dampShake(Math.max(0, 1 - dt * 10));
  }
}
