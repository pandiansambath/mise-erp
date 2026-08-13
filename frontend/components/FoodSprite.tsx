"use client";

// Live, moving food — without paying for it.
//
// His ask: "we want real live motion moving feel of that thing… for that a real
// 3D kinda one only suits", with the hard constraint "coz of this our site
// should not get slow and slow in loading and all".
//
// Those two pull opposite ways in the browser. three.js plus a model per
// category is megabytes and a WebGL context per tile; a Lottie per tile
// animates on the CPU, which is the jank he already complained about on this
// very page.
//
// So the 3D happens OFFLINE. `scripts/render_food_sprites.py` lights and
// rotates each object properly — Lambert, specular, rim, contact shadow — and
// bakes 24 frames into one strip. Here the browser just walks that strip with
// `steps()` on background-position: no JavaScript per frame, no WebGL, no video
// decode. It costs what an image costs, and it looks like what it is, because
// it IS a rendered 3D object.
//
// Two rules keep it honest:
//   · nothing animates unless it is ON SCREEN;
//   · nothing animates at all under prefers-reduced-motion.

import { useEffect, useRef, useState } from "react";

/** Kept in step with FOODS in scripts/render_food_sprites.py. */
const FRAMES = 24;
const SIZE = 96;

const SPRITES = new Set([
  "lemon", "tomato", "onion", "potato", "apple", "orange", "egg", "milk",
  "rice", "flour", "oil", "fish", "meat", "chicken", "cheese", "spice",
  "pulse", "greens", "cleaning", "packaging", "drink", "frozen", "basket",
]);

/** Which object stands for a category. Word matching, not regex — the same
 *  lesson as the storage colours, where an invisible escape made every rule
 *  match nothing. */
const FOR_CATEGORY: { words: string[]; sprite: string }[] = [
  { words: ["frozen", "freezer", "ice cream"], sprite: "frozen" },
  { words: ["veg", "greens", "salad", "herb"], sprite: "greens" },
  { words: ["fruit"], sprite: "apple" },
  { words: ["fish", "seafood", "prawn"], sprite: "fish" },
  { words: ["meat", "mutton", "lamb", "beef", "pork"], sprite: "meat" },
  { words: ["poultry", "chicken", "egg"], sprite: "chicken" },
  { words: ["dairy", "milk", "cream", "curd", "paneer", "yog"], sprite: "milk" },
  { words: ["cheese", "butter"], sprite: "cheese" },
  { words: ["rice", "grain", "flour", "staple"], sprite: "rice" },
  { words: ["pulse", "lentil", "dal", "bean"], sprite: "pulse" },
  { words: ["spice", "masala", "condiment", "pickle", "sauce"], sprite: "spice" },
  { words: ["oil", "ghee"], sprite: "oil" },
  { words: ["drink", "bever", "juice", "water", "tea", "coffee"], sprite: "drink" },
  { words: ["clean", "chemical", "hygiene"], sprite: "cleaning" },
  { words: ["packag", "disposab", "paper", "cutlery", "utensil"], sprite: "packaging" },
];

export function spriteFor(category: string): string | null {
  const hay = category.toLowerCase();
  const hit = FOR_CATEGORY.find((c) => c.words.some((w) => hay.includes(w)));
  return hit && SPRITES.has(hit.sprite) ? hit.sprite : null;
}

export function FoodSprite({
  name,
  size = 40,
  className = "",
}: {
  /** A sprite name, or a category name to look one up from. */
  name: string;
  size?: number;
  className?: string;
}) {
  const sprite = SPRITES.has(name) ? name : spriteFor(name);
  const host = useRef<HTMLSpanElement>(null);
  const [live, setLive] = useState(false);

  // Only what you can see is allowed to move. A grid of twenty tiles all
  // animating off-screen is exactly the kind of always-on work that made this
  // page feel sticky before.
  useEffect(() => {
    const el = host.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => setLive(e.isIntersecting),
      { rootMargin: "80px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!sprite) return null;

  return (
    <span
      ref={host}
      aria-hidden
      className={`mise-food ${live ? "is-live" : ""} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(/food/${sprite}.webp)`,
        // The strip is FRAMES frames wide; the element shows one of them.
        backgroundSize: `${FRAMES * 100}% 100%`,
        ["--food-frames" as string]: String(FRAMES),
        ["--food-step" as string]: `${100 / (FRAMES - 1)}%`,
      }}
    />
  );
}

export { FRAMES as FOOD_FRAMES, SIZE as FOOD_SIZE };
