"use client";

/** The first thing a restaurant sees, and the moment its data arrives.
 *
 *     "this is the only page wihhc will give first imporesssiion to hotel
 *      owners... litrelly the new hotel coming to register wiht us they should
 *      feel smoth expiereince...litrelly whatever they need they can do"
 *
 *  ⚠️ IT LIVES INSIDE THE APP SHELL, and that single move is the largest fix
 *  here. The old page was a standalone route at `/onboarding` painted
 *  `bg-[#0b1220]` with about thirty `white/x` alpha classes — so a restaurant
 *  on any of the other 22 themes clicked through from its own dashboard into a
 *  near-black green page that read as a different product. Inside `(app)` it
 *  inherits the theme, `mise-card-inset`, `mise-well`, `SheetPopup` and the
 *  sidebar, all correct in both modes, for nothing.
 *
 *  It also stops being a dead end you have to "Skip setup →" out of and
 *  becomes A ROOM YOU CAN LEAVE AND COME BACK TO. Most restaurants will never
 *  finish setting up. A wizard makes that a failure; a room does not.
 *
 *  ONE DROP RAIL, NOT FOUR ZONES. Four zones is four decisions before you have
 *  done anything — and it is a lie, because the reader does not need to be
 *  told which pile a file belongs to. Pretending it does is exactly the
 *  friction this page exists to remove.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ImportPlan, type Decision, type Plan } from "@/components/ImportPlan";
import { SheetPopup } from "@/components/SheetPopup";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError, postForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Station = {
  key: string;
  icon: string;
  title: string;
  /** The count noun — "items", "suppliers". Plural handled by the count. */
  noun: string;
  /** What does NOT work until this has something. Not a nag: a reason. */
  cost: string;
  href: string;
  /** The import base, where one exists. Menu has none yet. */
  base?: string;
  count: number;
};

const BLANK: Omit<Station, "count">[] = [
  {
    key: "items",
    icon: "📦",
    title: "Stock",
    noun: "items",
    cost: "Recipes can't be costed until this has something in it.",
    href: "/inventory",
    base: "inventory",
  },
  {
    key: "vendors",
    icon: "🤝",
    title: "Suppliers",
    noun: "suppliers",
    cost: "Nothing to compare prices against yet.",
    href: "/vendors",
    base: "vendors",
  },
  {
    key: "recipes",
    icon: "🍲",
    title: "Menu",
    noun: "dishes",
    cost: "No margins until there are dishes.",
    href: "/recipes",
    // The menu got its importer this week; before that it was the one station
    // a file could not reach, so the deterministic pass skipped it entirely.
    base: "recipes",
  },
  {
    key: "employees",
    icon: "🧑‍🍳",
    title: "Team",
    noun: "people",
    cost: "Rota and payroll wait on this.",
    href: "/employees",
    base: "employees",
  },
];

