"use client";

/** Three ways to get your data in, and none of them is homework.
 *
 *     "following the template is fine...but everytime they wont have a
 *      tempate also evenign donwlaod empty tempate and adding datas are
 *      extra job...so better keep this + add one more featuyre like let them
 *      add whatever document they have like csv image pdf word whatsever->
 *      our AI will analyse and give preview"
 *
 *  He uploaded a .txt menu and got "Couldn't find the template's header
 *  row." True, and useless: a text file has no header row, and being told to
 *  go and download a blank template, fill it in, and come back is precisely
 *  the extra job.
 *
 *  SO THE FILE PICKER NEVER REFUSES. One drop zone, any number of files, any
 *  format. The deterministic reader runs first because it is exact and free;
 *  anything it cannot parse goes to the AI automatically, WITHOUT him having
 *  to know which button meant which. He should not have to understand our
 *  parsing strategy to add his suppliers.
 *
 *  MANY FILES AT ONCE, because "suppose user if they upload 20+ photos whihc
 *  has handwriten recipe". Twenty photographs is one job, not twenty.
 */

import { useCallback, useRef, useState } from "react";

const HINT: Record<string, string> = {
  vendors: "a supplier list, an email, a photo of the board in the kitchen",
  inventory: "a stock sheet, a delivery note, a photo of the shelves list",
  employees: "a rota, a payroll export, a list of names",
  recipes: "a menu, a PDF, or twenty photos of the recipe book",
};

export function SourceRail({
  list,
  noun,
  title,
  href,
  reading,
  onFiles,
  onTyped,
}: {
  list: string;
  noun: string;
  title: string;
  href: string;
  /** Non-null while files are being read — the label to show. */
  reading: string | null;
  onFiles: (files: File[]) => void;
  onTyped: (text: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");

  const drop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  if (reading) {
    return (
      <div className="mise-card-inset rounded-2xl p-5">
        <p className="text-sm font-medium text-fg">{reading}</p>
        {/* Skeleton rows at the REAL row height, so nothing jumps when the
            rows land. A spinner in the middle of a wide card tells you
            nothing about what is arriving. */}
        <div className="mt-3 space-y-1.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mise-readrail h-9 rounded-lg border border-line/60" />
          ))}
        </div>
      </div>
    );
  }

  if (typing) {
    return (
      <div className="mise-card-inset rounded-2xl p-4">
        <p className="text-sm font-medium text-fg">Type or paste your {noun}</p>
        <p className="mt-0.5 max-w-[54ch] text-[0.8125rem] leading-relaxed text-fg-soft">
          One per line is plenty — a name on its own works. Anything extra you
          put after it, we will try to read.
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          autoFocus
          placeholder={
            list === "vendors"
              ? "Fresh Foods, 07700 900111\nLocal Market\nRudra Exim Ltd, accounts@rudra.co.uk"
              : list === "inventory"
                ? "Basmati Rice, kg, 25\nPaneer, kg, 10"
                : list === "employees"
                  ? "Bala Subramani, chef\nMeena R, front of house"
                  : "Butter Chicken, Mains, 12.50\nMasala Dosa, Breakfast, 8.00"
          }
          className="mise-well mt-3 w-full rounded-xl px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed text-fg outline-none placeholder:text-fg-faint"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => {
              onTyped(draft);
              setTyping(false);
            }}
            className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Read this
          </button>
          <button
            type="button"
            onClick={() => setTyping(false)}
            className="mise-press rounded-xl px-3 py-2.5 text-sm text-fg-faint hover:text-fg"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={`mise-card-inset rounded-2xl p-5 transition ${
        over ? "ring-2 ring-brand-500" : ""
      }`}
    >
      <p className="font-display text-lg font-bold text-fg">
        {over ? `Drop them — I'll read them` : `Bring your ${noun}`}
      </p>
      <p className="mt-1 max-w-[54ch] text-sm leading-relaxed text-fg-soft">
        {/* NO FORMAT LIST. "csv, xlsx, pdf, docx, png, jpg" is a rule to obey;
            naming the THINGS he owns is an invitation. */}
        Drop {HINT[list] ?? "whatever you have"} — as many files as you like.
        If it is a photo or a document, the AI reads it and shows you what it
        found before anything is saved.
      </p>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          Choose files
        </button>
        <button
          type="button"
          onClick={() => setTyping(true)}
          className="mise-press mise-card-inset rounded-xl px-3.5 py-2.5 text-sm font-medium text-fg-soft"
        >
          Type them instead
        </button>
        <a
          href={href}
          className="mise-press rounded-xl px-2.5 py-2.5 text-[0.8125rem] text-fg-faint underline underline-offset-2"
        >
          add on the {title.toLowerCase()} page
        </a>
      </div>

      {/* NO `accept` AT ALL. Narrowing it is what once told him to send a PNG
          of his spreadsheet — the refusal happened in the file dialog, before
          anything was uploaded, and looked like the product rejecting his
          data. Whatever he picks, something here will read it or say plainly
          that it could not. */}
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
