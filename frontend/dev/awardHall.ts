// The hall the award's chest stands in (§103.5: "the cursor to act as a light in
// an ancient world… when I move the cursor the other dark area brightens… these
// kinds of small, small detailing").
//
// A dark temple chamber, and a light carried where you point. Nothing is painted
// bright: the back wall is a carved relief (its height baked offline, its normals
// made from it on the GPU), and a small warm light moves over it, raking across a
// great wheel, turned pilasters, marching elephants, and a verse of the Kural cut
// in the stone ("learning is the wealth that never perishes"); the chest and the
// hammer throw that light's real shadow across the room; the dust hangs bright
// only near it; a kolam lies drawn on the floor. Four oil lamps catch fire when
// the light comes near, and stay lit; with all four, the gold in the carvings
// wakes. The pointer itself is as it was.

import type { BufferGeometry, Camera, Mesh, Object3D, PerspectiveCamera, PointLight, Scene, ShaderMaterial, Texture, WebGLRenderer, WebGLRenderTarget, Vector3 } from "three";

export type T3 = typeof import("three");

export const FLOOR_Y = -1.15;
/** Where the wall stands. */
export const WALL_Z = -3.1;
// The carving: what of the wall its picture covers, and the depth of its 0–255.
const CARVE = { x0: -7, w: 14, y0: FLOOR_Y, h: 7, lo: -0.085, range: 0.42 };

/** A height field's normals, occlusion and height, made once on the GPU: RG the
 *  normal's x and y, B how open to the light, A the height (slopes true to its own
 *  width and depth). The picture is there at once, drawn when `ready`. */
