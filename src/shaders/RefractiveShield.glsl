uniform float uTime;
uniform float uIntensity;
varying vec3 vNormal;
varying vec2 vUv;

void main() {
  float fresnel = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
  float lines = abs(sin(vUv.x * 25.0 + uTime * 1.4) * cos(vUv.y * 25.0 - uTime * 1.1));
  vec3 base = mix(vec3(0.04, 0.12, 0.22), vec3(0.18, 0.62, 1.0), fresnel);
  base += vec3(0.12, 0.34, 0.85) * lines * uIntensity * 0.35;
  gl_FragColor = vec4(base, 0.62 + fresnel * 0.25);
}
