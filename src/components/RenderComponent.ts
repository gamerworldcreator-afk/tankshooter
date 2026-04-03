import type * as THREE from 'three';

export interface RenderComponent {
  type: 'Render';
  mesh: THREE.Object3D;
  bloomLayer: number;
}