export type Relief = { rt: WebGLRenderTarget; ready: Promise<void> };
export function reliefPass(THREE: T3, renderer: WebGLRenderer, height: Texture, o: { w: number; h: number; depth: number; width: number; tall: number; cavity: number }): Relief {
  height.generateMipmaps = true;
  height.minFilter = THREE.LinearMipmapLinearFilter;
  const rt = new THREE.WebGLRenderTarget(o.w, o.h, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()) });
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { tH: { value: height }, uPx: { value: new THREE.Vector2(1 / o.w, 1 / o.h) }, uK: { value: new THREE.Vector2((o.depth * o.w) / o.width, (o.depth * o.h) / o.tall) }, uC: { value: o.cavity } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tH; uniform vec2 uPx, uK; uniform float uC; varying vec2 vUv;
      float H(float x, float y) { return texture2D(tH, vUv + vec2(x, y) * uPx).r; }
      void main() {
        // A derivative over five texels: eight bits of height, no steps.
        float gx = 0.0, gy = 0.0;
        for (int i = -2; i <= 2; i++) {
          float w = i == 0 ? 0.375 : abs(float(i)) < 1.5 ? 0.25 : 0.0625;
          float k = float(i);
          gx += w * (2.0 * (H(1.0, k) - H(-1.0, k)) + (H(2.0, k) - H(-2.0, k)));
          gy += w * (2.0 * (H(k, 1.0) - H(k, -1.0)) + (H(k, 2.0) - H(k, -2.0)));
        }
        vec3 n = normalize(vec3(-gx * 0.125 * uK.x, -gy * 0.125 * uK.y, 1.0));
        float h = H(0.0, 0.0);
        float b = 0.5 * textureLod(tH, vUv, 3.0).r + 0.3 * textureLod(tH, vUv, 4.0).r + 0.2 * textureLod(tH, vUv, 5.0).r;
        float ao = clamp(1.0 - uC * (b - h), 0.0, 1.0);
        gl_FragColor = vec4(n.xy * 0.5 + 0.5, ao, h);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.Camera();
  // Its shader built in the background: a first use otherwise holds the page.
  renderer.setRenderTarget(rt);
  const built = renderer.compileAsync(scene, cam);
  renderer.setRenderTarget(null);
  const ready = built
    .catch(() => {})
    .then(() => {
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      quad.geometry.dispose();
      mat.dispose();
    });
  return { rt, ready };
}

// ── the shaders ──────────────────────────────────────────────────────────────

const VERT = /* glsl */ `
  varying vec3 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/** What lights the wall and the floor: the light you carry (with its shadow),
 *  four lamps, the gold when it is open, the shaft from above, a blow's flash. */
const LIGHTS = /* glsl */ `
  precision highp float;
  uniform vec3 uEye, uTorchP, uTorchC, uLampC, uInnerP, uInnerC, uFlashP, uFlashC, uAmb;
  uniform vec3 uLampP[4];
  uniform float uLampI[4];
  uniform float uRim, uShaft, uT, uOpen;
  uniform sampler2D tShadow;
  uniform mat4 uShadowM;
  uniform vec2 uNF;
  uniform float uShadowOn;
  varying vec3 vP;
  float lin(float d) { return uNF.x * uNF.y / (uNF.y - d * (uNF.y - uNF.x)); }
  float torchShadow(vec3 P) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 q = uShadowM * vec4(P, 1.0);
    if (q.w < 0.05) return 1.0;
    vec3 s = q.xyz / q.w * 0.5 + 0.5;
    vec2 e = min(s.xy, 1.0 - s.xy);
    if (min(e.x, e.y) <= 0.0) return 1.0;
    float me = lin(s.z);
    float a = 6.2832 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    float lit = 0.0;
    #if TAPS == 8
    vec2 P8[8];
    P8[0] = vec2(-0.71, -0.41); P8[1] = vec2(0.15, -0.95); P8[2] = vec2(0.79, -0.28); P8[3] = vec2(-0.27, 0.16);
    P8[4] = vec2(-0.94, 0.33); P8[5] = vec2(-0.1, 0.93); P8[6] = vec2(0.36, 0.36); P8[7] = vec2(0.84, 0.54);
    // Softer the further the shadow falls from what casts it.
    float block = 0.0, n = 0.0;
    for (int i = 0; i < 8; i += 2) { float z = lin(textureLod(tShadow, s.xy + R * P8[i] * 0.02, 0.0).r); if (z < me - 0.05) { block += z; n += 1.0; } }
    if (n < 0.5) return 1.0;
    block /= n;
    float r = clamp((me - block) / block * 0.02, 0.0016, 0.02);
    for (int i = 0; i < 8; i++) lit += step(me - 0.05, lin(textureLod(tShadow, s.xy + R * P8[i] * r, 0.0).r));
    lit *= 0.125;
    #else
    for (int i = 0; i < 4; i++) { float an = float(i) * 1.5708; lit += step(me - 0.06, lin(textureLod(tShadow, s.xy + R * vec2(cos(an), sin(an)) * 0.006, 0.0).r)); }
    lit *= 0.25;
    #endif
    return mix(1.0, lit, smoothstep(0.0, 0.06, min(e.x, e.y)));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  // Diffuse (xyz) and a highlight (w) from one light; soft keeps the spot
  // under it from burning out.
  vec4 from(vec3 P, vec3 N, vec3 V, vec3 at, float soft, float shin) {
    vec3 L = at - P;
    float d2 = dot(L, L);
    L *= inversesqrt(d2);
    float nl = max(dot(N, L), 0.0);
    float hi = pow(max(dot(N, normalize(L + V)), 0.0), shin) * step(0.0001, nl);
    return vec4(vec3(nl), hi) / (d2 + soft);
  }`;

const WALL_FRAG = /* glsl */ `
  uniform sampler2D tRelief, tGold, tStone, tStoneN, tGrain;
  uniform float uWake;
  vec4 relief(vec2 p) { return texture2D(tRelief, (p - vec2(${CARVE.x0.toFixed(1)}, ${CARVE.y0.toFixed(2)})) / vec2(${CARVE.w.toFixed(1)}, ${CARVE.h.toFixed(1)})); }
  float carved(vec2 p) { return textureLod(tRelief, (p - vec2(${CARVE.x0.toFixed(1)}, ${CARVE.y0.toFixed(2)})) / vec2(${CARVE.w.toFixed(1)}, ${CARVE.h.toFixed(1)}), 0.0).a; }
  float deep(float a) { return ${CARVE.lo.toFixed(3)} + a * ${CARVE.range.toFixed(2)}; }
  void main() {
    vec3 V = normalize(uEye - vP);
    // The carving stands out of the plane: seen where it stands.
    vec2 p = vP.xy;
    vec2 sl = V.xy / max(V.z, 0.35);
    p += sl * deep(relief(p).a);
    vec4 re = relief(p);
    float h = deep(re.a);
    vec3 P = vec3(p, vP.z + h);
    vec2 suv = p / 2.9 + vec2(0.13, 0.31);
    vec3 alb = texture2D(tStone, suv).rgb;
    alb = alb * alb * vec3(0.86, 0.72, 0.56);
    vec3 sn = texture2D(tStoneN, suv).xyz * 2.0 - 1.0;
    vec3 gr = texture2D(tGrain, p * 0.83).xyz * 2.0 - 1.0;
    float cut = smoothstep(0.015, 0.05, abs(h));
    vec3 N = normalize(vec3((re.rg * 2.0 - 1.0) * 1.12 + sn.xy * mix(0.75, 0.3, cut) + gr.xy * 0.34, max(0.12, sqrt(max(0.0, 1.0 - dot(re.rg * 2.0 - 1.0, re.rg * 2.0 - 1.0))))));
    float ao = re.b * re.b;
    float gold = texture2D(tGold, (p - vec2(${CARVE.x0.toFixed(1)}, ${CARVE.y0.toFixed(2)})) / vec2(${CARVE.w.toFixed(1)}, ${CARVE.h.toFixed(1)})).r * step(abs(p.x), 6.98);
    gold *= 0.75 + 0.25 * noise(p * 60.0);
    // Dust and damp gather low and in the hollows.
    alb *= 0.72 + 0.4 * noise(p * 1.7 + 3.0) * noise(p * 5.1);
    alb = mix(alb, alb * vec3(0.5, 0.56, 0.5), 0.5 * smoothstep(-0.2, -1.15, p.y) * noise(p * 3.0));
    float shin = mix(14.0, 46.0, gold);
    vec4 t = from(P, N, V, uTorchP, 0.32, shin);
    float sh = 1.0;
    // Only where the carried light reaches: its shadow, and the relief's own,
    // marched across it towards the light.
    if (t.x * uTorchC.x > 0.006) {
    sh = torchShadow(P);
    #if MARCH > 0
    vec3 Lt = uTorchP - P;
    float ll = length(Lt.xy);
    vec2 dir = Lt.xy / max(ll, 1e-3);
    float rise = Lt.z / max(ll, 1e-3);
    float far = min(ll, 0.36 / max(rise, 0.08));
    float occ = 0.0;
    float j = hash(gl_FragCoord.xy);
    for (int i = 0; i < MARCH; i++) {
      float s = far * (float(i) + 0.35 + 0.6 * j) / float(MARCH);
      float over = deep(carved(p + dir * s)) - (h + s * rise);
      occ = max(occ, over / (0.012 + s * 0.09));
    }
    sh *= 1.0 - smoothstep(0.1, 1.0, occ) * 0.92;
    #endif
    }
    vec3 dif = uTorchC * t.xyz * sh;
    vec3 spe = uTorchC * t.w * sh;
    for (int i = 0; i < 4; i++) {
      if (uLampI[i] < 0.004) continue;
      vec4 l = from(P, N, V, uLampP[i], 0.5, shin);
      dif += uLampC * uLampI[i] * l.xyz;
      spe += uLampC * uLampI[i] * l.w;
    }
    if (uInnerC.x > 0.001) {
      vec4 inn = from(P, N, V, uInnerP, 0.6, shin);
      float out_ = smoothstep(-0.1, 0.55, (P.y - uRim) / max(0.4, distance(P.xy, uInnerP.xy)));
      dif += uInnerC * inn.xyz * out_;
      spe += uInnerC * inn.w * out_;
    }
    if (uFlashC.x > 0.001) dif += uFlashC * from(P, N, V, uFlashP, 0.3, shin).xyz;
    vec3 ga = vec3(0.86, 0.56, 0.16);
    vec3 col = mix(alb, ga * 0.3, gold * 0.85) * (dif + uAmb * (0.6 + 0.4 * N.y)) * ao;
    col += (mix(vec3(0.02), ga * 1.5, gold)) * spe * ao;
    // Awake: gold light spreads from the wheel's hub out along the inlay.
    float r = length(p - vec2(0.0, 0.95));
    float front = uWake * 8.0;
    float on = smoothstep(front, front - 0.8, r);
    float edge = exp(-pow((r - front) * 2.2, 2.0)) * step(0.001, uWake) * step(uWake, 0.999);
    col += gold * vec3(1.0, 0.54, 0.14) * (0.45 + 0.75 * ao) * (on * (0.36 + 0.1 * sin(uT * 1.7 - r * 2.0)) + edge * 2.0);
    // What is far off to the sides is lost in the dark.
    col *= 1.0 - 0.55 * smoothstep(6.0, 9.5, abs(p.x));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const FLOOR_FRAG = /* glsl */ `
  uniform sampler2D tFloor, tFloorN, tFloorA;
  uniform float uWake, uFace;
  uniform vec2 uFar;
  float ln(float d, float w) { float a = fwidth(d) + 0.0012; return 1.0 - smoothstep(w - a, w + a, abs(d)); }
  // The kolam: drawn in rice flour round the chest, one line that never lifts.
  float kolam(vec2 q) {
    float r = length(q);
    if (r < 1.7 || r > 3.75) return 0.0;
    float a = atan(q.y, q.x);
    float m = 0.0;
    float w = 0.0125;
    float s1 = 2.42 + 0.3 * sin(a * 9.0), s2 = 2.42 - 0.3 * sin(a * 9.0);
    float k1 = inversesqrt(1.0 + pow(0.3 * 9.0 * cos(a * 9.0) / r, 2.0));
    m = max(m, ln((r - s1) * k1, w));
    m = max(m, ln((r - s2) * k1, w));
    float s3 = 2.42 + 0.46 * cos(a * 9.0);
    float k3 = inversesqrt(1.0 + pow(0.46 * 9.0 * sin(a * 9.0) / r, 2.0));
    m = max(m, ln((r - s3) * k3, w * 0.8));
    // its dots
    float ad = (fract(a * 18.0 / 6.28318 + 0.5) - 0.5) * 6.28318 / 18.0;
    m = max(m, 1.0 - smoothstep(0.03, 0.04, length(vec2(ad * 2.42, r - 2.42))));
    float ae = (fract(a * 9.0 / 6.28318 + 0.25) - 0.5) * 6.28318 / 9.0;
    m = max(m, 1.0 - smoothstep(0.02, 0.028, length(vec2(ae * 2.0, r - 2.0))));
    m = max(m, ln(r - 1.86, w * 0.8));
    m = max(m, ln(r - 3.0, w));
    m = max(m, ln(r - 3.06, w * 0.6));
    // petals round it
    float b = fract(a * 36.0 / 6.28318) - 0.5;
    float pr = 3.06 + 0.34 * pow(max(0.0, 1.0 - pow(abs(b) * 2.0, 2.4)), 0.6);
    m = max(m, ln(r - pr, w * 0.9) * step(3.07, r));
    float b2 = fract(a * 36.0 / 6.28318 + 0.5) - 0.5;
    m = max(m, (1.0 - smoothstep(0.022, 0.03, length(vec2(b2 * 6.28318 / 36.0 * 3.46, r - 3.46)))));
    return m;
  }
  void main() {
    vec3 V = normalize(uEye - vP);
    vec2 uv = mat2(0.9928, -0.1197, 0.1197, 0.9928) * vP.xz * 0.2;
    vec3 alb = texture2D(tFloor, uv).rgb;
    alb = alb * alb * vec3(0.72, 0.62, 0.5);
    vec3 tn = texture2D(tFloorN, uv).xyz * 2.0 - 1.0;
    vec3 N = normalize(vec3(tn.x * 0.95, 1.0, -tn.y * 0.95));
    float ao = texture2D(tFloorA, uv).r;
    float worn = noise(vP.xz * 7.0) * 0.55 + noise(vP.xz * 23.0) * 0.45;
    float kc = cos(uFace), ks = sin(uFace);
    float kl = kolam(mat2(kc, -ks, ks, kc) * vP.xz) * smoothstep(0.16, 0.5, worn + 0.12);
    alb = mix(alb, vec3(0.62, 0.58, 0.5), kl * 0.8);
    vec4 t = from(vP, N, V, uTorchP, 0.32, 22.0);
    float sh = 1.0;
    if (t.x * uTorchC.x > 0.006) sh = torchShadow(vP);
    vec3 dif = uTorchC * t.xyz * sh;
    vec3 spe = uTorchC * t.w * sh;
    for (int i = 0; i < 4; i++) {
      if (uLampI[i] < 0.004) continue;
      vec4 l = from(vP, N, V, uLampP[i], 0.5, 22.0);
      dif += uLampC * uLampI[i] * l.xyz;
      spe += uLampC * uLampI[i] * l.w;
    }
    // The shaft from above: a pool of pale light round the chest.
    float pool = exp(-dot(vP.xz, vP.xz) * 0.16);
    dif += vec3(0.66, 0.72, 0.86) * uShaft * pool * max(N.y, 0.0);
    // When it is open, gold light thrown round it.
    float gr = length(vP.xz);
    dif += uInnerC * 0.05 * smoothstep(1.2, 2.4, gr) * exp(-gr * 0.35);
    if (uFlashC.x > 0.001) dif += uFlashC * from(vP, N, V, uFlashP, 0.3, 22.0).xyz;
    // Under the chest, and out to the walls, it is dark.
    float dark = smoothstep(0.2, 1.25, length(vP.xz * vec2(0.72, 1.05)));
    float corner = smoothstep(0.0, 0.7, vP.z - (${WALL_Z.toFixed(2)}));
    vec3 col = alb * (dif + uAmb) * ao * (0.12 + 0.88 * dark) * (0.35 + 0.65 * corner);
    col += 0.05 * spe * ao * dark;
    col += vec3(1.0, 0.72, 0.32) * kl * uWake * 0.16 * (0.7 + 0.3 * sin(uT * 1.6 - gr * 3.0));
    col *= 1.0 - smoothstep(uFar.x, uFar.y, length(vP.xz - vec2(0.0, 1.0)));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const FLAME_VERT = /* glsl */ `
  attribute vec3 iAt; attribute vec2 iWho;
  uniform float uT; uniform float uLampI[4]; uniform vec2 uSize;
  varying vec2 vUv; varying float vI, vS;
  void main() {
    vUv = vec2(position.x, position.y * 0.5 + 0.5);
    vS = iWho.x;
    int k = int(iWho.y + 0.5);
    vI = k == 0 ? uLampI[0] : k == 1 ? uLampI[1] : k == 2 ? uLampI[2] : uLampI[3];
    vec4 mv = viewMatrix * vec4(iAt, 1.0);
    float grow = 0.3 + 0.7 * vI;
    mv.xy += vec2(position.x * uSize.x, (position.y * 0.5 + 0.5) * uSize.y * 1.0) * grow;
    gl_Position = projectionMatrix * mv;
  }`;
const FLAME_FRAG = /* glsl */ `
  precision highp float;
  uniform float uT; varying vec2 vUv; varying float vI, vS;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
  void main() {
    if (vI < 0.01) discard;
    float y = vUv.y;
    float t = uT * 2.1 + vS * 37.0;
    float sway = (n1(t) - 0.5) * 0.7 * y * y + (n1(t * 2.7 - y * 3.0) - 0.5) * 0.34 * y;
    float tall = 0.86 + 0.14 * n1(t * 1.4 + 9.0);
    float v = y / tall;
    float w = 0.62 * pow(max(0.0, sin(3.14159 * pow(clamp(v, 0.0, 1.0), 0.52))), 0.9) * (1.0 - 0.42 * v);
    float d = abs(vUv.x - sway) / max(w, 0.02);
    float body = smoothstep(1.0, 0.25, d) * step(v, 1.0);
    float core = smoothstep(0.75, 0.0, d) * smoothstep(0.0, 0.25, v) * smoothstep(1.0, 0.45, v);
    float blue = smoothstep(0.2, 0.0, v) * body;
    vec3 c = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.82, 0.42), core) * body;
    c += vec3(1.0, 0.95, 0.8) * pow(core, 2.0) * 0.8;
    c = mix(c, vec3(0.2, 0.36, 1.0) * 0.5 * body, blue * 0.7);
    float halo = exp(-dot(vec2(vUv.x - sway * 0.5, (y - 0.36) * 1.2), vec2(vUv.x - sway * 0.5, (y - 0.36) * 1.2)) * 4.2) * 0.22;
    c += vec3(1.0, 0.6, 0.2) * halo;
    float a = clamp(body + halo, 0.0, 1.0);
    gl_FragColor = vec4(c * vI * 1.5, a * vI);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uT, uFocal, uPool;
  uniform vec3 uTorchP, uTorchC, uTorchV, uLampC;
  uniform vec3 uLampP[4]; uniform float uLampI[4];
  varying float vB;
  void main() {
    vec3 p = vec3((aSeed.x - 0.5) * 11.0, ${FLOOR_Y.toFixed(2)} + fract(aSeed.y + uT * 0.006 * (0.4 + aSeed.w)) * 5.2, mix(-2.6, 2.8, aSeed.z));
    p.x += sin(uT * 0.11 + aSeed.w * 40.0) * 0.35 + sin(uT * 0.31 + aSeed.y * 23.0) * 0.12;
    p.z += cos(uT * 0.09 + aSeed.x * 31.0) * 0.3;
    // Stirred by the light going past.
    vec3 d = p - uTorchP;
    float near = exp(-dot(d, d) * 1.1);
    p += uTorchV * near * 0.3 + vec3(-d.y, d.x, 0.0) * near * 0.1;
    d = p - uTorchP;
    float b = dot(uTorchC, vec3(0.33)) * 0.055 / (dot(d, d) + 0.1);
    for (int i = 0; i < 4; i++) { vec3 e = p - uLampP[i]; b += uLampI[i] * 0.06 / (dot(e, e) + 0.2); }
    b += uPool * 0.2 * exp(-dot(p.xz, p.xz) * 0.5);
    vB = min(1.0, b * 1.9) * (0.35 + 0.65 * fract(aSeed.w * 7.3 + 0.2 * sin(uT * 0.6 + aSeed.x * 60.0)));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp((0.008 + 0.02 * aSeed.w * aSeed.w) * uFocal / -mv.z, 1.0, 14.0);
  }`;
const DUST_FRAG = /* glsl */ `
  precision highp float;
  varying float vB;
  void main() {
    float m = smoothstep(0.5, 0.05, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vec3(1.0, 0.8, 0.5) * m * vB, m * vB);
  }`;

// The oil lamp's outline, turned on a lathe: radius, height.
const LAMP: [number, number][] = [
  [0, 0], [0.3, 0], [0.315, 0.012], [0.315, 0.03], [0.3, 0.05], [0.25, 0.06], [0.24, 0.085], [0.16, 0.12], [0.09, 0.16], [0.06, 0.2], [0.055, 0.235], [0.086, 0.252], [0.098, 0.28], [0.086, 0.308], [0.05, 0.325], [0.042, 0.36], [0.04, 0.5], [0.064, 0.514], [0.078, 0.54], [0.064, 0.566], [0.042, 0.58],
  [0.039, 0.74], [0.062, 0.754], [0.076, 0.78], [0.062, 0.806], [0.042, 0.82], [0.046, 0.9], [0.1, 0.93], [0.2, 0.955], [0.268, 0.985], [0.29, 1.012], [0.287, 1.024], [0.262, 1.016], [0.15, 0.99], [0.05, 0.985], [0.034, 1], [0.03, 1.08], [0.05, 1.094], [0.06, 1.116], [0.05, 1.138], [0.028, 1.15], [0.022, 1.2], [0.047, 1.226], [0.043, 1.262], [0.018, 1.3], [0.008, 1.35], [0, 1.372],
];
const BOWL: [number, number][] = [[0, -0.13], [0.016, -0.125], [0.034, -0.1], [0.026, -0.075], [0.05, -0.06], [0.11, -0.02], [0.2, 0.03], [0.25, 0.07], [0.254, 0.084], [0.232, 0.078], [0.12, 0.048], [0, 0.044]];

/** The wall's carving, as its normals (once). */
export const carveWall = (THREE: T3, renderer: WebGLRenderer, height: Texture, phone: boolean) =>
  reliefPass(THREE, renderer, height, { w: phone ? 2048 : 2560, h: phone ? 1024 : 1280, depth: CARVE.range, width: CARVE.w, tall: CARVE.h, cavity: 5.5 });

export type HallFiles = { relief: WebGLRenderTarget; wallGold: Texture; stone: Texture; stoneN: Texture; floorD: Texture; floorN: Texture; floorA: Texture };

export type Hall = {
  /** The light you carry. */
  torch: PointLight;
  /** Where it is meant to be; it follows. */
  want: Vector3;
  /** How bright it is (0 at first: it wakes). */
  power: { value: number; want: number };
  /** Something that throws the light's shadow. */
  casts: (o: Object3D) => void;
  lamps: { at: Vector3; lit: number; on: boolean }[];
  ignite: (i: number) => boolean;
  /** 0…1: the gold in the carvings, awake. */
  wake: { value: number; on: boolean };
  /** Each frame, before the scene is drawn. */
  step: (dt: number, t: number, s: { open: number; inner: number; innerAt: Vector3; rim: number; flash: number; flashAt: Vector3; face: number; shaft: number }) => void;
  /** The light's shadow, drawn from where it is. */
  shadow: () => void;
  fit: (o: { half: (z: number) => number; focal: number; tall: boolean }) => void;
  dispose: () => void;
};

export function buildHall(THREE: T3, o: { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; phone: boolean; lite: boolean; env: Texture; files: HallFiles; target: Vector3 }): Hall {
  const { renderer, scene, camera, phone, lite, files: f } = o;
  const trash: { dispose: () => void }[] = [];
  const keep = <X extends { dispose: () => void }>(x: X): X => {
    trash.push(x);
    return x;
  };
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const tx of [f.stone, f.stoneN, f.floorD, f.floorN, f.floorA]) {
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    // (The wall is seen square on; the floor, almost along it.)
    tx.anisotropy = tx === f.stone || tx === f.stoneN ? 2 : aniso;
  }
  // (Squared in the shader, near enough: read as plain numbers.)
  f.wallGold.anisotropy = 2;
  const relief = keep(f.relief);
  relief.texture.wrapS = THREE.MirroredRepeatWrapping;
  relief.texture.anisotropy = 2;

  // ── the light's shadow ─────────────────────────────────────────────────────
  const shadowsOn = !lite;
  const SZ = phone ? 512 : 1024;
  const depth = new THREE.DepthTexture(SZ, SZ);
  depth.minFilter = depth.magFilter = THREE.NearestFilter;
  const shadowRT = keep(new THREE.WebGLRenderTarget(SZ, SZ, { depthTexture: depth, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }));
  const NF = new THREE.Vector2(0.12, 16);
  const shadowCam = new THREE.PerspectiveCamera(90, 1, NF.x, NF.y);
  const shadowScene = new THREE.Scene();
  const shadowMat = keep(new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  const pairs: { from: Mesh; to: Mesh }[] = [];
  const casts = (root: Object3D) => {
    root.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      const to = new THREE.Mesh(m.geometry as BufferGeometry, shadowMat);
      to.matrixAutoUpdate = false;
      to.matrixWorldAutoUpdate = false;
      to.frustumCulled = false;
      shadowScene.add(to);
      pairs.push({ from: m, to });
    });
  };
  const shadowM = new THREE.Matrix4();
  const aim = new THREE.Vector3();
  const seen = (m: Object3D): boolean => {
    for (let p: Object3D | null = m; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const shadow = () => {
    if (!shadowsOn) return;
    shadowCam.position.copy(torch.position);
    aim.copy(o.target);
    const d = Math.max(0.8, shadowCam.position.distanceTo(aim));
    const fov = Math.min(130, Math.max(34, (2 * Math.atan(2.1 / d) * 180) / Math.PI));
    if (Math.abs(shadowCam.fov - fov) > 0.2) {
      shadowCam.fov = fov;
      shadowCam.updateProjectionMatrix();
    }
    shadowCam.lookAt(aim);
    shadowCam.updateMatrixWorld();
    shadowM.multiplyMatrices(shadowCam.projectionMatrix, shadowCam.matrixWorldInverse);
    for (const { from, to } of pairs) {
      to.visible = seen(from);
      to.matrixWorld.copy(from.matrixWorld);
    }
    const auto = renderer.shadowMap.autoUpdate;
    const needs = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(shadowRT);
    renderer.clear();
    renderer.render(shadowScene, shadowCam);
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = auto;
    renderer.shadowMap.needsUpdate = needs;
  };

  // ── what every surface of the hall is lit by ───────────────────────────────
  const lampAt = Array.from({ length: 4 }, () => new THREE.Vector3(0, -50, 0));
  const lampI = new Float32Array(4);
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const U = {
    uEye: { value: camera.position },
    uTorchP: { value: V3(0, 0.6, 2) },
    uTorchC: { value: V3() },
    uTorchV: { value: V3() },
    uLampC: { value: V3(1.0, 0.56, 0.22).multiplyScalar(1.15) },
    uLampP: { value: lampAt },
    uLampI: { value: lampI },
    uInnerP: { value: V3() },
    uInnerC: { value: V3() },
    uFlashP: { value: V3() },
    uFlashC: { value: V3() },
    uAmb: { value: V3(0.019, 0.0195, 0.025) },
    uRim: { value: 0 },
    uShaft: { value: 0 },
    uT: { value: 0 },
    uOpen: { value: 0 },
    uWake: { value: 0 },
    uFace: { value: 0 },
    tShadow: { value: depth as Texture },
    uShadowM: { value: shadowM },
    uNF: { value: NF },
    uShadowOn: { value: shadowsOn ? 1 : 0 },
    uFocal: { value: 1000 },
    uFar: { value: new THREE.Vector2(5.5, 9) },
    uPool: { value: 0 },
  };
  const defines = { TAPS: phone ? 4 : 8, MARCH: lite ? 0 : phone ? 3 : 9 };
  const wallMat = keep(
    new THREE.ShaderMaterial({
      defines,
      uniforms: { ...U, tRelief: { value: relief.texture }, tGold: { value: f.wallGold }, tStone: { value: f.stone }, tStoneN: { value: f.stoneN }, tGrain: { value: f.floorN } },
      vertexShader: VERT,
      fragmentShader: LIGHTS + WALL_FRAG,
    }),
  );
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(21, 10)), wallMat);
  wall.position.set(0, FLOOR_Y + 5, WALL_Z);
  wall.renderOrder = 2;
  scene.add(wall);
  const floorMat = keep(
    new THREE.ShaderMaterial({
      defines,
      uniforms: { ...U, tFloor: { value: f.floorD }, tFloorN: { value: f.floorN }, tFloorA: { value: f.floorA } },
      vertexShader: VERT,
      fragmentShader: LIGHTS + FLOOR_FRAG,
    }),
  );
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(21, 20)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, WALL_Z + 10);
  floor.renderOrder = 1;
  scene.add(floor);

  // ── the light itself: warm, never quite still ──────────────────────────────
  const torch = new THREE.PointLight(0xffb066, 0, 7.5, 1.9);
  torch.position.set(0, 0.5, 2.2);
  scene.add(torch);
  const want = torch.position.clone();
  const power = { value: 0, want: 1 };
  const wispTex = keep(softTexture(THREE, 128));
  const wispMat = keep(new THREE.SpriteMaterial({ map: wispTex, color: 0xffb060, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
  const wisp = new THREE.Sprite(wispMat);
  scene.add(wisp);

  // ── four oil lamps: two stand by the chest, two hang ───────────────────────
  const brass = keep(new THREE.MeshStandardMaterial({ color: 0xb98a42, metalness: 1, roughness: 0.34, envMap: o.env, envMapIntensity: 0.55 }));
  const turned = (prof: [number, number][], seg: number, y0: number, y1: number) => {
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    // Five lips for five wicks.
    const p = g.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < y0 || y > y1) continue;
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 0.12) continue;
      const k = 1 + 0.17 * Math.max(0, Math.cos(Math.atan2(z, x) * 5)) ** 5 * Math.min(1, (r - 0.12) / 0.12);
      p.setXYZ(i, x * k, y + (k - 1) * 0.16, z * k);
    }
    g.computeVertexNormals();
    return keep(g);
  };
  const standG = turned(LAMP, phone ? 40 : 64, 0.95, 1.05);
  const bowlG = turned(BOWL, phone ? 36 : 56, 0.0, 0.1);
  const linkG = keep(new THREE.TorusGeometry(0.026, 0.0075, 6, 12));
  const rodG = keep(new THREE.CylinderGeometry(0.006, 0.006, 1, 6));
  type Lamp = { group: InstanceType<T3["Group"]>; at: Vector3; lit: number; on: boolean; wicks: Vector3[]; hang: boolean; seed: number };
  const lamps: Lamp[] = [];
  const LINKS = 26;
  for (let i = 0; i < 4; i++) {
    const hang = i > 1;
    const group = new THREE.Group();
    group.add(new THREE.Mesh(hang ? bowlG : standG, brass));
    const wicks = Array.from({ length: 5 }, (_, k) => {
      const a = (k / 5) * Math.PI * 2;
      const r = hang ? 0.262 : 0.302;
      return V3(Math.cos(a) * r, hang ? 0.098 : 1.04, Math.sin(a) * r);
    });
    if (hang) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + 0.3;
        const from = V3(Math.cos(a) * 0.23, 0.08, Math.sin(a) * 0.23);
        const to = V3(0, 0.56, 0);
        const rod = new THREE.Mesh(rodG, brass);
        rod.position.copy(from).lerp(to, 0.5);
        rod.scale.y = from.distanceTo(to);
        rod.quaternion.setFromUnitVectors(V3(0, 1, 0), to.clone().sub(from).normalize());
        group.add(rod);
      }
      const chain = new THREE.InstancedMesh(linkG, brass, LINKS);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let k = 0; k < LINKS; k++) {
        q.setFromEuler(new THREE.Euler(0, k % 2 ? Math.PI / 2 : 0, 0));
        m4.compose(V3(0, 0.59 + k * 0.043, 0), q, V3(0.8, 1.25, 0.8));
        chain.setMatrixAt(k, m4);
      }
      chain.frustumCulled = false;
      group.add(chain);
    } else casts(group);
    scene.add(group);
    lamps.push({ group, at: lampAt[i], lit: 0, on: false, wicks, hang, seed: i * 7.3 });
  }
  // Their flames.
  const quad = new THREE.PlaneGeometry(2, 2);
  const flameG = keep(new THREE.InstancedBufferGeometry());
  flameG.index = quad.index;
  flameG.setAttribute("position", quad.getAttribute("position"));
  const flameAt = new Float32Array(20 * 3);
  const flameWho = new Float32Array(20 * 2);
  for (let i = 0; i < 20; i++) {
    flameWho[i * 2] = Math.random();
    flameWho[i * 2 + 1] = Math.floor(i / 5);
  }
  const flameAtA = new THREE.InstancedBufferAttribute(flameAt, 3);
  flameG.setAttribute("iAt", flameAtA);
  flameG.setAttribute("iWho", new THREE.InstancedBufferAttribute(flameWho, 2));
  flameG.instanceCount = 20;
  const flameMat = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { uT: U.uT, uLampI: U.uLampI, uSize: { value: new THREE.Vector2(0.1, 0.27) } },
      vertexShader: FLAME_VERT,
      fragmentShader: FLAME_FRAG,
    }),
  );
  const flames = new THREE.Mesh(flameG, flameMat);
  flames.frustumCulled = false;
  flames.renderOrder = 6;
  scene.add(flames);
  // A bloom of light round each.
  const halos = lamps.map(() => {
    const m = keep(new THREE.SpriteMaterial({ map: wispTex, color: 0xff9a3c, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    const s = new THREE.Sprite(m);
    s.renderOrder = 5;
    scene.add(s);
    return { s, m };
  });

  // ── the dust in the air, seen only where there is light ────────────────────
  const DUST = lite ? 90 : phone ? 220 : 620;
  const dustG = keep(new THREE.BufferGeometry());
  dustG.setAttribute("position", new THREE.BufferAttribute(new Float32Array(DUST * 3), 3));
  dustG.setAttribute("aSeed", new THREE.BufferAttribute(Float32Array.from({ length: DUST * 4 }, () => Math.random()), 4));
  const dustMat = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: U.uT, uFocal: U.uFocal, uPool: U.uPool, uTorchP: U.uTorchP, uTorchC: U.uTorchC, uTorchV: U.uTorchV, uLampC: U.uLampC, uLampP: U.uLampP, uLampI: U.uLampI },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
    }),
  );
  const dust = new THREE.Points(dustG, dustMat);
  dust.frustumCulled = false;
  dust.renderOrder = 7;
  scene.add(dust);

  // ── the shaft from above ───────────────────────────────────────────────────
  const shaftMat = keep(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      uniforms: { uT: U.uT, uA: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() { vUv = uv; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uT, uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float face = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float bands = 0.72 + 0.28 * sin(vUv.x * 53.0 + uT * 0.12) * sin(vUv.x * 21.0 - uT * 0.09);
          float a = face * bands * smoothstep(0.02, 0.5, vUv.y) * uA;
          gl_FragColor = vec4(vec3(0.72, 0.78, 0.92) * a, a);
        }`,
    }),
  );
  const shaft = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.55, 2.1, 7.4, 40, 1, true)), shaftMat);
  shaft.position.set(0, FLOOR_Y + 3.7, 0);
  shaft.renderOrder = 4;
  scene.add(shaft);

  const wake = { value: 0, on: false };
  const ignite = (i: number): boolean => {
    const l = lamps[i];
    if (!l || l.on) return false;
    l.on = true;
    return true;
  };
  const prev = torch.position.clone();
  const tmp = V3();

  const step: Hall["step"] = (dt, t, s) => {
    U.uT.value = t;
    // It follows you, a little behind, as a thing carried does.
    const k = 1 - Math.exp(-dt * 10);
    torch.position.lerp(want, k);
    power.value += (power.want - power.value) * (1 - Math.exp(-dt * 2.2));
    const flick = 0.93 + 0.05 * Math.sin(t * 11.3) * Math.sin(t * 7.1) + 0.04 * Math.sin(t * 23.7 + Math.sin(t * 5));
    const pw = power.value * flick;
    U.uTorchP.value.copy(torch.position);
    U.uTorchP.value.y += Math.sin(t * 9) * 0.006;
    U.uTorchC.value.set(1.0, 0.6, 0.27).multiplyScalar(3.1 * pw);
    U.uTorchV.value.lerp(tmp.copy(torch.position).sub(prev).divideScalar(Math.max(dt, 0.008)).clampLength(0, 5), 1 - Math.exp(-dt * 6));
    prev.copy(torch.position);
    torch.intensity = 5.6 * pw;
    wisp.position.copy(torch.position);
    wisp.scale.setScalar(0.9 + 0.06 * Math.sin(t * 13));
    wispMat.opacity = 0.13 * pw;

    for (let i = 0; i < 4; i++) {
      const l = lamps[i];
      if (l.on && l.lit < 1) l.lit = Math.min(1, l.lit + dt * 1.6);
      const up = l.lit * l.lit * (3 - 2 * l.lit);
      const over = 1 + 0.5 * Math.sin(Math.min(1, l.lit) * Math.PI) * (l.lit < 1 ? 1 : 0);
      const fl = 0.9 + 0.1 * Math.sin(t * 8.3 + l.seed) * Math.sin(t * 5.9 + l.seed * 2);
      lampI[i] = up * over * fl;
      if (l.hang) l.group.rotation.set(Math.sin(t * 0.8 + l.seed) * 0.018, l.seed, Math.sin(t * 0.63 + l.seed * 1.7) * 0.026);
      else l.group.rotation.y = l.seed;
      l.group.updateMatrixWorld(true);
      for (let w = 0; w < 5; w++) {
        tmp.copy(l.wicks[w]).applyMatrix4(l.group.matrixWorld);
        flameAt.set([tmp.x, tmp.y, tmp.z], (i * 5 + w) * 3);
      }
      l.at.set(0, l.hang ? 0.26 : 1.16, 0).applyMatrix4(l.group.matrixWorld);
      halos[i].s.position.copy(l.at);
      halos[i].s.scale.setScalar(1.7);
      halos[i].m.opacity = 0.2 * lampI[i];
      halos[i].s.visible = lampI[i] > 0.01;
    }
    flameAtA.needsUpdate = true;

    if (wake.on) wake.value = Math.min(1, wake.value + dt * 0.34);
    U.uWake.value = wake.value;
    U.uOpen.value = s.open;
    U.uInnerP.value.copy(s.innerAt);
    U.uInnerC.value.set(1.0, 0.62, 0.22).multiplyScalar(s.inner * 0.52);
    U.uRim.value = s.rim;
    U.uFlashP.value.copy(s.flashAt);
    U.uFlashC.value.set(1.0, 0.66, 0.36).multiplyScalar(s.flash * 0.7);
    U.uFace.value = s.face;
    U.uShaft.value = 0.34 * s.shaft;
    U.uPool.value = s.shaft;
    shaftMat.uniforms.uA.value = 0.24 * s.shaft * (1 - 0.5 * s.open);
  };

  return {
    torch,
    want,
    power,
    casts,
    lamps,
    ignite,
    wake,
    step,
    shadow,
    fit: ({ half, focal, tall }) => {
      U.uFocal.value = focal;
      U.uFar.value.set(tall ? 8 : 5.5, tall ? 14 : 9);
      // Inside the frame whatever its shape; on a tall screen the hanging ones
      // go up, over the wheel.
      const sx = Math.min(2.55, half(-1.2) - 0.42);
      lamps[0].group.position.set(-sx, FLOOR_Y, -1.2);
      lamps[1].group.position.set(sx, FLOOR_Y, -1.2);
      const hx = tall ? Math.min(2.2, half(-2) - 0.5) : Math.min(2.34, half(-2) - 0.6);
      lamps[2].group.position.set(-hx, tall ? 2.35 : 1.5, -2);
      lamps[3].group.position.set(hx, tall ? 2.35 : 1.5, -2);
    },
    dispose: () => {
      for (const x of trash) x.dispose();
      quad.dispose();
      depth.dispose();
      torch.dispose();
    },
  };
}

/** A soft round glow. */
export function softTexture(THREE: T3, w: number) {
  const c = document.createElement("canvas");
  c.width = c.height = w;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.25, "rgba(255,255,255,.42)");
  gr.addColorStop(0.6, "rgba(255,255,255,.09)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, w);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export type { Camera, ShaderMaterial };
