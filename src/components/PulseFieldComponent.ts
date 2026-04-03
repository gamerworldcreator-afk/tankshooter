export interface PulseFieldComponent {
  type: 'PulseField';
  radius: number;
  maxRadius: number;
  strength: number;
  active: boolean;
  cooldownMs: number;
}
