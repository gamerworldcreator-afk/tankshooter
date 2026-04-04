import * as THREE from 'three';
import type { System, World } from '../core/World';

export class BossEvolutionSystem implements System {
  public readonly priority = 6;
  public readonly name = 'BossEvolutionSystem';

  private beamTickMs = 0;
  private bossFireCooldownMs = 0;
  private obstacleDropCooldownMs = 0;
  private supportLaunchCooldownMs = 0;
  private retreatCycleMs = 7600;
  private readonly supportSlotByEntity = new Map<number, number>();

  public update(world: World, dt: number): void {
    const fabricator = world.fabricatorEntity;
    const boss = world.bosses.get(fabricator);
    if (!boss) {
      return;
    }

    boss.stage = world.currentStage;
    boss.shieldActive = world.currentStage >= 2;
    boss.beamFiring = world.currentStage >= 3;
    this.updateBossRetreatCycle(world, dt);

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
    const activeY = world.arena.maxY - 1.25 + Math.sin(t * (0.8 + stage * 0.03)) * (0.22 + stage * 0.03);
    if (world.bossRetreatMs > 0 && stage >= 3) {
      const retreatAlpha = Math.min(1, world.bossRetreatMs / 3200);
      transform.y = THREE.MathUtils.lerp(activeY, world.arena.maxY + 1.9, retreatAlpha);
    } else {
      transform.y = activeY;
    }
    if (stage < 3) {
      transform.scaleX = 1;
      transform.scaleY = 1;
      transform.scaleZ = 1;
      return;
    }

    const pulse = Math.sin(t * (1.8 + stage * 0.1));
    const breathe = Math.cos(t * (1.15 + stage * 0.06));
    const base = stage >= 5 ? 1.12 : stage === 4 ? 1.06 : 1.02;
    const uniform = base + pulse * 0.045;
    transform.scaleX = uniform + breathe * 0.016;
    transform.scaleY = uniform - breathe * 0.014;
    transform.scaleZ = uniform + pulse * 0.02;
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

    if (!boss.beamFiring || world.phase !== 'playing' || world.bossRetreatMs > 0) {
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
      const nearWall =
        tanker.x <= world.arena.minX + 0.18 ||
        tanker.x >= world.arena.maxX - 0.18;
      if (!nearWall && Math.abs(tanker.x - boss.beamTargetX) < 0.95) {
        world.applyDamage(world.tankerEntity, world.currentStage >= 5 ? 6 : 4);
        world.feedbackQueue.push({ kind: 'hit', magnitude: 0.13, haptics: [25] });
      }
    }
  }

  private updateBossFire(world: World, dt: number, stage: 1 | 2 | 3 | 4 | 5): void {
    if (world.phase !== 'playing' || stage < 3 || world.bossRetreatMs > 0) {
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
      const cadence = stage === 3 ? 1100 : stage === 4 ? 860 : 640;
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
      this.obstacleDropCooldownMs = stage === 3 ? 2400 : stage === 4 ? 1900 : 1450;
      world.queueSpawn({
        key: 'obstacle',
        role: 'obstacle',
        x: bossTransform.x + (Math.random() - 0.5) * 1.8,
        y: bossTransform.y - 0.7,
        vx: (Math.random() - 0.5) * 2.6,
        vy: -4.9 - Math.random() * 0.8
      });
    }
  }

