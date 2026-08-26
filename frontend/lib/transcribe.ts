"use client";

/** 🎧 Streaming speech-to-text, for the browsers that refuse to do it themselves.
 *
 * Brave — which is what he actually uses — ships `webkitSpeechRecognition` and
 * then blocks the Google endpoint behind it. So our voice took the blame for a
 * browser decision, and "this browser blocks the speech service" is a true
 * sentence that helps him not at all.
 *
 * This talks to Amazon Transcribe's streaming API directly from the page, over
 * a WebSocket whose URL our server signed. No audio touches our box: an
 * always-on microphone would otherwise be a permanent audio stream per user
 * through a t3.micro, and there would be a socket to re-establish on every
 * deploy.
 *
 * The fiddly part is that Transcribe speaks AWS's binary event-stream framing
 * rather than JSON — every message is a length-prefixed envelope with its own
 * CRC32 checksums. That is what most of this file is.
 */

const SAMPLE_RATE = 16000;

/* ── CRC32, which the framing requires on every message ─────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ── Encoding one audio event ───────────────────────────────────────────── */

function header(name: string, value: string): Uint8Array {
  const n = new TextEncoder().encode(name);
  const v = new TextEncoder().encode(value);
  const out = new Uint8Array(1 + n.length + 1 + 2 + v.length);
  const dv = new DataView(out.buffer);
  let o = 0;
  out[o] = n.length;
  o += 1;
  out.set(n, o);
  o += n.length;
  out[o] = 7; // value type: string
  o += 1;
  dv.setUint16(o, v.length);
  o += 2;
  out.set(v, o);
  return out;
}

/** Wrap a chunk of PCM in the envelope Transcribe expects. */
function audioEvent(pcm: Uint8Array): Uint8Array {
  const headers = [
    header(":message-type", "event"),
    header(":event-type", "AudioEvent"),
    header(":content-type", "application/octet-stream"),
  ];
  const headerLen = headers.reduce((n, h) => n + h.length, 0);
  const total = 16 + headerLen + pcm.length;

  const msg = new Uint8Array(total);
  const dv = new DataView(msg.buffer);
  dv.setUint32(0, total);
  dv.setUint32(4, headerLen);
  dv.setUint32(8, crc32(msg.subarray(0, 8)));
  let o = 12;
  for (const h of headers) {
    msg.set(h, o);
    o += h.length;
  }
  msg.set(pcm, o);
  dv.setUint32(total - 4, crc32(msg.subarray(0, total - 4)));
  return msg;
}

