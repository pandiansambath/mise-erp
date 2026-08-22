"use client";

// 👤 ADDING PEOPLE — one at a time, a hundred at once, or just say it.
//
//   "while adding new login, make this a POPUP instead of in-place. In-place is
//    making the UI stretch and that place clumsy."
//   "suppose hotel has 100 workers, owner can't add 100 one by one."
//   "think about the alignment and placement of these feature buttons without
//    making the current clumsy — think deeply where we can add."
//
// That last line decided the shape. The toolbar already carries By job, By
// person, a search and Add a login; four controls is the point where a page
// starts reading as a cockpit. So the new ways in do NOT become three more
// buttons on the board — they are three routes inside this one popup, and only
// one is ever on screen.
//
// All three end in the same place: a table of exactly what is about to be
// created, checked, then one click. Nobody should make a hundred logins blind.
import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useConfirm } from "@/components/confirm";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, ROLES } from "@/lib/permissions";

export type Row = {
  email: string;
  password: string;
  /** A standard job key, or `role:<id>` for one of the hotel's own. */
  role: string;
  name?: string;
  /** Why this row cannot be created, if it cannot. */
  problem?: string;
};

type Mode = "one" | "file" | "ai";

const TEMPLATE_HEADERS = ["name", "email", "password", "role"];

/** The columns, filled in, so the file they download already makes sense. */
function templateCsv(roleNames: string[]): string {
  const example = [
    ["Priya Kumar", "priya@yourhotel.com", "atleast8chars", "Staff"],
    ["Arun Raj", "arun@yourhotel.com", "atleast8chars", "Kitchen Manager"],
    ["Meena S", "meena@yourhotel.com", "atleast8chars", roleNames[0] ?? "Manager"],
  ];
  return [TEMPLATE_HEADERS.join(","), ...example.map((r) => r.join(","))].join("\n");
}

