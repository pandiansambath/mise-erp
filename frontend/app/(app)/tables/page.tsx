"use client";

// 🪑 THE ROOM — rebuilt.
//
//   "now table qr page: you definitely need to rebuild this entire UI UX from
//    scratch... also make qr like it needs to have a table name in that qr
//    center area, surrounded by qr... when creating several tables if user wish
//    to add different name for each table means we need to allow nah... after
//    created also we need to allow them to edit all, regenerated qr... also you
//    need to add some more useful feature here bro."
//
// WHAT WAS WRONG, from the screenshot rather than from memory:
//
// Nineteen tables meant nineteen raised white slabs, each carrying a 145px QR,
// three download buttons and its URL printed in monospace. That is 57 buttons
// and a page four screens tall to answer "which tables do I have" — on a site
// whose owner says, repeatedly, that he hates scrolling. The QR is the LEAST
// interesting thing on the card too: you print it once, laminate it, and never
// look at it again. It was taking 80% of the space every day for a job it does
// on one day.
//
// So the room is a grid of TILES now — name, seats, and what is happening at
// that table right now — and everything a single table needs opens in a popup
// when you click it. Same shape as Staff and Purchasing, which is the house
// style, and the same reason: a page is for finding the thing, a popup is for
// doing something to it.
//
// The useful feature he asked for is the third line on each tile. These are the
// tables people are SITTING AT, and every fact needed to say so was already in
// the orders table — nobody had joined them up. A printing utility became a
// floor view for the cost of one grouped query.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, API_BASE, downloadFile } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";
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
  open_orders: number;
  seated_since: string | null;
  needs_help: boolean;
};

