import * as THREE from 'three';
import type { System, World } from '../core/World';

export class BossEvolutionSystem implements System {
  public readonly priority = 6;
  public readonly name = 'BossEvolutionSystem';

  private beamTickMs = 0;
  private bossFireCooldownMs = 0;
  private obstacleDropCooldownMs = 0;

  public update(world: World, dt: number): void {
    const fabricator = world.fabricatorEntity;
    const boss = world.bosses.get(fabricator);
    if (!boss) {
      return;
    }

    boss.stage = world.currentStage;
    boss.shieldActive = world.currentStage >= 2;
    boss.beamFiring = world.currentStage >= 3;

    this.updateBossMovement(world, world.currentStage);
    this.updateShieldVisual(world, boss.shieldActive);
    this.updateTrackingBeam(world, dt, boss);
    this.updateBossFire(world, dt, world.currentStage);
    this.updateJets(world, world.currentStage, dt);
  }

  private updateBossMovement(world: World, stage: 1 | 2 | 3 | 4 | 5): void {
    const transform = world.transforms.get(world.fabricatorEntity);
    if (!transform) {
      return;
    }
    const t = world.timeMs * 0.001;
    const range = (world.arena.maxX - world.arena.minX) * 0.37;
    const pattern =
      Math.sin(t * (0.56 + stage * 0.04)) * range * 0.68 +
      Math.sin(t * (1.18 + stage * 0.06) + 1.4) * range * 0.32;
    transform.x = THREE.MathUtils.clamp(pattern, world.arena.minX + 1.2, world.arena.maxX - 1.2);
    transform.y = world.arena.maxY - 1.25 + Math.sin(t * (0.8 + stage * 0.03)) * (0.22 + stage * 0.03);
    if (stage >= 5) {
      const scale = 1.18 + Math.sin(t * 1.8) * 0.05;
      transform.scaleX = scale;
      transform.scaleY = scale;
      transform.scaleZ = scale;
    } else {
      transform.scaleX = 1;
      transform.scaleY = 1;
      transform.scaleZ = 1;
    }
  }

