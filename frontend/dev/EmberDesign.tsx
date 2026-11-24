"use client";

// Design 8: Ember — "Light, made from the dark."
//
//   "a new design which resembles the UI UX of activetheory.com… with the same
//    theme, same animation, enhanced"
//
// An original design in that school of work — a cinematic WebGL scene, not a
// copy of anybody's site. What it takes from the genre: a dark room with light
// leaking in at the corners and film grain over everything, one iridescent
// object at the centre that TURNS AS YOU SCROLL (and rests when you stop),
// embers of light that drift and burst with the scroll, a glyph loader, tiny
// instrument-like labels. What is his: the object is two interlocked CHAIN
// LINKS in iridescent chrome, and the chapters are his life — hello, time in
// the chain, recognition, skills, DineAI, say hello.
//
// The scene reads the theme's colours, so all fifteen themes apply. Native
// scrolling, never hijacked: the scene follows the scroll with easing, so it
// glides even though the page itself scrolls normally. Phones get the same
// scene with fewer embers and the object above the words.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { chennaiTime, elapsed, useDev, useNow, useData } from "./context";
import { ResumeActions } from "./designKit";
import { honours } from "./profile";
import { readRGB, THEME_EVENT } from "./theme";
import { compiled, guardCanvas, quiet } from "./glGuard";

const CHAPTERS = ["Hello", "Time", "Recognition", "Skills", "DineAI", "Say hello"];
const pad = (n: number) => String(n).padStart(2, "0");
const LABEL = "font-mono text-[10px] uppercase tracking-[0.32em]";

// ── The scene ───────────────────────────────────────────────────────────────