  private updateJets(world: World, stage: 1 | 2 | 3 | 4 | 5, dt: number): void {
    const jets = world.getEntitiesByRole('enemyJet', false);
    const bossTransform = world.transforms.get(world.fabricatorEntity);
    if (!bossTransform) {
      return;
    }

    if (stage < 3 || world.phase !== 'playing') {
      for (const jet of jets) {
        world.releaseToPool(jet);
        this.supportSlotByEntity.delete(jet);
      }
      return;
    }

    const maxSupport = stage === 3 ? 3 : stage === 4 ? 4 : 5;
    const activeJetSet = new Set(world.getEntitiesByRole('enemyJet'));
    for (const [jet] of this.supportSlotByEntity) {
      if (!activeJetSet.has(jet)) {
        this.supportSlotByEntity.delete(jet);
      }
    }
    this.supportLaunchCooldownMs -= dt * 1000;
    const activeJets = world.getEntitiesByRole('enemyJet');
    if (activeJets.length < maxSupport && this.supportLaunchCooldownMs <= 0) {
      const jet = world.acquireFromPool('enemyJet');
      if (jet) {
        const t = world.transforms.get(jet);
        const v = world.velocities.get(jet);
        const h = world.health.get(jet);
        if (t && v && h) {
          const slot = this.getFirstOpenSlot(maxSupport);
          this.supportSlotByEntity.set(jet, slot);
          t.x = bossTransform.x + (Math.random() - 0.5) * 0.35;
          t.y = bossTransform.y - 0.3;
          t.scaleX = 0.74;
          t.scaleY = 0.74;
          t.scaleZ = 0.74;
          v.vx = 0;
          v.vy = 0;
          h.max = stage >= 5 ? 620 : stage === 4 ? 520 : 420;
          h.current = h.max;
          world.obstacleFireCooldownMs.set(jet, 900 + Math.random() * 700);
        }
      }
      this.supportLaunchCooldownMs = stage === 3 ? 2800 : stage === 4 ? 2200 : 1600;
    }

    const aliveJets = world.getEntitiesByRole('enemyJet');
    for (const jet of aliveJets) {
      const t = world.transforms.get(jet);
      if (!t) {
        continue;
      }
      const slot = this.supportSlotByEntity.get(jet) ?? 0;
      const spread = (slot - (maxSupport - 1) * 0.5) * 1.18;
      const time = world.timeMs * 0.001;
      const targetX = bossTransform.x + spread + Math.sin(time * 1.35 + slot * 0.7) * 0.6;
      const targetY = bossTransform.y - 2.1 - Math.abs(spread) * 0.12 + Math.cos(time * 2.2 + slot) * 0.22;
      t.x = THREE.MathUtils.lerp(t.x, targetX, 0.085);
      t.y = THREE.MathUtils.lerp(t.y, targetY, 0.092);
      const scale = 0.88 + Math.sin(time * 2.4 + slot) * 0.05;
      t.scaleX = scale;
      t.scaleY = scale;
      t.scaleZ = scale;

      const render = world.renders.get(jet);
      const mesh = render?.mesh;
      if (mesh) {
        const wingA = mesh.getObjectByName('enemyJetWingA');
        const wingB = mesh.getObjectByName('enemyJetWingB');
        if (wingA) {
          wingA.rotation.z += dt * 8.5;
        }
        if (wingB) {
          wingB.rotation.z -= dt * 8.5;
        }
      }

      const cd = (world.obstacleFireCooldownMs.get(jet) ?? 720) - dt * 1000;
      if (cd <= 0) {
        world.obstacleFireCooldownMs.set(jet, stage >= 5 ? 330 : stage === 4 ? 430 : 540);
        world.queueSpawn({
          key: 'enemyBullet',
          role: 'enemyBullet',
          x: t.x,
          y: t.y - 0.35,
          vx: Math.sin(time * 2.3 + slot) * 2.8,
          vy: -7.6
        });
      } else {
        world.obstacleFireCooldownMs.set(jet, cd);
      }
    }
  }

  private updateBossRetreatCycle(world: World, dt: number): void {
    if (world.currentStage < 3 || world.phase !== 'playing') {
      this.retreatCycleMs = 7600;
      return;
    }
    if (world.bossRetreatMs > 0) {
      return;
    }
    this.retreatCycleMs -= dt * 1000;
    if (this.retreatCycleMs <= 0) {
      world.bossRetreatMs = world.currentStage >= 5 ? 3600 : 3000;
      world.bossExposeMs = 4500;
      this.retreatCycleMs = world.currentStage >= 5 ? 6200 : 7600;
    }
  }

  private getFirstOpenSlot(maxSupport: number): number {
    for (let i = 0; i < maxSupport; i += 1) {
      if (![...this.supportSlotByEntity.values()].includes(i)) {
        return i;
      }
    }
    return 0;
  }
}
