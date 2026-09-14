"use client";

// /control-room/operators — who can open this Control Room. Fixes the named
// defect: a 403 here used to render an empty list; it now renders an error.
// Also the one home for SupportWindowPicker (viewAs.ts reads the same
// localStorage key from every hotel tab).

import { Fragment, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { useConfirm } from "@/components/confirm";
import { SupportWindowPicker } from "@/components/DeletedHotels";
import { Card, PageHeader, Spinner } from "@/components/ui";

type Op = { id: string; email: string; is_active: boolean; last_login: string | null; you: boolean };

function ErrorCard({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">
        {error.status || "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">This did not load</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

export default function OperatorsPage() {
  const opsQ = useOperatorQuery<{ operators: Op[] }>("/platform/operators");
  const confirm = useConfirm();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [pwFor, setPwFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAddBusy(true);
    setAddErr(null);
    setAddMsg(null);
    try {
      await api.post("/platform/operators", { email, password });
      setEmail("");
      setPassword("");
      setAddMsg(`Operator created — ${email || "they"} sign in on the normal login page.`);
      opsQ.reload();
    } catch (err) {
      setAddErr(err instanceof ApiError ? err.message : "Could not create the operator.");
    } finally {
      setAddBusy(false);
    }
  }

  async function setActive(op: Op, active: boolean) {
    if (!active) {
      const ok = await confirm({
        title: `Disable ${op.email}?`,
        message: "They lose access to this Control Room immediately. You can re-enable them any time.",
        confirmText: "Disable",
        tone: "danger",
      });
      if (!ok) return;
    }
    setRowBusy(op.id);
    setRowErr(null);
    try {
      await api.patch(`/platform/operators/${op.id}`, { active });
      opsQ.reload();
    } catch (err) {
      setRowErr(err instanceof ApiError ? err.message : "Could not update that operator.");
    } finally {
      setRowBusy(null);
    }
  }

  async function savePassword(op: Op) {
    if (newPw.length < 8) return;
    setRowBusy(op.id);
    setRowErr(null);
    try {
      await api.patch(`/platform/operators/${op.id}`, { password: newPw });
      setPwFor(null);
      setNewPw("");
    } catch (err) {
      setRowErr(err instanceof ApiError ? err.message : "Could not update the password.");
    } finally {
      setRowBusy(null);
    }
  }

  const ops = opsQ.data?.operators ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operators"
        subtitle="Who can open this Control Room — add a colleague, cut access instantly, all audited."
        actions={<SupportWindowPicker />}
      />

      <Card>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
          Add an operator
        </h3>
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block min-w-[14rem] flex-1">
            <span className="text-xs font-medium text-fg-faint">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
            />
          </label>
          <label className="block min-w-[12rem] flex-1">
            <span className="text-xs font-medium text-fg-faint">Password (min 8)</span>
            <span className="relative mt-1 block">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPw ? "text" : "password"}
                minLength={8}
                required
                className="mise-well w-full rounded-lg py-2 pl-3 pr-10 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="mise-press absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md px-2 py-0.5 text-xs font-medium text-fg-faint hover:text-fg"
              >
                {showPw ? "hide" : "show"}
              </button>
            </span>
          </label>
          <button
            type="submit"
            disabled={addBusy}
            data-tone="brand"
            className="mise-btn-flat mise-press px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {addBusy ? "Creating…" : "Add operator"}
          </button>
        </form>
        {addErr && <p className="mt-2 text-xs font-medium text-danger">{addErr}</p>}
        {addMsg && <p className="mt-2 text-xs font-medium text-brand-300">{addMsg}</p>}
      </Card>

      <Card className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            Operator accounts
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-fg-faint">{ops.length}</span>
        </div>

        {rowErr && <p className="px-4 pt-2 text-xs font-medium text-danger">{rowErr}</p>}

        <div className="mt-3">
          {opsQ.error ? (
            <div className="p-4">
              <ErrorCard error={opsQ.error} onRetry={opsQ.reload} />
            </div>
          ) : opsQ.loading ? (
            <Spinner />
          ) : ops.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
              <p className="font-display text-lg font-semibold text-fg">No operator accounts</p>
              <p className="mt-1.5 max-w-sm text-sm text-fg-faint">Add the first one above.</p>
            </div>
          ) : (
            <div className="overflow-x-auto pb-1">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2.5">Operator</th>
                    <th className="px-3 py-2.5">Last signed in</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {ops.map((op) => (
                    <Fragment key={op.id}>
                      <tr className="border-b border-line/60 transition hover:bg-glass/[0.04]">
                        <td data-label="Operator" className="px-4 py-2.5">
                          <span className="text-sm text-fg">{op.email}</span>
                          {op.you && (
                            <span className="mise-chip ml-2" data-tone="slate">
                              you
                            </span>
                          )}
                        </td>
                        <td data-label="Last signed in" className="px-3 py-2.5 text-xs text-fg-soft">
                          {op.last_login ? new Date(op.last_login).toLocaleDateString() : "never signed in"}
                        </td>
                        <td data-label="Status" className="px-3 py-2.5">
                          <span className="mise-chip" data-tone={op.is_active ? "green" : "red"}>
                            {op.is_active ? "active" : "disabled"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPwFor((cur) => (cur === op.id ? null : op.id));
                                setNewPw("");
                              }}
                              className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium"
                            >
                              Reset password
                            </button>
                            {!op.you && (
                              <button
                                type="button"
                                disabled={rowBusy === op.id}
                                onClick={() => setActive(op, !op.is_active)}
                                data-tone={op.is_active ? "danger" : undefined}
                                className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                              >
                                {op.is_active ? "Disable" : "Re-enable"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {pwFor === op.id && (
                        <tr className="border-b border-line/60 bg-glass/[0.03]">
                          <td colSpan={4} className="px-4 py-3">
                            <div className="mise-well flex flex-wrap items-center gap-2 rounded-xl p-2.5">
                              <input
                                value={newPw}
                                onChange={(e) => setNewPw(e.target.value)}
                                type="text"
                                placeholder="new password (min 8)"
                                className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1.5 text-xs outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => savePassword(op)}
                                disabled={rowBusy === op.id || newPw.length < 8}
                                data-tone="brand"
                                className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
