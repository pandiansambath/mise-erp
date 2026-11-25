"use client";

// The Kural, read (§106.4: "if one clicks that kural we need to show [an] explanation for that
// kural in our own words, with our achievement as [the] example").
//
// As it has come down: on palm leaves, strung on two cords — the couplet, how it is said, its
// words one by one, what it means, and what it has meant to him. The leaves lie in a stack and
// open out one after another. All of it is his (the Template, the award room).

import { Fragment, useEffect, useRef, useState } from "react";

export type KuralWords = { head: string; one: string; two: string; said: string; words: string; means: string; own: string; mine: string };

/** A line of his, with what he put between *stars* in bold. */
function Bold({ text }: { text: string }) {
  return text.split("*").map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

/** `down`: at the foot of a screen it does not fit in, until it is read down; `shutWords`: how it
 *  closes. */
export function Kural({ words: w, onClose, down = "", shutWords = "" }: { words: KuralWords; onClose: () => void; down?: string; shutWords?: string }) {
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const was = document.activeElement as HTMLElement | null;
    shut.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const el = box.current;
    const t = window.setTimeout(() => setMore(!!el && el.scrollHeight > el.clientHeight + 60 && el.scrollTop < 40), 2200);
    const onScroll = () => setMore((v) => (v && (el?.scrollTop ?? 0) > 40 ? false : v));
    el?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      el?.removeEventListener("scroll", onScroll);
      window.removeEventListener("keydown", onKey, true);
      was?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  const pairs = w.words
    .split(";")
    .map((p) => p.split("=").map((x) => x.trim()))
    .filter((p) => p[0]);
  const leaves = [
    w.head || w.one ? (
      <>
        {w.head && <p className="olai-head">{w.head}</p>}
        <p lang="ta" className="olai-verse">
          {w.one}
          {w.two && (
            <>
              <br />
              {w.two}
            </>
          )}
        </p>
        {w.said && <p className="olai-said">{w.said}</p>}
      </>
    ) : null,
    pairs.length ? (
      <ul className="olai-words">
        {pairs.map(([ta, en], i) => (
          <li key={i}>
            <span lang="ta">{ta}</span>
            {en && <em>{en}</em>}
          </li>
        ))}
      </ul>
    ) : null,
    w.means ? (
      <p className="olai-text olai-means">
        <Bold text={w.means} />
      </p>
    ) : null,
    w.own ? (
      <p className="olai-text">
        <Bold text={w.own} />
      </p>
    ) : null,
    w.mine ? (
      <p className="olai-text">
        <Bold text={w.mine} />
      </p>
    ) : null,
  ].filter(Boolean);
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label={w.head || "The Kural"} className="olai" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="olai-book" style={{ ["--n" as string]: leaves.length }}>
        {leaves.map((leaf, i) => (
          <section key={i} className="olai-leaf" style={{ ["--i" as string]: i }}>
            <i aria-hidden className="olai-hole olai-hole-l" />
            <i aria-hidden className="olai-hole olai-hole-r" />
            {i < leaves.length - 1 && (
              <>
                <i aria-hidden className="olai-cord olai-cord-l" />
                <i aria-hidden className="olai-cord olai-cord-r" />
              </>
            )}
            {leaf}
          </section>
        ))}
        {shutWords && <p className="olai-say">{shutWords}</p>}
      </div>
      {down && <p className={`olai-down ${more ? "is-on" : ""}`}>{down}</p>}
      <button ref={shut} type="button" onClick={onClose} aria-label="Close" className="olai-shut">
        ✕
      </button>
    </div>
  );
}
