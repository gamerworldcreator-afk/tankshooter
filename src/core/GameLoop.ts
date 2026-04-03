import type { Renderer } from './Renderer';
import type { World } from './World';

const FIXED_DT = 0.01;
const MAX_FRAME_DELTA = 0.2;

export class GameLoop {
  private accumulator = 0;
  private lastTime = 0;
  private running = false;

  public constructor(
    private readonly world: World,
    private readonly renderer: Renderer
  ) {}

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  public stop(): void {
    this.running = false;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) {
      return;
    }

    requestAnimationFrame(this.frame);
    const rawDelta = (now - this.lastTime) / 1000;
    this.lastTime = now;

    this.accumulator += Math.min(rawDelta, MAX_FRAME_DELTA);
    while (this.accumulator >= FIXED_DT) {
      this.world.tick(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    const alpha = this.accumulator / FIXED_DT;
    this.renderer.render(alpha);
  };
}
