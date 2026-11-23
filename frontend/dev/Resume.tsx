"use client";

// His résumé, in place.
//
//   "add our finalized resume there (keep resume in s3 and serve to site) ...
//    resume should open inplace in a neat way adapted based on screen size
//    also have a download option too pdf, word"
//
// The pages are pictures of the PDF, rendered once by
// dev/scripts/publish_resume.py — not the PDF in an <iframe>. Most phones will
// not draw a PDF inside a page (Android Chrome offers a download instead), and
// this has to read on a phone. The real PDF and the Word file stay one tap
// away, for printing and for editing.
//
// Everything comes out of the private bucket through /api/dev-site/resume/…,
// and every URL carries the manifest's version, so a republished résumé can
// never hide behind a cached old one.

import { useWord } from "./context";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHead } from "@/dev/SectionHead";
import { CardChrome, Wave } from "./flourish";

export type ResumePage = { src: string; w: number; h: number };

export type ResumeManifest = {
  version: string;
  /** yyyy-mm-dd */
  updated: string;
  pdf: string;
  /** Null when he replaced the résumé without a Word file (the old Word file
   *  would have been the old résumé). */
  docx: string | null;
  pdfKB: number;
  docxKB: number | null;
  thumb: ResumePage;
  pages: ResumePage[];
};

const BASE = "/api/dev-site/resume/";
// Sky. It was paper-white (var(--d-ink2)), which made "RÉSUMÉ" the one bright
// header among soft colours — "the resume word and aws word font different".
// Same font, measured; the difference was the colour.
const HUE = "var(--d-b2)";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `?v=` busts the cache on a republish; `download` asks the server to send
 *  the file as an attachment under its own name. */
export function resumeHref(m: ResumeManifest, file: string, download = false): string {
  return `${BASE}${file}?v=${m.version}${download ? "&download=1" : ""}`;
}

/** 2026-11-21 → 21 Nov 2026. By hand rather than Intl: the server and the
 *  browser can disagree on a month's short name ("Sep" / "Sept"), and the
 *  card would then hydrate with a mismatch. */
function updatedOn(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : iso;
}