export function AddLoginModal({
  open,
  onClose,
  onDone,
  roles,
  employees,
  isSuperAdmin,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  roles: { id: string; name: string; base_role: string }[];
  employees: { id: string; full_name: string }[];
  isSuperAdmin: boolean;
}) {
  const confirm = useConfirm();
  const [mode, setMode] = useState<Mode>("one");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // one at a time
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("STAFF");
  const [linkEmpId, setLinkEmpId] = useState("");

  // many at once — both routes land here
  const [rows, setRows] = useState<Row[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const choices = useMemo(
    () => [
      ...roles.map((r) => ({ value: `role:${r.id}`, label: `${r.name} (yours)` })),
      ...ROLES.filter((r) => r !== "SUPER_ADMIN" || isSuperAdmin).map((r) => ({
        value: r,
        label: ROLE_LABELS[r],
      })),
    ],
    [roles, isSuperAdmin],
  );

  /** Turn whatever the row calls a job into something the API accepts. */
  function resolveRole(text: string): string | null {
    const t = (text || "").trim().toLowerCase();
    if (!t) return "STAFF";
    const own = roles.find((r) => r.name.toLowerCase() === t);
    if (own) return `role:${own.id}`;
    const std = ROLES.find(
      (r) => r.toLowerCase() === t || ROLE_LABELS[r].toLowerCase().startsWith(t),
    );
    return std ?? null;
  }

  function reset() {
    setRows([]);
    setNote(null);
    setErr(null);
    setPrompt("");
  }

  // ── the file route ───────────────────────────────────────────────────────
  function downloadTemplate(kind: "csv" | "xlsx") {
    const csv = templateCsv(roles.map((r) => r.name));
    // XLSX from the browser would mean shipping a library for something Excel
    // opens perfectly well as CSV. Said plainly rather than pretending.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = kind === "csv" ? "dineai-logins.csv" : "dineai-logins-for-excel.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function readFile(f: File) {
    setBusy(true);
    setErr(null);
    try {
      const text = await f.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) throw new Error("That file is empty.");
      const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idx = (k: string) => head.indexOf(k);
      const from = head.includes("email") ? 1 : 0;
      const parsed: Row[] = lines.slice(from).map((line) => {
        const c = line.split(",").map((x) => x.trim());
        const pick = (k: string, fallback: number) =>
          idx(k) >= 0 ? (c[idx(k)] ?? "") : (c[fallback] ?? "");
        const em = pick("email", 1);
        const pw = pick("password", 2);
        const rl = pick("role", 3);
        const resolved = resolveRole(rl);
        return {
          name: pick("name", 0),
          email: em,
          password: pw,
          role: resolved ?? "STAFF",
          problem: !em.includes("@")
            ? "That does not look like an email address"
            : pw.length < 8
              ? "Password needs at least 8 characters"
              : resolved === null
                ? `No job or role called "${rl}"`
                : undefined,
        };
      });
      setRows(parsed);
      setNote(`Read ${parsed.length} ${parsed.length === 1 ? "row" : "rows"} from ${f.name}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  // ── the AI route ─────────────────────────────────────────────────────────
  async function askAi() {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await api.post<{ rows: Row[]; note?: string; question?: string }>(
        "/auth/users/draft-from-text",
        { text: prompt.trim(), roles: roles.map((r) => r.name) },
      );
      const parsed = (out.rows ?? []).map((r) => {
        const resolved = resolveRole(r.role);
        return {
          ...r,
          role: resolved ?? "STAFF",
          problem: !r.email?.includes("@")
            ? "No email for this person — add one below"
            : (r.password ?? "").length < 8
              ? "Password needs at least 8 characters"
              : undefined,
        };
      });
      setRows(parsed);
      setNote(out.question ?? out.note ?? `Read ${parsed.length} people from what you wrote.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "The assistant could not read that.");
    } finally {
      setBusy(false);
    }
  }

  // ── creating, for real ───────────────────────────────────────────────────
  const good = rows.filter((r) => !r.problem);

  async function createAll() {
    const ok = await confirm({
      title: `Create ${good.length} ${good.length === 1 ? "login" : "logins"}?`,
      message:
        `${good.length} ${good.length === 1 ? "person" : "people"} will be able to sign in ` +
        `straight away with the passwords shown.` +
        (rows.length - good.length
          ? `\n\n${rows.length - good.length} rows have a problem and will be skipped.`
          : ""),
      confirmText: "Create them",
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    let made = 0;
    try {
      for (const r of good) {
        const ownRole = r.role.startsWith("role:") ? r.role.slice(5) : null;
        const base = ownRole
          ? (roles.find((x) => x.id === ownRole)?.base_role ?? "STAFF")
          : r.role;
        const created = await api.post<{ id: string }>("/auth/users", {
          email: r.email,
          password: r.password,
          role: base,
        });
        if (ownRole) {
          await api.put(`/roles/user/${created.id}/role`, { role_id: ownRole });
        }
        made += 1;
      }
      onDone();
      onClose();
      reset();
    } catch (e) {
      setErr(
        `${made} created, then it stopped: ` +
          (e instanceof ApiError ? e.message : "something went wrong"),
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function createOne(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const ownRole = role.startsWith("role:") ? role.slice(5) : null;
      const base = ownRole ? (roles.find((r) => r.id === ownRole)?.base_role ?? "STAFF") : role;
      let id: string | null = null;
      if (linkEmpId) {
        await api.post(`/employees/${linkEmpId}/account`, { email, password, role: base });
      } else {
        id = (await api.post<{ id: string }>("/auth/users", { email, password, role: base })).id;
      }
      if (ownRole) {
        if (!id) {
          const all = await api.get<{ id: string; email: string }[]>("/auth/users");
          id = all.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())?.id ?? null;
        }
        if (id) await api.put(`/roles/user/${id}/role`, { role_id: ownRole });
      }
      setEmail("");
      setPassword("");
      setRole("STAFF");
      setLinkEmpId("");
      onDone();
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Could not add that login.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const TABS: { k: Mode; icon: string; label: string; hint: string }[] = [
    { k: "one", icon: "👤", label: "One person", hint: "name, email, what they do" },
    { k: "file", icon: "📄", label: "From a file", hint: "a spreadsheet of everybody" },
    { k: "ai", icon: "✨", label: "Just tell DineAI", hint: "type it however you like" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="mise-fade-in absolute inset-0 bg-black/60 backdrop-blur-[3px]" onClick={onClose} />
      <div className="mise-pop-lg relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-paper shadow-2xl shadow-black/60 sm:max-w-4xl sm:rounded-3xl">
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" />

        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-gradient-to-r from-brand-500/10 via-transparent to-transparent px-5 py-3.5">
          <span aria-hidden className="mise-neo-raised grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl">
            🔑
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-semibold leading-tight text-fg">
              Give somebody a login
            </p>
            <p className="text-[11px] text-fg-faint">
              They can sign in as soon as you create it. What they reach is set on their card.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fg-faint transition hover:bg-paper-2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        {/* Three routes, one on screen at a time. */}
        <div className="flex shrink-0 gap-1.5 border-b border-line px-5 py-2.5">
          {TABS.map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => {
                setMode(t.k);
                reset();
              }}
              className={`mise-press flex-1 rounded-xl px-3 py-2 text-left transition ${
                mode === t.k ? "bg-brand-600 text-white" : "mise-well text-fg-soft hover:text-fg"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </span>
              <span className={`block text-[10px] ${mode === t.k ? "text-white/70" : "text-fg-faint"}`}>
                {t.hint}
              </span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {err && (
            <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              {err}
            </p>
          )}

          {mode === "one" && (
            <form id="add-one" onSubmit={createOne} className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-fg-soft">Email</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="chef@yourhotel.com"
                  className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg-soft">Password</span>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="text"
                  required
                  minLength={8}
                  placeholder="at least 8 characters"
                  className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                />
              </label>
              <label className="block">
                {/* 20 — "why the word THEY? We're creating ONE login." Right: it
                    read as a group because it was written for the list. */}
                <span className="text-xs font-medium text-fg-soft">What is this person?</span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                >
                  {choices.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-fg-soft">Link to a staff record</span>
                <select
                  value={linkEmpId}
                  onChange={(e) => setLinkEmpId(e.target.value)}
                  className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                >
                  <option value="">— not linked —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </form>
          )}

          {mode === "file" && rows.length === 0 && (
            <div className="text-center">
              <p className="text-4xl" aria-hidden>📄</p>
              <p className="mt-2 font-display text-base font-semibold text-fg">
                A spreadsheet of everybody
              </p>
              <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-fg-soft">
                Four columns — name, email, password, job. Download the template if you want the
                shape; any CSV with those headings works. Nothing is created until you have seen
                the list and said yes.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadTemplate("csv")}
                  className="mise-press mise-well rounded-xl px-3.5 py-2 text-sm font-medium text-fg-soft"
                >
                  ⬇ Download the template
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
                >
                  Choose a file
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {mode === "ai" && rows.length === 0 && (
            <div>
              <p className="text-[12px] leading-relaxed text-fg-soft">
                Write it however you like — a list, a sentence, a paste from WhatsApp. If something
                is missing DineAI will say what it needs rather than guess.
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                placeholder={
                  "e.g. Add my kitchen team: Arun and Meena as chefs, Priya on the till.\n" +
                  "Emails are firstname@nirai.com, give them all the password Welcome2026."
                }
                className="mise-well mt-2 w-full rounded-xl px-3 py-2.5 text-sm leading-relaxed outline-none"
              />
              <button
                type="button"
                onClick={askAi}
                disabled={busy || !prompt.trim()}
                className="mise-press mt-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Reading…" : "✨ Read it"}
              </button>
            </div>
          )}

          {/* THE PREVIEW. Both bulk routes end here, because a hundred logins is
              not something anybody should create without seeing the list. */}
          {rows.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-[12px] text-fg-soft">{note}</p>
                <button
                  type="button"
                  onClick={reset}
                  className="mise-press ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] text-fg-faint"
                >
                  Start again
                </button>
              </div>
              <div className="mise-well overflow-hidden rounded-xl">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-wide text-fg-faint">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Password</th>
                      <th className="px-3 py-2">Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        className={`border-t border-line/60 ${r.problem ? "bg-rose-400/5" : ""}`}
                      >
                        <td className="px-3 py-1.5 text-fg">{r.name || "—"}</td>
                        <td className="px-3 py-1.5 text-fg-soft">{r.email || "—"}</td>
                        <td className="px-3 py-1.5 font-mono text-[11px] text-fg-faint">
                          {r.password || "—"}
                        </td>
                        <td className="px-3 py-1.5 text-fg-soft">
                          {choices.find((c) => c.value === r.role)?.label ?? r.role}
                          {r.problem && (
                            <span className="mise-chip-warn ml-1.5 inline-block">{r.problem}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/40 px-5 py-3">
          {rows.length > 0 ? (
            <>
              <span className="mr-auto text-[11px] text-fg-faint">
                {good.length} ready
                {rows.length - good.length ? ` · ${rows.length - good.length} to fix` : ""}
              </span>
              <button
                type="button"
                disabled={busy || good.length === 0}
                onClick={createAll}
                className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Creating…" : `Create ${good.length} ${good.length === 1 ? "login" : "logins"}`}
              </button>
            </>
          ) : mode === "one" ? (
            <button
              type="submit"
              form="add-one"
              disabled={busy}
              className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create the login"}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
