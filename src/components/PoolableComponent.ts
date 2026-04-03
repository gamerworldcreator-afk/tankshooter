export interface PoolableComponent {
  type: 'Poolable';
  poolKey: string;
  active: boolean;
}