export default function SetupPage() {
  const { hotel } = useAuth();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: Plan; base: string; noun: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.get<{ steps: { key: string; count: number }[] }>(
        "/hotels/onboarding",
      );
      setCounts(Object.fromEntries(s.steps.map((x) => [x.key, x.count])));
    } catch {
      // A failed count must not blank the page — the doors still work, and a
      // station showing "—" is better than a screen that refuses to render.
      setCounts({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** THE ONE DOOR. Try to read it as a list we know; if the headers do not
   *  match anything, hand it to the AI rather than dead-ending.
   *
   *  Deterministic first, always: a file this product exported is read exactly
   *  and for free, and only a file we have never seen costs a model call. The
   *  reverse order would spend money re-reading our own exports and would be
   *  less accurate doing it. */
  const take = useCallback(async (file: File) => {
    setReading(file.name);
    setNote(null);
    try {
      for (const st of BLANK) {
        if (!st.base) continue;
        try {
          const body = new FormData();
          body.append("file", file);
          const p = await postForm<Plan>(`/${st.base}/import/preview`, body);
          // A plan with rows means the headers matched this list. A plan with
          // errors means it did not — try the next one rather than stopping.
          if (p.rows?.length) {
            setPlan({ plan: p, base: st.base, noun: st.title.toLowerCase() });
            return;
          }
        } catch {
          // 4xx here is "not this list", not a failure worth showing.
        }
      }
      // NOTHING MATCHED BY ITS HEADINGS — SO ASK THE AI WHAT IT IS.
      //
      // This page promises "drop it anywhere and I'll work out what it is",
      // and until now it only kept that promise for a file whose column
      // headings we already knew. Everything else — a supplier's PDF, a
      // photographed stock sheet, a spreadsheet with somebody's own wording —
      // got a note telling them to go and find the right station, which is
      // the precise friction this page exists to remove.
      //
      // One call. It identifies the list AND reads it, and hands back the
      // same plan shape the file importers produce, so it lands on the same
      // preview screen and commits through the same endpoint.
      setReading(`${file.name} — reading it with AI…`);
      const body = new FormData();
      body.append("file", file);
      const read = await postForm<{
        list: string | null;
        label?: string;
        plan: Plan | null;
        why?: string;
      }>("/assistant/read-any", body);

      if (read.list && read.plan?.rows?.length) {
        setPlan({
          plan: read.plan,
          base: read.list,
          noun: (read.label ?? read.list).toLowerCase(),
        });
        return;
      }
      setNote(
        read.why ??
          `I read “${file.name}”, but couldn't see a list of stock, ` +
            `suppliers, staff or dishes in it.`,
      );
    } catch (err) {
      // The deterministic passes swallow their own 4xx (that is "not this
      // list"). This catch is for the AI call, which is the one whose failure
      // a person needs to hear about — it can be off, busy, or rate-limited.
      setNote(
        err instanceof ApiError
          ? err.message
          : `Something went wrong reading “${file.name}”. Try again, or open ` +
            `the station you want and use Import there.`,
      );
    } finally {
      setReading(null);
    }
  }, []);

  const commit = async (decisions: Decision[]) => {
    if (!plan) return;
    try {
      const res = await api.post<{
        counts: { created: number; updated: number; skipped: number; failed: number };
      }>(`/${plan.base}/import/commit`, { rows: decisions, source: "setup" });
      const c = res.counts;
      setNote(
        `Added ${c.created}${c.updated ? `, updated ${c.updated}` : ""}` +
          `${c.skipped ? `, left ${c.skipped}` : ""}.`,
      );
      setPlan(null);
      void load();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not save those.");
    }
  };

  const stations: Station[] = BLANK.map((s) => ({ ...s, count: counts[s.key] ?? 0 }));
  const nextUp = stations.find((s) => s.count === 0);

  return (
    <div
      className="flex flex-1 flex-col space-y-5"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void take(f);
      }}
    >
      <PageHeader
        title={`Set up ${hotel?.name ?? "your restaurant"}`}
        subtitle="Bring what you already have — drop it anywhere on this page and I'll work out what it is."
        actions={
          // A WAY OUT, ON ARRIVAL. Setting up is not a prerequisite for using
          // the product, and a page you cannot leave says it is.
          <Link
            href="/dashboard"
            className="mise-press mise-well rounded-xl px-3.5 py-2 text-sm font-medium text-fg-soft"
          >
            Skip — I&apos;ll do it as I go
          </Link>
        }
      />

      {/* ── THE DROP RAIL ─────────────────────────────────────────────── */}
      <Card
        className={`mise-feel p-5 transition ${
          dragging ? "ring-2 ring-brand-500" : ""
        }`}
      >
        {reading ? (
          <div className="flex items-center gap-3">
            <Spinner />
            <p className="text-sm text-fg-soft">
              Reading <b className="text-fg">{reading}</b>…
            </p>
          </div>
        ) : (
          <>
            <p className="font-display text-lg font-bold text-fg">
              {dragging ? "Drop it — anywhere is fine" : "Drop a file here"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-fg-soft">
              A spreadsheet, a PDF, a photo of a handwritten list — stock,
              suppliers, your team or your menu. I&apos;ll work out which it is.
              If you have just exported from another DineAI account, that file
              works here exactly as it is.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Choose a file
              </button>
              <span className="text-[11px] text-fg-faint">
                or drag it onto the page
              </span>
            </div>
          </>
        )}
        {/* NO `accept`. Narrowing it is what stopped him choosing his own
            spreadsheet on the AI page — the refusal happened in the file
            dialog, before anything was uploaded, and looked like the product
            rejecting his data. */}
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void take(f);
          }}
        />
      </Card>

      {note && (
        <p className="text-xs leading-relaxed text-fg-soft" role="status">
          {note}
        </p>
      )}

      {/* ── THE FOUR STATIONS ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stations.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            className="mise-card-inset mise-press flex flex-col rounded-2xl p-4 transition"
          >
            <span className="text-2xl" aria-hidden>
              {s.icon}
            </span>
            <span className="mt-2 font-semibold text-fg">{s.title}</span>
            <span className="mt-0.5 font-mono text-sm tabular-nums text-fg-soft">
              {loading ? "—" : `${s.count} ${s.noun}`}
            </span>
            {/* THE COST OF LEAVING IT EMPTY, not a nag to fill it. "0 items"
                is a number; "recipes can't be costed" is a reason. */}
            {s.count === 0 && (
              <span className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                {s.cost}
              </span>
            )}
          </Link>
        ))}
      </div>

      {/* ONE LINE, NOT A PROGRESS BAR. Most restaurants will never fill all
          four, and a percentage turns that into permanent failure. */}
      {!loading && nextUp && (
        <p className="text-sm text-fg-soft">
          Add your {nextUp.title.toLowerCase()} next — {nextUp.cost.toLowerCase()}
        </p>
      )}
      {!loading && !nextUp && (
        <p className="text-sm text-fg-soft">
          Everything is in. This page stays here if you ever need to bring more.
        </p>
      )}

      <div className="mise-well rounded-xl p-3 text-[11px] leading-relaxed text-fg-faint">
        <b className="text-fg-soft">Moving from another DineAI account?</b> Export
        there, drop the file here — it imports exactly as it left.{" "}
        <b className="text-fg-soft">Got your own spreadsheet?</b> Drop it as it
        is; you will see what would change before anything is saved.
      </div>

      {plan && (
        <SheetPopup
          onClose={() => setPlan(null)}
          title={`Import ${plan.noun}`}
        >
          <ImportPlan
            plan={plan.plan}
            onCancel={() => setPlan(null)}
            onCommit={commit}
          />
        </SheetPopup>
      )}
    </div>
  );
}
