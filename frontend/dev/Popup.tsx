"use client";

// The one popup pandi-dev uses: centred, over a blurred page, and it GROWS out
// of whatever opened it — a month block, the palette button — then shrinks
// back into it on close. The zoom is what tells you which thing you opened.
//
// Rendered into <body> through a portal: the designs carry transforms, and a
// transformed ancestor would pin a "fixed" layer to itself instead of to the
// screen. The theme's variables are copied onto the portal root so the popup
// wears the page's theme even though it lives outside the page's element.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

/** Lets content inside a Popup close it WITH the shrink animation. */
const CloseContext = createContext<(() => void) | null>(null);
export function usePopupClose() {
  return useContext(CloseContext);
}

export type Origin = { x: number; y: number } | null;

export function originOf(el: Element | null): Origin {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function Popup({
  label,
  origin,
  onClose,
  children,
  wide = false,
}: {
  label: string;
  origin: Origin;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const closing = useRef(false);

  useEffect(() => {
    const el = document.createElement("div");
    // Wear the page's theme: copy its --d-* variables, and keep copying, so a
    // theme picked in the studio repaints the studio itself.
    const root = document.querySelector<HTMLElement>(".dev-root");
    const copy = () => root && el.setAttribute("style", root.getAttribute("style") ?? "");
    copy();
    const mo = root ? new MutationObserver(copy) : null;
    if (root) mo?.observe(root, { attributes: true, attributeFilter: ["style"] });
    el.className = "dev-popup-host";
    document.body.appendChild(el);
    setHost(el);
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      mo?.disconnect();
      document.body.style.overflow = before;
      el.remove();
    };
  }, []);

  const motion = useCallback(
    (direction: "in" | "out") => {
      const c = card.current;
      if (!c) return null;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const r = c.getBoundingClientRect();
      const from = origin
        ? `translate(${origin.x - (r.left + r.width / 2)}px, ${origin.y - (r.top + r.height / 2)}px) scale(.12)`
        : "translate(0, 18px) scale(.94)";
      const frames = [
        { transform: from, opacity: 0, filter: "blur(6px)" },
        { transform: "none", opacity: 1, filter: "blur(0)" },
      ];
      const a = c.animate(direction === "in" ? frames : frames.reverse(), {
        duration: reduced ? 1 : direction === "in" ? 520 : 300,
        easing: direction === "in" ? "cubic-bezier(.2,1.1,.3,1)" : "cubic-bezier(.4,0,.8,.4)",
        fill: "both",
      });
      shade.current?.animate([{ opacity: direction === "in" ? 0 : 1 }, { opacity: direction === "in" ? 1 : 0 }], {
        duration: reduced ? 1 : 300,
        fill: "both",
      });
      return a;
    },
    [origin],
  );

  useLayoutEffect(() => {
    if (host) motion("in");
  }, [host, motion]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const a = motion("out");
    if (a) a.onfinish = onClose;
    else onClose();
  }, [motion, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close]);

  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={label}>
      <div
        ref={shade}
        onClick={close}
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: "color-mix(in srgb, var(--d-bg) 72%, transparent)" }}
      />
      <div
        ref={card}
        className={`relative max-h-[88dvh] w-full overflow-y-auto overscroll-contain rounded-3xl border border-[var(--d-line2)] p-5 text-[var(--d-ink)] sm:p-7 ${
          wide ? "max-w-3xl" : "max-w-md"
        }`}
        style={{
          background: "linear-gradient(160deg, var(--d-bg2), var(--d-bg))",
          boxShadow:
            "0 40px 120px -30px rgba(0,0,0,.65), inset 0 1px 0 color-mix(in srgb, var(--d-ink) 8%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--d-ink) 3%, transparent)",
        }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full border border-[var(--d-line)] text-[var(--d-ink4)] transition hover:border-[var(--d-line2)] hover:text-[var(--d-ink)]"
        >
          <IconClose width={16} height={16} />
        </button>
        <CloseContext.Provider value={close}>{children}</CloseContext.Provider>
      </div>
    </div>,
    host,
  );
}

/** The password door. Checked by the server; the page never knows the answer. */
export function Gate({
  origin,
  onDone,
}: {
  origin: Origin;
  onDone: (password: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "wrong" | "busy">("idle");
  const input = useRef<HTMLInputElement>(null);
  const result = useRef<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 200);
    return () => clearTimeout(id);
  }, []);

  const submit = async () => {
    if (!value || state === "checking") return;
    setState("checking");
    try {
      const r = await fetch("/api/dev-site/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: value }),
      });
      if (r.ok) {
        result.current = value;
        closeRef.current?.();
        return;
      }
      setState(r.status === 429 ? "busy" : "wrong");
    } catch {
      setState("wrong");
    }
  };

  // The popup's own close runs the shrink animation; on finish we report.
  const closeRef = useRef<(() => void) | null>(null);

  return (
    <Popup label="Unlock editing" origin={origin} onClose={() => onDone(result.current)}>
      <CloseHandle register={(fn) => (closeRef.current = fn)} />
      <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">OWNER ONLY</p>
      <h2 className="mt-2 text-xl font-semibold">Unlock editing</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--d-ink4)]">
        Enter the password to edit the months and choose the site’s default look.
      </p>
      <form
        className="mt-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          ref={input}
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (state !== "checking") setState("idle");
          }}
          placeholder="Password"
          className={`w-full rounded-xl border bg-[var(--d-shade)] px-4 py-3 font-mono text-[14px] text-[var(--d-ink)] outline-none transition focus-visible:!shadow-none focus-visible:!outline-none placeholder:text-[var(--d-ink6)] focus:border-[var(--d-b)] ${
            state === "wrong" ? "border-[#f0736a]" : "border-[var(--d-line2)]"
          }`}
          style={state === "wrong" ? { animation: "devShake .4s" } : undefined}
        />
        <p className="mt-2 h-4 text-[12px] text-[#f0736a]">
          {state === "wrong" ? "That isn’t it." : state === "busy" ? "Too many tries. Wait a few minutes." : ""}
        </p>
        <button
          type="submit"
          disabled={!value || state === "checking"}
          className="mt-2 w-full rounded-xl py-3 text-[14px] font-semibold text-[var(--d-on)] transition enabled:hover:brightness-110 disabled:opacity-50"
          style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
        >
          {state === "checking" ? "Checking…" : "Unlock"}
        </button>
      </form>
    </Popup>
  );
}

function CloseHandle({ register }: { register: (fn: () => void) => void }) {
  const close = usePopupClose();
  useEffect(() => {
    if (close) register(close);
  }, [close, register]);
  return null;
}
