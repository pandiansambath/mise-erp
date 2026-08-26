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
// THREE THINGS HIS SCREENSHOTS TAUGHT ME, all of them my fault:
//
//   1. It landed on top of the "Ask DineAI" pill. That pill is DRAGGABLE, so
//      the user decides where it lives and I cannot dodge it by picking a
//      cleverer corner. The voice now sits a clear 6rem above the bottom edge,
//      and the launcher disappears while the panel is open — so there are never
//      two floating things fighting over the same square inch.
//   2. "I did not catch that" — because he is on Brave, which ships
//      webkitSpeechRecognition and then blocks the Google endpoint it needs.
//      A blank refusal is the worst possible answer: it reads as OUR bug. It
//      now names the browser fact in the way, and there is a text box so the
//      feature works anyway, in any browser, today.
//   3. "no voice choosing thing and all, nothing is there" — it WAS there, as a
//      7-pixel gear nobody would ever find. Invisible is the same as absent.
//      The current voice is now a named button you can read across the room.
//
// THE HONEST BIT: it fills forms, it does not submit them. The model can ask
// the page to open Sales and type 120 into the amount; the save button is his.
// A spoken instruction is a request, exactly like a click — not a password.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";

import { API_BASE, api, ApiError, getToken } from "@/lib/api";
import { listen as awsListen, type Listener } from "@/lib/transcribe";
import { useDraggable } from "@/components/useDraggable";

type Turn = { role: "user" | "assistant"; content: string };
type Action =
  | { kind: "navigate"; page: string }
  | { kind: "fill"; fields: Record<string, string>; summary: string };
type Voice = { id: string; label: string; who: string; sex: string };

type Phase = "idle" | "listening" | "thinking" | "speaking";

// "confirmation on screen before serious actions, configurable: always ask /
//  give all access / never ask." Held per browser, defaulting to the careful
//  end — a person who wants the fast one will find it, and a person who never
//  opens settings should not discover the fast one by accident.
type Ask = "always" | "money" | "never";
const ASK_MODES: { id: Ask; label: string; note: string }[] = [
  { id: "always", label: "Ask me every time", note: "Nothing is typed in before you say so" },
  {
    id: "money",
    label: "Ask about money & people",
    note: "Sales, wages, staff. The rest just happens",
  },
  { id: "never", label: "Just do it", note: "No confirmation. You are watching anyway" },
];
// Which fields make a thing "serious". A number that ends up in his books is
// worth a second of his attention; a date is not.
const WEIGHTY = /amount|total|price|cost|pay|wage|salary|rate|hours|qty|quantity|staff|employee/i;

// The hardest thing about talking to a machine is not knowing what it can be
// asked. A mic and a silence is a guessing game; three real sentences are an
// offer. One of each kind on purpose — a number, a check, and a page — so the
// shape of what it does is obvious after reading three lines.
const STARTERS = ["What did we take today?", "What's running low?", "Open expenses"];

// How long a gap counts as "he has stopped talking". Short enough that it does
// not feel like waiting; long enough to survive the pause in the middle of "a
// hundred and twenty... cash". The browser's own `isFinal` fires on a rhythm
// nobody can predict, which is why the turn is ended here instead.
const SILENCE_MS = 1300;

// "my.", "the money thing.", "money pin." — the debris of a feedback loop, and
// also what a noisy kitchen produces on its own. Acting on two words of it
// wastes a model call and puts a wrong answer on screen; more importantly it
// TEACHES him the thing mishears, when really it was never spoken to.
const MIN_WORDS = 2;
const MIN_CHARS = 7;

function worthAnswering(text: string): boolean {
  const t = text.trim();
  if (t.length < MIN_CHARS) return false;
  if (t.split(/\s+/).filter(Boolean).length < MIN_WORDS) return false;
  return true;
}

function needsAsking(mode: Ask, fields: Record<string, string>): boolean {
  if (mode === "never") return false;
  if (mode === "always") return true;
  return Object.keys(fields).some((k) => WEIGHTY.test(k));
}

// The Web Speech API ships no types with TypeScript, so this is the slice of it
// we actually touch — written out rather than reached for through `any`, which
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

