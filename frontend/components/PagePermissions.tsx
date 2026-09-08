"use client";

// SET EACH PAGE, ONE AT A TIME.
//
//   "under sales we have 3 permission nah. Currently I can able to select all
//    and give write or read access, or I can cross and give. But I want like:
//    those 3 is there nah — in that 1 I can give write, 1 I can give read, like
//    this I want bro, for all the roles. Go build popup kinda thing like ask in
//    these 3 page what role u want to give, like that ask user."
//
// My first attempt at this was wrong in two ways and he spotted both.
//
// It was a CYCLING CHIP: click once for read-only, again to hide, again to give
// it back. Three answers hidden inside one control, discoverable only by
// clicking and watching what happens. And it only offered read-only when the
// whole area was already on "Can change", so on an area set to "Can see" the
// chips did nothing at all — which is the state he screenshotted.
//
// He asked for a popup that ASKS. So each page gets its own three-way, the same
// control the area itself uses, and the answer is visible without touching
// anything.
//
// The area switch and the page switches cannot contradict each other, so there
// is one rule: THE AREA IS THE MAXIMUM OF ITS PAGES. Give one page "can change"
// and the area is on "can change"; the other two are still whatever they were.
// That is what makes "Online Orders read-only, the other two writable" express-
// ible without a second, conflicting source of truth.

import { Level, type Area, type PageRef } from "@/lib/access";
import { SheetPopup } from "@/components/SheetPopup";

const WHAT: Record<Level, { label: string; hint: string; tone: string }> = {
  none: {
    label: "Hidden",
    hint: "They never see this page",
    tone: "text-fg-faint",
  },
  view: {
    label: "Can look",
    hint: "They can open it and read it, but nothing on it will save",
    tone: "text-amber-500",
  },
  edit: {
    label: "Can change",
    hint: "They can open it and change things on it",
    tone: "text-brand-300",
  },
};

export function PagePermissions({
  area,
  levelFor,
  onSet,
  onClose,
}: {
  area: Area;
  /** What this page is set to right now. */
  levelFor: (page: PageRef) => Level;
  onSet: (page: PageRef, level: Level) => void;
  onClose: () => void;
}) {
  // De-duplicated: two routes that are deliberately one thing should be asked
  // about once. ("why here duplicate? the assistant the assistant")
  const pages = area.pages.filter(
    (p, i, all) => all.findIndex((x) => x.slug === p.slug) === i,
  );
  // An area with nothing to write has no meaningful middle — offering "can
  // look" where looking IS the only thing would be a choice with one outcome.
  const options: Level[] = area.write.length > 0 ? ["none", "view", "edit"] : ["none", "edit"];

  return (
    <SheetPopup
      depth={2}
      columns={2}
      onClose={onClose}
      onBack={onClose}
      title={area.label}
      subtitle={`What may they do on each of these ${pages.length} pages?`}
    >
      <div className="space-y-2.5">
        <p className="text-sm text-fg-soft">
          One switch used to cover all of them together. Set them separately here — one
          page can be read-only while the ones beside it stay editable.
        </p>

        <ul className="space-y-2">
          {pages.map((pg) => {
            const level = levelFor(pg);
            return (
              <li key={pg.slug} className="mise-card-inset rounded-2xl p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{pg.label}</p>
                    <p className={`mt-0.5 text-[11px] ${WHAT[level].tone}`}>
                      {WHAT[level].hint}
                    </p>
                  </div>
                  <div
                    role="radiogroup"
                    aria-label={`What they may do on ${pg.label}`}
                    className="mise-well inline-flex shrink-0 rounded-xl p-0.5"
                  >
                    {options.map((o) => {
                      const on = level === o;
                      return (
                        <button
                          key={o}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          data-testid={`pagelevel-${pg.slug}-${o}`}
                          onClick={() => onSet(pg, o)}
                          title={WHAT[o].hint}
                          className={`mise-press rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                            on ? "bg-brand-600 text-white" : "text-fg-faint hover:text-fg"
                          }`}
                        >
                          {WHAT[o].label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="text-[11px] leading-relaxed text-fg-faint">
          {/* Said plainly, because the honest version of this is not obvious and
              a reader who assumes more than it does would be misled. */}
          <b className="text-fg-soft">Worth knowing:</b> these pages share one underlying
          permission, so &ldquo;can look&rdquo; hides the buttons rather than sealing the
          data. It is the right tool for &ldquo;don&apos;t let them touch this one&rdquo;,
          not for keeping a secret from someone who already has the module.
        </p>
      </div>
    </SheetPopup>
  );
}
