"use client";

// The water under the orbit's chips.
//
//   "those skills small small cards revolving my photo… even those small cards
//    also we need to have that wave water liquid kind we have in the big
//    card… mostly it's small so it won't be visible, but still we need to do…
//    these are all perfect detailing, like we follow the same consistent
//    animation in all cards" (22 Nov)
//
// One small WebGL canvas behind the whole orbit draws, under every chip, a
// pill of the cards' water — the theme's painted texture in two sheets
// drifting against each other, on dark glass, with a hairline rim in the
// chip's own colour. One draw call for all of them (instanced quads), placed
// every frame by the orbit's own loop. The chips themselves become glass over
// it. It sits under the portrait, so a chip passing behind him takes its water
// with it, and over the back of the rings.

import type * as THREE_NS from "three";
import { paintLiquid } from "./liquid";
import { readRGB, THEME_EVENT } from "./theme";
import { guardCanvas } from "./glGuard";

type Three = typeof THREE_NS;

export class OrbitWater {
  private THREE: Three | null = null;
  private renderer: THREE_NS.WebGLRenderer | null = null;
  private scene: THREE_NS.Scene | null = null;
  private camera: THREE_NS.OrthographicCamera | null = null;
  private mat: THREE_NS.ShaderMaterial | null = null;
  private mesh: THREE_NS.InstancedMesh | null = null;
  private aCenter: Float32Array;
  private aSize: Float32Array;
  private aAlpha: Float32Array;
  private aHue: Float32Array;
  private aSeed: Float32Array;
  private attrs: THREE_NS.InstancedBufferAttribute[] = [];
  private texture: THREE_NS.Texture | null = null;
  private dead = false;
  private w = 0;
  private h = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private count: number,
  ) {
    this.aCenter = new Float32Array(count * 2);
    this.aSize = new Float32Array(count * 2);
    this.aAlpha = new Float32Array(count);
    this.aHue = new Float32Array(count * 3);
    this.aSeed = new Float32Array(count);
    for (let i = 0; i < count; i++) this.aSeed[i] = Math.random() * 10;
  }

  /** False when there is no WebGL (the chips keep their plain glass). */
  async init(): Promise<boolean> {
    const THREE = await import("three");
    if (this.dead) return false;
    this.THREE = THREE;
    let renderer: THREE_NS.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, powerPreference: "low-power", premultipliedAlpha: true });
    } catch {
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    // Taken away by the browser (a phone's few contexts): hide, never white.
    this.unguard = guardCanvas(this.canvas);
    this.scene = new THREE.Scene();
    // CSS pixels, y down: (0, 0) is the canvas's top-left corner.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    geo.setAttribute("uv", quad.getAttribute("uv"));
    const mk = (arr: Float32Array, n: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      this.attrs.push(a);
      return a;
    };
    geo.setAttribute("aCenter", mk(this.aCenter, 2));
    geo.setAttribute("aSize", mk(this.aSize, 2));
    geo.setAttribute("aAlpha", mk(this.aAlpha, 1));
    geo.setAttribute("aHue", mk(this.aHue, 3));
    geo.setAttribute("aSeed", mk(this.aSeed, 1));
    geo.instanceCount = this.count;

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uLiquid: { value: null },
        uTime: { value: 0 },
        uGlass: { value: new THREE.Color(0.05, 0.07, 0.1) },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aCenter, aSize;
        attribute float aAlpha, aSeed;
        attribute vec3 aHue;
        varying vec2 vP, vSize, vWorld;
        varying float vAlpha, vSeed;
        varying vec3 vHue;
        void main() {
          vP = position.xy * aSize;
          vSize = aSize;
          vWorld = aCenter + vP;
          vAlpha = aAlpha;
          vSeed = aSeed;
          vHue = aHue;
          gl_Position = projectionMatrix * vec4(aCenter + vec2(position.x, -position.y) * aSize, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uLiquid;
        uniform float uTime;
        uniform vec3 uGlass;
        varying vec2 vP, vSize, vWorld;
        varying float vAlpha, vSeed;
        varying vec3 vHue;
        void main() {
          // A pill: the chip's own shape.
          float r = min(vSize.x, vSize.y) * 0.5;
          vec2 q = abs(vP) - (vSize * 0.5 - r);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
          float inside = smoothstep(0.75, -0.75, sd);
          if (inside <= 0.0) discard;
          // The cards' water: two sheets drifting against each other.
          vec2 u1 = vWorld / 210.0 + vec2(0.05 * sin(uTime * 0.13 + vSeed), 0.04 * cos(uTime * 0.11 + vSeed)) + vSeed * 0.37;
          vec2 u2 = -vWorld / 180.0 + vec2(-0.04 * cos(uTime * 0.09 + vSeed), 0.05 * sin(uTime * 0.12)) + vSeed * 0.21;
          vec4 A = texture2D(uLiquid, u1);
          vec4 B = texture2D(uLiquid, u2);
          vec3 water = 1.0 - (1.0 - A.rgb * A.a) * (1.0 - B.rgb * B.a * 0.6);
          float wA = clamp(max(A.a, B.a * 0.6) * 1.35, 0.0, 1.0);
          vec3 col = mix(uGlass, uGlass * 0.55 + water, 0.5 * wA);
          // A hairline rim in the chip's colour.
          col = mix(col, vHue, smoothstep(1.4, 0.0, abs(sd + 0.9)) * 0.55);
          float a = 0.62 * inside * vAlpha;
          gl_FragColor = vec4(col * a, a);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.count);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.paint();
    window.addEventListener(THEME_EVENT, this.onTheme);
    return true;
  }

  private onTheme = () => {
    window.setTimeout(() => this.paint(), 140);
  };

  private paint() {
    const THREE = this.THREE;
    if (!THREE || !this.mat) return;
    const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
    const [r, g, b] = readRGB(root, "bg2", [11, 17, 24]);
    (this.mat.uniforms.uGlass.value as THREE_NS.Color).setRGB(r / 255, g / 255, b / 255);
    const url = paintLiquid(root);
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (this.dead || !this.mat) return;
      const tex = new THREE.Texture(img);
      tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
      tex.needsUpdate = true;
      this.texture?.dispose();
      this.texture = tex;
      this.mat.uniforms.uLiquid.value = tex;
    };
    img.src = url;
  }

  resize(w: number, h: number) {
    if (!this.renderer || !this.camera || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.left = 0;
    this.camera.right = w;
    this.camera.top = 0;
    this.camera.bottom = h;
    this.camera.updateProjectionMatrix();
  }

  /** One chip: its centre in canvas px, its drawn size, opacity and colour. */
  set(i: number, x: number, y: number, w: number, h: number, alpha: number, hue: [number, number, number]) {
    this.aCenter[i * 2] = x;
    this.aCenter[i * 2 + 1] = y;
    this.aSize[i * 2] = w;
    this.aSize[i * 2 + 1] = h;
    this.aAlpha[i] = alpha;
    this.aHue[i * 3] = hue[0];
    this.aHue[i * 3 + 1] = hue[1];
    this.aHue[i * 3 + 2] = hue[2];
  }

  render(time: number) {
    if (!this.renderer || !this.scene || !this.camera || !this.mat || !this.mat.uniforms.uLiquid.value) return;
    for (const a of this.attrs) a.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
    this.renderer.render(this.scene, this.camera);
  }

  private unguard = () => {};

  dispose() {
    this.dead = true;
    this.unguard();
    window.removeEventListener(THEME_EVENT, this.onTheme);
    this.mesh?.geometry.dispose();
    this.mat?.dispose();
    this.texture?.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
  }
}
