"use client";

// Giving a role to somebody.
//
// He knows AWS IAM, so he expects what IAM does: you write a policy, then you
// **attach** it. Two separate acts. The old screen mixed them — designing and
// assigning happened in the same place with no seam between them, and his
// verdict was "very very confusing seriously".
//
// So this is only the second half. A designed role on the left, the team on
// the right, and one button between them.
//
// The part worth getting right is the refusal. A role built on Manager cannot
// be given to somebody who is Staff — their archetype could never hold those
// permissions, and the server says no. But a refusal that just says "no" is
// what made the old model feel arbitrary, so this **explains and offers the
// fix**: it names the archetype the role needs, says what changing it would
// mean, and lets them do it in the same breath.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type UserOut } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/permissions";

type Role = {
  id: string;
  name: string;
  base_role: string;
  permissions: string[];
  is_active: boolean;
};

export function RoleAttach() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [people, setPeople] = useState<UserOut[]>([]);
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<{ user: UserOut; role: Role } | null>(null);

  const load = useCallback(async () => {
    const [r, u] = await Promise.all([
      api.get<{ roles: Role[] }>("/roles").then((d) => d.roles).catch(() => [] as Role[]),
      api.get<UserOut[]>("/auth/users").catch(() => [] as UserOut[]),
    ]);
    setRoles(r.filter((x) => x.is_active));
    setPeople(u);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const role = roles.find((r) => r.id === picked) ?? null;

  async function attach(user: UserOut, r: Role, alsoChangeArchetype = false) {
    setBusy(user.id);
    setMsg(null);
    try {
      if (alsoChangeArchetype) {
        // Move them to the archetype the role needs, THEN attach. Two calls,
        // because changing somebody's base role deliberately drops any custom
        // role built on the old one.
        await api.patch(`/auth/users/${user.id}`, { role: r.base_role });
      }
      await api.patch(`/auth/users/${user.id}`, { custom_role_id: r.id });
      setWarn(null);
      setMsg(`${user.email} now holds “${r.name}”.`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not attach that role.");
    } finally {
      setBusy(null);
    }
  }

  async function detach(user: UserOut) {
    setBusy(user.id);
    try {
      await api.patch(`/auth/users/${user.id}`, { clear_custom_role: true });
      setMsg(`${user.email} is back to plain ${ROLE_LABELS[user.role] ?? user.role}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not remove that role.");
    } finally {
      setBusy(null);
    }
  }

  if (roles.length === 0) return null;

  return (
    <section className="mise-feel mb-6 rounded-2xl border border-line bg-glass/[0.03] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">🔗</span>
        <h3 className="font-semibold text-fg">Give a role to someone</h3>
        <span className="text-xs text-fg-faint">
          pick the role, then attach it to whoever should have it
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => { setPicked(r.id === picked ? "" : r.id); setMsg(null); setWarn(null); }}
            className={`mise-press rounded-xl border px-3.5 py-2 text-left transition ${
              r.id === picked
                ? "border-brand-400/60 bg-brand-400/10"
                : "border-line hover:border-line-2"
            }`}
          >
            <span className="block text-sm font-medium text-fg">{r.name}</span>
            <span className="block text-[11px] text-fg-faint">
              built on {ROLE_LABELS[r.base_role] ?? r.base_role} · {r.permissions.length} things
            </span>
          </button>
        ))}
      </div>

      {msg && (
        <p className="mt-3 rounded-lg bg-brand-400/10 px-3 py-2 text-xs text-brand-300">{msg}</p>
      )}

      {/* The refusal, explained — and fixable in the same breath. */}
      {warn && (
        <div className="mise-pop mt-3 rounded-xl border border-amber-400/40 bg-amber-400/[0.08] p-4">
          <p className="text-sm font-medium text-amber-200">
            “{warn.role.name}” is built on {ROLE_LABELS[warn.role.base_role] ?? warn.role.base_role}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-soft">
            {warn.user.email} is currently{" "}
            <b className="text-fg">{ROLE_LABELS[warn.user.role] ?? warn.user.role}</b>, and that job
            can never hold what this role grants — so it cannot simply be added on top. Move them to{" "}
            <b className="text-fg">{ROLE_LABELS[warn.role.base_role] ?? warn.role.base_role}</b> and
            the role will fit.
          </p>
          <p className="mt-2 text-[11px] text-amber-200/80">
            This widens what they can see. Only do it if that is what you meant.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => attach(warn.user, warn.role, true)}
              disabled={busy === warn.user.id}
              className="mise-press rounded-lg bg-amber-500/90 px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
            >
              Make them {ROLE_LABELS[warn.role.base_role] ?? warn.role.base_role} and attach
            </button>
            <button
              type="button"
              onClick={() => setWarn(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Leave it
            </button>
          </div>
        </div>
      )}

      {role && (
        <ul className="mt-4 space-y-1.5">
          {people
            .filter((u) => !u.is_platform_owner)
            .map((u) => {
              const holds = u.custom_role_id === role.id;
              const fits = u.role === role.base_role;
              return (
                <li
                  key={u.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{u.email}</span>
                    <span className="block text-[11px] text-fg-faint">
                      {ROLE_LABELS[u.role] ?? u.role}
                      {u.custom_role_id && (
                        <span className="ml-1.5 text-brand-300">
                          · holds {roles.find((r) => r.id === u.custom_role_id)?.name ?? "a role"}
                        </span>
                      )}
                    </span>
                  </span>
                  {holds ? (
                    <button
                      type="button"
                      onClick={() => detach(u)}
                      disabled={busy === u.id}
                      className="mise-press shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg-faint hover:text-fg disabled:opacity-50"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      // Warn BEFORE the server refuses, so the explanation
                      // arrives with the offer to fix it rather than as an
                      // error after the fact.
                      onClick={() => (fits ? attach(u, role) : setWarn({ user: u, role }))}
                      disabled={busy === u.id}
                      className={`mise-press shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                        fits
                          ? "border-brand-400/40 bg-brand-400/10 text-brand-300"
                          : "border-amber-400/40 text-amber-300"
                      }`}
                    >
                      {fits ? "Attach" : "Attach…"}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      {!role && (
        <p className="mt-4 text-xs text-fg-faint">Pick a role above to see who can hold it.</p>
      )}
    </section>
  );
}