function useEmberScene(
  canvas: React.RefObject<HTMLCanvasElement | null>,
  progress: React.RefObject<number>,
  tuck: React.RefObject<boolean>,
) {
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      // A beat before building the scene: switching designs tears the old one
      // down first, and two designs' GPU memory at once is what took the page
      // down when he picked Ember (94.5).
      await new Promise((r) => setTimeout(r, 180));
      if (dead) return;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: !phone, alpha: true, powerPreference: "high-performance" });

      quiet(renderer);
      // Taken away by the browser (a phone's few contexts): hide, never white.
      const unguard = guardCanvas(el);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.75));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0, 10);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      scene.environment = pmrem.fromScene(room, 0.04).texture;

      // Two interlocked links. A stadium curve keeps the tube one thickness
      // all the way round, as a forged link is, where a squashed torus would
      // thin at the ends.
      class Stadium extends THREE.Curve<InstanceType<typeof THREE.Vector3>> {
        constructor(private r: number, private half: number) {
          super();
        }
        getPoint(t: number, target = new THREE.Vector3()) {
          const { r, half } = this;
          const straight = 2 * half;
          const arc = Math.PI * r;
          const total = 2 * straight + 2 * arc;
          let d = t * total;
          if (d < straight) return target.set(r, -half + d, 0);
          d -= straight;
          if (d < arc) {
            const a = d / r;
            return target.set(r * Math.cos(a), half + r * Math.sin(a), 0);
          }
          d -= arc;
          if (d < straight) return target.set(-r, half - d, 0);
          d -= straight;
          const a = Math.PI + d / r;
          return target.set(r * Math.cos(a), -half + r * Math.sin(a), 0);
        }
      }
      const linkGeo = new THREE.TubeGeometry(new Stadium(0.78, 0.62), phone ? 140 : 220, 0.2, phone ? 18 : 28, true);
      const chrome = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.14,
        iridescence: 1,
        iridescenceIOR: 1.7,
        iridescenceThicknessRange: [120, 1100],
        clearcoat: 1,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.5,
        // Transparent so that, tucked into the corner of a phone while words
        // pass under it, the chain can fade right down (94.6).
        transparent: phone,
      });
      const chain = new THREE.Group();
      const a = new THREE.Mesh(linkGeo, chrome);
      const b = new THREE.Mesh(linkGeo, chrome);
      a.position.y = 0.72;
      b.position.y = -0.72;
      b.rotation.y = Math.PI / 2;
      chain.add(a, b);
      scene.add(chain);
      // A rim light in the theme's own colour, so the chrome picks it up.
      const rim = new THREE.PointLight(0xffffff, 70, 16);
      rim.position.set(-2.6, 1.8, 2.6);
      scene.add(rim);
      // A warm light opposite the cool one, so the chrome shows both colours.
      const warm = new THREE.PointLight(0xffffff, 60, 16);
      warm.position.set(2.8, -1.8, 2.4);
      scene.add(warm);
      // And the room's accent from below, the colour of the streak.
      const under = new THREE.PointLight(0xffffff, 40, 14);
      under.position.set(0, -3.4, 1.5);
      scene.add(under);

      // Embers: points that rise, drift and burst outward with the scroll.
      const N = still ? 400 : phone ? 1000 : 2600;
      const pos = new Float32Array(N * 3);
      const seed = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 18;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
        pos[i * 3 + 2] = -6 + Math.random() * 9;
        seed[i * 4] = Math.random();
        seed[i * 4 + 1] = 0.15 + Math.random() * 0.55;
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = Math.random();
      }
      const emberGeo = new THREE.BufferGeometry();
      emberGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      emberGeo.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
      const emberMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uZ: { value: 0 },
          uRatio: { value: renderer.getPixelRatio() },
          uA: { value: new THREE.Color(1, 0.45, 0.2) },
          uB: { value: new THREE.Color(1, 0.8, 0.45) },
          uC: { value: new THREE.Color(0.4, 0.9, 0.85) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform float uTime, uZ, uRatio;
          varying float vSeed;
          varying float vFade;
          void main() {
            vec3 p = position;
            float rise = mod(p.y + 6.0 + uTime * seed.y, 12.0) - 6.0;
            p.y = rise;
            p.x += sin(uTime * 0.4 + seed.x * 6.283) * 0.35;
            // ZOOM IN, only ("zoom out feels like destroying the feeling"):
            // the embers fly towards the camera — slowly always, fast while
            // you scroll — and wrap round to the far end.
            p.z = mod(p.z + 6.0 + uZ * (0.55 + seed.y), 9.5) - 6.0;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (2.4 + seed.w * seed.w * 9.0) * uRatio * (9.0 / -mv.z);
            vSeed = seed.x;
            vFade = smoothstep(6.0, 3.5, abs(rise)) * (0.45 + 0.55 * seed.z) * (1.0 - 0.5 * seed.w * seed.w)
                  * smoothstep(-6.0, -4.0, p.z) * (1.0 - smoothstep(2.4, 3.4, p.z));
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uA, uB, uC;
          varying float vSeed;
          varying float vFade;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d);
            vec3 col = vSeed < 0.55 ? mix(uA, uB, vSeed / 0.55) : (vSeed < 0.85 ? uB : uC);
            gl_FragColor = vec4(col, a * vFade);
          }`,
      });
      const embers = new THREE.Points(emberGeo, emberMat);
      scene.add(embers);

      // A slow streak of coloured light low in the room.
      const streakMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uCol: { value: new THREE.Color(0.85, 0.15, 0.45) }, uGain: { value: 0.5 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; uniform float uTime, uGain; uniform vec3 uCol;
          float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
          float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
          float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
          void main(){
            vec2 p = vUv * vec2(3.0, 1.2);
            float f = fbm(p + vec2(uTime*0.05, -uTime*0.02) + fbm(p*1.7 - uTime*0.04));
            float band = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.35, vUv.y);
            float edge = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.75, vUv.x);
            gl_FragColor = vec4(uCol * f * 1.6, pow(f, 2.2) * band * edge * uGain);
          }`,
      });
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(16, 5), streakMat);
      streak.position.set(0, -4.2, -3);
      streak.rotation.x = -0.35;
      scene.add(streak);

      // The theme's colours, re-read whenever the theme changes.
      const paint = () => {
        const root = el.closest(".dev-root") ?? document.documentElement;
        const c = (role: string, fb: [number, number, number]) => {
          const [r, g, b2] = readRGB(root, role, fb);
          return new THREE.Color(r / 255, g / 255, b2 / 255);
        };
        emberMat.uniforms.uA.value = c("a", [217, 119, 66]);
        emberMat.uniforms.uB.value = c("gold", [240, 189, 106]);
        emberMat.uniforms.uC.value = c("b2", [125, 240, 220]);
        streakMat.uniforms.uCol.value = c("d", [244, 114, 182]);
        rim.color = c("b", [45, 212, 191]);
        warm.color = c("a2", [240, 160, 100]);
        under.color = c("d", [244, 114, 182]);
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      // Size.
      const fit = () => {
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      // The pointer leans the camera a little; never on touch.
      const mouse = { x: 0, y: 0 };
      const onMove = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      // Compile every shader before the first frame, in parallel where the
      // GPU allows. Compiled on first draw instead, the chrome's physical
      // material froze the page for seconds and held the intro up (22 Nov).
      try {
        await compiled(renderer, scene, camera);
      } catch {
        /* older drivers: it compiles on first draw instead */
      }
      if (dead) return;

      // The loop. The chain's pose follows the scroll through an easing, so
      // it turns when you scroll and comes to rest when you stop — never a
      // spin on its own.
      const n = CHAPTERS.length - 1;
      let last = performance.now();
      let rotY = 0;
      let rotX = 0;
      let x = 0;
      let prevP = progress.current ?? 0;
      let burst = 0;
      let tuckV = 0;
      let raf = 0;
      let t = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (document.hidden) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        t += still ? 0 : dt;
        const p = progress.current ?? 0;
        const k = 1 - Math.exp(-dt * 3.2);
        const tRotY = p * Math.PI * 2 * 1.25 + 0.5;
        const tRotX = Math.sin(p * Math.PI * 2) * 0.45 + 0.18;
        // Desktop: the chain keeps to the side AWAY from the current chapter's
        // words (even chapters write on the left), swinging across when the
        // chapter changes — it used to glide through the middle between
        // chapters and pass behind the text. Phones: while a chapter's words
        // fill the top of the screen, the chain tucks small into the top
        // right corner, and comes back as the next chapter begins.
        const ch = Math.round(p * n);
        tuckV += ((tuck.current ? 1 : 0) - tuckV) * (1 - Math.exp(-dt * 4));
        const tX = phone ? 1.08 * tuckV : ch % 2 === 0 ? 2.35 : -2.35;
        rotY += (tRotY - rotY) * k;
        rotX += (tRotX - rotX) * k;
        x += (tX - x) * k;
        chain.rotation.set(rotX, rotY, Math.sin(t * 0.3) * 0.04);
        // On a phone the chain keeps to the top third, clear of the bar and
        // of the words, which start just below the middle of the screen.
        chain.position.set(x, phone ? 1.6 + 0.62 * tuckV + Math.sin(t * 0.8) * 0.05 : Math.sin(t * 0.8) * 0.08, 0);
        chain.scale.setScalar(phone ? 0.52 - 0.22 * tuckV : 1);
        // …and while the words are up it fades out altogether: a ghost of it
        // left in the corner still lay over the ends of the longer lines
        // (94.6 — steps 10 and 13 of 16, 22 Nov). It returns with the next
        // chapter.
        if (phone) {
          chrome.opacity = 1 - tuckV;
          chain.visible = chrome.opacity > 0.02;
        }
        // Scroll speed becomes the embers' burst, and dies away.
        const v = Math.abs(p - prevP) / Math.max(dt, 0.001);
        prevP = p;
        burst += (Math.min(1.6, v * 6) - burst) * (1 - Math.exp(-dt * 5));
        emberMat.uniforms.uTime.value = t;
        // Forward speed from the scroll speed: faster, never backwards.
        emberMat.uniforms.uZ.value += (still ? 0 : 0.18 + burst * 4.2) * dt;
        streakMat.uniforms.uTime.value = t;
        streakMat.uniforms.uGain.value = 0.42 + burst * 0.25;
        camera.position.x += (mouse.x * 0.45 - camera.position.x) * k;
        camera.position.y += (-mouse.y * 0.3 - camera.position.y) * k;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        unguard();
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener(THEME_EVENT, paint);
        window.removeEventListener("pointermove", onMove);
        linkGeo.dispose();
        chrome.dispose();
        emberGeo.dispose();
        emberMat.dispose();
        streak.geometry.dispose();
        streakMat.dispose();
        scene.environment?.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      if (dead) cleanup();
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, [canvas, progress, tuck]);
}

