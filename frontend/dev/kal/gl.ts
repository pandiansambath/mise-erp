// Shaders, built off the main thread where the browser can (KHR_parallel_shader_compile).

export type Linked = { p: WebGLProgram; u: (name: string) => WebGLUniformLocation | null };

export async function compileAll(gl: WebGL2RenderingContext, list: [string, string][]): Promise<Linked[]> {
  const ext = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  const made = list.map(([v, f]) => {
    const p = gl.createProgram()!;
    const shaders = (
      [
        [gl.VERTEX_SHADER, v],
        [gl.FRAGMENT_SHADER, f],
      ] as const
    ).map(([type, src]) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
      return s;
    });
    gl.bindAttribLocation(p, 0, "q");
    gl.bindAttribLocation(p, 1, "a0");
    gl.linkProgram(p);
    return { p, shaders };
  });
  if (ext) while (!gl.isContextLost() && made.some((m) => !gl.getProgramParameter(m.p, ext.COMPLETION_STATUS_KHR))) await new Promise((r) => setTimeout(r, 16));
  return made.map(({ p, shaders }) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`kal: ${gl.getProgramInfoLog(p)} ${shaders.map((s) => gl.getShaderInfoLog(s)).join(" ")}`);
    const at = new Map<string, WebGLUniformLocation | null>();
    return {
      p,
      u: (name: string) => {
        if (!at.has(name)) at.set(name, gl.getUniformLocation(p, name));
        return at.get(name) ?? null;
      },
    };
  });
}
