import { gameStore } from '../store/gameStore';
import type { System, World } from '../core/World';

export class PulseFieldSystem implements System {
  public readonly priority = 3;
  public readonly name = 'PulseFieldSystem';

  public update(world: World, dt: number): void {
    const tanker = world.tankerEntity;
    const pulse = world.pulseFields.get(tanker);
    const tankerTransform = world.transforms.get(tanker);
    if (!pulse || !tankerTransform) {
      return;
    }

    pulse.cooldownMs = Math.max(0, pulse.cooldownMs - dt * 1000);
    if (world.input.pulseRequested && pulse.cooldownMs <= 0 && !pulse.active) {
      pulse.active = true;
      pulse.radius = 0.5;
      pulse.cooldownMs = 2600;
      world.feedbackQueue.push({ kind: 'explosion', magnitude: 0.25 });
    }
    world.input.pulseRequested = false;

    if (pulse.active) {
      pulse.radius += dt * 14;
      if (pulse.radius >= pulse.maxRadius) {
        pulse.active = false;
      }
      this.applyPulseForce(world, pulse.radius, pulse.strength, tankerTransform.x, tankerTransform.y, dt);
    }

    const wave = world.getEntitiesByRole('pulseWave', false)[0];
    if (wave) {
      const waveTransform = world.transforms.get(wave);
      if (waveTransform) {
        waveTransform.x = tankerTransform.x;
        waveTransform.y = tankerTransform.y;
        const visualScale = pulse.active ? pulse.radius * 0.22 : 0.01;
        waveTransform.scaleX = visualScale;
        waveTransform.scaleY = visualScale;
      }
      const render = world.renders.get(wave);
      if (render) {
        render.mesh.visible = pulse.active;
      }
    }

    gameStore.getState().setHud({ pulseCooldownMs: pulse.cooldownMs });
  }

  private applyPulseForce(
    world: World,
    radius: number,
    strength: number,
    originX: number,
    originY: number,
    dt: number
  ): void {
    const obstacles = world.getEntitiesByRole('obstacle');
    for (const obstacle of obstacles) {
      const transform = world.transforms.get(obstacle);
      const velocity = world.velocities.get(obstacle);
      if (!transform || !velocity) {
        continue;
      }
      const dx = transform.x - originX;
      const dy = transform.y - originY;
      const distance = Math.hypot(dx, dy);
      if (distance <= 0.0001 || distance > radius) {
        continue;
      }
      const force = strength * (1 - distance / radius);
      velocity.vx += (dx / distance) * force * dt;
      velocity.vy += (dy / distance) * force * dt;
    }
  }
}