// ── The glyph loader: a sphere of slashes counting to a hundred ─────────────

function GlyphIntro({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  const [rows, setRows] = useState<string[]>([]);
  // The page re-renders every second for its clock, handing a new onDone each
  // time; held in a ref so the count runs once instead of restarting forever.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const R = 9;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 1500);
      setN(Math.round(p * 100));
      const out: string[] = [];
      for (let y = -R; y <= R; y++) {
        let line = "";
        for (let x = -R * 2; x <= R * 2; x++) {
          const inside = (x / 2) ** 2 + y ** 2 <= R * R;
          if (!inside) line += " ";
          else line += Math.random() < 0.06 * (1 - p) ? String(Math.floor(Math.random() * 10)) : Math.random() < p ? "/" : "·";
        }
        out.push(line);
      }
      setRows(out);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(() => done.current(), 260);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[35] grid place-items-center bg-[var(--d-bg)]" style={{ animation: n >= 100 ? "devFade .3s reverse both" : undefined }}>
      <div className="relative">
        <pre className="font-mono text-[9px] leading-[11px] text-[var(--d-b2)] opacity-70">{rows.join("\n")}</pre>
        <span className="absolute inset-0 grid place-items-center font-mono text-[13px] tracking-[0.2em] text-[var(--d-ink)]">/{pad(n)}</span>
      </div>
    </div>
  );
}

