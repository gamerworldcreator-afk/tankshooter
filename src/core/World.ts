import type { BossComponent } from '../components/BossComponent';
import type { HealthComponent } from '../components/HealthComponent';
import type { PoolableComponent } from '../components/PoolableComponent';
import type { PulseFieldComponent } from '../components/PulseFieldComponent';
import type { RenderComponent } from '../components/RenderComponent';
import type { TransformComponent } from '../components/TransformComponent';
import type { VelocityComponent } from '../components/VelocityComponent';
import { gameStore } from '../store/gameStore';

export type EntityRole =
  | 'tanker'
  | 'fabricator'
  | 'bullet'
  | 'enemyBullet'
  | 'enemyJet'
  | 'obstacle'
  | 'debris'
  | 'subParticle'
  | 'pulseWave'
  | 'beam';

type ComponentUnion =
  | TransformComponent
  | VelocityComponent
  | HealthComponent
  | RenderComponent
  | PulseFieldComponent
  | BossComponent
  | PoolableComponent;

export interface FeedbackEvent {
  kind: 'hit' | 'kill' | 'explosion';
  magnitude: number;
  haptics?: number[];
}

export interface SpawnCommand {
  key: string;
  role: EntityRole;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttlMs?: number;
  scale?: number;
  tint?: number;
}

export interface System {
  readonly priority: number;
  readonly name: string;
  update(world: World, dt: number): void;
}

export class World {
  private nextEntity = 1;
  private systems: System[] = [];

  public readonly transforms = new Map<number, TransformComponent>();
  public readonly velocities = new Map<number, VelocityComponent>();
  public readonly health = new Map<number, HealthComponent>();
  public readonly renders = new Map<number, RenderComponent>();
  public readonly pulseFields = new Map<number, PulseFieldComponent>();
  public readonly bosses = new Map<number, BossComponent>();
  public readonly poolables = new Map<number, PoolableComponent>();

  public readonly entities = new Set<number>();
  public readonly roles = new Map<number, EntityRole>();
  public readonly pools = new Map<string, number[]>();
  public readonly hitboxes = new Map<number, { w: number; h: number }>();
  public readonly lifetimesMs = new Map<number, number>();
  public readonly angularVelocity = new Map<number, number>();
  public readonly obstacleSway = new Map<number, { amplitude: number; frequency: number; phase: number }>();
  public readonly obstacleFireCooldownMs = new Map<number, number>();

  public readonly spawnQueue: SpawnCommand[] = [];
  public readonly feedbackQueue: FeedbackEvent[] = [];
  public readonly deathQueue: number[] = [];

  public readonly input = {
    targetX: 0,
    moveAxisX: 0,
    useAxisControl: false,
    shootHeld: false,
    pulseRequested: false
  };

  public readonly arena = {
    minX: -8.15,
    maxX: 8.15,
    minY: -9.5,
    maxY: 9.5
  };

  public timeMs = 0;
  public score = 0;
  public unlimitedPowerMode = false;
  public phase: 'lobby' | 'countdown' | 'playing' | 'stageClear' | 'defeat' | 'victory' = 'lobby';
  public stageCountdownMs = 0;
  public currentStage: 1 | 2 | 3 | 4 | 5 = 1;
  public readonly maxStage = 5;
  public tankerEntity = -1;
  public fabricatorEntity = -1;

  public createEntity(role: EntityRole): number {
    const id = this.nextEntity;
    this.nextEntity += 1;
    this.entities.add(id);
    this.roles.set(id, role);
    return id;
  }

  public addComponent(entity: number, component: ComponentUnion): void {
    switch (component.type) {
      case 'Transform':
        this.transforms.set(entity, component);
        break;
      case 'Velocity':
        this.velocities.set(entity, component);
        break;
      case 'Health':
        this.health.set(entity, component);
        break;
      case 'Render':
        this.renders.set(entity, component);
        break;
      case 'PulseField':
        this.pulseFields.set(entity, component);
        break;
      case 'Boss':
        this.bosses.set(entity, component);
        break;
      case 'Poolable':
        this.poolables.set(entity, component);
        break;
      default:
        break;
    }
  }

  public registerSystem(system: System): void {
    this.systems.push(system);
    this.systems.sort((a, b) => a.priority - b.priority);
  }

  public registerPool(poolKey: string, entityIds: number[]): void {
    this.pools.set(poolKey, entityIds);
    for (const id of entityIds) {
      const poolable = this.poolables.get(id);
      if (poolable) {
        poolable.active = false;
      }
      const render = this.renders.get(id);
      if (render) {
        render.mesh.visible = false;
      }
    }
  }

  public acquireFromPool(poolKey: string): number | null {
    const ids = this.pools.get(poolKey);
    if (!ids) {
      return null;
    }
    for (const id of ids) {
      const poolable = this.poolables.get(id);
      if (poolable && !poolable.active) {
        poolable.active = true;
        const render = this.renders.get(id);
        if (render) {
          render.mesh.visible = true;
        }
        return id;
      }
    }
    return null;
  }

  public releaseToPool(entity: number): void {
    const poolable = this.poolables.get(entity);
    if (!poolable) {
      return;
    }
    poolable.active = false;
    this.lifetimesMs.delete(entity);
    this.angularVelocity.delete(entity);
    this.obstacleSway.delete(entity);
    this.obstacleFireCooldownMs.delete(entity);
    const velocity = this.velocities.get(entity);
    if (velocity) {
      velocity.vx = 0;
      velocity.vy = 0;
      velocity.vz = 0;
    }
    const render = this.renders.get(entity);
    if (render) {
      render.mesh.visible = false;
    }
  }

  public getEntitiesByRole(role: EntityRole, activeOnly = true): number[] {
    const result: number[] = [];
    for (const [entity, value] of this.roles) {
      if (value !== role) {
        continue;
      }
      if (activeOnly && !this.isEntityActive(entity)) {
        continue;
      }
      result.push(entity);
    }
    return result;
  }

  public queueSpawn(command: SpawnCommand): void {
    this.spawnQueue.push(command);
  }

  public isEntityActive(entity: number): boolean {
    const poolable = this.poolables.get(entity);
    return !poolable || poolable.active;
  }

  public applyDamage(entity: number, amount: number): void {
    const health = this.health.get(entity);
    if (!health || amount <= 0) {
      return;
    }
    health.current = Math.max(0, health.current - amount);
    if (entity === this.tankerEntity && this.unlimitedPowerMode) {
      return;
    }
    if (health.current <= 0) {
      this.deathQueue.push(entity);
    }
  }

  public addScore(points: number): void {
    if (points <= 0) {
      return;
    }
    this.score += points;
    gameStore.getState().addScore(points);
  }

  public tick(dt: number): void {
    this.timeMs += dt * 1000;
    if (this.phase === 'countdown') {
      this.stageCountdownMs = Math.max(0, this.stageCountdownMs - dt * 1000);
      if (this.stageCountdownMs <= 0) {
        this.phase = 'playing';
      }
    }
    for (const system of this.systems) {
      system.update(this, dt);
    }
  }
}
