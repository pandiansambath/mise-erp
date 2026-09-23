"use client";

// Emptying the restaurant.
//
//     "i need delete all datas feature...like it wont delete the owner login
//      alone...other thatn this..it will delete litrelly all the datas...makr
//      it like dangerous.... (but even if they accidnlty deleted by clickng if
//      they need there datas back we need a feature in control center to
//      revert back they datas to old"
//
// DANGEROUS, AND SAYING SO IS NOT THE SAME AS BEING SAFE. A red button and a
// confirm dialog are decoration; what makes this allowable is that a snapshot
// is taken first and the server REFUSES to delete anything if it could not
// take one. So this screen tells the truth about that — it does not promise
// "you can undo this", it says DineAI can put it back, which is what is
// actually true.
//
// THREE DELIBERATE ACTS, and none of them is a click you can make by accident:
// open the panel, type the restaurant's own name, type your password. The
// name has to be read off the screen, so it cannot be muscle memory.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

export function DangerZone({ hotelName }: { hotelName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ total: number; note: string } | null>(null);

  const matches = name.trim().toLowerCase() === (hotelName || "").trim().toLowerCase();

  async function wipe() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ total: number; note: string }>("/hotels/wipe", {
        password,
        confirm_name: name,
      });
      setDone({ total: r.total, note: r.note });
      setOpen(false);
      setName("");
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nothing was deleted.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mise-feel mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-5">
        <h3 className="font-semibold text-fg">Your restaurant is empty</h3>
        <p className="mt-1 text-sm text-fg-soft">
          {done.total.toLocaleString()} records were removed. {done.note}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mise-press mt-3 rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft"
        >
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="mise-feel mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">
          ⚠️
        </span>
        <h3 className="font-semibold text-fg">Delete all my data</h3>
        <span className="text-xs text-rose-300">the most destructive thing here</span>
      </div>

      <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-soft">
        {/* `{expr} —` on one line loses its space: JSX strips the leading
            whitespace of a text node that spans lines, so it rendered
            "NIRAI— every supplier". An explicit {" "} survives that. */}
        This removes <b className="text-fg">everything</b> in {hotelName || "this restaurant"}
        {" "}— every supplier, stock item, recipe, sale, expense, payslip, order and document.
        Your login and everybody else&apos;s stays, so you will still be signed in,
        looking at an empty restaurant.
      </p>

      {/* The honest version of "this can be undone". It cannot be undone BY
          HIM — which is exactly what somebody about to press it needs to know. */}
      <p className="mt-2 max-w-prose rounded-xl border border-line bg-paper-2/60 px-3 py-2 text-xs leading-relaxed text-fg-soft">
        <b className="text-fg">A copy is saved first.</b> If nothing can be saved, nothing
        is deleted. If you do this by mistake, DineAI support can put it back exactly as
        it was — but you cannot do that yourself from here.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setError(null);
          }}
          className="mise-press mt-4 rounded-xl border border-rose-500/40 px-4 py-2.5 text-sm font-medium text-rose-300"
        >
          Delete all my data…
        </button>
      ) : (
        <div className="mise-pop mt-4 max-w-sm space-y-3 rounded-xl border border-rose-500/30 bg-paper-2/60 p-4">
          <div>
            <label className="block text-xs font-medium text-fg-soft">
              Type <b className="text-fg">{hotelName}</b> to confirm
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              placeholder={hotelName}
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-soft">Your password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="to confirm it is you"
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={wipe}
              disabled={busy || !matches || !password}
              className="mise-press flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete everything"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setName("");
                setPassword("");
                setError(null);
              }}
              className="rounded-xl px-4 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
