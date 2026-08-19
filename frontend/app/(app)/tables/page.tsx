"use client";

// 🪑 THE ROOM. Set up the tables, print the cards that go on them.
//
//   "we don't know how many table each hotel have so we can make it
//    configurable by superadmin"
//
// So the first thing this page offers is "how many tables have you got" and a
// button — a twenty-cover restaurant should not press Add twenty times. The
// printed sheet is the point of the page: a QR that never leaves the screen has
// automated nothing.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, API_BASE, downloadFile } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type Table = {
  id: string;
  label: string;
  code: string;
  seats: number;
  sort_order: number;
  is_active: boolean;
};

export default function TablesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "orders:write");

  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [howMany, setHowMany] = useState("10");
  const [prefix, setPrefix] = useState("Table");
  const [oneLabel, setOneLabel] = useState("");
  // "how you know each table will have 4 seats... it depends, so we need to get
  // these datas from super admin." Four is where the form starts, not a rule.
  const [seats, setSeats] = useState("4");
  const [oneSeats, setOneSeats] = useState("4");
  const [printing, setPrinting] = useState(false);
  // When set, only this card is on the printed sheet.
  const [only, setOnly] = useState<string | null>(null);

  function load() {
    return api
      .get<Table[]>("/ordering/tables")
      .then(setTables)
      .catch(() => setTables([]));
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function addMany() {
    const n = parseInt(howMany, 10);
    if (!(n > 0)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/ordering/tables/bulk", {
        count: n,
        prefix: prefix.trim() || "Table",
        seats: Math.max(1, parseInt(seats, 10) || 4),
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add those tables.");
    } finally {
      setBusy(false);
    }
  }

  async function addOne() {
    if (!oneLabel.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/ordering/tables", {
        label: oneLabel.trim(),
        seats: Math.max(1, parseInt(oneSeats, 10) || 4),
      });
      setOneLabel("");
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add that table.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: Table) {
    const ok = await confirm({
      title: `Remove ${t.label}?`,
      message:
        `The card printed for ${t.label} will stop working immediately. ` +
        `Past orders from it are kept.`,
      confirmText: "Remove the table",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/ordering/tables/${t.id}`).catch(() => {});
    await load();
  }

  /** PDFs come from the server, so they need the auth header a plain <a> has
   *  no way to send. */
  async function downloadPdf(path: string, filename: string) {
    setErr(null);
    try {
      await downloadFile(path, filename);
    } catch {
      setErr("Could not build that PDF just now.");
    }
  }

  /** Print ONE card: mark it, print, unmark. Cheaper and more predictable than
   *  opening a second window that has none of the app's styles. */
  function printOne(t: Table) {
    setOnly(t.id);
    document.documentElement.classList.add("mise-printing");
    window.setTimeout(() => {
      window.print();
      document.documentElement.classList.remove("mise-printing");
      setOnly(null);
    }, 600);
  }

  const live = useMemo(() => tables.filter((t) => t.is_active), [tables]);
  const base = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <Workbench
      title="Tables & QR codes"
      subtitle="A card on every table. Diners scan it, order, and the kitchen sees it."
      tools={
        canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="text-[11px] font-medium text-fg-soft">How many tables?</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  inputMode="numeric"
                  value={howMany}
                  onChange={(e) => setHowMany(e.target.value.replace(/\D/g, ""))}
                  className="mise-well w-16 rounded-xl px-3 py-2.5 text-center text-sm outline-none"
                />
                <input
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  aria-label="What to call them"
                  className="mise-well w-24 rounded-xl px-3 py-2.5 text-sm outline-none"
                />
                <input
                  inputMode="numeric"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))}
                  aria-label="Seats at each of them"
                  title="Seats at each table"
                  className="mise-well w-14 rounded-xl px-2 py-2.5 text-center text-sm outline-none"
                />
                <span className="text-[11px] text-fg-faint">seats</span>
                <button
                  type="button"
                  onClick={addMany}
                  disabled={busy}
                  className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Create
                </button>
              </span>
            </label>
            <span className="h-8 w-px bg-line" aria-hidden />
            <label className="block">
              <span className="text-[11px] font-medium text-fg-soft">Or add one</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  value={oneLabel}
                  onChange={(e) => setOneLabel(e.target.value)}
                  placeholder="Bar 1"
                  className="mise-well w-32 rounded-xl px-3 py-2.5 text-sm outline-none"
                />
                <input
                  inputMode="numeric"
                  value={oneSeats}
                  onChange={(e) => setOneSeats(e.target.value.replace(/\D/g, ""))}
                  aria-label="Seats at this table"
                  className="mise-well w-14 rounded-xl px-2 py-2.5 text-center text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={addOne}
                  disabled={busy || !oneLabel.trim()}
                  className="mise-press mise-raised rounded-xl px-3 py-2.5 text-sm font-medium text-fg-soft disabled:opacity-40"
                >
                  Add
                </button>
              </span>
            </label>
          </div>
        ) : undefined
      }
      tally={
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-faint">
          <span>
            <b className="text-fg-soft tabular-nums">{live.length}</b> tables taking orders
          </span>
          {live.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPrinting(true);
                // Mark the document so the print rules can scope to it, and
                // give the QR images a beat to paint before the dialog freezes
                // the page — a sheet of empty boxes is a wasted tree.
                document.documentElement.classList.add("mise-printing");
                window.setTimeout(() => {
                  window.print();
                  document.documentElement.classList.remove("mise-printing");
                  setPrinting(false);
                }, 700);
              }}
              className="mise-press rounded-lg border border-brand-400/40 bg-brand-400/10 px-3 py-1.5 font-medium text-brand-300"
            >
              🖨 Print the cards
            </button>
          )}
          {live.length > 0 && (
            <button
              type="button"
              onClick={() => downloadPdf("/ordering/table-cards.pdf", "table-cards.pdf")}
              className="mise-press rounded-lg border border-line px-3 py-1.5 font-medium text-fg-soft"
              title="One PDF of every card — the file you hand to a print shop"
            >
              ⬇ Download all as PDF
            </button>
          )}
        </div>
      }
    >
      {err && (
        <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {err}
        </p>
      )}

      {loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : tables.length === 0 ? (
        <Card>
          <div className="py-10 text-center">
            <p className="text-4xl" aria-hidden>🪑</p>
            <p className="mt-3 text-sm font-medium text-fg">No tables yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-faint">
              Say how many you have above and press Create. Each one gets its own QR card —
              print them, put one on each table, and diners can order without waiting for
              anybody.
            </p>
          </div>
        </Card>
      ) : (
        <ul
          className="mise-print-sheet mise-stagger grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(15rem, 100%), 1fr))" }}
        >
          {tables.map((t) => (
            <li
              key={t.id}
              className={`mise-print-card break-inside-avoid ${
                only && only !== t.id ? "print:hidden" : ""
              }`}
            >
              <div className={`mise-card3d overflow-hidden p-3.5 ${t.is_active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold text-fg">{t.label}</p>
                    <p className="text-[11px] text-fg-faint">
                      {t.seats} seats · code <b className="font-mono text-fg-soft">{t.code}</b>
                    </p>
                  </div>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => remove(t)}
                      aria-label={`Remove ${t.label}`}
                      className="mise-press shrink-0 rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:border-rose-400/50 hover:text-rose-300 print:hidden"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* The card itself. White behind the QR ALWAYS — a dark-themed
                    QR on a dark card is a QR no camera will read, and this is
                    the one element whose job is to be scanned. */}
                <div className="mt-3 grid place-items-center rounded-2xl bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_BASE}/api/public/table/${t.code}/qr.svg`}
                    alt={`QR code for ${t.label}`}
                    className="h-36 w-36"
                  />
                </div>
                {/* Taking THIS card away: the sheet is for the print shop,
                    these are for when one card gets spilled on. */}
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1 print:hidden">
                  <a
                    href={`${API_BASE}/api/public/table/${t.code}/qr.png`}
                    download={`${t.label}.png`}
                    className="mise-press rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:text-fg"
                  >
                    ⬇ PNG
                  </a>
                  <button
                    type="button"
                    onClick={() => downloadPdf(`/ordering/tables/${t.id}/card.pdf`, `${t.label}.pdf`)}
                    className="mise-press rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:text-fg"
                  >
                    ⬇ PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => printOne(t)}
                    className="mise-press rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:text-fg"
                  >
                    🖨 Print
                  </button>
                </div>
                <p className="mt-2 text-center text-[11px] leading-relaxed text-fg-faint">
                  Scan to see the menu and order
                  <span className="mt-0.5 block break-all font-mono text-[10px] text-fg-faint/70">
                    {base}/t/{t.code}
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {printing && (
        <p className="mt-4 text-center text-xs text-fg-faint">Preparing the sheet…</p>
      )}
    </Workbench>
  );
}