function recognition(): Recognizer | null {
  if (typeof window === "undefined") return null;
  const W = window as SpeechWindow;
  const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Say what is actually in the way, not "something went wrong". */
function explain(err: string): string {
  if (err === "not-allowed" || err === "service-not-allowed")
    return "The microphone is blocked for this site — allow it from the padlock in the address bar, then try again.";
  if (err === "network")
    return "This browser blocks the speech service (Brave and some privacy browsers do). Type it below — I'll still answer out loud.";
  if (err === "audio-capture") return "I can't find a microphone on this machine.";
  if (err === "no-speech") return "I didn't hear anything that time.";
  return "I didn't catch that — try again, or type it below.";
}

export function VoiceBubble() {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voice, setVoice] = useState("Amy");
  const [panel, setPanel] = useState<"none" | "voice" | "ask">("none");
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    fields: Record<string, string>;
    summary: string;
  } | null>(null);
  const [askMode, setAskMode] = useState<Ask>("money");
  const [level, setLevel] = useState(0);
  const [typed, setTyped] = useState("");
  // What it is doing while it is not yet answering — the model's own words for
  // it, which beat a spinner and beat a lie.
  const [doing, setDoing] = useState("");
  // The bubble renders into document.body, OUTSIDE the `.mise-app` element
  // that carries `data-mode` — so no CSS in globals can tell whether the app is
  // in a light theme. Mirror it onto the card. An aurora tuned against a
  // near-black surface is a highlighter over near-white.
  const [mode, setMode] = useState<"light" | "dark">("dark");
  // "that aurora effect + bubble icon color... you need to change according to
  //  the theme selected... but don't compromise the aurora effects."
  //
  // Every theme already ships its own aurora triple and brand ramp — the
  // landing page has used them all along. The voice was the one thing painting
  // itself emerald-and-violet regardless, which is why it clashed the moment he
  // picked a different theme. So it reads the SAME variables everyone else
  // does. The motion, the blur and the layering are untouched; only the
  // pigment now comes from his choice instead of mine.
  const [paint, setPaint] = useState<Record<string, string>>({});
  useEffect(() => {
    const app = document.querySelector(".mise-app");
    const read = () => {
      setMode(app?.getAttribute("data-mode") === "light" ? "light" : "dark");
      const from = app ?? document.documentElement;
      const cs = getComputedStyle(from);
      const pick = (name: string, fallback: string) =>
        (cs.getPropertyValue(name) || "").trim() || fallback;
      setPaint({
        "--v1": pick("--mise-aurora-1", "#10b981"),
        "--v2": pick("--mise-aurora-2", "#0ea5e9"),
        "--v3": pick("--mise-aurora-3", "#14b8a6"),
        // A fourth, warmer note so the drift does not read as one colour
        // breathing. The brand ramp is the only place to get it that is
        // guaranteed to suit whatever he picked.
        "--v4": pick("--color-brand-400", "#34d399"),
        "--vbrand": pick("--color-brand-500", "#10b981"),
      });
    };
    read();
    if (!app) return;
    const obs = new MutationObserver(read);
    obs.observe(app, { attributes: true, attributeFilter: ["data-mode", "style", "class"] });
    return () => obs.disconnect();
  }, []);

  const [live, setLive] = useState(false);
  // A browser that refused to autoplay has to be tapped once before it will
  // ever make a sound. Saying so is the difference between "broken" and "tap".
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    phaseRef.current = phase;
    // Thinking counts as deaf too: a reply is coming, and anything picked up
    // in the meantime is either the room or our own last sentence.
    if (phase === "thinking" || phase === "speaking") deafUntilRef.current = Date.now() + 1200;
  }, [phase]);

  // "we can drag the chat ui anywhere in screen... we can tap the bubble and
  //  move anywhere in screen... these are missing." They were: the old Copilot
  //  had both, and I dropped them when the voice panel became the only
  //  assistant. Where a floating thing lives is the user's decision — no corner
  //  we pick is free on every page.
  const bubbleDrag = useDraggable("mise.voice.bubble");
  const panelDrag = useDraggable("mise.voice.panel");

  const recRef = useRef<Recognizer | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Refs, not state, because the recogniser's callbacks are created once and
  // would otherwise read whatever these were when the microphone started.
  const liveRef = useRef(false);
  // Once a browser has proved it will not do speech, stop asking it.
  const preferAwsRef = useRef(false);
  const greetedRef = useRef(false);
  const heardRef = useRef("");
  const silenceRef = useRef<number | null>(null);
  const awsRef = useRef<Listener | null>(null);
  const queueRef = useRef<string[]>([]);
  const drainingRef = useRef(false);
  // It hears itself. Amy comes out of the speakers, back in through the
  // microphone, gets transcribed, and answers — and every answer starts
  // another one. That is the flicker: a new turn every second, forever.
  //
  // `draining` alone was deaf only while a chunk was actually PLAYING, which
  // leaves three holes: before the first chunk arrives, between queued
  // sentences, and while the last word is still in the room. Each is wide
  // enough to start the loop. `echoCancellation` cannot help — a laptop
  // speaker into a laptop microphone defeats browser AEC routinely.
  const deafUntilRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const logRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef<HTMLInputElement | null>(null);
  const camRef = useRef<HTMLInputElement | null>(null);
  const supported = typeof window !== "undefined" && !!recognition();
  const current = voices.find((v) => v.id === voice);

  useEffect(() => {
    if (!open || voices.length) return;
    api
      .get<{ voices: Voice[]; default: string }>("/assistant/voice/voices")
      .then((d) => setVoices(d.voices ?? []))
      .catch(() => {});
  }, [open, voices.length]);

  // A person picks a voice once; asking again every session is the app
  // forgetting something it was told.
  useEffect(() => {
    try {
      const v = localStorage.getItem("mise.voice");
      if (v) setVoice(v);
      const a = localStorage.getItem("mise.voice.ask");
      if (a === "always" || a === "money" || a === "never") setAskMode(a);
    } catch {
      /* private mode — the defaults are fine */
    }
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, phase]);

  // ── The mouth: a queue, not a request ────────────────────────────────────
  //
  // The server now sends audio a sentence at a time, as each sentence is
  // written. So playback is a QUEUE that drains in order — the first sentence
  // is already being spoken while the model is still thinking of the second.
  // That is where the eight seconds went.
  const playChunk = useCallback((b64: string) => {
    return new Promise<void>((resolve) => {
      const a = new Audio(`data:audio/mpeg;base64,${b64}`);
      audioRef.current = a;
      const done = () => resolve();
      a.onended = done;
      a.onerror = done;
      a.play().catch(() => {
        // A browser that refuses autoplay must not leave the queue hanging.
        setNeedsTap(true);
        resolve();
      });
    });
  }, []);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    setPhase("speaking");
    const tick = window.setInterval(() => setLevel(0.35 + Math.random() * 0.5), 110);
    try {
      while (queueRef.current.length) {
        const next = queueRef.current.shift();
        if (next) await playChunk(next);
      }
    } finally {
      window.clearInterval(tick);
      setLevel(0);
      drainingRef.current = false;
      // The last word is still in the room after the file has finished.
      deafUntilRef.current = Date.now() + 900;
      // Back to listening, because the microphone never actually left.
      setPhase(liveRef.current ? "listening" : "idle");
    }
  }, [playChunk]);


  /** Type the values into the real form on the real page. */
  const fillIn = useCallback(async (fields: Record<string, string>) => {
    await new Promise((r) => setTimeout(r, 400));
    // Anything we could not place. Saying "filled it in" over an empty box is
    // the worst outcome available: he walks away believing a number is in his
    // books. If a field cannot be found he has to be TOLD, in the same breath.
    const missed: string[] = [];
    for (const [name, value] of Object.entries(fields)) {
      const el = findField(name);
      if (!el) {
        missed.push(name);
        continue;
      }
      if (!setNativeValue(el, value)) {
        // The box exists but will not take that value — a dropdown with no
        // matching option. Say so rather than leaving the old one showing.
        missed.push(`${name} (no "${value}" to choose)`);
        continue;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("mise-voice-filled");
      window.setTimeout(() => el.classList.remove("mise-voice-filled"), 2400);
      await new Promise((r) => setTimeout(r, 220));
    }
    if (missed.length) {
      setErr(
        `I couldn't find a box for ${missed.join(" or ")} on this page — you'll need to put ` +
          `that one in yourself.`,
      );
    }
  }, []);

  const goTo = useCallback(
    async (actions: Action[]) => {
      for (const a of actions) {
        if (a.kind !== "navigate") continue;
        router.push(`/${a.page.replace(/^\//, "")}`);
        await new Promise((r) => setTimeout(r, 900));
      }
    },
    [router],
  );

  // ── One turn, streamed ───────────────────────────────────────────────────
  //
  // Text arrives as it is written and audio a sentence at a time, so the reply
  // starts appearing in well under a second instead of after eight. Same model,
  // same tools, same answers — only the order changed.
  const ask = useCallback(
    async (text: string) => {
      setPhase("thinking");
      setErr(null);
      setHeard("");
      setDoing("");
      setTurns((t) => [...t, { role: "user", content: text }]);
      let reply = "";
      const fills: Extract<Action, { kind: "fill" }>[] = [];

      try {
        const res = await fetch(`${API_BASE}/api/assistant/voice/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
          },
          body: JSON.stringify({
            text,
            history: turns.slice(-8),
            route: pathname,
            voice,
          }),
        });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

        setTurns((t) => [...t, { role: "assistant", content: "" }]);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";

          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (ev.type === "doing") {
              // Something on screen at ~1s instead of ~3s. It is the truth,
              // too: this is genuinely what it is off doing.
              setDoing(String(ev.label ?? ""));
              setTurns((t) => {
                if (t.length && t[t.length - 1].role === "assistant") return t;
                return [...t, { role: "assistant", content: "" }];
              });
            } else if (ev.type === "draft") {
              // Straight onto the screen. It is not spoken until the server
              // says it was the answer rather than a thought.
              reply += String(ev.text ?? "");
              if (reply) setDoing("");
              setTurns((t) => {
                const copy = [...t];
                copy[copy.length - 1] = { role: "assistant", content: reply };
                return copy;
              });
            } else if (ev.type === "draft_drop") {
              // That text was the model thinking out loud on its way to
              // looking something up. Say so, honestly, instead of leaving a
              // half-answer on screen that is about to be replaced.
              reply = "";
              setDoing(String(ev.text ?? "") || "Looking that up…");
              setTurns((t) => {
                const copy = [...t];
                copy[copy.length - 1] = { role: "assistant", content: "" };
                return copy;
              });
            } else if (ev.type === "delta") {
              reply += String(ev.text ?? "");
              setTurns((t) => {
                const copy = [...t];
                copy[copy.length - 1] = { role: "assistant", content: reply };
                return copy;
              });
            } else if (ev.type === "audio" && typeof ev.b64 === "string") {
              queueRef.current.push(ev.b64);
              void drain();
            } else if (ev.type === "action") {
              const a = ev.action as Action;
              // Navigating shows him something; it changes nothing. Gating a
              // LOOK behind a dialog just teaches people to click yes.
              if (a?.kind === "navigate") await goTo([a]);
              else if (a?.kind === "fill") fills.push(a);
            } else if (ev.type === "error") {
              throw new Error(String(ev.message ?? "the assistant stopped"));
            }
          }
        }

        if (fills.length) {
          // Several fills are one intention: "a 120 pound cash sale" is one
          // thing to agree to, not three. Merge them into a single question.
          const fields = Object.assign({}, ...fills.map((f) => f.fields)) as Record<
            string,
            string
          >;
          const summary = fills
            .map((f) => f.summary)
            .filter(Boolean)
            .join(" ");
          if (needsAsking(askMode, fields)) setPending({ fields, summary });
          else await fillIn(fields);
        }
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "I could not reach the assistant.");
        setPhase(liveRef.current ? "listening" : "idle");
        return;
      }

      // If nothing is queued to say, we are done talking; if something is, the
      // drain will put us back to listening when it finishes.
      if (!queueRef.current.length && !drainingRef.current) {
        setPhase(liveRef.current ? "listening" : "idle");
      }
    },
    [turns, pathname, voice, goTo, fillIn, askMode, drain],
  );

  // ── The ear: on until he turns it off ────────────────────────────────────
  //
  // "we are not implementing voice to text model... once the voice model is
  //  turned on it needs to be live always until they close the site... it need
  //  to listen to each and every thing in realtime."
  //
  // Two things had to change for that. `continuous` was FALSE, so the
  // recogniser stopped at the first pause — which is exactly why it answered
  // half a sentence. And the turn was ended by the browser's own idea of
  // "final", which arrives whenever it feels like it. Now WE decide the turn
  // is over: every result resets a silence timer, and the turn ends when he
  // has actually stopped talking.
  const askRef = useRef(ask);
  askRef.current = ask;

  const armSilence = useCallback(() => {
    if (silenceRef.current) window.clearTimeout(silenceRef.current);
    silenceRef.current = window.setTimeout(() => {
      const said = heardRef.current.trim();
      heardRef.current = "";
      if (worthAnswering(said)) void askRef.current(said);
      else setHeard("");
    }, SILENCE_MS);
  }, []);

  /** Deaf while we are talking, thinking, or still echoing. */
  const isDeaf = useCallback(
    () => drainingRef.current || phaseRef.current !== "listening" || Date.now() < deafUntilRef.current,
    [],
  );

  /** Plan B, and for Brave the only plan: stream to Transcribe ourselves. */
  const startAws = useCallback(async () => {
    try {
      const { url } = await api.get<{ url: string }>("/assistant/voice/listen-url");
      const handle = await awsListen({
        url,
        muted: () => isDeaf(),
        onError: (m) => setErr(m),
        onText: (text, final) => {
          // Belt and braces: audio already in flight when we went deaf still
          // comes back as a transcript a moment later.
          if (isDeaf()) return;
          heardRef.current = text;
          setHeard(text);
          setLevel(0.3 + Math.min(0.6, text.length / 60));
          // Transcribe tells us when an utterance ended, which is a better
          // signal than any timer — but the timer stays as a backstop for a
          // sentence it never closes.
          if (final) {
            if (silenceRef.current) window.clearTimeout(silenceRef.current);
            const said = text.trim();
            heardRef.current = "";
            if (worthAnswering(said)) void askRef.current(said);
            else setHeard("");
          } else {
            armSilence();
          }
        },
      });
      awsRef.current = handle;
      liveRef.current = true;
      setLive(true);
      setErr(null);
      setPhase("listening");
      // A level meter that follows the actual microphone, not a guess.
      const tick = window.setInterval(() => {
        if (!liveRef.current) {
          window.clearInterval(tick);
          return;
        }
        if (!drainingRef.current) setLevel(Math.min(1, handle.level() * 3));
      }, 120);
    } catch (e) {
      setPhase("idle");
      setLive(false);
      liveRef.current = false;
      setErr(
        e instanceof Error && /denied|not allowed|Permission/i.test(e.message)
          ? "The microphone is blocked for this site — allow it from the padlock in the address bar."
          : "I couldn't open the microphone just then. Try again?",
      );
    }
  }, [armSilence, isDeaf]);

  const startLive = useCallback(() => {
    const rec = recognition();
    // Brave ships the API and blocks the service behind it, so "it exists" is
    // not the same as "it works". We find that out from the network error and
    // switch permanently for this session rather than failing twice.
    if (!rec || preferAwsRef.current) {
      void startAws();
      return;
    }
    rec.lang = "en-GB";
    rec.interimResults = true;
    rec.continuous = true;
    recRef.current = rec;
    liveRef.current = true;
    setLive(true);
    setErr(null);
    setHeard("");
    heardRef.current = "";
    setPhase("listening");

    rec.onresult = (e) => {
      // Same loop, same deafness — the browser's own ears hear the speakers too.
      if (isDeaf()) return;
      let text = "";
      for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript;
      heardRef.current = text;
      setHeard(text);
      setLevel(0.3 + Math.min(0.6, text.length / 60));
      armSilence();
    };
    rec.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      setLevel(0);
      setErr(explain(e.error));
      // A blocked speech service is permanent for this browser; restarting in
      // a loop would spin forever and say nothing. This is what left him
      // staring at "Listening…" for two minutes.
      if (e.error === "network" || e.error === "service-not-allowed") {
        // The browser's own speech service is unreachable. Do not stand down —
        // this is exactly the case our own ears exist for.
        preferAwsRef.current = true;
        setErr(null);
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        void startAws();
        return;
      }
      if (e.error === "not-allowed") {
        liveRef.current = false;
        setLive(false);
        setPhase("idle");
      }
    };
    rec.onend = () => {
      // Chrome ends the session on its own every so often even in continuous
      // mode. If he has not turned it off, it goes straight back on — that is
      // what "live until they close the site" actually costs.
      if (!liveRef.current) {
        setPhase("idle");
        return;
      }
      try {
        rec.start();
      } catch {
        /* already running — nothing to do */
      }
    };

    try {
      rec.start();
    } catch {
      setPhase("idle");
      setErr("The microphone is already in use.");
    }
  }, [armSilence, startAws, isDeaf]);

  // It speaks first. "once user click the voice model that model need to start
  // the conversation... it need to guide and initiate conversation." An
  // assistant that waits to be spoken to is a strange thing to have built.
  useEffect(() => {
    if (!open || greetedRef.current) return;
    greetedRef.current = true;
    api
      .get<{ text: string; audio: string }>(`/assistant/voice/hello?voice_id=${voice}`)
      .then((d) => {
        if (!d.text) return;
        setTurns((t) => (t.length ? t : [{ role: "assistant", content: d.text }]));
        if (d.audio) {
          queueRef.current.push(d.audio);
          void drain();
        }
      })
      .catch(() => {
        /* a silent open is survivable; a broken one is not */
      });
    // `voice` is read once, on open, on purpose — changing voice mid-session
    // must not re-greet him.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, drain]);

  /** Say one line in a voice, so picking one is a decision you can hear. */
  const preview = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/assistant/voice/speak`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
          },
          body: JSON.stringify({ text: `Hello, I'm ${id}. Shall we get on with it?`, voice: id }),
        });
        if (!res.ok) return;
        const buf = await res.arrayBuffer();
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        queueRef.current.push(b64);
        void drain();
      } catch {
        /* a preview that will not play is not worth an error message */
      }
    },
    [drain],
  );

  const stop = useCallback(() => {
    liveRef.current = false;
    setLive(false);
    if (silenceRef.current) window.clearTimeout(silenceRef.current);
    queueRef.current = [];
    recRef.current?.abort();
    awsRef.current?.stop();
    awsRef.current = null;
    audioRef.current?.pause();
    setPhase("idle");
    setLevel(0);
  }, []);

  /** Pass a file to the page that can read it.
   *
   * Reimplementing the scan flow in a corner bubble would mean a second copy of
   * the extract-confirm-save path — the part where a wrong number reaches his
   * books. So the file rides across in memory and /ai-scan picks it up.
   */
  const handOff = useCallback(
    (file: File) => {
      try {
        (window as Window & { __miseHandoff?: File }).__miseHandoff = file;
      } catch {
        /* nothing to do */
      }
      stop();
      setOpen(false);
      router.push("/ai-scan?handoff=1");
    },
    [router, stop],
  );

  // An open microphone on a counter is a bill. Close on the way out.
  useEffect(() => () => stop(), [stop]);

  // Get the OTHER floating launcher out of the way while this panel is up.
  //
  // The "Ask DineAI" pill is draggable - the user decides where it lives - so
  // there is no corner I can pick that is guaranteed to be free, and his
  // screenshot is what picking one looks like when you guess wrong. Standing
  // it down while the voice is open is the only version that cannot collide.
  useEffect(() => {
    const cls = "mise-voice-open";
    document.body.classList.toggle(cls, open);
    return () => document.body.classList.remove(cls);
  }, [open]);

  if (!open) {
    return (
      <button
        type="button"
        {...bubbleDrag.handlers}
        onClick={() => {
          if (bubbleDrag.wasDrag()) return;
          setOpen(true);
        }}
        aria-label="Talk to DineAI"
        title="Talk to DineAI"
        style={{ ...paint, ...bubbleDrag.style } as React.CSSProperties}
        className={`mise-voice-launch fixed bottom-44 right-5 z-[60] grid h-14 w-14 touch-none place-items-center rounded-full text-white lg:bottom-24 lg:right-6 ${
          bubbleDrag.dragging ? "scale-110 cursor-grabbing" : "cursor-grab"
        }`}
      >
        <MicIcon className="h-6 w-6" />
      </button>
    );
  }

  // It is live until he stops it, so "listening" is the resting state, not a
  // held button. The wording has to say that, or he taps it again to "start"
  // something that never stopped.
  const label =
    phase === "listening"
      ? heard
        ? "…go on"
        : "Listening — just talk"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? `${current?.label ?? "DineAI"} is talking`
          : "Tap to go live";

  return createPortal(
    <>
      {/* 🌈 LIVE. The whole window breathes in aurora colours while it is
          hearing or speaking — "when we are live with voice then it needs to
          glow in aurora kinda colour". It is the thing you can see from the
          other side of a kitchen, which is exactly when you need to know
          whether the machine is still listening to you. Nothing but light: it
          takes no clicks and covers nothing. */}
      {phase !== "idle" && (
        <div
          className="mise-live-glow"
          data-phase={phase}
          data-mode={mode}
          style={paint as React.CSSProperties}
          aria-hidden
        />
      )}

      <div
        style={panelDrag.style}
        className="mise-voice fixed bottom-44 right-5 z-[65] w-[min(23rem,calc(100vw-2.5rem))] lg:bottom-24 lg:right-6"
      >
        <div
          className="mise-voice-card relative rounded-3xl border border-line"
          data-live={phase !== "idle"}
          data-mode={mode}
          style={paint as React.CSSProperties}
        >
          {/* THE AURORA. Four blurred blobs drifting behind the glass — it is
              the whole personality of this thing, and it costs four divs. */}
          <span aria-hidden className="mise-voice-aurora" data-phase={phase}>
            <i />
            <i />
            <i />
            <i />
          </span>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <div
            {...panelDrag.handlers}
            className={`relative flex touch-none items-center gap-2 border-b border-line/70 px-3.5 py-2.5 ${
              panelDrag.dragging ? "cursor-grabbing" : "cursor-grab"
            }`}
          >
            <span className="mise-voice-dot" data-phase={phase} aria-hidden />
            <p className="font-display text-[13px] font-semibold text-fg">
              DineAI Voice
              {live && (
                <span className="mise-voice-live ml-1.5 align-middle text-[9px] font-bold uppercase tracking-wider">
                  live
                </span>
              )}
            </p>
            <div className="ml-auto flex items-center gap-1">
              {/* The voice, named. It was a 7-pixel gear and he could not find
                  it, which is the same as it not being there. */}
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "voice" ? "none" : "voice"))}
                className="mise-press mise-card-inset flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-fg-soft"
                aria-label="Choose a voice"
              >
                <span aria-hidden>{current?.sex === "male" ? "🧔" : "👩"}</span>
                {current?.label ?? voice}
                <span aria-hidden className="text-[8px] opacity-70">
                  ▾
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "ask" ? "none" : "ask"))}
                aria-label="When to ask me first"
                title="When to ask me first"
                className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
              >
                <GearIcon className="h-4 w-4" />
              </button>
              {/* This is the only assistant button on the page now, so the
                  way through to files and history has to live here — or
                  combining the two launchers would have quietly removed
                  bill scanning from every screen. */}
              <button
                type="button"
                onClick={() => {
                  stop();
                  setOpen(false);
                  setPanel("none");
                  router.push("/ai-scan");
                }}
                aria-label="Open the full chat"
                title="Full chat, files and history"
                className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
              >
                <ExpandIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  stop();
                  setOpen(false);
                  setPanel("none");
                }}
                aria-label="Close"
                className="mise-press grid h-7 w-7 place-items-center rounded-lg text-fg-faint hover:text-fg"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Settings sheets ────────────────────────────────────────── */}
          {panel === "voice" && (
            <div className="relative grid gap-1 border-b border-line/70 px-3 py-2.5">
              <p className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                Whose voice
              </p>
              {voices.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setVoice(v.id);
                    remember("mise.voice", v.id);
                    setPanel("none");
                    void preview(v.id);
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
          )}

          {panel === "ask" && (
            <div className="relative grid gap-1 border-b border-line/70 px-3 py-2.5">
              <p className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                Before I fill something in
              </p>
              {ASK_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setAskMode(m.id);
                    remember("mise.voice.ask", m.id);
                    setPanel("none");
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
          )}

          {/* ── The orb ────────────────────────────────────────────────── */}
          {/*  It is the whole personality of this thing when there is nothing
              else to look at, and it is in the way the moment there is. So it
              is full size on an empty panel and a small control once a
              conversation exists — the room goes to the words.  */}
          <div
            className={`relative flex px-4 ${
              turns.length
                ? "items-center gap-3 pb-2.5 pt-3"
                : "flex-col items-center pb-3 pt-4"
            }`}
          >
            <button
              type="button"
              onClick={live ? stop : startLive}
              disabled={!supported}
              aria-label={live ? "Stop listening" : "Start listening"}
              className={`mise-voice-orb grid shrink-0 place-items-center rounded-full ${
                turns.length ? "h-11 w-11" : "h-20 w-20"
              }`}
              data-phase={phase}
              style={{ ...paint, "--level": level } as React.CSSProperties}
            >
              {phase === "idle" ? (
                <MicIcon className={turns.length ? "h-5 w-5" : "h-7 w-7"} />
              ) : phase === "speaking" ? (
                <WaveIcon className={turns.length ? "h-5 w-5" : "h-7 w-7"} />
              ) : (
                <span
                  aria-hidden
                  className={`block rounded-[3px] bg-white ${
                    turns.length ? "h-3 w-3" : "h-4 w-4"
                  }`}
                />
              )}
            </button>
            <div className={turns.length ? "min-w-0 flex-1" : "contents"}>
              <p
                className={`font-display text-[13px] font-semibold text-fg ${
                  turns.length ? "" : "mt-2.5"
                }`}
              >
                {label}
              </p>
              {heard && (
                <p
                  className={`text-[11px] text-fg-soft ${
                    turns.length ? "truncate" : "mt-0.5 text-center"
                  }`}
                >
                  “{heard}”
                </p>
              )}
            </div>

            {turns.length === 0 && phase === "idle" && !heard && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {STARTERS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => ask(q)}
                    className="mise-press mise-card-inset rounded-full px-2.5 py-1 text-[11px] text-fg-soft transition hover:text-fg"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── What has been said ─────────────────────────────────────── */}
          {/*  "how tight it is.. make it free" — it was 160px of flat
              paragraphs, which is a log, not a conversation. Now it is the
              biggest thing in the panel, it keeps the whole exchange rather
              than the last six lines, and the two speakers actually look
              different from each other.  */}
          {turns.length > 0 && (
            <div
              ref={logRef}
              className="relative max-h-[44vh] min-h-[8rem] space-y-2.5 overflow-y-auto border-t border-line/70 px-3.5 py-3.5"
            >
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <p className="mise-voice-said max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[12.5px] leading-relaxed">
                      {t.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <p className="mise-card-inset max-w-[92%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[12.5px] leading-relaxed text-fg">
                      {t.content ||
                        (i === turns.length - 1 && doing ? (
                          <span className="text-fg-faint">{doing}</span>
                        ) : (
                          <span className="mise-voice-dots" aria-label="thinking">
                            <i />
                            <i />
                            <i />
                          </span>
                        ))}
                    </p>
                  </div>
                ),
              )}
            </div>
          )}

          {err && (
            <p className="mise-voice-warn relative mx-3.5 mb-2 mt-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200">
              {err}
            </p>
          )}

          {/* A browser that has never been interacted with refuses to make a
              sound, and the rejection is silent. Without this the assistant
              looks broken when it is one tap from working. */}
          {needsTap && (
            <button
              type="button"
              onClick={() => {
                setNeedsTap(false);
                void drain();
              }}
              className="mise-voice-warn relative mx-3.5 mb-2 mt-2 block w-[calc(100%-1.75rem)] rounded-xl border border-amber-400/40 bg-amber-400/10 px-2.5 py-2 text-left text-[11px] leading-relaxed text-amber-200"
            >
              This browser won’t let me speak until you tap once. Tap here and I’ll carry on.
            </button>
          )}

          {/* ── Type it instead ────────────────────────────────────────── */}
          {/*  Not a consolation prize. Brave and several privacy browsers ship
              the speech API and block the service behind it, a phone in a loud
              kitchen mishears, and sometimes you simply cannot talk out loud.
              Typed or spoken, the same brain answers and the same page moves —
              so the feature is never dead, it only changes how it starts.  */}
          <form
            className="relative flex items-center gap-2 border-t border-line/70 px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const t = typed.trim();
              if (!t) return;
              setTyped("");
              ask(t);
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={supported ? "…or type it here" : "Type what you need"}
              aria-label="Type what you need"
              className="mise-card-inset min-w-0 flex-1 rounded-xl bg-transparent px-3 py-2 text-[12px] text-fg outline-none placeholder:text-fg-faint"
            />
            {/* "what and all feature we had in previous ai chat interface — the
                photo, file upload feature etc — are missing in this ai
                interface." Combining the two launchers must not quietly delete
                bill scanning from every screen, so the paperclip comes back —
                and it hands the file to the page that is actually built to
                read it, with its confirm-before-saving flow intact. */}
            <label
              className="mise-press grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-xl text-fg-faint hover:text-fg"
              title="Send a bill, a photo or a file"
              aria-label="Send a bill, a photo or a file"
            >
              <input
                ref={pickRef}
                type="file"
                // "if mobile means we need to allow camera also..photos etc."
                // A phone offers Camera, Photo Library and Files from ONE
                // input as long as we do not pin it to a capture device —
                // `capture` would force the camera and remove the choice.
                accept="image/*,application/pdf,.csv,.xlsx,.xls,.txt"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  handOff(file);
                  e.target.value = "";
                }}
              />
              <ClipIcon className="h-4 w-4" />
            </label>
            <button
              type="button"
              onClick={() => camRef.current?.click()}
              title="Take a photo of a bill"
              aria-label="Take a photo of a bill"
              className="mise-press grid h-8 w-8 shrink-0 place-items-center rounded-xl text-fg-faint hover:text-fg lg:hidden"
            >
              <CameraIcon className="h-4 w-4" />
            </button>
            {/* A SECOND input, camera-pinned, for the phone. One input cannot
                both offer the library and open the lens straight away. */}
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                handOff(file);
                e.target.value = "";
              }}
            />
            <button
              type="submit"
              disabled={!typed.trim() || phase === "thinking"}
              aria-label="Send"
              className="mise-press grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-600 text-white disabled:opacity-40"
            >
              <ArrowIcon className="h-4 w-4" />
            </button>
          </form>
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
          <div className="mise-pop-lg mise-voice-card relative w-full max-w-sm rounded-3xl border border-line p-5"
            data-mode={mode}>
            <span aria-hidden className="mise-voice-aurora" data-phase="speaking">
              <i />
              <i />
              <i />
              <i />
            </span>
            <div className="relative">
              <p className="font-display text-base font-semibold text-fg">Shall I put this in?</p>
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

