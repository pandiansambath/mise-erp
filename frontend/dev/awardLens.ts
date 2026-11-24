// How the award room is photographed, on a desktop: the scene drawn in high range
// to a picture, bright things (flames, gold, sparks) blooming a little, edges
// smoothed, and the whole developed to the screen with a fine grain that keeps the
// long dark gradients from banding. Cheaper than the canvas's own multisampling
// (8 ms of 20 on his laptop's GPU), and it looks more like a film than a game.
//
// A phone draws straight to its canvas: multisampling is nearly free there.

import type { Camera, Scene, WebGLRenderer, WebGLRenderTarget } from "three";
import type { T3 } from "./awardHall";

export type Lens = {
  size: (w: number, h: number) => void;
  /** Its own shaders, built in the background. */
  warm: () => Promise<void>;
  /** The scene's shaders are built for what it draws into. */
  bind: () => void;
  /** The scene drawn very small: its textures and shapes sent, nothing shown. */
  touch: (scene: Scene, camera: Camera) => void;
  draw: (scene: Scene, camera: Camera, t: number) => void;
  dispose: () => void;
};

const QUAD = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Null where the browser cannot draw in high range. */
export function buildLens(THREE: T3, renderer: WebGLRenderer): Lens | null {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  if (!gl.getExtension("EXT_color_buffer_float")) return null;
  // Eleven, eleven and ten bits: high range in the memory of an ordinary picture
  // (half floats are read at half speed by an integrated GPU).
  const rt = (w: number, h: number, depth: boolean) =>
    new THREE.WebGLRenderTarget(w, h, { format: THREE.RGBFormat, type: THREE.HalfFloatType, internalFormat: "R11F_G11F_B10F", depthBuffer: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  const full = rt(4, 4, true);
  let tiny: WebGLRenderTarget | null = null;
  const LEVELS = 4;
  const down: WebGLRenderTarget[] = Array.from({ length: LEVELS }, () => rt(4, 4, false));
  const up: WebGLRenderTarget[] = Array.from({ length: LEVELS - 1 }, () => rt(4, 4, false));
  const scene = new THREE.Scene();
  const cam = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const make = (frag: string, uniforms: Record<string, { value: unknown }>) => new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false, uniforms, vertexShader: QUAD, fragmentShader: frag });

  // The bright part, a quarter of the size; a single hot pixel does not flicker.
  const bright = make(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
    vec4 s(vec2 o) {
      vec3 c = min(texture2D(tSrc, vUv + o * uPx).rgb, vec3(14.0));
      float l = max(c.r, max(c.g, c.b));
      float k = clamp(l - 0.62, 0.0, 0.9);
      c *= max(k * k * 0.55, l - 1.06) / max(l, 1e-4);
      return vec4(c, 1.0) / (1.0 + max(c.r, max(c.g, c.b)) * 0.35);
    }
    void main() {
      vec4 a = s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0));
      gl_FragColor = vec4(a.rgb / max(a.a, 1e-4), 1.0);
    }`,
    { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } },
  );
  const half = make(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
      c += texture2D(tSrc, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(1.0, -1.0)).rgb;
      c += texture2D(tSrc, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(c / 8.0, 1.0);
    }`,
    { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } },
  );
  const grow = make(
    /* glsl */ `
    precision highp float;
    uniform sampler2D tSrc, tAdd; uniform vec2 uPx; varying vec2 vUv;
    void main() {
      vec3 c = vec3(0.0);
      c += texture2D(tSrc, vUv + uPx * vec2(-2.0, 0.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(2.0, 0.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(0.0, -2.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(0.0, 2.0)).rgb;
      c += 2.0 * (texture2D(tSrc, vUv + uPx * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(1.0, 1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uPx * vec2(1.0, -1.0)).rgb);
      gl_FragColor = vec4(c / 12.0 * 0.9 + texture2D(tAdd, vUv).rgb, 1.0);
    }`,
    { tSrc: { value: null }, tAdd: { value: null }, uPx: { value: new THREE.Vector2() } },
  );
  const develop = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tSrc: { value: full.texture }, tBloom: { value: up[0].texture }, uPx: { value: new THREE.Vector2() }, uT: { value: 0 } },
    vertexShader: QUAD,
    fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tSrc, tBloom; uniform vec2 uPx; uniform float uT; varying vec2 vUv;
    vec3 C(vec2 uv) { vec3 c = texture2D(tSrc, uv).rgb; return c / (1.0 + max(c.r, max(c.g, c.b))); }
    float L(vec3 c) { return sqrt(dot(c, vec3(0.299, 0.587, 0.114))); }
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main() {
      vec3 m = C(vUv);
      float lM = L(m);
      float nw = L(C(vUv + uPx * vec2(-1.0, 1.0))), ne = L(C(vUv + uPx * vec2(1.0, 1.0)));
      float sw = L(C(vUv + uPx * vec2(-1.0, -1.0))), se = L(C(vUv + uPx * vec2(1.0, -1.0)));
      float lo = min(lM, min(min(nw, ne), min(sw, se))), hi = max(lM, max(max(nw, ne), max(sw, se)));
      vec3 c = m;
      if (hi - lo > max(0.045, hi * 0.16)) {
        vec2 d = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
        float r = max((nw + ne + sw + se) * 0.03125, 0.0078125);
        d = clamp(d / (min(abs(d.x), abs(d.y)) + r), -7.0, 7.0) * uPx;
        vec3 a = 0.5 * (C(vUv - d * 0.16667) + C(vUv + d * 0.16667));
        vec3 b = a * 0.5 + 0.25 * (C(vUv - d * 0.5) + C(vUv + d * 0.5));
        float lb = L(b);
        c = lb < lo || lb > hi ? a : b;
      }
      // What is fine in the stone, a little finer.
      float round4 = (nw + ne + sw + se) * 0.25;
      c *= 1.0 + clamp((lM - round4) / max(round4, 0.04), -0.5, 0.5) * 0.42 * (1.0 - smoothstep(0.12, 0.36, hi - lo));
      c = c / max(1.0 - max(c.r, max(c.g, c.b)), 0.02);
      c += texture2D(tBloom, vUv).rgb * 0.5;
      vec2 q = vUv - 0.5;
      c *= 1.0 - 0.34 * smoothstep(0.2, 0.85, dot(q, q) * 2.0);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (hash(gl_FragCoord.xy + fract(uT) * 61.0) - 0.5) * 0.0135;
    }`,
  });

  const pass = (mat: InstanceType<T3["ShaderMaterial"]>, to: WebGLRenderTarget | null) => {
    quad.material = mat;
    renderer.setRenderTarget(to);
    renderer.render(scene, cam);
  };
  return {
    size: (w, h) => {
      const W = Math.max(2, Math.round(w));
      const H = Math.max(2, Math.round(h));
      full.setSize(W, H);
      let x = W / 4;
      let y = H / 4;
      for (let i = 0; i < LEVELS; i++) {
        down[i].setSize(Math.max(2, Math.round(x)), Math.max(2, Math.round(y)));
        if (i < LEVELS - 1) up[i].setSize(Math.max(2, Math.round(x)), Math.max(2, Math.round(y)));
        x /= 2;
        y /= 2;
      }
      (develop.uniforms.uPx.value as { set: (x: number, y: number) => void }).set(1 / W, 1 / H);
    },
    bind: () => renderer.setRenderTarget(full),
    touch: (s, c) => {
      tiny ??= rt(32, 18, true);
      renderer.setRenderTarget(tiny);
      renderer.render(s, c);
      renderer.setRenderTarget(null);
    },
    warm: async () => {
      const jobs: Promise<unknown>[] = [];
      const ready = (sc: Scene, cm: Camera, to: WebGLRenderTarget | null) => {
        renderer.setRenderTarget(to);
        jobs.push(renderer.compileAsync(sc, cm).catch(() => {}));
      };
      for (const m of [bright, half, grow, develop]) {
        const one = new THREE.Scene();
        const q = new THREE.Mesh(quad.geometry, m);
        one.add(q);
        ready(one, cam, m === develop ? null : down[0]);
      }
      renderer.setRenderTarget(null);
      await Promise.all(jobs);
    },
    draw: (s, c, t) => {
      renderer.setRenderTarget(full);
      renderer.render(s, c);
      bright.uniforms.tSrc.value = full.texture;
      bright.uniforms.uPx.value.set(1 / full.width, 1 / full.height);
      pass(bright, down[0]);
      for (let i = 1; i < LEVELS; i++) {
        half.uniforms.tSrc.value = down[i - 1].texture;
        half.uniforms.uPx.value.set(0.5 / down[i].width, 0.5 / down[i].height);
        pass(half, down[i]);
      }
      for (let i = LEVELS - 2; i >= 0; i--) {
        const src = i === LEVELS - 2 ? down[LEVELS - 1] : up[i + 1];
        grow.uniforms.tSrc.value = src.texture;
        grow.uniforms.tAdd.value = down[i].texture;
        grow.uniforms.uPx.value.set(0.5 / src.width, 0.5 / src.height);
        pass(grow, up[i]);
      }
      develop.uniforms.uT.value = t;
      pass(develop, null);
    },
    dispose: () => {
      full.dispose();
      tiny?.dispose();
      down.forEach((x) => x.dispose());
      up.forEach((x) => x.dispose());
      [bright, half, grow, develop].forEach((m) => m.dispose());
      quad.geometry.dispose();
    },
  };
}