// ── Words that rise out of a mask when their chapter arrives ────────────────

function Line({ on, i, children, className = "" }: { on: boolean; i: number; children: ReactNode; className?: string }) {
  return (
    <span className={`block overflow-hidden ${className}`}>
      <span
        className="block will-change-transform"
        style={{
          transform: on ? "translateY(0)" : "translateY(108%)",
          opacity: on ? 1 : 0,
          transition: `transform 1s cubic-bezier(.16,1,.3,1) ${0.08 + i * 0.09}s, opacity .8s ease ${0.08 + i * 0.09}s`,
        }}
      >
        {children}
      </span>
    </span>
  );
}

function Chapter({
  id,
  index,
  active,
  side,
  children,
}: {
  id: string;
  index: number;
  active: boolean;
  side: "left" | "right";
  children: (on: boolean) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { rootMargin: "-30% 0px -30% 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  const on = seen || active;
  return (
    <section
      ref={ref}
      id={id}
      className={`relative flex min-h-[100svh] items-end px-5 pb-24 pt-[52svh] md:items-center md:px-12 md:py-24 ${side === "right" ? "md:justify-end" : "md:justify-start"}`}
    >
      <div data-ember-copy className="relative w-full max-w-xl">
        {/* The words keep their own dark: a soft glow of the background behind
            them, so they read over the chrome, the embers or anything else. */}
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-x-10 -inset-y-12 -z-10 md:-inset-x-16"
          style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--d-bg) 78%, transparent) 55%, transparent)" }}
        />
        <p className={`${LABEL} mb-5 flex items-center gap-3 text-[var(--d-b2)]`}>
          <span className="tabular-nums">{pad(index + 1)}</span>
          <span className="h-px w-10 bg-[var(--d-b2)]/60" style={{ transform: on ? "scaleX(1)" : "scaleX(0)", transformOrigin: "left", transition: "transform .9s cubic-bezier(.16,1,.3,1) .1s" }} />
          <span>{CHAPTERS[index]}</span>
        </p>
        {children(on)}
      </div>
    </section>
  );
}

