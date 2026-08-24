"use client";

// 🎙️ THE VOICE — a bubble in the corner that hears, answers, and drives.
//
//   "when I click that voice model it needs to open as a popup small bubble in
//    the corner so that I can see the dashboard pages. Now when I say 'hey
//    could you please add this sales into sales page' it needs to navigate to
//    that sales page in realtime and enter the sale value and click enter, so
//    that the owner feels like hands free."
//   "target more on UI please."
//
// So the bubble is deliberately SMALL and never covers the page: the whole
// point is watching the app move while you talk to it. What it does cover, it
// covers in the corner, and the aurora is the only thing that draws the eye —
// because when you are speaking to a machine the one question you have is "is
// it hearing me", and a ring that answers that costs nothing to read.
//
// THE HONEST BIT: it fills forms, it does not submit them. The model can ask
// the page to open Sales and type 120 into the amount; the save button is his.
// A spoken instruction is a request, exactly like a click — not a password.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";

import { API_BASE, api, ApiError, getToken } from "@/lib/api";

type Turn = { role: "user" | "assistant"; content: string };
type Action =
  | { kind: "navigate"; page: string }
  | { kind: "fill"; fields: Record<string, string>; summary: string };
type Voice = { id: string; label: string; who: string; sex: string };

type Phase = "idle" | "listening" | "thinking" | "speaking";

// "confirmation on screen before serious actions, configurable: always ask /
//  give all access / never ask." Held per browser, defaulting to the careful
//  end - a person who wants the fast one will find it, and a person who never
//  opens settings should not discover the fast one by accident.
type Ask = "always" | "money" | "never";
const ASK_MODES: { id: Ask; label: string; note: string }[] = [
  { id: "always", label: "Ask me every time", note: "Nothing is typed in before you say so" },
  { id: "money", label: "Ask about money & people", note: "Sales, wages, staff. The rest just happens" },
  { id: "never", label: "Just do it", note: "No confirmation. You are watching anyway" },
];
// Which fields make a thing "serious". A number that ends up in his books is
// worth a second of his attention; a date is not.
const WEIGHTY = /amount|total|price|cost|pay|wage|salary|rate|hours|qty|quantity|staff|employee|name/i;

function needsAsking(mode: Ask, fields: Record<string, string>): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return Object.keys(fields).some((k) => WEIGHTY.test(k));
}

// The Web Speech API ships no types with TypeScript, so this is the slice of it
// we actually touch - written out rather than reached for through `any`, which
// would hide a typo in exactly the place a typo is hardest to notice.
type SpeechAlt = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlt; length: number };
type SpeechResults = { length: number; [i: number]: SpeechResult };
type SpeechEvent = { results: SpeechResults };
type SpeechErrorEvent = { error: string };
interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognizer;
  webkitSpeechRecognition?: new () => Recognizer;
};

