import * as THREE from 'three';
import type { System, World } from '../core/World';

export class BossEvolutionSystem implements System {
  public readonly priority = 6;
  public readonly name = 'BossEvolutionSystem';

  private beamTickMs = 0;

  public update(world: World, dt: number): void {
    const fabricator = world.fabricatorEntity;
    const boss = world.bosses.get(fabricator);
    const health = world.health.get(fabricator);
    if (!boss || !health) {
      return;
    }

    const ratio = health.current / health.max;
    const nextStage = ratio < 0.33 ? 3 : ratio < 0.66 ? 2 : 1;
    if (nextStage !== boss.stage) {
      boss.stage = nextStage;
      boss.shieldActive = nextStage >= 2;
      boss.beamFiring = nextStage >= 3;
      world.feedbackQueue.push({ kind: 'explosion', magnitude: 0.45, haptics: [20, 20, 30] });
    }

    this.updateShieldVisual(world, boss.shieldActive);
    this.updateTrackingBeam(world, dt, boss);
  }

  private updateShieldVisual(world: World, enabled: boolean): void {
    const render = world.renders.get(world.fabricatorEntity);
    if (!render) {
      return;
    }
    const mat = render.mesh.material;
    if (!(mat instanceof THREE.ShaderMaterial)) {
      return;
    }
    const target = enabled ? 1 : 0;
    const current = Number(mat.uniforms.uIntensity?.value ?? 0);
    mat.uniforms.uIntensity.value = THREE.MathUtils.lerp(current, target, 0.12);
    mat.uniforms.uTime.value = world.timeMs / 1000;
  }

  private updateTrackingBeam(world: World, dt: number, boss: { beamFiring: boolean; beamTargetX: number }): void {
    const beam = world.getEntitiesByRole('beam', false)[0];
    const tanker = world.transforms.get(world.tankerEntity);
    const beamTransform = beam ? world.transforms.get(beam) : undefined;
    const beamRender = beam ? world.renders.get(beam) : undefined;
    if (!tanker || !beamTransform || !beamRender) {
      return;
    }

    if (!boss.beamFiring) {
      beamRender.mesh.visible = false;
      return;
    }

    beamRender.mesh.visible = true;
    boss.beamTargetX = THREE.MathUtils.lerp(boss.beamTargetX, tanker.x, 0.08);
    beamTransform.x = boss.beamTargetX;

    this.beamTickMs -= dt * 1000;
    if (this.beamTickMs <= 0) {
      this.beamTickMs = 250;
      if (Math.abs(tanker.x - boss.beamTargetX) < 0.9) {
        world.applyDamage(world.tankerEntity, 4);
        world.feedbackQueue.push({ kind: 'hit', magnitude: 0.12, haptics: [25] });
      }
    }
  }
}
