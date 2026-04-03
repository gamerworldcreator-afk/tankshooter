export interface BossComponent {
  type: 'Boss';
  stage: 1 | 2 | 3;
  shieldActive: boolean;
  beamTargetX: number;
  beamFiring: boolean;
}