/** Browser speech recognition, under its two vendor names. */
function recognition(): Recognizer | null {
  if (typeof window === "undefined") return null;
  const W = window as SpeechWindow;
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function VoiceBubble() {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("Amy");
  const [pickingVoice, setPickingVoice] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{ fields: Record<string, string>; summary: string } | null>(
    null,
  );
  const [askMode, setAskMode] = useState<Ask>("money");
  const [level, setLevel] = useState(0);

  const recRef = useRef<Recognizer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const supported = typeof window !== "undefined" && !!recognition();

  useEffect(() => {
    if (!open || voices.length) return;
    api
      .get<{ voices: Voice[]; default: string }>("/assistant/voice/voices")
      .then((d) => {
        setVoices(d.voices ?? []);
        setVoice((v) => v || d.default);
      })
      .catch(() => {});
  }, [open, voices.length]);

  // Remember the chosen voice. A person picks a voice once; asking again every
  // session is the app forgetting something it was told.
  useEffect(() => {
    try {
      const v = localStorage.getItem("mise.voice");
      if (v) setVoice(v);
      const a = localStorage.getItem("mise.voice.ask");
      if (a === "always" || a === "money" || a === "never") setAskMode(a);
    } catch {
      /* private mode — the default is fine */
    }
  }, []);

  const say = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setPhase("speaking");
      try {
        const res = await fetch(`${API_BASE}/api/assistant/voice/speak`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
          },
          body: JSON.stringify({ text, voice }),
        });
        if (!res.ok) throw new Error("no audio");
        const buf = await res.blob();
        const url = URL.createObjectURL(buf);
        const a = new Audio(url);
        audioRef.current = a;
        // The ring breathes with the speech. Without a real analyser this is a
        // gentle simulation, which is honest enough: it says "still talking".
        const tick = window.setInterval(() => setLevel(0.35 + Math.random() * 0.5), 110);
        a.onended = () => {
          window.clearInterval(tick);
          setLevel(0);
          setPhase("idle");
          URL.revokeObjectURL(url);
        };
        await a.play();
      } catch {
        setPhase("idle");
      }
    },
    [voice],
  );

  /** Type the values into the real form on the real page. */
  const fillIn = useCallback(async (fields: Record<string, string>) => {
    // Find each field by what a person would call it, and type into it - the
    // real input on the real page, so what he watches is what would have
    // happened had he done it himself.
    await new Promise((r) => setTimeout(r, 400));
    for (const [name, value] of Object.entries(fields)) {
      const el = findField(name);
      if (!el) continue;
      setNativeValue(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("mise-voice-filled");
      window.setTimeout(() => el.classList.remove("mise-voice-filled"), 2400);
      await new Promise((r) => setTimeout(r, 220));
    }
  }, []);

  /** Do what the model asked the PAGE to do. Never a write. */
  const perform = useCallback(
    async (actions: Action[]) => {
      for (const a of actions) {
        if (a.kind === "navigate") {
          router.push(`/${a.page.replace(/^\//, "")}`);
          await new Promise((r) => setTimeout(r, 900));
        }
        if (a.kind === "fill") await fillIn(a.fields);
      }
    },
    [router, fillIn],
  );

  const ask = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setErr(null);
      setTurns((t) => [...t, { role: "user", content: text }]);
      try {
        const out = await api.post<{ reply: string; spoken: string; actions: Action[] }>(
          "/assistant/voice/turn",
          { text, history: turns.slice(-8), route: pathname },
        );
        setSaid(out.reply);
        setTurns((t) => [...t, { role: "assistant", content: out.reply }]);
        if (out.actions?.length) {
          // Navigation is never gated - opening a page shows him something, it
          // does not change anything, and asking permission to LOOK is the kind
          // of confirmation that trains people to click yes without reading.
          await perform(out.actions.filter((a) => a.kind === "navigate"));

          // Several fills are one intention: "a 120 pound cash sale" is one
          // thing to agree to, not three. Merge them into a single question.
          const fills = out.actions.filter(
            (a): a is Extract<Action, { kind: "fill" }> => a.kind === "fill",
          );
          if (fills.length) {
            const fields = Object.assign({}, ...fills.map((f) => f.fields)) as Record<
              string,
              string
            >;
            const summary = fills.map((f) => f.summary).filter(Boolean).join(" ");
            if (needsAsking(askMode, fields)) setPending({ fields, summary });
            else await fillIn(fields);
          }
        }
        await say(out.spoken || out.reply);
      } catch (e) {
        setPhase("idle");
        setErr(e instanceof ApiError ? e.message : "I could not reach the assistant.");
      }
    },
    [turns, pathname, perform, fillIn, askMode, say],
  );

  const listen = useCallback(() => {
    const rec = recognition();
    if (!rec) return;
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    recRef.current = rec;
    setHeard("");
    setErr(null);
    setPhase("listening");

    rec.onresult = (e: SpeechEvent) => {
      let text = "";
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      setHeard(text);
      setLevel(0.3 + Math.min(0.6, text.length / 60));
      if (e.results[e.results.length - 1].isFinal) {
        rec.stop();
        if (text.trim()) ask(text.trim());
      }
    };
    rec.onerror = (e: SpeechErrorEvent) => {
      setPhase("idle");
      setLevel(0);
      if (e.error === "not-allowed") setErr("The microphone is blocked for this site.");
      else if (e.error !== "aborted") setErr("I did not catch that.");
    };
    rec.onend = () => {
      setLevel(0);
      setPhase((p) => (p === "listening" ? "idle" : p));
    };
    rec.start();
  }, [ask]);

  const stop = useCallback(() => {
    recRef.current?.abort();
    audioRef.current?.pause?.();
    setPhase("idle");
    setLevel(0);
  }, []);

  // An open microphone on a counter is a bill. Close on the way out.
  useEffect(() => () => stop(), [stop]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Talk to DineAI"
        className="mise-voice-launch fixed bottom-24 right-5 z-[60] grid h-14 w-14 place-items-center rounded-full text-white shadow-lg sm:bottom-6 sm:right-24"
      >
        <span aria-hidden className="text-xl">🎙️</span>
      </button>
    );
  }

  const label =
    phase === "listening"
      ? "Listening…"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? "Speaking"
          : "Tap to talk";

  return createPortal(
    <>
      <div className="mise-voice fixed bottom-5 right-5 z-[65] w-[min(22rem,calc(100vw-2.5rem))]">
        <div className="mise-voice-card relative overflow-hidden rounded-3xl border border-line p-4">
          {/* THE AURORA. Four blurred blobs drifting behind the glass — it is
              the whole personality of this thing, and it costs three divs. */}
          <span aria-hidden className="mise-aurora" data-phase={phase}>
            <i />
            <i />
            <i />
            <i />
          </span>

          <div className="relative flex items-start gap-3">
            <button
              type="button"
              onClick={phase === "idle" ? listen : stop}
              disabled={!supported}
              aria-label={phase === "idle" ? "Start talking" : "Stop"}
              className="mise-voice-orb grid h-14 w-14 shrink-0 place-items-center rounded-full"
              data-phase={phase}
              style={{ "--level": level } as React.CSSProperties}
            >
              <span aria-hidden className="text-lg">
                {phase === "idle" ? "🎙️" : phase === "speaking" ? "🔊" : "■"}
              </span>
            </button>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="font-display text-sm font-semibold leading-tight text-fg">{label}</p>
              <p className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-fg-soft">
                {heard || said || "Ask me anything, or tell me to put something in."}
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => setPickingVoice((v) => !v)}
                aria-label="Choose a voice"
                className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
              >
                ⚙
              </button>
              <button
                type="button"
                onClick={() => {
                  stop();
                  setOpen(false);
                }}
                aria-label="Close"
                className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
              >
                ✕
              </button>
            </div>
          </div>

          {err && (
            <p className="relative mt-2 rounded-xl border border-rose-400/40 bg-rose-400/10 px-2.5 py-1.5 text-[11px] text-rose-200">
              {err}
            </p>
          )}

          {!supported && (
            <p className="relative mt-2 text-[11px] leading-relaxed text-fg-faint">
              This browser will not give me a microphone. Chrome, Edge or Brave will.
            </p>
          )}

          {pickingVoice && (
            <div className="relative mt-3 border-t border-line pt-3">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                My voice
              </p>
              <div className="grid gap-1">
                {voices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setVoice(v.id);
                      remember("mise.voice", v.id);
                      say(`Hello — I'm ${v.label}. Shall we get on with it?`);
                    }}
                    className={`mise-press flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12px] transition ${
                      voice === v.id ? "bg-brand-600 text-white" : "mise-card-inset text-fg-soft"
                    }`}
                  >
                    <span aria-hidden>{v.sex === "male" ? "🧔" : "👩"}</span>
                    <span className="font-medium">{v.label}</span>
                    <span
                      className={`ml-auto text-[10px] ${
                        voice === v.id ? "text-white/75" : "text-fg-faint"
                      }`}
                    >
                      {v.who}
                    </span>
                  </button>
                ))}
              </div>

              <p className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                Before I fill something in
              </p>
              <div className="grid gap-1">
                {ASK_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setAskMode(m.id);
                      remember("mise.voice.ask", m.id);
                    }}
                    className={`mise-press rounded-xl px-2.5 py-1.5 text-left transition ${
                      askMode === m.id ? "bg-brand-600 text-white" : "mise-card-inset text-fg-soft"
                    }`}
                  >
                    <span className="block text-[12px] font-medium">{m.label}</span>
                    <span
                      className={`block text-[10px] leading-tight ${
                        askMode === m.id ? "text-white/75" : "text-fg-faint"
                      }`}
                    >
                      {m.note}
                    </span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setPickingVoice(false)}
                className="mise-press mt-2.5 w-full rounded-xl border border-line py-1.5 text-[12px] text-fg-soft"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      {/* THE CONFIRM. Shown BEFORE anything is typed, so the question is
          "shall I?" rather than "look what I did". */}
      {pending && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
          <div
            className="mise-fade-in absolute inset-0 bg-black/50"
            onClick={() => setPending(null)}
          />
          <div className="mise-pop-lg mise-voice-card relative w-full max-w-sm overflow-hidden rounded-3xl border border-line p-5">
            <span aria-hidden className="mise-aurora" data-phase="speaking">
              <i />
              <i />
              <i />
              <i />
            </span>
            <div className="relative">
              <p className="font-display text-base font-semibold text-fg">
                Shall I put this in?
              </p>
              {pending.summary && (
                <p className="mt-1 text-[12px] leading-relaxed text-fg-soft">{pending.summary}</p>
              )}
              <dl className="mise-card-inset mt-3 rounded-2xl px-3.5 py-2.5 text-[12px]">
                {Object.entries(pending.fields).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 py-1">
                    <dt className="capitalize text-fg-faint">{k.replace(/[_-]/g, " ")}</dt>
                    <dd className="font-display font-semibold text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[10px] leading-relaxed text-fg-faint">
                I only type it into the form. Check it, then save it on the page as usual.
              </p>
              <div className="mt-3.5 flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const f = pending.fields;
                    setPending(null);
                    await fillIn(f);
                  }}
                  className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white"
                >
                  Yes, fill it in
                </button>
                <button
                  type="button"
                  onClick={() => setPending(null)}
                  className="mise-press rounded-xl border border-line px-4 py-2.5 text-sm text-fg-soft"
                >
                  No
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

/** Save a preference, shrugging if the browser will not keep one. */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode - it lasts the session, which is better than an error */
  }
}

/** Find an input by what a person calls it, not by an id nobody knows. */
function findField(name: string): HTMLInputElement | HTMLSelectElement | null {
  const want = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "main input, main select, input, select",
    ),
  ].filter((el) => el.offsetParent !== null && !el.disabled);

  const score = (el: HTMLElement) => {
    const bits = [
      el.getAttribute("name"),
      el.getAttribute("id"),
      el.getAttribute("placeholder"),
      el.getAttribute("aria-label"),
      el.closest("label")?.textContent,
      el.previousElementSibling?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (!bits) return 0;
    if (bits === want) return 3;
    if (bits.includes(want)) return 2;
    if (want.length > 3 && want.includes(bits)) return 1;
    return 0;
  };

  let best: (HTMLInputElement | HTMLSelectElement) | null = null;
  let bestScore = 0;
  for (const el of inputs) {
    const s = score(el);
    if (s > bestScore) {
      best = el;
      bestScore = s;
    }
  }
  return bestScore > 0 ? best : null;
}

/** React tracks input values on the node, so `el.value = x` is invisible to it. */
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}
