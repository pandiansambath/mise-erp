// Bundled dish-photo library (frontend/public/dishes/*.jpg, sourced from
// Pexels — free for commercial use). Menu items are matched by NAME keywords;
// anything unmatched falls back to its emoji. Hotels get custom photo uploads
// in a later round — this makes every menu look appetising TODAY.

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

export function dishPhoto(name: string): string | null {
  const n = name.toLowerCase();
  for (const [slug, re] of RULES) {
    if (re.test(n)) return `/dishes/${slug}.jpg`;
  }
  return null;
}
