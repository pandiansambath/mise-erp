"use client";

// Build a role the way this hotel actually talks: "Kitchen Manager", "Accounts
// Assistant" — any name you like, pinned to one of our archetypes.
//
// The important bit is what you CANNOT do here. Each archetype has an envelope
// — the most it may ever hold — and this screen only ever renders toggles from
// that envelope. So a Staff-based role simply has no Hiring switch to mis-tick.
// The mistake isn't blocked; it's unrepresentable. The server clips anything
// out-of-envelope that arrives anyway, in case of a stale tab.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";

type Archetype = {
  key: string;
  label: string;
  defaults: string[];
  envelope: string[];
};

type Role = {
  id: string;
  name: string;
  base_role: string;
  overrides: Record<string, boolean>;
  permissions: string[];
  is_active: boolean;
};

/** "payroll:write" → "Payroll · edit" — nobody should need to read our keys. */
function pretty(perm: string): { area: string; verb: string } {
  const [area, verb = ""] = perm.split(":");
  const nice = area.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const verbs: Record<string, string> = {
    read: "view",
    write: "add & edit",
    approve: "approve",
    self: "their own only",
    config: "settings",
    use: "use",
  };
  return { area: nice, verb: verbs[verb] ?? verb };
}

export function RoleBuilder() {
  const [archetypes, setArchetypes] = useState<Archetype[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // the role being built or edited
  const [editing, setEditing] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  useEffect(() => {
    Promise.all([
      api.get<{ archetypes: Archetype[] }>("/roles/archetypes").then((d) =>
        // THE KIOSK IS NOT A JOB. It is the PIN screen on the tablet by the
        // door, its permissions are sealed server-side, and nobody signs in as
        // one — so offering it as something to build a role on top of is an
        // invitation to a dead end. His standing decision: nothing kiosk in
        // Roles & Access.
        //
        // Filtered HERE and not removed from the backend on purpose: Role.KIOSK
        // is what the tablet login actually uses, so deleting it would break
        // the kiosk. It simply stops being offered as a starting point.
        setArchetypes(d.archetypes.filter((a) => !/kiosk/i.test(`${a.key} ${a.label}`))),
      ),
      api.get<{ roles: Role[] }>("/roles").then((d) => setRoles(d.roles)),
    ])
      .catch(() => setMsg("Could not load roles."))
      .finally(() => setLoading(false));
  }, []);

  const arch = archetypes.find((a) => a.key === base) ?? null;

  function startNew(a: Archetype) {
    setEditing(null);
    setBase(a.key);
    setName("");
    setOverrides({});
    setMsg(null);
  }

  function startEdit(r: Role) {
    setEditing(r);
    setBase(r.base_role);
    setName(r.name);
    setOverrides(r.overrides ?? {});
    setMsg(null);
  }

  /** Is this permission on, given the archetype's defaults + any override? */
  function isOn(perm: string): boolean {
    if (perm in overrides) return overrides[perm];
    return Boolean(arch?.defaults.includes(perm));
  }

  async function save() {
    if (!arch || name.trim().length < 2) {
      setMsg("Give the role a name first.");
      return;
    }
    try {
      const body = { name: name.trim(), base_role: base, overrides };
      const saved = editing
        ? await api.patch<Role>(`/roles/${editing.id}`, body)
        : await api.post<Role>("/roles", body);
      setRoles((prev) =>
        editing ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved],
      );
      setEditing(null);
      setBase("");
      setName("");
      setMsg(`Saved “${saved.name}”.`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not save that role.");
    }
  }

  async function remove(r: Role) {
    try {
      await api.delete(`/roles/${r.id}`);
      setRoles((prev) => prev.filter((x) => x.id !== r.id));
      setMsg(`Removed “${r.name}”. Anyone holding it falls back to ${r.base_role}.`);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not remove that role.");
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      {msg && (
        <p className="mb-4 rounded-lg bg-brand-500/10 px-3 py-2 text-sm text-brand-300">{msg}</p>
      )}

      {/* existing roles */}
      {roles.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.id} className="mise-feel">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg">{r.name}</p>
                  <p className="text-xs text-fg-faint">
                    behaves like {r.base_role.replace(/_/g, " ").toLowerCase()}
                  </p>
                </div>
                <span className="rounded-full bg-paper-2 px-2 py-0.5 text-[11px] text-fg-faint">
                  {r.permissions.length} things
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(r)}
                  className="mise-press rounded-lg border border-line px-3 py-1.5 text-xs text-fg-soft hover:border-brand-400/50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-rose-300"
                >
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* pick a starting point */}
      {!base && (
        <Card className="mise-feel">
          <h3 className="font-semibold text-fg">Create a role</h3>
          <p className="mt-1 text-sm text-fg-faint">
            Start from the job it most resembles. That choice sets the ceiling — you can turn
            things off, and on again, but never beyond what that job should ever reach.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {archetypes.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => startNew(a)}
                className="mise-press rounded-xl border border-line px-4 py-3 text-left transition hover:border-brand-400/50 hover:bg-paper-2"
              >
                <span className="block text-sm font-medium text-fg">{a.label.split("—")[0]}</span>
                <span className="block text-xs text-fg-faint">
                  {a.label.split("—")[1]?.trim() ?? ""}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* the builder */}
      {arch && (
        <Card className="mise-feel">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[14rem] flex-1">
              <span className="text-xs font-medium text-fg-soft">Call this role</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kitchen Manager"
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
              />
            </label>
            <p className="pb-2 text-xs text-fg-faint">
              behaves like <b className="text-fg-soft">{arch.label.split("—")[0].trim()}</b>
            </p>
          </div>

          <p className="mt-4 text-xs text-fg-faint">
            Only what this job could ever be trusted with is shown. Anything outside that
            isn&apos;t here to switch on by mistake.
          </p>

          <ul className="mt-2 divide-y divide-line/60">
            {arch.envelope.map((perm) => {
              const { area, verb } = pretty(perm);
              const on = isOn(perm);
              return (
                <li key={perm} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">{area}</span>
                    <span className="text-[11px] text-fg-faint">{verb}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${area} — ${verb}`}
                    onClick={() => setOverrides((o) => ({ ...o, [perm]: !on }))}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                      on ? "bg-brand-600" : "bg-paper-3"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                        on ? "left-[1.375rem]" : "left-0.5"
                      }`}
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={save}
              className="mise-press rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {editing ? "Save changes" : "Create role"}
            </button>
            <button
              type="button"
              onClick={() => {
                setBase("");
                setEditing(null);
              }}
              className="rounded-xl border border-line px-4 py-2.5 text-sm text-fg-soft hover:bg-paper-2"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