function sinceText(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export default function TablesPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "orders:write");

  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Table | null>(null);
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [only, setOnly] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(
    () =>
      api
        .get<Table[]>("/ordering/tables")
        .then((rows) => {
          setTables(rows);
          // Keep the open popup pointed at fresh data — a rename or a release
          // has to be visible in the sheet that did it.
          setOpen((cur) => (cur ? (rows.find((r) => r.id === cur.id) ?? null) : null));
        })
        .catch(() => setTables([])),
    [],
  );

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // The floor changes while you are looking at it, so this re-reads on a slow
  // beat. Thirty seconds, not three: nobody is expediting from this page, and a
  // poll that fires twenty times a minute to move a "seated 12 min" label to 13
  // is a cost with no reader.
  useEffect(() => {
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

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
    setOpen(null);
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

  function printCards(oneId: string | null) {
    setOnly(oneId);
    setPrinting(true);
    document.documentElement.classList.add("mise-printing");
    // The QR images need a beat to paint before the dialog freezes the page —
    // a sheet of empty boxes is a wasted tree.
    window.setTimeout(() => {
      window.print();
      document.documentElement.classList.remove("mise-printing");
      setPrinting(false);
      setOnly(null);
    }, 700);
  }

  const live = useMemo(() => tables.filter((t) => t.is_active), [tables]);
  const busy = useMemo(() => tables.filter((t) => t.open_orders > 0), [tables]);
  const waving = useMemo(() => tables.filter((t) => t.needs_help), [tables]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tables;
    return tables.filter(
      (t) => t.label.toLowerCase().includes(needle) || t.code.includes(needle),
    );
  }, [tables, q]);

  return (
    <Workbench
      title="Tables & QR codes"
      subtitle="A card on every table. Diners scan it, order, and the kitchen sees it."
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 Find a table…"
            aria-label="Find a table"
            className="mise-well min-h-[42px] flex-1 rounded-xl px-3 text-sm outline-none sm:w-56 sm:flex-none"
          />
          {canWrite && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-tone="brand"
              data-testid="tables-add"
              className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm"
            >
              + Add tables
            </button>
          )}
          {live.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => printCards(null)}
                className="mise-btn-flat mise-press min-h-[42px] px-3 text-sm font-semibold text-fg-soft"
              >
                🖨 Print the cards
              </button>
              <button
                type="button"
                onClick={() => downloadPdf("/ordering/table-cards.pdf", "table-cards.pdf")}
                title="One PDF of every card — the file you hand to a print shop"
                className="mise-btn-flat mise-press min-h-[42px] px-3 text-sm font-semibold text-fg-soft"
              >
                ⬇ All as PDF
              </button>
            </>
          )}
        </div>
      }
      tally={
        /* THE ROOM IN ONE LINE. What was here before was the table count and
           two buttons; the count you can see by looking, and the buttons have
           moved up to where the other actions are. This says what you cannot
           see by looking: how much of the room is working right now. */
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-fg-faint">
            <b className="tabular-nums text-fg-soft">{live.length}</b> tables taking orders
          </span>
          {busy.length > 0 && (
            <span className="font-semibold text-fg">
              <b className="tabular-nums">{busy.length}</b> seated
            </span>
          )}
          {waving.length > 0 && (
            <span className="text-danger">
              ✋ {waving.length} waiting for someone
            </span>
          )}
        </div>
      }
    >
      {err && (
        <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300">
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
            <p className="text-4xl" aria-hidden>
              🪑
            </p>
            <p className="mt-3 text-sm font-medium text-fg">No tables yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-fg-faint">
              Add the tables you have and each one gets its own QR card — print them, put
              one on each table, and diners can order without waiting for anybody.
            </p>
            {canWrite && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                data-tone="brand"
                className="mise-btn-flat mise-press mt-4 min-h-[44px] px-5 text-sm"
              >
                + Add tables
              </button>
            )}
          </div>
        </Card>
      ) : (
        <ul
          className="mise-stagger mise-long-list grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(11rem, 100%), 1fr))" }}
        >
          {shown.map((t) => (
            <li key={t.id}>
              {/* THE WHOLE TILE IS THE BUTTON.
                  "click anything, do anything." A tile with a clickable name
                  and three clickable sub-buttons teaches people to aim; a tile
                  that is one target teaches them to click. */}
              <button
                type="button"
                onClick={() => setOpen(t)}
                data-testid="table-tile"
                className={`mise-card-inset mise-press w-full rounded-2xl p-3 text-left transition ${
                  t.is_active ? "" : "opacity-55"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate font-display text-[15px] font-bold text-fg">
                    {t.label}
                  </p>
                  {t.needs_help && (
                    <span
                      aria-label="Waiting for someone"
                      title="Waiting for someone"
                      className="shrink-0 text-sm"
                    >
                      ✋
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-fg-faint">{t.seats} seats</p>

                {/* The line that turns a printing page into a floor view. */}
                {t.open_orders > 0 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-fg">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    {t.open_orders} {t.open_orders === 1 ? "order" : "orders"}
                    <span className="font-normal text-fg-soft">
                      · {sinceText(t.seated_since)}
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-fg-faint">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg-faint/40" />
                    {t.is_active ? "Free" : "Not taking orders"}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {shown.length === 0 && tables.length > 0 && (
        <p className="py-10 text-center text-sm text-fg-faint">
          No table matches “{q}”.
        </p>
      )}

      {printing && <p className="mt-4 text-center text-xs text-fg-faint">Preparing the sheet…</p>}

      {/* ── THE PRINTABLE SHEET ─────────────────────────────────────────────
          Hidden on screen, laid out for paper. It used to BE the page, which is
          how the page ended up four screens tall: the artefact that leaves the
          building was also the interface for managing it, and those two want
          opposite things. A print card wants to be large, isolated and
          unclickable; a management tile wants to be small, dense and clickable.
          Separating them lets each be right. */}
      <div aria-hidden className="hidden print:block">
        <ul className="mise-print-sheet grid grid-cols-2 gap-4">
          {live
            .filter((t) => !only || only === t.id)
            .map((t) => (
              <li
                key={t.id}
                className="mise-print-card break-inside-avoid rounded-2xl border border-black/20 p-4 text-center"
              >
                <p className="font-display text-lg font-bold text-black">{t.label}</p>
                <p className="text-[11px] text-black/60">{t.seats} seats</p>
                <div className="mt-2 grid place-items-center rounded-xl bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${API_BASE}/api/public/table/${t.code}/qr.svg`}
                    alt={`QR code for ${t.label}`}
                    className="h-44 w-44"
                  />
                </div>
                <p className="mt-2 text-xs font-semibold text-black">
                  Scan to see the menu and order
                </p>
              </li>
            ))}
        </ul>
      </div>

      {open && (
        <TableSheet
          table={open}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onChanged={load}
          onRemove={() => remove(open)}
          onPrint={() => printCards(open.id)}
          onPdf={() => downloadPdf(`/ordering/tables/${open.id}/card.pdf`, `${open.label}.pdf`)}
        />
      )}

      {adding && (
        <AddTablesSheet
          existing={tables.length}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </Workbench>
  );
}

/* ── One table, everything about it ─────────────────────────────────────────
   Everything that used to be printed on every card in the grid — the code, the
   URL, three download buttons — lives here, where it is read once by somebody
   who came looking for it, rather than nineteen times by everybody else. */