  private updateShieldVisual(world: World, enabled: boolean): void {
    const render = world.renders.get(world.fabricatorEntity);
    if (!render || !(render.mesh instanceof THREE.Mesh)) {
      return;
    }
    const stage = world.currentStage;
    const stageBoost = stage === 1 ? 0.45 : stage === 2 ? 0.75 : stage === 3 ? 1 : stage === 4 ? 1.2 : 1.45;
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
        haloMat.opacity = 0.2 + Math.sin(time * 2.1) * 0.08 + stageBoost * 0.15;
      }
    }
    if (haloInner instanceof THREE.Mesh) {
      haloInner.rotation.z -= 0.015 * stageBoost;
      haloInner.rotation.y = Math.sin(time * 0.9) * 0.38;
      const haloMat = haloInner.material;
      if (haloMat instanceof THREE.MeshBasicMaterial) {
        haloMat.opacity = 0.18 + Math.cos(time * 2.8) * 0.07 + stageBoost * 0.12;
      }
    }
    if (orbA instanceof THREE.Mesh) {
      orbA.position.x = Math.cos(time * (1.4 + stage * 0.12)) * 1.9;
      orbA.position.y = Math.sin(time * (1.4 + stage * 0.12)) * 0.72;
    }
    if (orbB instanceof THREE.Mesh) {
      orbB.position.x = Math.cos(time * (1.4 + stage * 0.12) + Math.PI) * 1.9;
      orbB.position.y = Math.sin(time * (1.4 + stage * 0.12) + Math.PI) * 0.72;
    }
    if (coreLight instanceof THREE.PointLight) {
      coreLight.intensity = 1 + stageBoost * 0.6 + Math.sin(time * 3.2) * 0.35;
    }
  }

  private updateTrackingBeam(
    world: World,
    dt: number,
    boss: { beamFiring: boolean; beamTargetX: number }
  ): void {
    const beam = world.getEntitiesByRole('beam', false)[0];
    const tanker = world.transforms.get(world.tankerEntity);
    const beamTransform = beam ? world.transforms.get(beam) : undefined;
    const beamRender = beam ? world.renders.get(beam) : undefined;
    if (!tanker || !beamTransform || !beamRender) {
      return;
    }

    if (!boss.beamFiring || world.phase !== 'playing') {
      beamRender.mesh.visible = false;
      return;
    }

    beamRender.mesh.visible = true;
    boss.beamTargetX = THREE.MathUtils.lerp(boss.beamTargetX, tanker.x, 0.08);
    beamTransform.x = boss.beamTargetX;

    this.beamTickMs -= dt * 1000;
    const period = world.currentStage >= 5 ? 160 : 240;
    if (this.beamTickMs <= 0) {
      this.beamTickMs = period;
      if (Math.abs(tanker.x - boss.beamTargetX) < 0.95) {
        world.applyDamage(world.tankerEntity, world.currentStage >= 5 ? 6 : 4);
        world.feedbackQueue.push({ kind: 'hit', magnitude: 0.13, haptics: [25] });
      }
    }
  }

  private updateBossFire(world: World, dt: number, stage: 1 | 2 | 3 | 4 | 5): void {
    if (world.phase !== 'playing' || stage < 3) {
      return;
    }
    this.bossFireCooldownMs -= dt * 1000;
    this.obstacleDropCooldownMs -= dt * 1000;

    const bossTransform = world.transforms.get(world.fabricatorEntity);
    const tankerTransform = world.transforms.get(world.tankerEntity);
    if (!bossTransform || !tankerTransform) {
      return;
    }

    if (this.bossFireCooldownMs <= 0) {
      const cadence = stage === 3 ? 980 : stage === 4 ? 760 : 540;
      this.bossFireCooldownMs = cadence;
      const shots = stage >= 5 ? 3 : 2;
      for (let i = 0; i < shots; i += 1) {
        const spread = (i - (shots - 1) * 0.5) * (stage >= 5 ? 0.35 : 0.2);
        const dx = tankerTransform.x + spread - bossTransform.x;
        const dy = tankerTransform.y - bossTransform.y;
        const mag = Math.hypot(dx, dy) || 1;
        world.queueSpawn({
          key: 'enemyBullet',
          role: 'enemyBullet',
          x: bossTransform.x + spread * 0.6,
          y: bossTransform.y - 0.8,
          vx: (dx / mag) * (stage >= 5 ? 8.6 : 7.4),
          vy: Math.min(-5.8, (dy / mag) * (stage >= 5 ? 8.6 : 7.4))
        });
      }
    }

    if (stage >= 3 && this.obstacleDropCooldownMs <= 0) {
      this.obstacleDropCooldownMs = stage === 3 ? 2300 : stage === 4 ? 1700 : 1100;
      world.queueSpawn({
        key: 'obstacle',
        role: 'obstacle',
        x: bossTransform.x + (Math.random() - 0.5) * 1.8,
        y: bossTransform.y - 0.7,
        vx: (Math.random() - 0.5) * (stage >= 5 ? 4.2 : 2.6),
        vy: -4.8 - stage * 0.7
      });
    }
  }

  private updateJets(world: World, stage: 1 | 2 | 3 | 4 | 5, dt: number): void {
    const jets = world.getEntitiesByRole('enemyJet', false);
    const bossTransform = world.transforms.get(world.fabricatorEntity);
    if (!bossTransform) {
      return;
    }

    if (stage < 4 || world.phase !== 'playing') {
      for (const jet of jets) {
        world.releaseToPool(jet);
      }
      return;
    }

    if (jets.filter((j) => world.isEntityActive(j)).length === 0) {
      for (const offset of [-1.15, 1.15]) {
        const jet = world.acquireFromPool('enemyJet');
        if (!jet) {
          continue;
        }
        const t = world.transforms.get(jet);
        const v = world.velocities.get(jet);
        const h = world.health.get(jet);
        if (!t || !v || !h) {
          continue;
        }
        t.x = bossTransform.x + offset;
        t.y = bossTransform.y - 1.7;
        v.vx = 0;
        v.vy = 0;
        h.max = 450;
        h.current = 450;
      }
    }

    const activeJets = world.getEntitiesByRole('enemyJet');
    for (let i = 0; i < activeJets.length; i += 1) {
      const jet = activeJets[i];
      const t = world.transforms.get(jet);
      if (!t) {
        continue;
      }
      const offset = i % 2 === 0 ? -1.25 : 1.25;
      const time = world.timeMs * 0.001;
      t.x = bossTransform.x + offset + Math.sin(time * 1.4 + i) * 0.35;
      t.y = bossTransform.y - 1.75 + Math.cos(time * 1.8 + i) * 0.12;

      const cd = (world.obstacleFireCooldownMs.get(jet) ?? 700) - dt * 1000;
      if (cd <= 0) {
        world.obstacleFireCooldownMs.set(jet, stage >= 5 ? 350 : 520);
        world.queueSpawn({
          key: 'enemyBullet',
          role: 'enemyBullet',
          x: t.x,
          y: t.y - 0.4,
          vx: (Math.random() - 0.5) * 2.2,
          vy: -7.2
        });
      } else {
        world.obstacleFireCooldownMs.set(jet, cd);
      }
    }
  }
}