// ── The design ──────────────────────────────────────────────────────────────

export function EmberDesign() {
  const { CAREER_START, CLUSTERS, EDUCATION, EMAIL, LINKS, PROJECT, VOLUNTEERING } = useData();
  const { entered, milestones, photos, openAlbum, toast } = useDev();
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const awards = honours(milestones);
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef(0);
  const tuck = useRef(false);
  const [chapter, setChapter] = useState(0);
  const [intro, setIntro] = useState(true);
  // Whatever the frame rate, the words arrive within 2.4 s of ENTER.
  useEffect(() => {
    if (!entered) return;
    const t = setTimeout(() => setIntro(false), 2400);
    return () => clearTimeout(t);
  }, [entered]);

  useEmberScene(canvas, progress, tuck);

  // Scroll progress for the scene, and which chapter is current. DOM-light:
  // one number into a ref, a state change only when the chapter changes.
  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      progress.current = p;
      setChapter(Math.min(CHAPTERS.length - 1, Math.round(p * (CHAPTERS.length - 1))));
      // Phones: are any words in the top part of the screen, where the chain
      // floats? Then it tucks away.
      let t = false;
      if (window.matchMedia("(max-width: 767px)").matches) {
        const vh = window.innerHeight;
        document.querySelectorAll("[data-ember-copy]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.bottom > vh * 0.08 && r.top < vh * 0.46) t = true;
        });
      }
      tuck.current = t;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);

  const go = (i: number) => document.getElementById(`ember-${i}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast(`Copied ${EMAIL}`);
    } catch {
      window.location.href = LINKS.email;
    }
  };
  const side = (i: number): "left" | "right" => (i % 2 === 0 ? "left" : "right");
  const pill =
    "inline-flex items-center gap-2 rounded-full border border-[var(--d-line2)] bg-[var(--d-bg)]/40 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--d-ink2)] backdrop-blur transition hover:border-[var(--d-b2)] hover:text-[var(--d-ink)]";

  return (
    <main className="relative z-10 text-[var(--d-ink)]">
      {/* The room: the scene, the light at the corners, the grain. */}
      <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 h-full w-full" style={{ opacity: entered ? 1 : 0, transition: "opacity 1.2s ease .3s" }} />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(60% 55% at 0% 100%, color-mix(in srgb, var(--d-b) 22%, transparent), transparent 70%), radial-gradient(45% 40% at 100% 0%, color-mix(in srgb, var(--d-b) 14%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-[-50%] opacity-[0.07] mix-blend-overlay motion-safe:animate-[devGrain_.9s_steps(6)_infinite]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />
      {entered && intro && <GlyphIntro onDone={() => setIntro(false)} />}

      {/* Where you are: a rail of ticks on a desktop, a pill on a phone. */}
      <nav aria-label="Chapters" className="fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-3 md:flex">
        {CHAPTERS.map((c, i) => (
          <button key={c} type="button" onClick={() => go(i)} className="group flex items-center gap-3" aria-current={chapter === i}>
            <span className={`${LABEL} transition ${chapter === i ? "text-[var(--d-ink)] opacity-100" : "text-[var(--d-ink5)] opacity-0 group-hover:opacity-100"}`}>{c}</span>
            <span className="h-px transition-all duration-500" style={{ width: chapter === i ? 34 : 14, background: chapter === i ? "var(--d-b2)" : "var(--d-ink6)" }} />
          </button>
        ))}
      </nav>
      <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center md:hidden">
        <span className={`${pill} !py-1.5 !text-[10px]`}>
          <span className="tabular-nums text-[var(--d-b2)]">{pad(chapter + 1)}/{pad(CHAPTERS.length)}</span>
          {CHAPTERS[chapter]}
        </span>
      </div>

      <Chapter id="ember-0" index={0} active={chapter === 0} side={side(0)}>
        {(on) => (
          <>
            <h1 className="font-display text-[clamp(3rem,9vw,6.5rem)] font-light leading-[0.92] tracking-tight">
              <Line on={on && !intro} i={0}>Pandian</Line>
              <Line on={on && !intro} i={1} className="text-[var(--d-a2)]">Sambath</Line>
            </h1>
            <Line on={on && !intro} i={2} className="mt-6">
              <span className="text-[16px] text-[var(--d-ink2)]">System Engineer at Tata Consultancy Services</span>
            </Line>
            <Line on={on && !intro} i={3}>
              <span className="text-[14px] text-[var(--d-ink4)]">Python, AWS and Generative AI · Chennai · {now ? `${chennaiTime(now)} IST` : ""}</span>
            </Line>
            <Line on={on && !intro} i={4} className="mt-10">
              <span className={`${LABEL} flex items-center gap-3 text-[var(--d-ink5)]`}>
                Scroll
                <span className="relative h-8 w-px overflow-hidden bg-[var(--d-line2)]">
                  <span className="absolute inset-x-0 top-0 h-3 bg-[var(--d-b2)] motion-safe:animate-[devScrollCue_1.8s_ease-in-out_infinite]" />
                </span>
              </span>
            </Line>
          </>
        )}
      </Chapter>

      <Chapter id="ember-1" index={1} active={chapter === 1} side={side(1)}>
        {(on) => (
          <>
            <h2 className="font-display text-[clamp(2.2rem,6vw,4.2rem)] font-light leading-none tracking-tight">
              <Line on={on} i={0}>Time in the chain</Line>
            </h2>
            <div className="mt-8 grid grid-cols-3 gap-4">
              {[
                { v: exp?.years ?? 0, k: "years" },
                { v: exp?.months ?? 0, k: "months" },
                { v: exp?.days ?? 0, k: "days" },
              ].map((c, i) => (
                <Line key={c.k} on={on} i={i + 1}>
                  <span className="block font-display text-[clamp(2.6rem,7vw,4.6rem)] font-light tabular-nums leading-none">{c.v}</span>
                  <span className={`${LABEL} mt-2 block text-[var(--d-ink5)]`}>{c.k}</span>
                </Line>
              ))}
            </div>
            <Line on={on} i={4} className="mt-8">
              <span className="font-mono text-[13px] tabular-nums text-[var(--d-b2)]">
                DAY {exp ? exp.dayNumber.toLocaleString("en-US") : "—"} · {exp ? `${pad(exp.hours)}:${pad(exp.minutes)}:${pad(exp.seconds)}` : ""} UTC
              </span>
            </Line>
            <Line on={on} i={5}>
              <span className="text-[14px] text-[var(--d-ink4)]">Since 1 January 2024. Life doesn’t stop — it moves like a chain.</span>
            </Line>
          </>
        )}
      </Chapter>

      <Chapter id="ember-2" index={2} active={chapter === 2} side={side(2)}>
        {(on) => (
          <>
            <h2 className="font-display text-[clamp(2.2rem,6vw,4.2rem)] font-light leading-none tracking-tight">
              {/* The gold sits on the words, not the moving wrapper: a gradient
                  clipped to text cannot reach through a transformed child. */}
              <Line on={on} i={0}>
                <span className="dev-gold">Gold Medalist</span>
              </Line>
            </h2>
            <Line on={on} i={1} className="mt-3">
              <span className="text-[16px] text-[var(--d-ink2)]">
                {EDUCATION.honour} · {EDUCATION.degree}, {EDUCATION.percentage}{" "}
                <a href={EDUCATION.verifyUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--d-b2)] underline decoration-dotted underline-offset-4">
                  verify ↗
                </a>
              </span>
            </Line>
            <ul className="mt-7 space-y-3">
              {awards.map((m, i) => (
                <li key={`${m.when}-${m.title}`}>
                  <Line on={on} i={i + 2}>
                    <span className="flex items-baseline gap-4 border-b border-[var(--d-line)] pb-3">
                      <span className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--d-ink5)]">{m.when}</span>
                      <span className="text-[15px] text-[var(--d-ink)]">{m.title}</span>
                    </span>
                  </Line>
                </li>
              ))}
            </ul>
          </>
        )}
      </Chapter>

      <Chapter id="ember-3" index={3} active={chapter === 3} side={side(3)}>
        {(on) => (
          <>
            <h2 className="font-display text-[clamp(2.2rem,6vw,4.2rem)] font-light leading-none tracking-tight">
              <Line on={on} i={0}>What I build with</Line>
            </h2>
            <div className="mt-7 space-y-5">
              {CLUSTERS.map((c, ci) => (
                <Line key={c.key} on={on} i={ci + 1}>
                  <span className={`${LABEL} block`} style={{ color: c.hue }}>
                    {c.glyph} {c.label}
                  </span>
                  <span className="mt-2 block text-[14px] leading-relaxed text-[var(--d-ink3)]">{c.items.join(" · ")}</span>
                </Line>
              ))}
            </div>
          </>
        )}
      </Chapter>

      <Chapter id="ember-4" index={4} active={chapter === 4} side={side(4)}>
        {(on) => (
          <>
            <Line on={on} i={0}>
              <span className={`${LABEL} text-[var(--d-a2)]`}>{PROJECT.slogan}</span>
            </Line>
            <h2 className="mt-3 font-display text-[clamp(2.6rem,7vw,5rem)] font-light leading-none tracking-tight">
              <Line on={on} i={1}>{PROJECT.name}</Line>
            </h2>
            <Line on={on} i={2} className="mt-5">
              <span className="text-[15px] leading-relaxed text-[var(--d-ink2)]">{PROJECT.pitch}</span>
            </Line>
            <Line on={on} i={3} className="mt-3">
              <span className="text-[13px] leading-relaxed text-[var(--d-ink4)]">{PROJECT.honesty}</span>
            </Line>
            <Line on={on} i={4} className="mt-7">
              <span className="flex flex-wrap gap-2">
                <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className={pill}>
                  dineai.cloud ↗
                </a>
                <a href={PROJECT.inUse.href} target="_blank" rel="noopener noreferrer" className={pill}>
                  In use · {PROJECT.inUse.label} ↗
                </a>
              </span>
            </Line>
          </>
        )}
      </Chapter>

      <Chapter id="ember-5" index={5} active={chapter === 5} side={side(5)}>
        {(on) => (
          <>
            <h2 className="font-display text-[clamp(2.6rem,7vw,5rem)] font-light leading-none tracking-tight">
              <Line on={on} i={0}>Say hello</Line>
            </h2>
            <Line on={on} i={1} className="mt-6">
              <span className="flex flex-wrap gap-2">
                <button type="button" onClick={copyEmail} className={pill}>
                  ✉ Copy email
                </button>
                <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className={pill}>
                  LinkedIn ↗
                </a>
                <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className={pill}>
                  GitHub ↗
                </a>
                <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className={pill}>
                  Instagram ↗
                </a>
                {photos.length > 0 && (
                  <button type="button" onClick={openAlbum} className={pill}>
                    ◉ The album
                  </button>
                )}
              </span>
            </Line>
            <Line on={on} i={2} className="mt-4">
              <ResumeActions button={pill} />
            </Line>
            <Line on={on} i={3} className="mt-8">
              <span className="text-[13px] leading-relaxed text-[var(--d-ink4)]">Volunteering with {VOLUNTEERING.map((v) => v.org).join(", ")}.</span>
            </Line>
            <Line on={on} i={4} className="mt-10">
              <span className={`${LABEL} text-[var(--d-ink6)]`}>© {now ? now.getFullYear() : ""} Pandian Sambath · built with AI-assisted development</span>
            </Line>
          </>
        )}
      </Chapter>
    </main>
  );
}
