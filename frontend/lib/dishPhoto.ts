// Bundled dish-photo library (frontend/public/dishes/*.jpg, sourced from
// Pexels — free for commercial use). Menu items are matched by NAME keywords.
// Hotels get custom photo uploads in a later round — this makes every menu
// look appetising TODAY.

const RULES: [string, RegExp][] = [
  ["butter-chicken", /butter\s*chicken/],
  ["chicken-65", /chicken\s*65|chicken\s*lollipop|fried\s*chicken/],
  ["gobi-manchurian", /gobi|manchurian|cauliflower/],
  ["idli", /idli/],
  ["dosa", /dosa|uttapam/],
  ["lassi", /lassi|milkshake|smoothie/],
  ["biryani", /biryani|biriyani|pulao|pilau/],
  ["naan", /naan|roti|chapati|paratha|bread/],
  ["paneer", /paneer|tofu/],
  ["samosa", /samosa|pakora|bhaji|spring\s*roll|vada/],
  ["dal", /\bdal\b|\bdhal\b|lentil|sambar/],
  ["fried-rice", /fried\s*rice|rice\b/],
  ["noodles", /noodle|chow\s*mein|hakka|pasta|spaghetti/],
  ["pizza", /pizza/],
  ["burger", /burger|sandwich|wrap/],
  ["salad", /salad|raita/],
  ["kebab", /kebab|kabab|tikka(?!\s*masala)|skewer/],
  ["tandoori", /tandoori|grill|roast/],
  ["soup", /soup|rasam|broth|stew/],
  ["dessert", /gulab|jamun|dessert|kheer|halwa|cake|ice\s*cream|sweet/],
  ["coffee", /coffee|espresso|latte|cappuccino/],
  ["tea", /\btea\b|chai/],
  ["fish", /fish|prawn|shrimp|seafood|crab/],
  ["chicken-curry", /chicken|chettinad|curry|masala|korma|vindaloo|madras/],
];

/** Every photo in the bundle. Used as the last-resort pool so a dish that
 *  collides with everything still gets a picture rather than a grey hole. */
const ALL = [
  "butter-chicken", "chicken-curry", "chicken-65", "tandoori", "kebab",
  "biryani", "fried-rice", "noodles", "dosa", "idli", "naan", "samosa",
  "paneer", "dal", "gobi-manchurian", "salad", "soup", "fish", "pizza",
  "burger", "lassi", "dessert", "coffee", "tea",
];

/** When the obvious photo is already spoken for, what else is honest.
 *
 *  Ordered best-first, and kept plausible on purpose: a biryani may borrow the
 *  pulao-ish fried-rice shot, but it must never borrow the coffee. A picture of
 *  visibly the wrong food is worse than a repeat. */
const ALTERNATES: Record<string, string[]> = {
  "butter-chicken": ["chicken-curry", "tandoori", "paneer", "dal"],
  "chicken-curry": ["butter-chicken", "tandoori", "chicken-65", "kebab"],
  "chicken-65": ["kebab", "tandoori", "gobi-manchurian", "chicken-curry"],
  tandoori: ["kebab", "chicken-65", "chicken-curry"],
  kebab: ["tandoori", "chicken-65", "fish"],
  biryani: ["fried-rice", "dal", "tandoori", "chicken-curry"],
  "fried-rice": ["biryani", "noodles", "dal"],
  noodles: ["fried-rice", "gobi-manchurian"],
  dosa: ["idli", "naan", "samosa"],
  idli: ["dosa", "samosa", "naan"],
  naan: ["dosa", "samosa", "idli"],
  samosa: ["gobi-manchurian", "chicken-65", "idli"],
  paneer: ["dal", "gobi-manchurian", "butter-chicken"],
  dal: ["paneer", "soup", "biryani"],
  "gobi-manchurian": ["chicken-65", "samosa", "paneer"],
  salad: ["gobi-manchurian", "paneer"],
  soup: ["dal", "salad"],
  fish: ["kebab", "tandoori", "chicken-curry"],
  pizza: ["burger", "naan"],
  burger: ["pizza", "kebab"],
  lassi: ["dessert", "tea", "coffee"],
  dessert: ["lassi", "coffee"],
  coffee: ["tea", "lassi"],
  tea: ["coffee", "lassi"],
};