function TableSheet({
  table,
  canWrite,
  onClose,
  onChanged,
  onRemove,
  onPrint,
  onPdf,
}: {
  table: Table;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onRemove: () => void;
  onPrint: () => void;
  onPdf: () => void;
}) {
  const [label, setLabel] = useState(table.label);
  const [seats, setSeats] = useState(String(table.seats));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  // Bumped after a rename so the <img> refetches. Without it the browser serves
  // the QR it already has, and the card would still show the old name in the
  // middle — "after created also we need to allow them to edit all, REGENERATED
  // qr". The server sends no-cache, but a cache-buster is what makes it certain.
  const [stamp, setStamp] = useState(0);

  const dirty = label.trim() !== table.label || String(table.seats) !== seats;

  async function save() {
    if (!label.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await api.patch(`/ordering/tables/${table.id}`, {
        label: label.trim(),
        seats: Math.max(1, parseInt(seats, 10) || table.seats),
        sort_order: table.sort_order,
        is_active: table.is_active,
      });
      setStamp((n) => n + 1);
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save that.");
    } finally {
      setSaving(false);
    }
  }

  async function release() {
    setReleasing(true);
    try {
      await api.post(`/ordering/tables/${table.id}/release`, {});
      await onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not clear that table.");
    } finally {
      setReleasing(false);
    }
  }

  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/t/${table.code}`;

  return (
    <SheetPopup
      onClose={onClose}
      title={table.label}
      subtitle={`${table.seats} seats · code ${table.code}`}
      columns={3}
    >
      <div className="grid gap-3.5 lg:grid-cols-[1fr_1.1fr]">
        {/* ── the card itself ── */}
        <section className="mise-card-inset rounded-2xl p-3.5">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
            The card on this table
          </p>
          {/* White behind the QR ALWAYS — a dark-themed QR on a dark card is a
              QR no camera will read, and this is the one element whose entire
              job is to be scanned. */}
          <div className="grid place-items-center rounded-2xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${API_BASE}/api/public/table/${table.code}/qr.svg?v=${stamp}`}
              alt={`QR code for ${table.label}`}
              className="h-52 w-52"
            />
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-soft">
            The name in the middle is this table&apos;s — rename it below and the code
            redraws itself.
          </p>

          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            <a
              href={`${API_BASE}/api/public/table/${table.code}/qr.png`}
              download={`${table.label}.png`}
              className="mise-btn-flat mise-press min-h-[38px] px-3 py-2 text-xs font-semibold text-fg-soft"
            >
              ⬇ PNG
            </a>
            <button
              type="button"
              onClick={onPdf}
              className="mise-btn-flat mise-press min-h-[38px] px-3 text-xs font-semibold text-fg-soft"
            >
              ⬇ PDF
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="mise-btn-flat mise-press min-h-[38px] px-3 text-xs font-semibold text-fg-soft"
            >
              🖨 Print
            </button>
          </div>
          <p className="mt-2 break-all text-center font-mono text-[10px] text-fg-faint">{url}</p>
        </section>

        <div className="space-y-3.5">
          {/* ── what is happening at it ── */}
          <section className="mise-card-inset rounded-2xl p-3.5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
              Right now
            </p>
            {table.open_orders > 0 ? (
              <>
                <p className="text-sm font-semibold text-fg">
                  {table.open_orders} {table.open_orders === 1 ? "order" : "orders"} open ·
                  seated {sinceText(table.seated_since)}
                </p>
                {table.needs_help && (
                  <p className="mt-1.5 text-sm font-semibold text-danger">
                    ✋ They have asked for someone.
                  </p>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => void release()}
                    disabled={releasing}
                    className="mise-btn-flat mise-press mt-2.5 min-h-[42px] w-full px-4 text-sm font-semibold text-fg-soft disabled:opacity-40"
                  >
                    {releasing ? "Clearing…" : "Clear the table for the next party"}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-fg-soft">
                Free — nobody is ordering from this table.
              </p>
            )}
          </section>

          {/* ── rename ── */}
          {canWrite && (
            <section className="mise-card-inset rounded-2xl p-3.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Name and seats
              </p>
              <div className="grid gap-2.5 sm:grid-cols-[1fr_6rem]">
                <label className="block">
                  <span className="text-[11px] text-fg-soft">Called</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    data-testid="table-rename"
                    className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-fg-soft">Seats</span>
                  <input
                    inputMode="numeric"
                    value={seats}
                    onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))}
                    className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-center text-sm outline-none"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                The printed card keeps working. Its code never changes — only the name
                shown in the middle of it, so you can rename a table without walking round
                collecting cards.
              </p>
              {err && (
                <p className="mt-2 text-xs font-semibold text-rose-300">{err}</p>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !dirty || !label.trim()}
                data-tone="brand"
                data-testid="table-save"
                className="mise-btn-flat mise-press mt-2.5 min-h-[44px] w-full px-4 text-sm disabled:opacity-40"
              >
                {saving ? "Saving…" : dirty ? "Save and redraw the code" : "Saved"}
              </button>
            </section>
          )}

          {canWrite && (
            <button
              type="button"
              onClick={onRemove}
              data-tone="danger"
              className="mise-btn-flat mise-press min-h-[42px] w-full px-4 text-sm"
            >
              Remove this table
            </button>
          )}
        </div>
      </div>
    </SheetPopup>
  );
}

