"use client";

/** The picture library, browsable by mood.
 *
 *    "please download as much as images from Pixabay and have that in our
 *     suggestion customisation list as landing and login page — for both
 *     download as much as possible photos and let user use any one whatever he
 *     likes for both pages."
 *
 *  96 photographs, fetched once by `scripts/fetch_page_images.py` and shipped
 *  with the app. Not a live search box: a search box asks a restaurant owner to
 *  be a picture editor at the exact moment they are trying to get their page
 *  looking right, and it puts a third-party API in the render path of the one
 *  page a customer ever sees.
 *
 *  THE TWO SHELVES ARE DIFFERENT ON PURPOSE.
 *  A landing page sells the food — appetite, colour, a full plate. A staff
 *  sign-in page is opened at 6am by somebody who works there, with a form on
 *  top of it, so it wants texture and calm and emphatically NOT a busy focal
 *  point in the middle. Offering one list for both is how you get sign-in pages
 *  nobody can read.
 */

import { useEffect, useMemo, useState } from "react";

export type ShelfImage = { file: string; alt: string };
type Mood = { slug: string; label: string; page: "landing" | "login"; images: ShelfImage[] };

/** Loaded once from the static manifest. It is a public file, so no auth and
 *  no API round trip — and it is cached by the browser like any other asset. */
let cache: Mood[] | null = null;

export function useImageShelf(page: "landing" | "login") {
  const [moods, setMoods] = useState<Mood[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    fetch("/page-images/images.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.moods || !alive) return;
        cache = d.moods as Mood[];
        setMoods(cache);
      })
      .catch(() => {
        /* no library is a smaller problem than a broken editor — the built-in
           hero styles still work */
      });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => moods.filter((m) => m.page === page), [moods, page]);
}

export function ImageShelf({
  page,
  value,
  onPick,
}: {
  page: "landing" | "login";
  /** The currently chosen file path, or null for "no photograph". */
  value: string | null;
  onPick: (file: string | null) => void;
}) {
  const moods = useImageShelf(page);
  const [open, setOpen] = useState<string | null>(null);

  // Open the mood the current picture belongs to, so re-opening the editor
  // shows you where you already are instead of a collapsed list.
  useEffect(() => {
    if (open || !value || moods.length === 0) return;
    const owner = moods.find((m) => m.images.some((i) => i.file === value));
    setOpen(owner?.slug ?? moods[0].slug);
  }, [value, moods, open]);

  if (moods.length === 0) {
    return (
      <p className="text-[11px] text-fg-faint">
        The picture library isn&apos;t loaded. The built-in styles still work.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => onPick(null)}
        className={`mise-press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
          value === null ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
        }`}
      >
        <span aria-hidden>🚫</span>
        No photograph
        <span className="ml-auto text-[10px] opacity-70">
          {page === "login" ? "fastest to load" : "colour only"}
        </span>
      </button>

      {moods.map((m) => {
        const isOpen = open === m.slug;
        const mine = m.images.some((i) => i.file === value);
        return (
          <div key={m.slug} className="mise-card-inset overflow-hidden rounded-xl">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : m.slug)}
              aria-expanded={isOpen}
              className="mise-press flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <span className="min-w-0 flex-1 text-xs font-semibold text-fg">
                {m.label}
                {mine && <span className="ml-1.5 text-[10px] text-brand-300">● in use</span>}
              </span>
              <span className="text-[10px] tabular-nums text-fg-faint">{m.images.length}</span>
              <span
                aria-hidden
                className={`text-[10px] text-fg-faint transition-transform ${isOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
            {isOpen && (
              <div className="grid grid-cols-3 gap-1.5 p-2 pt-0">
                {m.images.map((img) => (
                  <button
                    key={img.file}
                    type="button"
                    onClick={() => onPick(img.file)}
                    title={img.alt}
                    className={`mise-press relative aspect-[4/3] overflow-hidden rounded-lg ring-2 transition ${
                      value === img.file ? "ring-brand-500" : "ring-transparent hover:ring-line"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.file}
                      alt={img.alt}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {value === img.file && (
                      <span
                        aria-hidden
                        className="absolute inset-0 grid place-items-center bg-brand-600/35 text-lg text-white"
                      >
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="pt-1 text-[10px] leading-relaxed text-fg-faint">
        Free for commercial use (Pixabay licence). No credit needed.
      </p>
    </div>
  );
}
