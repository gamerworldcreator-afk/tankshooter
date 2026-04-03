uniform float uTime;
uniform float uRadius;
uniform float uIntensity;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 pos = position;
  float dist = distance(uv, vec2(0.5));
  float ring = smoothstep(uRadius - 0.08, uRadius, dist) *
               (1.0 - smoothstep(uRadius, uRadius + 0.08, dist));
  pos.z += sin(dist * 28.0 - uTime * 12.0) * ring * uIntensity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