/* ── Icons. Drawn rather than typed, because an emoji glyph is a different
      shape and weight in every browser, and this one is the product's face. */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
    </svg>
  );
}
function WaveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  );
}
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l8.49-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.78-7.78" />
    </svg>
  );
}

function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3H5a2 2 0 0 0-2 2v4M15 3h4a2 2 0 0 1 2 2v4M9 21H5a2 2 0 0 1-2-2v-4M15 21h4a2 2 0 0 0 2-2v-4" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </svg>
  );
}
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13M12 5l7 7-7 7" />
    </svg>
  );
}

/** Save a preference, shrugging if the browser will not keep one. */
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode — it lasts the session, which is better than an error */
  }
}

/** Find an input by what a person calls it, not by an id nobody knows. */
// The model says "amount". The Sales page says "Gross". Both are right, and
// nothing matches — so the number was silently typed nowhere, which is the
// worst possible outcome: it navigated, it said "filled it in", and the box was
// empty. The model cannot see the page, so the translation has to live here.
const SYNONYMS: Record<string, string[]> = {
  amount: ["gross", "total", "value", "price", "net", "sum", "cost"],
  method: ["paymentmethod", "paidby", "payment", "type"],
  category: ["cat", "group", "kind", "type"],
  description: ["note", "notes", "detail", "details", "memo", "reference", "what"],
  vendor: ["supplier", "seller", "from", "payee"],
  date: ["on", "when", "day"],
  quantity: ["qty", "count", "number", "howmany", "units"],
  item: ["product", "ingredient", "name", "what"],
};