/** Pull the JSON payload back out of a message Transcribe sent us. */
function decodeMessage(buf: ArrayBuffer): Record<string, unknown> | null {
  try {
    const dv = new DataView(buf);
    const headerLen = dv.getUint32(4);
    const body = new Uint8Array(buf, 12 + headerLen, buf.byteLength - 12 - headerLen - 4);
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

/** Float samples from the mic → the 16-bit PCM Transcribe was promised. */
function toPcm16(input: Float32Array): Uint8Array {
  const out = new DataView(new ArrayBuffer(input.length * 2));
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

/** Cheap linear resample. The mic is usually 44.1k or 48k; Transcribe wants 16k. */
function downsample(input: Float32Array, from: number): Float32Array {
  if (from === SAMPLE_RATE) return input;
  const ratio = from / SAMPLE_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export type Listener = {
  stop: () => void;
  /** Forget this turn. Called once a question has been sent to the assistant. */
  reset: () => void;
  /** Signal strength, 0–1, for the ring to breathe with. */
  level: () => number;
};

export type ListenOpts = {
  url: string;
  /** Called with the running transcript; `final` marks the end of an utterance. */
  onText: (text: string, final: boolean) => void;
  onError: (message: string) => void;
  /** While true, audio is dropped — so it never transcribes its own voice. */
  muted: () => boolean;
};

/**
 * Open the microphone and stream it. Resolves once audio is actually flowing,
 * so a caller can tell "listening" from "asked to listen and was refused".
 */
export async function listen(opts: ListenOpts): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated in favour of AudioWorklet, which needs a
  // separate module file served from our origin. This works in every browser
  // we care about today and keeps the whole thing in one file.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const ws = new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";

  let loudness = 0;
  let closed = false;
  //: resultId -> what that segment currently says. Ordered by insertion, which
  //: is the order he said them.
  const segments = new Map<string, { text: string; final: boolean }>();

  const shutdown = () => {
    if (closed) return;
    closed = true;
    try {
      node.disconnect();
      source.disconnect();
      void ctx.close();
    } catch {
      /* already gone */
    }
    stream.getTracks().forEach((t) => t.stop());
    if (ws.readyState === WebSocket.OPEN) ws.close();
  };

  ws.onmessage = (ev) => {
    const msg = decodeMessage(ev.data as ArrayBuffer);
    if (!msg) return;
    if (msg.Message || msg.message) {
      opts.onError(String(msg.Message ?? msg.message));
      return;
    }
    const results =
      (msg.Transcript as { Results?: unknown[] } | undefined)?.Results ??
      ((msg as Record<string, { Transcript?: { Results?: unknown[] } }>).TranscriptEvent
        ?.Transcript?.Results ??
        []);
    // KEYED BY ResultId, and this is the whole trick.
    //
    // Transcribe re-sends the SAME result as it firms up — the id stays put and
    // the text grows — and it re-sends a finished one more than once. Treating
    // each arrival as new text appended to what came before is why one sentence
    // turned into "I want to see the staff's list I don't start all theI want to
    // see the staff's list..." repeating down the whole screen. Storing by id
    // REPLACES rather than appends, so a re-send costs nothing and a genuinely
    // new segment gets its own slot.
    const folded = foldSegments(
      segments,
      results as {
        ResultId?: string;
        IsPartial: boolean;
        Alternatives: { Transcript: string }[];
      }[],
    );
    if (folded) opts.onText(folded.whole, folded.allFinal);
  };
  ws.onerror = () => opts.onError("The transcription connection dropped.");
  ws.onclose = () => shutdown();

  node.onaudioprocess = (e) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const raw = e.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < raw.length; i += 64) peak = Math.max(peak, Math.abs(raw[i]));
    loudness = peak;
    // Deaf while we are talking, or it hears the reply through the speakers and
    // answers itself. But deaf means sending SILENCE, not sending nothing:
    // Transcribe closes a stream that has received no audio for fifteen
    // seconds, which is exactly "it goes offline after a few seconds and I have
    // to touch it again". The socket has to keep breathing while we are not
    // listening.
    const pcm = downsample(raw, ctx.sampleRate);
    if (opts.muted()) {
      ws.send(audioEvent(new Uint8Array(pcm.length * 2)));
      return;
    }
    ws.send(audioEvent(toPcm16(pcm)));
  };

  source.connect(node);
  node.connect(ctx.destination);

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error("timed out opening the microphone")), 8000);
    ws.onopen = () => {
      window.clearTimeout(t);
      resolve();
    };
    const failed = () => {
      window.clearTimeout(t);
      reject(new Error("could not reach the transcription service"));
    };
    ws.addEventListener("error", failed, { once: true });
  });

  return { stop: shutdown, reset: () => segments.clear(), level: () => loudness };
}

/** Exposed for tests only.
 *
 * The Python twin of this framing was accepted by Transcribe on the live
 * account — the handshake completed and AWS parsed the audio events without
 * complaint. This browser copy has never met AWS at all, and a byte wrong in a
 * CRC or a length prefix fails as a silent disconnect rather than an error.
 * So it is pinned to the bytes that are known to work.
 */
export const __testing = { audioEvent, toPcm16, crc32, downsample };

/** The segment bookkeeping, extracted so it can be tested without a socket. */
export function foldSegments(
  segments: Map<string, { text: string; final: boolean }>,
  results: { ResultId?: string; IsPartial: boolean; Alternatives: { Transcript: string }[] }[],
): { whole: string; allFinal: boolean } | null {
  let touched = false;
  for (const r of results) {
    const text = r.Alternatives?.[0]?.Transcript ?? "";
    if (!text) continue;
    segments.set(r.ResultId ?? "only", { text, final: !r.IsPartial });
    touched = true;
  }
  if (!touched) return null;
  return {
    whole: [...segments.values()].map((v) => v.text).join(" ").trim(),
    allFinal: [...segments.values()].every((v) => v.final),
  };
}
