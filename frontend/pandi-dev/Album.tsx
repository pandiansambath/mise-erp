"use client";

// The album.
//
// Photos do not fade in — they ASSEMBLE. Each tile flies in from a point on the
// same helix as the background, so the album feels like it was decoded out of
// the chain rather than dropped onto the page. That is the one idea here; the
// rest is restraint so the idea survives contact with 34 photos.
//
// Every image already sits in the browser cache (BootSequence fetched all of
// them before the door opened), so the assembly animation is the only thing
// standing between the click and the photos. Nothing is waiting on a network.
//
// LQIP: each tile paints a ~24px base64 preview inlined in the manifest, so
// even a cache miss shows the right colours instantly instead of a grey hole.
// Tiles are given their aspect ratio up front, so the masonry never reflows as
// images land — layout jump is the thing that makes galleries feel broken.
//
// The lightbox loads the FULL tier on demand: 34 full-size photos would be
// 9.7MB nobody looks at.

import { useCallback, useEffect, useRef, useState } from "react";

export type Photo = { id: string; w: number; h: number; ratio: number; lqip: string };

export function Album({
  photos,
  onClose,
}: {
  photos: Photo[];
  onClose: () => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 380);
  }, [onClose]);

  // Keyboard: Escape closes the lightbox first, then the album. Arrows page
  // through. A gallery you can only drive with a mouse is half a gallery.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (open !== null) setOpen(null);
        else dismiss();
      }
      if (open !== null) {
        if (e.key === "ArrowRight") setOpen((i) => (i === null ? null : (i + 1) % photos.length));
        if (e.key === "ArrowLeft") setOpen((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length, dismiss]);

  // Lock the page behind the album.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Swipe on phones.
  const touchX = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) < 50 || open === null) return;
    setOpen((i) =>
      i === null ? null : dx < 0 ? (i + 1) % photos.length : (i - 1 + photos.length) % photos.length,
    );
  };

  return (
    <div
      className={`fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-[#070a0f]/97 backdrop-blur-xl transition-all duration-[380ms] ${
        closing ? "scale-105 opacity-0" : "scale-100 opacity-100"
      }`}
      ref={scrollRef}
    >
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-white/[0.06] bg-[#070a0f]/80 px-5 py-4 backdrop-blur-xl sm:px-8">
        <div>
          <p className="font-mono text-[10px] tracking-[0.3em] text-[#d97742]">DECRYPTED</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight text-[#e6edf5]">
            The album
            <span className="ml-2 font-mono text-xs font-normal text-[#5b6e85]">
              {photos.length} blocks
            </span>
          </h2>
        </div>
        <button
          onClick={dismiss}
          aria-label="Close album"
          className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#7d93ad] transition hover:border-[#d97742]/50 hover:bg-[#d97742]/10 hover:text-[#f0a064]"
        >
          ✕
        </button>
      </header>

      {/* CSS columns give real masonry without measuring anything in JS. */}
      <div className="columns-2 gap-3 p-4 sm:columns-3 sm:gap-4 sm:p-8 lg:columns-4">
        {photos.map((p, i) => (
          <Tile key={p.id} photo={p} index={i} onOpen={() => setOpen(i)} />
        ))}
      </div>

      <p className="pb-10 text-center font-mono text-[10px] tracking-[0.25em] text-[#3f4f61]">
        END OF CHAIN
      </p>

      {open !== null && (
        <Lightbox
          photos={photos}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        />
      )}
    </div>
  );
}

/** One tile: flies in from the helix, then behaves like a photo. */
function Tile({ photo, index, onOpen }: { photo: Photo; index: number; onOpen: () => void }) {
  const [shown, setShown] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Staggered by index so the grid assembles in a wave rather than all at
    // once. Capped so photo 34 is not left waiting three seconds.
    const id = setTimeout(() => setShown(true), Math.min(index * 42, 900));
    return () => clearTimeout(id);
  }, [index]);

  // Entry vector taken from the same helix the background draws, so the album
  // and the background feel like one system.
  const angle = index * 0.7;
  const fromX = Math.cos(angle) * 120;
  const fromY = Math.sin(angle) * 90 + 60;

  return (
    <button
      onClick={onOpen}
      className="group relative mb-3 block w-full overflow-hidden rounded-xl border border-white/[0.06] sm:mb-4"
      style={{
        aspectRatio: String(photo.ratio),
        transform: shown
          ? "translate3d(0,0,0) scale(1) rotate(0deg)"
          : `translate3d(${fromX}px, ${fromY}px, 0) scale(.82) rotate(${index % 2 ? 5 : -5}deg)`,
        opacity: shown ? 1 : 0,
        transition:
          "transform .85s cubic-bezier(.16,1,.3,1), opacity .6s ease-out, border-color .3s",
      }}
    >
      {/* LQIP underneath: right colours immediately, no grey hole. */}
      <img
        src={photo.lqip}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg"
      />
      <img
        src={`/dev/thumb/${photo.id}.webp`}
        alt=""
        loading="eager"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 group-hover:scale-[1.07] ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <span className="absolute bottom-2 left-2.5 translate-y-2 font-mono text-[9px] tracking-[0.2em] text-white/70 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        {photo.id.toUpperCase()}
      </span>
      <span className="absolute inset-0 rounded-xl ring-1 ring-inset ring-[#d97742]/0 transition-all duration-300 group-hover:ring-[#d97742]/45" />
    </button>
  );
}

function Lightbox({
  photos, index, onIndex, onClose, onTouchStart, onTouchEnd,
}: {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
}) {
  const photo = photos[index];
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [index]);

  // Prefetch the neighbours so arrowing through is instant. Only the immediate
  // neighbours — prefetching all 34 full-size images defeats the point.
  useEffect(() => {
    [index + 1, index - 1].forEach((i) => {
      const p = photos[(i + photos.length) % photos.length];
      if (p) new Image().src = `/dev/full/${p.id}.webp`;
    });
  }, [index, photos]);

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-black/90 p-4 backdrop-blur-md sm:p-10"
      style={{ animation: "devFade .25s ease-out both" }}
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <img
        src={photo.lqip}
        alt=""
        aria-hidden
        className={`absolute max-h-[86vh] max-w-[92vw] scale-105 rounded-lg blur-2xl transition-opacity duration-500 ${
          loaded ? "opacity-0" : "opacity-60"
        }`}
        style={{ aspectRatio: String(photo.ratio) }}
      />
      <img
        key={photo.id}
        src={`/dev/full/${photo.id}.webp`}
        alt={`Photo ${index + 1} of ${photos.length}`}
        onLoad={() => setLoaded(true)}
        onClick={(e) => e.stopPropagation()}
        className={`relative max-h-[86vh] max-w-[92vw] rounded-lg object-contain shadow-2xl transition-all duration-500 ${
          loaded ? "scale-100 opacity-100" : "scale-95 opacity-0"
        }`}
      />

      <button
        onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + photos.length) % photos.length); }}
        aria-label="Previous photo"
        className="absolute left-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-xl text-white/70 backdrop-blur transition hover:border-[#d97742]/50 hover:text-[#f0a064] sm:left-6"
      >
        ‹
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % photos.length); }}
        aria-label="Next photo"
        className="absolute right-2 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/40 text-xl text-white/70 backdrop-blur transition hover:border-[#d97742]/50 hover:text-[#f0a064] sm:right-6"
      >
        ›
      </button>

      <p className="absolute bottom-5 left-1/2 -translate-x-1/2 font-mono text-[11px] tracking-[0.25em] text-white/45">
        {String(index + 1).padStart(2, "0")} / {photos.length}
      </p>
    </div>
  );
}
