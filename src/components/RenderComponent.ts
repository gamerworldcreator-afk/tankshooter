import type * as THREE from 'three';

export interface RenderComponent {
  type: 'Render';
  mesh: THREE.Mesh;
  bloomLayer: number;
}
