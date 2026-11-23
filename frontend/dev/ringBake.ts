// The finale's ring on a phone: its metal worked out once (§102.7).
//
// Drawn sharp — the screen's own resolution, anti-aliased — the ring's chrome
// (a thin film's rainbow, a clear coat, the room's reflections, three lights)
// cost a phone's GPU about three times what the blurry one had. As for the
// spine (spineBake.ts), everything but the lights depends only on which way
// the metal faces the camera, so it is drawn once per theme, in each of the
// four colours round the ring, and looked up. And its twenty-two links, which
// were twenty-two draws with a material each, are one.

import type * as THREE_NS from "three";
import { LOBE, capTarget, facingSheet, film } from "./spineBake";

type T = typeof THREE_NS;

const VERT = /* glsl */ `
  attribute vec4 aWeight;
  attribute vec3 aGlow;
  varying vec3 vNw;
  varying vec3 vPw;
  varying vec4 vWeight;
  varying vec3 vGlow;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vNw = mat3(m) * normal;
    vPw = wp.xyz;
    vWeight = aWeight;
    vGlow = aGlow;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */ `
  uniform sampler2D uCap0, uCap1, uCap2, uCap3, uFilm;
  uniform float uRough, uCoat, uCoatRough;
  uniform vec3 uLP[3];
  uniform vec3 uLC[3];
  uniform float uLD[3];
  varying vec3 vNw;
  varying vec3 vPw;
  varying vec4 vWeight;
  varying vec3 vGlow;
  ${LOBE}
  void main() {
    vec3 n = normalize(vNw);
    vec3 v = normalize(cameraPosition - vPw);
    vec3 ns = normalize((viewMatrix * vec4(n, 0.0)).xyz);
    vec3 vs = normalize((viewMatrix * vec4(v, 0.0)).xyz);
    vec3 x = normalize(vec3(vs.z, 0.0, -vs.x));
    vec3 y = cross(vs, x);
    vec2 uv = vec2(dot(x, ns), dot(y, ns)) * 0.495 + 0.5;
    float nv = clamp(dot(n, v), 0.001, 1.0);
    vec3 col = texture2D(uCap0, uv).rgb * vWeight.x + texture2D(uCap1, uv).rgb * vWeight.y + texture2D(uCap2, uv).rgb * vWeight.z + texture2D(uCap3, uv).rgb * vWeight.w;
    vec3 f = texture2D(uFilm, vec2(nv, 0.125)).rgb * vWeight.x + texture2D(uFilm, vec2(nv, 0.375)).rgb * vWeight.y + texture2D(uFilm, vec2(nv, 0.625)).rgb * vWeight.z + texture2D(uFilm, vec2(nv, 0.875)).rgb * vWeight.w;
    vec3 dn = max(abs(dFdx(n)), abs(dFdy(n)));
    float grain = max(max(dn.x, dn.y), dn.z);
    float a = pow(min(1.0, uRough + grain), 2.0);
    float ac = pow(min(1.0, uCoatRough + grain), 2.0);
    float coat = uCoat * (0.04 + 0.96 * pow(1.0 - nv, 5.0));
    for (int i = 0; i < 3; i++) {
      vec3 to = uLP[i] - vPw;
      float d = length(to);
      vec3 ld = to / d;
      float nl = dot(n, ld);
      if (nl <= 0.0) continue;
      float cut = clamp(1.0 - pow(d / uLD[i], 4.0), 0.0, 1.0);
      vec3 lc = uLC[i] * (cut * cut / max(d * d, 0.01));
      vec3 h = normalize(ld + v);
      float nh = clamp(dot(n, h), 0.0, 1.0);
      float vh = clamp(dot(v, h), 0.0, 1.0);
      col += lc * nl * (f * lobe(a, nl, nv, nh) * (1.0 - coat) + uCoat * (0.04 + 0.96 * pow(1.0 - vh, 5.0)) * lobe(ac, nl, nv, nh));
    }
    gl_FragColor = vec4(col + vGlow * (1.0 - coat), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export type BakedRing = {
  mesh: THREE_NS.InstancedMesh;
  /** A link: where it is (hidden: not drawn), and the light it gives off. */
  set: (i: number, o: THREE_NS.Object3D, glow: THREE_NS.Color, strength: number) => void;
  flush: () => void;
  /** The four colours round the ring, the room, and which way the camera looks. */
  bake: (room: THREE_NS.Texture, stops: THREE_NS.Color[], camera: THREE_NS.Camera) => void;
  warm: (room: THREE_NS.Texture, camera: THREE_NS.Camera) => Promise<void>;
  dispose: () => void;
};

export function bakedRing(
  THREE: T,
  renderer: THREE_NS.WebGLRenderer,
  geo: THREE_NS.BufferGeometry,
  metal: THREE_NS.MeshPhysicalMaterial,
  count: number,
  lights: THREE_NS.PointLight[],
): BakedRing {
  const caps = [0, 1, 2, 3].map(() => capTarget(THREE, 256));
  const FN = 64;
  const filmData = new Uint8Array(FN * 4 * 4);
  const filmTex = new THREE.DataTexture(filmData, FN, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
  filmTex.minFilter = filmTex.magFilter = THREE.LinearFilter;
  const sheet = facingSheet(THREE);
  const scene = new THREE.Scene();
  const copy = metal.clone();
  copy.roughness = metal.roughness + 0.03;
  copy.clearcoatRoughness = metal.clearcoatRoughness + 0.03;
  const face = new THREE.Mesh(sheet, copy);
  face.frustumCulled = false;
  scene.add(face);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCap0: { value: caps[0].texture },
      uCap1: { value: caps[1].texture },
      uCap2: { value: caps[2].texture },
      uCap3: { value: caps[3].texture },
      uFilm: { value: filmTex },
      uRough: { value: metal.roughness },
      uCoat: { value: metal.clearcoat },
      uCoatRough: { value: metal.clearcoatRoughness },
      uLP: { value: lights.map((l) => l.position) },
      uLC: { value: lights.map(() => new THREE.Color()) },
      uLD: { value: lights.map((l) => l.distance) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
  const own = geo.clone();
  const weight = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  const glow = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  glow.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < count; i++) {
    const u = (i / count) * 4;
    const k = Math.floor(u) % 4;
    const f = u - Math.floor(u);
    const w = [0, 0, 0, 0];
    w[k] = 1 - f;
    w[(k + 1) % 4] += f;
    weight.setXYZW(i, w[0], w[1], w[2], w[3]);
  }
  own.setAttribute("aWeight", weight);
  own.setAttribute("aGlow", glow);
  const mesh = new THREE.InstancedMesh(own, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const none = new THREE.Matrix4().makeScale(0, 0, 0);

  const look = (camera: THREE_NS.Camera) => {
    // Facing as the ring's own camera does: the room is reflected as it sees it.
    cam.quaternion.copy(camera.quaternion);
    face.quaternion.copy(camera.quaternion);
    cam.position.set(0, 0, 5).applyQuaternion(camera.quaternion);
  };
  return {
    mesh,
    set(i, o, color, strength) {
      if (o.visible) {
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      } else mesh.setMatrixAt(i, none);
      glow.setXYZ(i, color.r * strength, color.g * strength, color.b * strength);
    },
    flush() {
      mesh.instanceMatrix.needsUpdate = true;
      glow.needsUpdate = true;
    },
    bake(room, stops, camera) {
      scene.environment = room;
      look(camera);
      const was = renderer.getRenderTarget();
      stops.slice(0, 4).forEach((c, n) => {
        copy.color.copy(c);
        renderer.setRenderTarget(caps[n]);
        renderer.render(scene, cam);
        for (let i = 0; i < FN; i++) {
          const f = film((i + 0.5) / FN, metal.iridescenceIOR, metal.iridescenceThicknessRange[1], [c.r, c.g, c.b]);
          for (let k = 0; k < 3; k++) filmData[(n * FN + i) * 4 + k] = Math.round(f[k] * 255);
          filmData[(n * FN + i) * 4 + 3] = 255;
        }
      });
      renderer.setRenderTarget(was);
      filmTex.needsUpdate = true;
      (mat.uniforms.uLC.value as THREE_NS.Color[]).forEach((c, i) => c.copy(lights[i].color).multiplyScalar(lights[i].intensity));
    },
    async warm(room, camera) {
      scene.environment = room;
      look(camera);
      await renderer.compileAsync(scene, cam);
    },
    dispose() {
      caps.forEach((t) => t.dispose());
      filmTex.dispose();
      sheet.dispose();
      own.dispose();
      copy.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
