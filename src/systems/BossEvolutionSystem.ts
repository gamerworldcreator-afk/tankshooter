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

    this.updateBossMovement(world, boss.stage);
    this.updateShieldVisual(world, boss.shieldActive);
    this.updateTrackingBeam(world, dt, boss);
  }

  private updateBossMovement(world: World, stage: 1 | 2 | 3): void {
    const transform = world.transforms.get(world.fabricatorEntity);
    if (!transform) {
      return;
    }
    const t = world.timeMs * 0.001;
    const range = (world.arena.maxX - world.arena.minX) * 0.36;
    const pattern =
      Math.sin(t * (0.62 + stage * 0.05)) * range * 0.7 +
      Math.sin(t * (1.24 + stage * 0.08) + 1.3) * range * 0.35;
    transform.x = THREE.MathUtils.clamp(pattern, world.arena.minX + 1.2, world.arena.maxX - 1.2);
    transform.y = world.arena.maxY - 1.25 + Math.sin(t * 0.9 + 0.8) * 0.28;
  }

  private updateShieldVisual(world: World, enabled: boolean): void {
    const render = world.renders.get(world.fabricatorEntity);
    if (!render || !(render.mesh instanceof THREE.Mesh)) {
      return;
    }
    const boss = world.bosses.get(world.fabricatorEntity);
    const stage = boss?.stage ?? 1;
    const stageBoost = stage === 1 ? 0.55 : stage === 2 ? 0.9 : 1.25;
    const time = world.timeMs * 0.001;

    const mat = render.mesh.material;
    if (!(mat instanceof THREE.ShaderMaterial)) {
      return;
    }
    const target = enabled ? 1 : 0;
    const current = Number(mat.uniforms.uIntensity?.value ?? 0);
    mat.uniforms.uIntensity.value = THREE.MathUtils.lerp(current, target, 0.12);
    mat.uniforms.uTime.value = world.timeMs / 1000;

    const haloOuter = render.mesh.getObjectByName('fabricatorHaloOuter');
    const haloInner = render.mesh.getObjectByName('fabricatorHaloInner');
    const orbA = render.mesh.getObjectByName('fabricatorOrbA');
    const orbB = render.mesh.getObjectByName('fabricatorOrbB');
    const coreLight = render.mesh.getObjectByName('fabricatorLight');

    if (haloOuter instanceof THREE.Mesh) {
      haloOuter.rotation.z += 0.01 * stageBoost;
      haloOuter.rotation.x = Math.PI * (0.2 + Math.sin(time * 0.8) * 0.06);
      const haloMat = haloOuter.material;
      if (haloMat instanceof THREE.MeshBasicMaterial) {
        haloMat.opacity = 0.28 + Math.sin(time * 2.1) * 0.08 + stageBoost * 0.16;
      }
    }
    if (haloInner instanceof THREE.Mesh) {
      haloInner.rotation.z -= 0.016 * stageBoost;
      haloInner.rotation.y = Math.sin(time * 0.9) * 0.38;
      const haloMat = haloInner.material;
      if (haloMat instanceof THREE.MeshBasicMaterial) {
        haloMat.opacity = 0.22 + Math.cos(time * 2.8) * 0.09 + stageBoost * 0.12;
      }
    }
    if (orbA instanceof THREE.Mesh) {
      orbA.position.x = Math.cos(time * 1.6) * 1.92;
      orbA.position.y = Math.sin(time * 1.6) * 0.72;
    }
    if (orbB instanceof THREE.Mesh) {
      orbB.position.x = Math.cos(time * 1.6 + Math.PI) * 1.92;
      orbB.position.y = Math.sin(time * 1.6 + Math.PI) * 0.72;
    }
    if (coreLight instanceof THREE.PointLight) {
      coreLight.intensity = 1.1 + stageBoost * 0.6 + Math.sin(time * 3.2) * 0.35;
    }
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
