"use client";

// THE EMOJI PICKER.
//
//   "we need a best whatsapp style UI UX with emoji gif video audio image doc"
//
// The first version was thirty characters I had chosen. That is a shortcut bar,
// not a picker: the one you want is the one that is not there, and there is no
// way to look for it. This is the real thing — categories, a search box, and
// the ones you actually use kept at the top.
//
// No library and no CDN. Emoji are Unicode characters, so a picker is a list
// and a filter; pulling in a 400KB dependency to render text would be paying a
// download for something the font already does.
//
// Recents live in localStorage because they are a per-person convenience, not a
// fact about the restaurant. If the browser forgets them, the picker still works
// and nothing important is lost.

import { useEffect, useMemo, useRef, useState } from "react";

const RECENT_KEY = "mise.emoji.recent";

/** `emoji name name` — the trailing words are what search matches on. Chosen
 *  for a kitchen and a staff room rather than for completeness. */
const GROUPS: { key: string; icon: string; label: string; items: string[] }[] = [
  {
    key: "smileys",
    icon: "🙂",
    label: "Smileys & people",
    items: [
      "😀 grin happy", "😃 smile happy", "😄 laugh happy", "😁 beam grin",
      "😆 laugh squint", "😅 sweat laugh relief", "😂 tears joy laugh crying",
      "🤣 rofl rolling laugh", "🙂 slight smile", "🙃 upside down silly",
      "😉 wink", "😊 blush smile", "😇 innocent halo angel", "🥰 love hearts adore",
      "😍 heart eyes love", "🤩 star struck wow", "😘 kiss", "😗 kissing",
      "😚 kiss closed", "😋 yum tasty delicious", "😛 tongue", "🤪 zany crazy",
      "😜 wink tongue", "🤨 raised eyebrow doubt", "🧐 monocle inspect",
      "🤓 nerd glasses", "😎 cool sunglasses", "🥳 party celebrate",
      "😏 smirk", "😒 unamused meh", "😞 disappointed sad", "😔 pensive sad",
      "😟 worried", "😕 confused", "🙁 frown", "😣 persevere struggle",
      "😖 confounded", "😫 tired", "😩 weary", "🥺 pleading please beg",
      "😢 cry sad tear", "😭 sob crying loud", "😤 huff triumph steam",
      "😠 angry", "😡 rage furious mad", "🤬 swearing cursing",
      "🤯 mind blown exploding", "😳 flushed embarrassed", "🥵 hot heat sweating",
      "🥶 cold freezing", "😱 scream shock fear", "😨 fearful",
      "😰 anxious sweat", "😥 sad relieved", "😓 sweat downcast",
      "🤗 hug", "🤔 thinking hmm", "🤭 oops giggle", "🤫 shush quiet",
      "🤥 lying pinocchio", "😶 no mouth speechless", "😐 neutral",
      "😑 expressionless", "😬 grimace awkward", "🙄 eye roll",
      "😯 hushed surprised", "😪 sleepy", "😴 sleeping zzz tired",
      "🤤 drooling", "😷 mask sick", "🤒 thermometer ill sick",
      "🤕 bandage hurt injured", "🤢 nauseated sick", "🤮 vomiting sick",
      "🤧 sneezing", "🥴 woozy", "😵 dizzy", "🤠 cowboy",
      "🥱 yawn tired bored", "😈 devil mischief", "👻 ghost", "💀 skull dead",
      "🤖 robot bot", "👋 wave hello hi bye", "🤝 handshake deal agree",
      "👍 thumbs up yes good ok", "👎 thumbs down no bad",
      "👌 ok perfect", "🤌 pinched italian", "✌️ peace victory",
      "🤞 fingers crossed luck", "🤟 love you", "🤘 rock horns",
      "👏 clap applause well done", "🙌 raised hands praise celebrate",
      "🙏 pray please thanks thank you", "💪 muscle strong flex",
      "🫡 salute yes sir", "👀 eyes look watch", "🧠 brain",
      "🫶 heart hands love", "✍️ writing", "👇 down below",
      "👆 up above", "👉 right point", "👈 left point",
    ],
  },
  {
    key: "work",
    icon: "🧾",
    label: "Work & money",
    items: [
      "✅ tick check done yes complete", "❌ cross no wrong fail",
      "⚠️ warning careful caution", "❗ exclamation important",
      "❓ question", "⏰ alarm clock time late", "⏳ hourglass waiting",
      "📅 calendar date rota", "🗓️ calendar rota schedule",
      "📆 calendar", "🕐 clock time", "📈 chart up growth sales",
      "📉 chart down loss", "📊 bar chart report", "🧾 receipt invoice bill",
      "💷 pound money gbp", "💰 money bag cash", "💵 cash notes",
      "💳 card payment", "🏦 bank", "🧮 abacus count",
      "📝 memo note write", "📋 clipboard list", "📌 pin",
      "📎 paperclip attach", "🗂️ folders files", "📁 folder",
      "📄 document page file", "📃 page", "🖨️ printer print",
      "✏️ pencil edit", "🖊️ pen", "🔍 search magnify look",
      "🔑 key access", "🔒 locked private", "🔓 unlocked",
      "📣 megaphone announce shout", "📢 loudspeaker notice",
      "🔔 bell alert notify", "🔕 muted silent", "📞 phone call ring",
      "📱 mobile phone", "💻 laptop computer", "🖥️ desktop screen",
      "⚙️ settings gear config", "🛠️ tools fix repair",
      "🚨 siren emergency urgent", "♻️ recycle", "🗑️ bin waste rubbish",
    ],
  },
  {
    key: "food",
    icon: "🍽️",
    label: "Food & drink",
    items: [
      "🍽️ plate dining food meal", "🍴 cutlery fork knife",
      "🥄 spoon", "🔪 knife chop prep", "🍳 cooking fry egg pan",
      "🥘 pan dish curry", "🍲 pot stew soup", "🥣 bowl",
      "🥗 salad greens", "🍛 curry rice", "🍚 rice",
      "🍜 noodles ramen", "🍝 pasta spaghetti", "🍕 pizza",
      "🍔 burger", "🌮 taco", "🌯 wrap burrito", "🥙 kebab",
      "🥪 sandwich", "🍟 chips fries", "🍗 chicken drumstick",
      "🍖 meat", "🥩 steak beef", "🥓 bacon", "🐟 fish",
      "🍤 prawn shrimp", "🦐 prawn", "🥚 egg", "🧀 cheese",
      "🥖 bread baguette", "🍞 bread loaf", "🥐 croissant",
      "🥔 potato", "🧅 onion", "🧄 garlic", "🥕 carrot",
      "🍅 tomato", "🥬 lettuce greens", "🥦 broccoli",
      "🌶️ chilli spicy pepper", "🫑 pepper capsicum", "🍆 aubergine brinjal",
      "🍋 lemon", "🍎 apple", "🍌 banana", "🍇 grapes",
      "🥥 coconut", "🌾 wheat grain flour", "🧂 salt",
      "☕ coffee tea hot drink", "🍵 tea green", "🥤 soft drink cup",
      "🧃 juice", "🍺 beer", "🍷 wine", "🥂 cheers celebrate",
      "🎂 cake birthday", "🍰 cake slice", "🍨 ice cream dessert",
      "🍫 chocolate", "🍪 biscuit cookie", "🥧 pie",
    ],
  },
  {
    key: "places",
    icon: "🏨",
    label: "Places & travel",
    items: [
      "🏨 hotel restaurant", "🏪 shop store", "🏬 department store",
      "🏭 factory", "🏠 home house", "🏢 office building",
      "🚚 delivery lorry truck van", "🚛 lorry", "🛵 scooter delivery moped",
      "🚗 car", "🚕 taxi", "🚲 bike bicycle", "✈️ plane flight",
      "🚆 train", "🚌 bus", "⛽ fuel petrol", "🧭 compass direction",
      "📍 pin location here", "🗺️ map", "🌍 world globe earth",
      "☀️ sun sunny", "🌤️ partly cloudy", "☁️ cloud cloudy",
      "🌧️ rain wet", "⛈️ storm thunder", "❄️ snow cold ice",
      "🔥 fire hot busy", "💧 water drop", "🌊 wave sea",
      "🌙 moon night", "⭐ star", "✨ sparkles new shiny",
      "🌟 glowing star", "🎄 christmas tree", "🎃 halloween pumpkin",
    ],
  },
  {
    key: "symbols",
    icon: "❤️",
    label: "Symbols",
    items: [
      "❤️ red heart love", "🧡 orange heart", "💛 yellow heart",
      "💚 green heart", "💙 blue heart", "💜 purple heart",
      "🖤 black heart", "🤍 white heart", "💔 broken heart",
      "💯 hundred perfect full marks", "🎉 party tada celebrate congrats",
      "🎊 confetti celebrate", "🎈 balloon", "🎁 gift present",
      "🏆 trophy win", "🥇 first gold medal", "🥈 second silver",
      "🥉 third bronze", "🎯 target bullseye goal", "🚀 rocket launch fast",
      "💡 idea lightbulb", "🔆 bright", "🌈 rainbow",
      "♻️ recycle green", "☑️ checkbox ticked", "🔘 radio button",
      "➕ plus add", "➖ minus remove", "✖️ multiply times",
      "➗ divide", "🔁 repeat loop", "🔄 refresh sync",
      "⬆️ up", "⬇️ down", "⬅️ left", "➡️ right",
      "🔴 red circle", "🟠 orange circle", "🟡 yellow circle",
      "🟢 green circle ok", "🔵 blue circle", "⚫ black circle",
      "⚪ white circle", "🟥 red square", "🟩 green square",
      "🅿️ parking", "🆗 ok", "🆕 new", "🆘 sos help",
      "💬 speech bubble message chat", "💭 thought", "🗯️ anger bubble",
    ],
  },
];

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function noteRecent(ch: string) {
  try {
    const next = [ch, ...readRecent().filter((x) => x !== ch)].slice(0, 24);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* a private window is not a reason for the picker to stop working */
  }
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [group, setGroup] = useState(GROUPS[0].key);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecent(readRecent());
    // Typing is faster than aiming, so the caret starts in the search box.
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      const g = GROUPS.find((x) => x.key === group) ?? GROUPS[0];
      return g.items.map((s) => s.split(" ")[0]);
    }
    // Search crosses every category: when you are looking for a thing you do
    // not care which drawer it lives in.
    const hits: string[] = [];
    for (const g of GROUPS) {
      for (const item of g.items) {
        if (item.toLowerCase().includes(needle)) hits.push(item.split(" ")[0]);
      }
    }
    return hits;
  }, [q, group]);

  function choose(ch: string) {
    noteRecent(ch);
    setRecent(readRecent());
    onPick(ch);
  }

  return (
    <div className="w-[min(22rem,88vw)]">
      <input
        ref={searchRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search emoji…"
        data-testid="emoji-search"
        className="mise-well mb-2 min-h-[38px] w-full rounded-lg px-3 text-sm outline-none"
      />

      {!q && recent.length > 0 && (
        <>
          <p className="px-0.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            Recent
          </p>
          <div className="mb-2 grid grid-cols-8 gap-0.5">
            {recent.slice(0, 16).map((ch) => (
              <button
                key={`r-${ch}`}
                type="button"
                onClick={() => choose(ch)}
                className="mise-press grid h-8 place-items-center rounded-lg text-lg hover:bg-glass/10"
              >
                {ch}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mise-noscrollbar max-h-56 overflow-y-auto">
        {results.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-fg-faint">
            Nothing matches “{q}”.
          </p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {results.map((ch, i) => (
              <button
                key={`${ch}-${i}`}
                type="button"
                onClick={() => choose(ch)}
                data-testid="emoji-option"
                className="mise-press grid h-8 place-items-center rounded-lg text-lg hover:bg-glass/10"
              >
                {ch}
              </button>
            ))}
          </div>
        )}
      </div>

      {!q && (
        <div className="mt-2 flex gap-1 border-t border-line pt-2">
          {GROUPS.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => setGroup(g.key)}
              aria-label={g.label}
              title={g.label}
              className={`mise-press grid h-8 flex-1 place-items-center rounded-lg text-base transition ${
                group === g.key ? "bg-brand-500/20" : "hover:bg-glass/10"
              }`}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
