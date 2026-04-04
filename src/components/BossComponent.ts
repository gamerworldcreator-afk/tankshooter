export interface BossComponent {
  type: 'Boss';
  stage: 1 | 2 | 3 | 4 | 5;
  shieldActive: boolean;
  beamTargetX: number;
  beamFiring: boolean;
}
