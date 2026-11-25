// The coin, drawn by itself (§107.3: "in mobile it's so clear to read… in laptop not that much
// clear… if I stop and see that coin it needs to be so clear in high resolution that I can
// literally see every minute detailing inside that coin… put separate effort for [the] coin").
//
// On a desktop the room goes through a lens (awardLens): drawn smaller than the screen where the
// graphics are slow, smoothed, sharpened, a bloom laid over it. Good for a hall at night; on the
// coin it took the edges of every letter. So the coin is not in that picture: it is drawn alone,
// with the same lights, at about twice the screen's own pixels, each of those developed by itself
// and only then put together — and laid over the finished picture as the screen's own pixels.

import type { Camera, Group, Light, Object3D, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import type { T3 } from "./awardHall";

/** Its own layer: the room's camera does not see it, its own sees nothing else. */
const LAYER = 1;
/** The largest it is drawn (pixels), and how many for each of the screen's. */
const MOST = 1280;
const FINE = 2;

export type CoinView = {
  /** Over the finished picture: the coin, whose middle is at x, y and whose radius is r (CSS px)
   *  on a canvas w by h (CSS px) of so many pixels each. */
  draw: (at: { x: number; y: number; r: number; w: number; h: number; ratio: number }) => void;
  /** Its shaders, built in the background for what they are drawn into. */
  warm: () => Promise<void>;
  dispose: () => void;
};

export function buildCoinView(THREE: T3, renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, coin: Group): CoinView {
  coin.traverse((o: Object3D) => o.layers.set(LAYER));
  scene.traverse((o) => {
    if ((o as Light).isLight) o.layers.enable(LAYER);
  });
  // (What it throws a shadow with, where the room's camera looks: a plain disc of its size.)
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.1, 48), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  disc.rotation.x = Math.PI / 2;
  disc.castShadow = true;
  coin.add(disc);

  const rt = new THREE.WebGLRenderTarget(MOST, MOST, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.scissorTest = true;
  const eye = new THREE.PerspectiveCamera();
  eye.layers.set(LAYER);
  const lay = new THREE.Scene();
  const cam = new THREE.Camera();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      tCoin: { value: rt.texture },
      /** Where it lies (NDC: middle, half size), its picture's own size and so many of its pixels
       *  for one of the screen's. */
      uBox: { value: new THREE.Vector4() },
      uSide: { value: 1 },
      uStep: { value: 2 },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uBox;
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(uBox.xy + position.xy * uBox.zw, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tCoin;
      uniform float uSide, uStep;
      varying vec2 vUv;
      // One of its pixels, as the screen will show it.
      vec4 one(vec2 p) {
        vec4 c = texture2D(tCoin, p / ${MOST.toFixed(1)});
        vec3 rgb = c.rgb / max(c.a, 1e-4);
        rgb = linearToOutputTexel(vec4(toneMapping(rgb), 1.0)).rgb;
        return vec4(rgb * c.a, c.a);
      }
      void main() {
        vec2 p = vUv * uSide;
        float q = uStep * 0.25;
        gl_FragColor = 0.25 * (one(p + vec2(-q, -q)) + one(p + vec2(q, -q)) + one(p + vec2(-q, q)) + one(p + vec2(q, q)));
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  lay.add(quad);

  return {
    draw({ x, y, r, w, h, ratio }) {
      // A little room round it, for its glints; whole pixels of the screen.
      const half = Math.ceil(r * 1.16 * ratio) / ratio;
      const x0 = Math.round((x - half) * ratio) / ratio;
      const y0 = Math.round((y - half) * ratio) / ratio;
      const across = 2 * half * ratio;
      const side = Math.max(8, Math.min(MOST, Math.round(across * FINE)));
      eye.copy(camera as PerspectiveCamera, false);
      eye.layers.set(LAYER);
      eye.setViewOffset(w, h, x0, y0, 2 * half, 2 * half);
      eye.updateMatrixWorld();
      rt.viewport.set(0, 0, side, side);
      rt.scissor.set(0, 0, side, side);
      const was = renderer.getRenderTarget();
      const ground = scene.background;
      const fog = scene.fog;
      const auto = renderer.shadowMap.autoUpdate;
      const need = renderer.shadowMap.needsUpdate;
      scene.background = null;
      scene.fog = null;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      const clear = renderer.getClearAlpha();
      renderer.setClearAlpha(0);
      renderer.setRenderTarget(rt);
      renderer.render(scene, eye);
      renderer.setClearAlpha(clear);
      scene.background = ground;
      scene.fog = fog;
      renderer.shadowMap.autoUpdate = auto;
      renderer.shadowMap.needsUpdate = need;
      mat.uniforms.uBox.value.set(((x0 + half) / w) * 2 - 1, 1 - ((y0 + half) / h) * 2, (half / w) * 2, (half / h) * 2);
      mat.uniforms.uSide.value = side;
      mat.uniforms.uStep.value = side / across;
      renderer.setRenderTarget(was);
      const clears = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(lay, cam as Camera);
      renderer.autoClear = clears;
    },
    warm: async () => {
      const was = renderer.getRenderTarget();
      const seen = coin.visible;
      coin.visible = true;
      renderer.setRenderTarget(rt);
      const jobs: Promise<unknown>[] = [renderer.compileAsync(coin, eye, scene).catch(() => {})];
      renderer.setRenderTarget(null);
      jobs.push(renderer.compileAsync(lay, cam as Camera).catch(() => {}));
      renderer.setRenderTarget(was);
      coin.visible = seen;
      await Promise.all(jobs);
    },
    dispose: () => {
      rt.dispose();
      mat.dispose();
      quad.geometry.dispose();
      disc.geometry.dispose();
      (disc.material as { dispose: () => void }).dispose();
    },
  };
}