/* ── Adding tables ──────────────────────────────────────────────────────────
   "when creating several tables, if user wish to add different name for each
    table means we need to allow nah."

   Right, and it is not a nicety. A restaurant is not "Table 1..10" — it is a
   terrace, a window bay, two booths and a counter, and a numbering scheme that
   ignores that makes the staff translate every order in their head. So the
   batch form grows a "name them myself" mode: N boxes, pre-filled with what the
   numbering would have produced, each editable. Leave one alone and it keeps
   its number; that way naming three of ten costs three keystrokes rather than
   ten. */
function AddTablesSheet({
  existing,
  onClose,
  onAdded,
}: {
  existing: number;
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const [count, setCount] = useState("10");
  const [prefix, setPrefix] = useState("Table");
  const [seats, setSeats] = useState("4");
  const [named, setNamed] = useState(false);
  const [labels, setLabels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const n = Math.min(200, Math.max(0, parseInt(count, 10) || 0));

  // Keep the name boxes in step with the count, without throwing away anything
  // already typed into them.
  useEffect(() => {
    setLabels((cur) => {
      const next = [...cur];
      while (next.length < n) next.push(`${prefix.trim() || "Table"} ${existing + next.length + 1}`);
      next.length = n;
      return next;
    });
  }, [n, prefix, existing]);

  async function create() {
    if (n < 1) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/ordering/tables/bulk", {
        count: n,
        prefix: prefix.trim() || "Table",
        seats: Math.max(1, parseInt(seats, 10) || 4),
        labels: named ? labels.map((s) => s.trim()).filter(Boolean) : null,
      });
      await onAdded();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add those tables.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      onClose={onClose}
      title="Add tables"
      subtitle="Each one gets its own QR card"
      columns={2}
      footer={
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy || n < 1}
          data-tone="brand"
          data-testid="tables-create"
          className="mise-btn-flat mise-press min-h-[46px] w-full px-4 text-sm disabled:opacity-40"
        >
          {busy ? "Creating…" : n === 1 ? "Create 1 table" : `Create ${n} tables`}
        </button>
      }
    >
      <div className="space-y-3.5">
        <section className="mise-card-inset rounded-2xl p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <label className="block">
              <span className="text-[11px] text-fg-soft">How many</span>
              <input
                inputMode="numeric"
                value={count}
                onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
                data-testid="tables-count"
                className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-center text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-fg-soft">Called</span>
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-fg-soft">Seats each</span>
              <input
                inputMode="numeric"
                value={seats}
                onChange={(e) => setSeats(e.target.value.replace(/\D/g, ""))}
                className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-center text-sm outline-none"
              />
            </label>
          </div>
        </section>

        <label className="mise-card-inset flex cursor-pointer items-start gap-2.5 rounded-2xl p-3.5">
          <input
            type="checkbox"
            checked={named}
            onChange={(e) => setNamed(e.target.checked)}
            data-testid="tables-name-each"
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
          />
          <span>
            <span className="block text-sm font-semibold text-fg">Name each one myself</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-soft">
              For a room that is a terrace and a window bay rather than Table 1 to 10.
              Anything you leave alone keeps its number.
            </span>
          </span>
        </label>

        {named && n > 0 && (
          <section className="mise-card-inset rounded-2xl p-3.5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
              What to call them
            </p>
            <div className="mise-noscrollbar grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">
              {labels.map((l, i) => (
                <input
                  key={i}
                  value={l}
                  onChange={(e) =>
                    setLabels((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  aria-label={`Name of table ${i + 1}`}
                  className="mise-well min-h-[40px] w-full rounded-lg px-2.5 text-sm outline-none"
                />
              ))}
            </div>
          </section>
        )}

        {err && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300">
            {err}
          </p>
        )}
      </div>
    </SheetPopup>
  );
}
