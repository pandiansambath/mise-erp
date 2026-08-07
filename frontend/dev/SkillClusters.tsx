"use client";

// What he works with, and where he studied — written out, not just orbiting.
//
// The orbit is the showpiece; this is the record. Two reasons it exists rather
// than the orbit carrying everything:
//
// **Twenty chips will not fit on a phone.** Not at a readable size, not at any
// radius. Shrinking them until they do produces something nobody can read on
// the device most likely to open the page.
//
// **An orbit cannot be skimmed.** A recruiter looking for "does he know ECS"
// should not have to wait for a chip to come round. Motion for delight,
// columns for answers.
//
// The education block leads with the claim and puts the verification link
// immediately beside it. A rank that cannot be checked is a rank nobody
// believes.

import { CLUSTERS, DOCS, EDUCATION } from "@/dev/skills";
import Link from "next/link";

export function SkillClusters({ entered }: { entered: boolean }) {
  return (
    <div className="w-full space-y-4">
      {CLUSTERS.map((c, i) => (
        <section
          key={c.key}
          className="dev-reborn group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 backdrop-blur-sm transition-colors duration-500 hover:border-white/[0.14] sm:p-5"
          style={
            entered
              ? { animation: `devFadeUp .8s ${0.42 + i * 0.08}s ease-out both` }
              : undefined
          }
        >
          {/* A wash in the family's own colour, so the three blocks are
              distinguishable at a glance without shouting. */}
          <span
            aria-hidden
            className="absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.13] blur-3xl transition-opacity duration-500 group-hover:opacity-25"
            style={{ background: c.hue }}
          />

          <div className="relative flex items-baseline gap-2.5">
            <span aria-hidden className="text-base" style={{ color: c.hue }}>
              {c.glyph}
            </span>
            <h3 className="font-mono text-[11px] tracking-[0.24em]" style={{ color: c.hue }}>
              {c.label.toUpperCase()}
            </h3>
            <span
              aria-hidden
              className="mb-1 h-px flex-1"
              style={{ background: `linear-gradient(90deg, ${c.hue}55, transparent)` }}
            />
            <span className="font-mono text-[10px] tabular-nums text-[#4a5c70]">
              {c.items.length}
            </span>
          </div>

          <p className="relative mt-1.5 text-[12px] leading-relaxed text-[#7d93ad]">{c.blurb}</p>

          <ul className="relative mt-3 flex flex-wrap gap-1.5">
            {c.items.map((item) => {
              const href = DOCS[item];
              // Every chip goes to the official documentation. A chip that
              // cannot be clicked is a label; one that can is an invitation to
              // check he means it.
              const cls =
                "block rounded-lg border px-2.5 py-1 font-mono text-[11px] text-[#c3d3e4] transition duration-300";
              const style = { borderColor: `${c.hue}2e`, background: `${c.hue}0f` };
              return (
                <li key={item}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`${item} — official docs`}
                      className={`${cls} hover:-translate-y-0.5 hover:text-white`}
                      style={style}
                    >
                      {item}
                    </a>
                  ) : (
                    <span className={cls} style={style}>
                      {item}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {/* ── Education ────────────────────────────────────────────────────
          The honour is the headline and the proof sits next to it. */}
      <section
        className="dev-reborn relative overflow-hidden rounded-2xl border border-[#d97742]/25 bg-[#d97742]/[0.05] p-4 backdrop-blur-sm sm:p-5"
        style={entered ? { animation: "devFadeUp .8s .68s ease-out both" } : undefined}
      >
        <span
          aria-hidden
          className="absolute -left-12 -top-12 h-36 w-36 rounded-full bg-[#d97742] opacity-[0.16] blur-3xl"
        />
        <div className="relative flex items-baseline gap-2.5">
          <span aria-hidden className="text-base text-[#f0a064]">
            ⌾
          </span>
          <h3 className="font-mono text-[11px] tracking-[0.24em] text-[#f0a064]">EDUCATION</h3>
          <span
            aria-hidden
            className="mb-1 h-px flex-1"
            style={{ background: "linear-gradient(90deg, #d9774255, transparent)" }}
          />
        </div>

        {/* The one line on the page that is an award, styled like one.
            It was plain white — the same colour as every other heading — so
            the best thing here read as the least important thing here: "that
            highlighted 1st line is very plain, see others are fine".

            Struck in metal instead: a gold gradient with a highlight that
            travels across it, the way light crosses a real medal when you
            turn it. Slow and once every eight seconds, so it reads as
            material rather than as something blinking for attention. */}
        <p className="relative mt-2.5 flex items-baseline gap-2 text-lg font-semibold leading-snug">
          <Link
            href="/award"
            title="Open the award"
            // Warm the chest while they are still reading this card. By the
            // time the award page opens the model is usually already in cache,
            // which is the difference between a wait and no wait.
            onMouseEnter={() => {
              const id = "chest-prefetch";
              if (document.getElementById(id)) return;
              const l = document.createElement("link");
              l.id = id;
              l.rel = "prefetch";
              l.as = "fetch";
              l.href = "/dev/models/chest.glb";
              document.head.appendChild(l);
            }}
            className="group flex items-baseline gap-2 text-left"
          >
            <span aria-hidden className="dev-medal shrink-0 text-base transition-transform group-hover:scale-125">
              🏅
            </span>
            <span className="dev-gold underline-offset-4 group-hover:underline">
              {EDUCATION.honour}
            </span>
          </Link>
        </p>
        <p className="relative mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-[#a9bdd2]">
          <span>{EDUCATION.degree}</span>
          <span aria-hidden className="text-[#4a5c70]">·</span>
          <span>{EDUCATION.year}</span>
          <span aria-hidden className="text-[#4a5c70]">·</span>
          <span className="font-mono tabular-nums text-[#f0a064]">{EDUCATION.percentage}</span>
        </p>

        <a
          href={EDUCATION.schoolUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="relative mt-2 block text-sm text-[#c3d3e4] underline-offset-4 transition hover:text-[#f0a064] hover:underline"
        >
          {EDUCATION.school}
        </a>
        <p className="relative mt-0.5 text-[12px] text-[#7d93ad]">{EDUCATION.affiliation}</p>

        {/* The proof, one click away and with a pointer to the right page.
            A 49-page PDF and no page number is only technically evidence —
            nobody scrolls a stranger's rank list looking for their name. */}
        <div className="relative mt-3.5 flex flex-wrap items-center gap-2">
          <a
            href={EDUCATION.verifyUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 rounded-full border border-[#d97742]/40 bg-[#d97742]/10 px-3.5 py-1.5 font-mono text-[11px] text-[#f0a064] transition hover:border-[#d97742]/70 hover:bg-[#d97742]/20"
          >
            <span aria-hidden>✓</span>
            verify · {EDUCATION.verifyLabel}
            <span aria-hidden>↗</span>
          </a>
          <a
            href={EDUCATION.officialUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="font-mono text-[10px] text-[#4a5c70] underline-offset-4 transition hover:text-[#7d93ad] hover:underline"
          >
            annauniv.edu
          </a>
        </div>
        <p className="relative mt-2 font-mono text-[10px] leading-relaxed text-[#4a5c70]">
          {EDUCATION.exam}
          <span className="mt-0.5 block text-[#7d93ad]">↳ {EDUCATION.verifyHint}</span>
        </p>
      </section>
    </div>
  );
}
