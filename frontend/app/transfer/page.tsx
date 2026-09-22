"use client";

/** Somebody has offered you a restaurant.
 *
 *     "for migration both side need to accept (have this accpet featreu in
 *      setting email etcetc in new email)"
 *
 *  PUBLIC, AND IT HAS TO BE. On a copy the receiver has no account yet —
 *  that is the point — and on a move the restaurant is not theirs until they
 *  say yes. So this page authorises on the emailed token alone, exactly as
 *  the verify-email page does.
 *
 *  IT SHOWS DELIBERATELY LITTLE. The transfer row carries the sender's
 *  address, and a link like this can be forwarded; showing a stranger
 *  somebody's email leaks it for no benefit. What they need is what is on
 *  offer, from which restaurant, and by when.
 *
 *  AND THE DIFFERENCE BETWEEN THE TWO IS SPELLED OUT, because "move" and
 *  "copy" are almost the same word and opposite outcomes — and the person
 *  reading this did not choose which one it is.
 */

import { useCallback, useEffect, useState } from "react";

import { Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

type Offer = {
  id: string;
  hotel_name: string;
  kind: "move" | "copy";
  to_email: string;
  expires_at: string;
};

export default function TransferPage() {
  const [token, setToken] = useState<string | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    if (!t) {
      setGone("That link is missing its code. Open the one from the email.");
      setLoading(false);
      return;
    }
    api
      .get<Offer>(`/transfer/${t}`)
      .then(setOffer)
      .catch((e) =>
        setGone(
          e instanceof ApiError
            ? e.message
            : "That invitation is not valid any more.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const accept = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post("/transfer/accept", { token, password, name: name.trim() });
      setDone(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }, [token, password, name]);

  const decline = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api.post("/transfer/decline", { token });
      setGone("Declined. Nothing was transferred and they have been told.");
      setOffer(null);
    } catch {
      setGone("That invitation is not valid any more.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center px-4 py-10">
      {loading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {!loading && gone && (
        <div className="mise-card-inset rounded-2xl p-6 text-center">
          <p className="font-display text-xl font-bold text-fg">Nothing to do here</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-soft">{gone}</p>
          <a
            href="/login"
            className="mise-press mise-card-inset mt-4 inline-block rounded-xl px-4 py-2.5 text-sm font-medium text-fg-soft"
          >
            Go to sign in
          </a>
        </div>
      )}

      {!loading && done && (
        <div className="mise-card-inset rounded-2xl p-6 text-center">
          <p className="font-display text-xl font-bold text-fg">It&apos;s yours.</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-soft">
            Sign in with <b className="text-fg">{offer?.to_email}</b> and the
            password you just chose.
          </p>
          {/* NO AUTOMATIC SIGN-IN. They have just chosen a password; using it
              once is the step that proves they know it, and it costs one
              screen. */}
          <a
            href="/login"
            className="mise-press mt-4 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white"
          >
            Sign in
          </a>
        </div>
      )}

      {!loading && offer && !done && (
        <div className="mise-card-inset rounded-2xl p-6">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg-faint">
            An invitation to {offer.to_email}
          </p>
          <h1 className="mt-1.5 font-display text-2xl font-bold text-fg">
            {offer.kind === "move"
              ? `You are being given ${offer.hotel_name}`
              : `You are being sent a copy of ${offer.hotel_name}`}
          </h1>

          {/* WHAT IT ACTUALLY MEANS. They did not choose which kind this is,
              and the two words are nearly identical with opposite outcomes. */}
          <p className="mt-2 max-w-[54ch] text-sm leading-relaxed text-fg-soft">
            {offer.kind === "move" ? (
              <>
                You become the owner of that restaurant — its suppliers, stock,
                menu, team and history come with it, and the person who sent
                this loses access.
              </>
            ) : (
              <>
                You get your own restaurant set up with the same suppliers,
                stock and menu to start from. Theirs is untouched, and the two
                are separate from the moment you accept — nothing you do shows
                up on theirs.
              </>
            )}
          </p>

          <div className="mt-4 space-y-2.5">
            {offer.kind === "copy" && (
              <label className="block">
                <span className="mb-1 block text-[0.75rem] font-medium text-fg-soft">
                  What should yours be called?
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${offer.hotel_name} (copy)`}
                  className="mise-well min-h-[2.75rem] w-full rounded-xl px-3 text-sm text-fg outline-none placeholder:text-fg-faint"
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[0.75rem] font-medium text-fg-soft">
                Choose a password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="at least 8 characters"
                className="mise-well min-h-[2.75rem] w-full rounded-xl px-3 text-sm text-fg outline-none placeholder:text-fg-faint"
              />
              <span className="mt-1 block text-[0.6875rem] text-fg-faint">
                Yours, not theirs — they never see it and cannot sign in as you.
              </span>
            </label>
          </div>

          {err && (
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-danger">{err}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || password.length < 8}
              onClick={() => void accept()}
              className="mise-press rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Setting it up…" : offer.kind === "move" ? "Accept it" : "Make my copy"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decline()}
              className="mise-press rounded-xl px-3 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              No thanks
            </button>
          </div>

          <p className="mt-3 text-[0.6875rem] leading-relaxed text-fg-faint">
            This expires on{" "}
            {new Date(offer.expires_at).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
            })}
            . If you were not expecting it, ignore it — nothing happens on its own.
          </p>
        </div>
      )}
    </main>
  );
}