/** The single best photo for one dish name, ignoring what other dishes want. */
export function dishPhoto(name: string): string | null {
  const n = name.toLowerCase();
  for (const [slug, re] of RULES) {
    if (re.test(n)) return `/dishes/${slug}.jpg`;
  }
  return null;
}

/**
 * Photos for a WHOLE MENU at once — one picture per dish, no two the same.
 *
 * Two faults, both caused by deciding this one dish at a time:
 *
 * 1. THE SAME PHOTOGRAPH, THREE TIMES, SIDE BY SIDE. Keyword matching sends
 *    Mutton, Vegetable and Chicken Biryani to the identical file, and widening
 *    the grid to five columns put all three in one row. A menu that repeats a
 *    picture looks fake in a way one repeated image never did.
 *
 * 2. MY FIRST FIX MADE IT WORSE. I de-duplicated inside the render — first
 *    dish to claim a photo kept it, later collisions fell back to an emoji.
 *    That left FOUR dishes as grey boxes with a 🍽️ in the middle, including
 *    the £15.00 Chicken Biryani, the dearest thing on the menu. There are 24
 *    photos in the bundle and 13 dishes on this menu: there was never a reason
 *    for a single grey hole. And because the set was rebuilt per render over
 *    the VISIBLE dishes, pressing a category filter reshuffled who owned what
 *    — a photo would visibly hop from one dish to another.
 *
 * So: assign once, over the FULL menu, in a stable order. Each dish takes its
 * keyword match if free, then the best honest alternate, then any unused photo,
 * and only if the bundle were genuinely exhausted would it repeat. Sorting by
 * id rather than by display order is what makes it survive filtering — the
 * answer cannot depend on which dishes happen to be on screen.
 */
export function assignPhotos(
  items: { id: string; name: string; has_photo?: boolean }[],
): Record<string, string> {
  const taken = new Set<string>();
  const out: Record<string, string> = {};

  // A dish with the hotel's OWN photograph is never given a stand-in, and it
  // does not consume one either.
  const needing = items
    .filter((m) => !m.has_photo)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const pick = (slug: string | null): string | null => {
    if (slug && !taken.has(slug)) return slug;
    for (const alt of (slug && ALTERNATES[slug]) || []) {
      if (!taken.has(alt)) return alt;
    }
    for (const any of ALL) {
      if (!taken.has(any)) return any;
    }
    // 24 photos, and every one spoken for. A repeat beats a grey box.
    return slug;
  };

  // TWO PASSES, and the order matters.
  //
  // One interleaved pass gave "Idli (plate)" a photograph of SAMOSAS. Walking
  // the menu once, each dish taking its match or an alternate immediately,
  // let Masala Dosa borrow `idli` as its second choice before the actual idli
  // was ever considered — a dish lost its own name's photo to another dish's
  // fallback. A near-miss is tolerable; a plate of visibly different food
  // under a dish's name is not.
  //
  // So every DIRECT keyword match is settled first, and only then do the
  // dishes that missed out go looking for something close.
  const wanted = new Map<string, string | null>();
  for (const m of needing) {
    const w = dishPhoto(m.name);
    wanted.set(m.id, w ? w.slice("/dishes/".length, -4) : null);
  }

  // Pass 1 — a dish that names its own photo gets it.
  for (const m of needing) {
    const w = wanted.get(m.id);
    if (w && !taken.has(w)) {
      taken.add(w);
      out[m.id] = `/dishes/${w}.jpg`;
    }
  }

  // Pass 2 — everyone else takes the nearest honest thing left.
  for (const m of needing) {
    if (out[m.id]) continue;
    const slug = pick(wanted.get(m.id) ?? null);
    if (slug) {
      taken.add(slug);
      out[m.id] = `/dishes/${slug}.jpg`;
    }
  }
  return out;
}
