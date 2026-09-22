"use client";

/** Hand this restaurant to somebody else, or give them a copy of it.
 *
 *     "1.move one hotel from one email to other email 2. COPY one hotel
 *      datas(litrelly eevrything) from one email to othere new email ... for
 *      migration both side need to accept"
 *
 *  THE DANGEROUS ONE IS MOVE, AND THE SCREEN SAYS SO IN WORDS RATHER THAN IN
 *  RED. A colour is a decoration somebody learns to ignore; "you will lose
 *  access to this restaurant" is a sentence they have to read. There is no
 *  type-the-name-to-confirm here either, because nothing happens on this
 *  screen — the request only sends an email. The real confirmation is the
 *  other person accepting, which is the point of the whole feature.
 *
 *  ONE OUTSTANDING REQUEST AT A TIME, enforced by a partial unique index in
 *  the database as well as here: two live transfers on one restaurant is a
 *  race with somebody's whole business as the stake.
 */

import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";

type Group = { key: string; label: string; rows: number; optional: boolean };

type Transfer = {
  id: string;
  hotel_name: string;
  kind: "move" | "copy";
  to_email: string;
  state: string;
  from_email: string;
  created_at: string;
  expires_at: string;
  settled_at: string | null;
  note: string | null;
};

const WHEN = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function TransferHotel() {
  const [open, setOpen] = useState<Transfer | null>(null);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<"copy" | "move">("copy");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  /** WHAT WOULD ACTUALLY GO. "everything" is not a preview — it is a promise
   *  nobody can check, and this is the least reversible thing the product
   *  does. */
  const [manifest, setManifest] = useState<{ groups: Group[]; total_rows: number } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ open: Transfer | null; history: Transfer[] }>(
        "/hotels/transfer",
      );
      setOpen(r.open);
      setHistory(r.history.filter((h) => h.settled_at));
    } catch {
      setOpen(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    api
      .get<{ groups: Group[]; total_rows: number }>("/hotels/transfer/preview")
      .then(setManifest)
      .catch(() => setManifest(null));
  }, [load]);

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post("/hotels/transfer", {
        to_email: email.trim(),
        kind,
        skip: [...skip],
      });
      setSent(true);
      setEmail("");
      await load();
    } catch (e) {
      // The server's sentence, verbatim. It knows why — the address is taken,
      // there is already a request, they are not the owner — and inventing a
      // friendlier one here would lose the reason.
      setErr(e instanceof ApiError ? e.message : "Could not send that.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setBusy(true);
    try {
      await api.delete(`/hotels/transfer/${id}`);
      await load();
    } catch {
      /* it may have just been accepted — reloading tells the truth */
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (loading) return null;

  return (
    <section className="mise-card-inset rounded-2xl p-4">
      <h3 className="font-display text-lg font-bold text-fg">Move or copy this restaurant</h3>
      <p className="mt-1 max-w-[60ch] text-[0.8125rem] leading-relaxed text-fg-soft">
        Hand it to another owner, or give somebody a working copy to start from.
        They have to accept before anything happens, and nothing moves until
        they do.
      </p>

      {open ? (
        <div className="mise-spine mise-spine-warn mt-3 rounded-xl border border-line px-4 py-3">
          <p className="text-sm font-medium text-fg">
            Waiting on {open.to_email}
          </p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-soft">
            You asked to {open.kind === "move" ? "hand over" : "send a copy of"}{" "}
            {open.hotel_name} on {WHEN(open.created_at)}. The invitation expires{" "}
            {WHEN(open.expires_at)}. Nothing has moved.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void cancel(open.id)}
            className="mise-press mise-card-inset mt-2.5 rounded-xl px-3 py-2 text-[0.8125rem] font-medium text-fg-soft disabled:opacity-50"
          >
            Cancel this request
          </button>
        </div>
      ) : sent ? (
        <div className="mise-spine mise-spine-good mt-3 rounded-xl border border-line px-4 py-3">
          <p className="text-sm font-medium text-fg">Invitation sent.</p>
          <p className="mt-0.5 text-[0.8125rem] text-fg-soft">
            They have seven days to accept. Nothing changes here until they do.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {/* TWO CHOICES, EACH EXPLAINED BY WHAT IT COSTS. "Move" and "Copy"
              are almost the same word and opposite outcomes. */}
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  k: "copy" as const,
                  title: "Send a copy",
                  body: "They get their own restaurant with the same suppliers, stock, menu and team. Yours is untouched.",
                },
                {
                  k: "move" as const,
                  title: "Hand it over",
                  body: "They become the owner of THIS restaurant. You lose access to it.",
                },
              ]
            ).map((o) => (
              <button
                key={o.k}
                type="button"
                onClick={() => setKind(o.k)}
                aria-pressed={kind === o.k}
                className={`mise-press rounded-xl border p-3 text-left transition ${
                  kind === o.k ? "border-brand-500 bg-glass/[0.04]" : "border-line"
                }`}
              >
                <span className="block text-sm font-semibold text-fg">{o.title}</span>
                <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-soft">
                  {o.body}
                </span>
              </button>
            ))}
          </div>

          {/* THE MANIFEST. Grouped the way a restaurant thinks, not the way
              the database does — nobody agreeing to hand over their business
              wants to read `vendor_item_aliases`. Counted from the same plan
              the copy walks, so it cannot promise less than it delivers. */}
          {manifest && manifest.groups.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <p className="text-[0.75rem] font-semibold uppercase tracking-wide text-fg-faint">
                What goes with it
              </p>
              <ul className="mt-2 space-y-0.5">
                {manifest.groups.map((g) => {
                  const off = skip.has(g.key);
                  return (
                    <li key={g.key} className="flex items-center justify-between gap-3 py-1">
                      <span className={`min-w-0 truncate text-[0.8125rem] ${off ? "text-fg-faint line-through" : "text-fg-soft"}`}>
                        {g.label}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={`font-mono text-[0.75rem] tabular-nums ${off ? "text-fg-faint" : "text-fg-soft"}`}>
                          {g.rows.toLocaleString()}
                        </span>
                        {g.optional ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSkip((s) => {
                                const n = new Set(s);
                                if (n.has(g.key)) n.delete(g.key);
                                else n.add(g.key);
                                return n;
                              })
                            }
                            className="mise-press min-w-[4.5rem] rounded-lg px-2 py-1 text-[0.6875rem] font-semibold text-brand-500"
                          >
                            {off ? "include" : "leave out"}
                          </button>
                        ) : (
                          // Not optional, and it says why rather than being a
                          // greyed-out control nobody can interrogate.
                          <span className="min-w-[4.5rem] text-right text-[0.6875rem] text-fg-faint">
                            always
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[0.6875rem] text-fg-faint">
                {skip.size > 0
                  ? `${manifest.groups.filter((g) => !skip.has(g.key)).reduce((n, g) => n + g.rows, 0).toLocaleString()} of ${manifest.total_rows.toLocaleString()} records will go.`
                  : `${manifest.total_rows.toLocaleString()} records in total.`}
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="their email address"
              className="mise-well min-h-[2.75rem] min-w-0 flex-1 rounded-xl px-3 text-sm text-fg outline-none placeholder:text-fg-faint"
            />
            <button
              type="button"
              disabled={busy || !email.trim()}
              onClick={() => void send()}
              className="mise-press min-h-[2.75rem] rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send the invitation"}
            </button>
          </div>

          {err && <p className="text-[0.8125rem] leading-relaxed text-danger">{err}</p>}

          <p className="text-[0.75rem] leading-relaxed text-fg-faint">
            The address must not already have a DineAI account — they will
            choose their own password when they accept.
            {kind === "move" && (
              <>
                {" "}
                <b className="text-fg-soft">
                  Once they accept, this restaurant is theirs and your login here
                  stops working.
                </b>
              </>
            )}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[0.75rem] font-semibold uppercase tracking-wide text-fg-faint">
            Past transfers ({history.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {history.slice(0, 8).map((h) => (
              <li key={h.id} className="text-[0.75rem] text-fg-faint">
                {WHEN(h.created_at)} · {h.kind} to {h.to_email} — {h.state}
                {h.note ? ` (${h.note})` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