function findField(name: string): HTMLInputElement | HTMLSelectElement | null {
  const raw = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = raw;
  const alsoTry = SYNONYMS[raw] ?? [];
  const inputs = [
    ...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select"),
  ].filter((el) => el.offsetParent !== null && !el.disabled && el.getAttribute("type") !== "hidden");

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
    if (bits === want) return 5;
    if (bits.includes(want)) return 4;
    if (want.length > 3 && want.includes(bits)) return 3;
    // A synonym is a weaker match than the real name, never a stronger one:
    // "total" must not beat a field actually called "amount".
    for (const alt of alsoTry) {
      if (bits === alt) return 2;
      if (bits.includes(alt)) return 1;
    }
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
function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string): boolean {
  // A <select> only accepts a value that IS one of its options. He said "cash",
  // the option is <option value="card">CARD</option> and friends — so assigning
  // "cash" did nothing at all and the dropdown stayed on CARD. The number went
  // in, the reply said "cash", and the sale would have been recorded against
  // the wrong payment method. Silently wrong is worse than visibly empty, and
  // this one is about money.
  if (el instanceof HTMLSelectElement) {
    const want = value.trim().toLowerCase();
    const match =
      [...el.options].find((o) => o.value.trim().toLowerCase() === want) ??
      [...el.options].find((o) => (o.textContent || "").trim().toLowerCase() === want) ??
      [...el.options].find((o) => (o.textContent || "").trim().toLowerCase().includes(want));
    if (!match) return false;
    value = match.value;
  }
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  return true;
}
