"use client";

// Out-of-the-box: a LIVING animated backdrop, not media. A single full-screen
// WebGL fragment shader paints flowing "quantum" energy — aurora ribbons, a
// breathing central bloom, drifting light motes — that animates on its OWN clock
// (alive even when still), while SCROLL drives the journey's mood (palette +
// bloom shift from calm indigo night → teal → emerald → warm amber → gold dawn).
// One GPU pass per frame = glass-smooth on desktop AND mobile, no decode, no
// video, nothing to stutter. Falls back to an animated CSS gradient if WebGL is
// unavailable.

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";

type Props = { onProgress?: (frac: number) => void; onReady?: () => void };

const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_scroll;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i+vec2(1.0,0.0)), c = hash(i+vec2(0.0,1.0)), d = hash(i+vec2(1.0,1.0));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
vec3 palette(float t){
  vec3 a = vec3(0.04,0.06,0.15);   // indigo night
  vec3 b = vec3(0.05,0.28,0.40);   // teal
  vec3 c = vec3(0.06,0.42,0.30);   // emerald
  vec3 d = vec3(0.60,0.42,0.18);   // amber
  vec3 e = vec3(0.92,0.74,0.42);   // gold dawn
  t = clamp(t,0.0,1.0);
  if(t<0.25) return mix(a,b, t/0.25);
  if(t<0.50) return mix(b,c,(t-0.25)/0.25);
  if(t<0.75) return mix(c,d,(t-0.50)/0.25);
  return mix(d,e,(t-0.75)/0.25);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*u_res.xy)/u_res.y;
  float t = u_time*0.05;
  float s = u_scroll;

  // domain-warped flow field (the living energy)
  vec2 q = uv*1.4;
  vec2 warp = vec2(fbm(q + vec2(t, -t*0.6) + s*1.4),
                   fbm(q + vec2(-t*0.7, t) + s*1.1));
  float field = fbm(q + warp*1.5 + vec2(0.0, -s*1.4));

  vec3 base = palette(s);
  vec3 hi   = palette(s + 0.14);
  vec3 col  = mix(base, hi, smoothstep(0.25, 0.9, field));

  // aurora ribbon
  float ribbon = sin(uv.x*2.0 + warp.x*2.4 + t*2.2)*0.5 + 0.5;
  ribbon *= smoothstep(0.55, 0.0, abs(uv.y + 0.12 - field*0.45));
  col += hi * ribbon * 0.22;

  // breathing central bloom — grows along the journey
  float d = length(uv*vec2(1.0,1.2));
  float bloom = exp(-d*2.2)*(0.55 + 0.45*sin(u_time*0.4));
  col += hi * bloom * (0.30 + s*0.75);

  // drifting light motes (the "quantum" sparkle)
  vec2 mp = uv*3.0 + vec2(sin(t)*0.2, -t*1.6);
  vec2 mi = floor(mp), mf = fract(mp) - 0.5;
  float h = hash(mi);
  float tw = 0.5 + 0.5*sin(u_time*1.6 + h*6.28);
  float mote = smoothstep(0.13, 0.0, length(mf)) * step(0.86, h) * tw;
  col += hi * mote * 0.7;

  // tone + vignette
  col *= smoothstep(1.4, 0.12, d);
  col = pow(max(col, 0.0), vec3(0.85));
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function QuantumJourney({ onProgress, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl =
      (canvas.getContext("webgl", { antialias: false, alpha: false }) as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

    // ── No WebGL → reveal the CSS-gradient fallback and bail gracefully ──
    if (!gl) {
      if (fallbackRef.current) fallbackRef.current.style.display = "block";
      onProgress?.(1);
      onReady?.();
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (fallbackRef.current) fallbackRef.current.style.display = "block";
      onProgress?.(1);
      onReady?.();
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uScroll = gl.getUniformLocation(prog, "u_scroll");

    // Abstract visuals tolerate softness → render lean for buttery mobile perf.
    const isMobile = window.matchMedia("(max-width: 640px)").matches;
    const scale = isMobile ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    const resize = () => {
      const w = Math.round(window.innerWidth * scale);
      const h = Math.round(window.innerHeight * scale);
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let smooth = 0; // eased scroll so palette changes glide
    let revealed = false;
    let raf = 0;
    const render = () => {
      const time = (performance.now() - start) / 1000;
      smooth += (journeyProgress.value - smooth) * 0.06;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1f(uScroll, smooth);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!revealed) {
        revealed = true;
        onProgress?.(1);
        onReady?.();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      const ext = gl.getExtension("WEBGL_lose_context");
      if (ext) ext.loseContext();
    };
  }, [onProgress, onReady]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-[#04080e]" aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
      {/* CSS fallback (only shown if WebGL is unavailable) */}
      <div
        ref={fallbackRef}
        className="mise-quantum-fallback absolute inset-0 hidden"
        style={{
          background:
            "linear-gradient(135deg, #04060f, #073038, #0a3a2c, #5a4018, #04060f)",
          backgroundSize: "400% 400%",
        }}
      />
      {/* legibility scrim + vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,8,14,0.55) 0%, rgba(4,8,14,0.22) 34%, rgba(4,8,14,0.34) 64%, rgba(4,8,14,0.72) 100%)",
        }}
      />
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 240px 70px rgba(0,0,0,0.5)" }} />
    </div>
  );
}