const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-[var(--d-on)] shadow-[0_8px_24px_-10px_color-mix(in_srgb,_var(--d-b)_70%,_transparent)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110";
const SECONDARY =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] px-3 py-1.5 font-mono text-[11px] text-[var(--d-ink2)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--d-ink2)]/40 hover:text-[var(--d-ink)]";
// The chain's two strands, copper into teal: the page's own colours on the
// one button that matters most.
const STRANDS = { background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" };

export function ResumeCard({ resume, onOpen }: { resume: ResumeManifest; onOpen: () => void }) {
  const pages = resume.pages.length;
  const w = useWord();
  return (
    <section
      data-link
      // Grows in as it scrolls (dev-reborn), like every card on the page.
      className="dev-reborn dev-card group relative w-full overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-4 backdrop-blur-sm transition-colors duration-500 hover:border-[var(--d-line2)] sm:p-5"
    >
      <span
        aria-hidden
        className="absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.1] blur-3xl transition-opacity duration-500 group-hover:opacity-20"
        style={{ background: HUE }}
      />
      <CardChrome hue={HUE} />
      <SectionHead glyph="▤" label={w("resumeTitle")} hue={HUE} aside={`${pages} ${w(pages === 1 ? "resumePage" : "resumePages")}`} />

      <div className="relative mt-4 flex items-center gap-4 sm:gap-5">
        {/* The cover, like a document on a desk: tilted, and straightened by
            the hand that picks it up. A second sheet sits behind it, so it
            reads as more than one page before anyone counts. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open the résumé"
          className="relative shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--d-b)]/60"
        >
          <span
            aria-hidden
            className="absolute inset-0 translate-x-1.5 translate-y-1 rotate-[4deg] rounded-md bg-[#d5dbe3] shadow-lg transition-transform duration-500 group-hover:rotate-[7deg]"
          />
          {/* eslint-disable-next-line @next/next/no-img-element -- served from the private bucket through the backend; there is nothing for next/image to optimise */}
          <img
            src={resumeHref(resume, resume.thumb.src)}
            alt=""
            width={resume.thumb.w}
            height={resume.thumb.h}
            loading="lazy"
            decoding="async"
            className="relative w-[84px] -rotate-2 rounded-md bg-white shadow-[0_14px_32px_-12px_rgba(0,0,0,.85)] ring-1 ring-black/10 transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-0 sm:w-[96px]"
          />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-snug text-[var(--d-ink)]">
            <Wave text={w("resumeName")} />
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--d-ink4)]">
            {w("resumeLine")}
          </p>
          <p className="mt-1 font-mono text-[10px] tracking-[0.18em] text-[var(--d-ink6)]">
            {w("resumeUpdated")} {updatedOn(resume.updated).toUpperCase()}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onOpen} className={PRIMARY} style={STRANDS}>
              {w("resumeView")}
            </button>
            <a href={resumeHref(resume, resume.pdf, true)} download className={SECONDARY}>
              <span aria-hidden>↓</span> {w("resumePdf")} <span className="text-[var(--d-ink6)]">{resume.pdfKB} KB</span>
            </a>
            {resume.docx && (
              <a href={resumeHref(resume, resume.docx, true)} download className={SECONDARY}>
                <span aria-hidden>↓</span> {w("resumeWord")} <span className="text-[var(--d-ink6)]">{resume.docxKB} KB</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const TOOL =
  "inline-flex items-center gap-1 rounded-lg border border-[var(--d-line)] bg-[var(--d-glass)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--d-ink2)] transition hover:border-[var(--d-b)]/50 hover:text-[var(--d-ink)]";

export function ResumeViewer({ resume, onClose }: { resume: ResumeManifest; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const [current, setCurrent] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const total = resume.pages.length;
  const open = shown && !closing;

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose]);

  // One frame after mounting, so the opacity has something to transition from.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  // Hold the page still behind it, and hand focus back to whatever opened it
  // (the card's button, or the terminal) when it closes.
  useEffect(() => {
    const before = document.body.style.overflow;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = before;
      opener?.focus({ preventScroll: true });
    };
  }, []);

  // Which page is in front of the reader: the one crossing a thin band just
  // above the middle of the screen.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setCurrent(Number((e.target as HTMLElement).dataset.page));
        }
      },
      { root, rootMargin: "-40% 0px -55% 0px" },
    );
    root.querySelectorAll("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Résumé of Pandian Sambath"
      className={`fixed inset-0 z-[60] flex flex-col bg-[var(--d-bg)]/95 backdrop-blur-xl transition-opacity duration-300 motion-reduce:transition-none ${
        open ? "opacity-100" : "opacity-0"
      }`}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--d-line)] bg-[var(--d-shade)] px-3 py-2.5 sm:gap-2.5 sm:px-6">
        <div className="min-w-0 flex-1">
          {/* The name joins the title once there is room: on a phone the
              three buttons leave space for one word, not "Pandian Samb…". */}
          <p className="truncate text-[13px] font-semibold text-[var(--d-ink)] sm:text-sm">
            <span className="hidden sm:inline">Pandian Sambath — </span>Résumé
          </p>
          <p className="font-mono text-[10px] tabular-nums tracking-[0.18em] text-[var(--d-ink5)]">
            PAGE {current} / {total}
            <span className="hidden sm:inline"> · UPDATED {updatedOn(resume.updated).toUpperCase()}</span>
          </p>
        </div>
        <a
          href={resumeHref(resume, resume.pdf)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${TOOL} hidden md:inline-flex`}
        >
          Open PDF <span aria-hidden>↗</span>
        </a>
        <a href={resumeHref(resume, resume.pdf, true)} download className={TOOL}>
          <span aria-hidden>↓</span> PDF
        </a>
        {resume.docx && (
          <a href={resumeHref(resume, resume.docx, true)} download className={TOOL}>
            <span aria-hidden>↓</span> Word
          </a>
        )}
        <button
          ref={closeButton}
          type="button"
          onClick={dismiss}
          aria-label="Close the résumé"
          className="ml-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--d-line)] bg-[var(--d-glass)] text-[var(--d-ink2)] transition hover:border-[var(--d-line2)] hover:text-[var(--d-ink)]"
        >
          ✕
        </button>
      </header>

      <div
        ref={scroller}
        // A click in the margin beside the pages closes it, like any lightbox.
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-8 sm:py-8"
      >
        <div
          className={`mx-auto flex max-w-[860px] flex-col gap-4 transition duration-500 motion-reduce:transition-none sm:gap-6 ${
            open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
          }`}
        >
          {resume.pages.map((p, i) => (
            <figure
              key={p.src}
              data-page={i + 1}
              // The sheet is drawn at its final size before the picture
              // arrives, so nothing jumps as pages load.
              className="relative overflow-hidden rounded-md bg-white shadow-[0_24px_70px_-22px_rgba(0,0,0,.9)] ring-1 ring-[var(--d-line)]"
              style={{ aspectRatio: `${p.w} / ${p.h}` }}
            >
              {/* Under the picture, so the picture covers it once it lands. */}
              <span
                aria-hidden
                className="absolute inset-0 grid place-items-center font-mono text-[11px] tracking-[0.2em] text-[#9aa7b6]"
              >
                LOADING PAGE {i + 1}…
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element -- same as the cover */}
              <img
                src={resumeHref(resume, p.src)}
                alt={`Résumé of Pandian Sambath, page ${i + 1} of ${total}`}
                width={p.w}
                height={p.h}
                // All at once: two pages of ~210 KB. Lazy left page 2 a
                // blank sheet on a phone until the reader reached it.
                loading="eager"
                decoding="async"
                draggable={false}
                className="relative block h-full w-full select-none"
              />
            </figure>
          ))}
          <p className="pb-8 pt-1 text-center font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink6)]">
            END OF RÉSUMÉ ·{" "}
            <a href={resumeHref(resume, resume.pdf, true)} download className="text-[var(--d-ink4)] hover:text-[var(--d-ink)]">
              DOWNLOAD PDF
            </a>
            {resume.docx && (
              <>
                {" "}
                ·{" "}
                <a href={resumeHref(resume, resume.docx, true)} download className="text-[var(--d-ink4)] hover:text-[var(--d-ink)]">
                  WORD
                </a>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
