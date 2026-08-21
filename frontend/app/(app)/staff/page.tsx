"use client";

// ROLES & ACCESS, REBUILT AROUND THE PERSON.
//
// What was here asked an owner to think like an administrator. Three tabs —
// "who can sign in", "what roles grant", "who holds one" — and to change what
// one person could reach you had to visit all three: design a role in the
// second, then attach it in the third, having first chosen an archetype whose
// envelope you could not see. Four concepts before anything happened.
//
// The measurement, taken on his live hotel before touching anything:
//
//     Who can sign in    13 accounts
//     What roles grant    1 role designed
//     Who holds one       0 attached
//
// One role ever designed, held by nobody. That is not a UI blemish, it is the
// feature failing silently — somebody built a role and it never reached a
// person, because designing and attaching are two errands and only the first
// one feels like the job.
//
//   "creating role for role like manager and assigning to role like manager or
//    staff, it's confusing the laymans... we need to do something in 1 step
//    that layman can do easily."
//
// So the page is a list of people. Tap one, set what they can reach, save.
// The role machinery still exists underneath and is still bounded by the
// archetype ceiling — it simply stopped being the owner's paperwork.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Employee, type UserOut } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import Link from "next/link";
import { Workbench } from "@/components/Workbench";
import { AccessSheet, type Person } from "@/components/AccessSheet";
import { JobSheet, type Job } from "@/components/JobSheet";
import { RoleBuilder } from "@/components/RoleBuilder";
import { SECTIONS, levelOf, positionsFor } from "@/lib/access";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { can, ROLE_LABELS, ROLES } from "@/lib/permissions";

type Archetype = { key: string; label: string; defaults: string[]; envelope: string[] };
type CustomRole = { id: string; name: string; base_role: string; is_active: boolean; permissions: string[] };

export default function StaffPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "users:write");
  const canRead = can(user?.role, "users:read");
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [users, setUsers] = useState<UserOut[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [arch, setArch] = useState<Archetype[]>([]);
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Person | null>(null);
  // TWO DOORS, and the first one is the one most people need.
  //
  //   "it will make the job tough for layman that they need to keep on doing
  //    this. So manager means what and all he can access."
  //
  // Jobs answers it once for everybody; People is the exception.
  const [view, setView] = useState<"jobs" | "people">("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [everything, setEverything] = useState<string[]>([]);
  const [openJob, setOpenJob] = useState<Job | null>(null);
  // ROLES THE HOTEL INVENTED. `building` is open/closed; `editing` is which
  // one (null = designing a new one).
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState<CustomRole | null>(null);

  // add-a-login
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("STAFF");
  const [linkEmpId, setLinkEmpId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    return Promise.all([
      api
        .get<UserOut[]>("/auth/users")
        .then(setUsers)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 403) setDenied(true);
        }),
      api.get<Employee[]>("/employees").then(setEmployees).catch(() => {}),
      api
        .get<{ roles: CustomRole[] }>("/roles")
        // PER-PERSON TUNING IS NOT A ROLE THE HOTEL DESIGNED.
        //
        // Setting one person's switches creates a CustomRole underneath, named
        // "<who> - custom access". That is an implementation detail of "this
        // one person differs", and putting it on the roles board next to
        // Manager and Poori Master invites somebody to hand Balaji's private
        // arrangement to three other people. It stays on the card where it was
        // made; only roles that were NAMED belong here.
        .then((d) =>
          setRoles(
            d.roles.filter((r) => r.is_active && !/— custom access$/.test(r.name)),
          ),
        )
        .catch(() => setRoles([])),
      api
        .get<{ jobs: Job[]; everything: string[] }>("/roles/jobs")
        .then((d) => {
          setJobs(d.jobs ?? []);
          setEverything(d.everything ?? []);
        })
        .catch(() => setJobs([])),
    ]);
  }

  useEffect(() => {
    api
      .get<{ archetypes: Archetype[] }>("/roles/archetypes")
      .then((d) => setArch(d.archetypes))
      .catch(() => {});
    if (!canRead) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load().finally(() => setLoading(false));
  }, [canRead]);

  /** What this person can reach, as "3 of 11 pages" — the headline the list
   *  exists to give. Computed from their job's defaults plus their designed
   *  role, so the card never disagrees with the sheet it opens. */
  function reachOf(u: UserOut): { on: number; all: number } {
    if (u.role === "SUPER_ADMIN") return { on: 1, all: 1 };
    const base = arch.find((a) => a.key === u.role);
    const mine = u.custom_role_id ? roles.find((r) => r.id === u.custom_role_id) : null;
    const held = new Set(mine?.permissions ?? base?.defaults ?? []);
    // COUNTED IN PAGES, like the sheet this card opens. It used to say
    // "2 of 17 areas" while the sheet said "of 33 pages" - two units for one
    // fact, on two screens one tap apart.
    const on = new Set<string>();
    const all = new Set<string>();
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        for (const pg of a.pages) all.add(pg);
        if (levelOf(a, held) !== "none") for (const pg of a.pages) on.add(pg);
      }
    }
    return { on: on.size, all: all.size };
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // A role of ours, or one of theirs? The `role:` prefix keeps both in one
      // <select> without needing a second control the reader has to notice.
      const ownRole = role.startsWith("role:") ? role.slice(5) : null;
      const baseRole = ownRole
        ? (roles.find((r) => r.id === ownRole)?.base_role ?? "STAFF")
        : role;

      let created: UserOut | null = null;
      if (linkEmpId) {
        await api.post(`/employees/${linkEmpId}/account`, {
          email,
          password,
          role: baseRole,
        });
      } else {
        created = await api.post<UserOut>("/auth/users", {
          email,
          password,
          role: baseRole,
        });
      }

      if (ownRole) {
        // The account has to exist before it can be put in a role. When it was
        // made from an employee record we do not get the id back, so find them
        // by the email we just used.
        let id = created?.id ?? null;
        if (!id) {
          const all = await api.get<UserOut[]>("/auth/users");
          id = all.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())?.id ?? null;
        }
        if (id) await api.put(`/roles/user/${id}/role`, { role_id: ownRole });
      }
      setEmail("");
      setPassword("");
      setRole("STAFF");
      setLinkEmpId("");
      setAdding(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add user");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u: UserOut) {
    const ok = await confirm({
      title: u.is_active ? "Stop them signing in?" : "Let them sign in again?",
      message: u.is_active
        ? `${u.email} will no longer be able to log in. Their record and history stay.`
        : `${u.email} will be able to log in again.`,
      confirmText: u.is_active ? "Stop access" : "Restore access",
      tone: u.is_active ? "danger" : "default",
    });
    if (!ok) return;
    await api.patch<UserOut>(`/auth/users/${u.id}`, { is_active: !u.is_active });
    await load();
  }

  async function removePermanently(u: UserOut) {
    const ok = await confirm({
      title: "Permanently remove this login?",
      message:
        `${u.email} will be removed for good — the email is freed, the password destroyed, ` +
        `and they can never sign in again. This CANNOT be undone. Their past actions stay ` +
        `in your records, shown as “Removed user”. (To only block sign-in for now, use ` +
        `Stop access instead.)`,
      confirmText: "Remove permanently",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/auth/users/${u.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the account");
    }
  }

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    // THE TABLET IS NOT A PERSON. It signs in with a PIN at <hotel>/kiosk, its
    // permissions are sealed, and nobody manages its access — showing it here
    // as somebody to tap is the same mistake as offering Kiosk as a job.
    const people = users.filter((u) => u.role !== "KIOSK");
    const list = t
      ? people.filter(
          (u) =>
            u.email.toLowerCase().includes(t) ||
            (u.preferred_name ?? "").toLowerCase().includes(t) ||
            (ROLE_LABELS[u.role] ?? u.role).toLowerCase().includes(t),
        )
      : people;
    // Owners first, then anyone whose access has been tailored (the ones worth
    // a second look), then the rest.
    return [...list].sort((a, b) => {
      const rank = (u: UserOut) =>
        u.role === "SUPER_ADMIN" ? 0 : u.custom_role_id ? 1 : 2;
      return rank(a) - rank(b) || (a.preferred_name ?? a.email).localeCompare(b.preferred_name ?? b.email);
    });
  }, [users, q]);

  const tailored = users.filter((u) => u.custom_role_id).length;

  if (denied) {
    return (
      <div>
        <PageHeader title="Roles & Access" />
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">
            You don&apos;t have permission to manage staff. Ask your Super Admin.
          </p>
        </Card>
      </div>
    );
  }

  const inputCls = "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none";

  return (
    <Workbench
      title="Roles & Access"
      subtitle="Tap a person to set what they can reach."
      tools={
        <div className="flex flex-wrap items-center gap-2">
          <div className="mise-well flex shrink-0 rounded-xl p-0.5">
            {([
              ["jobs", "🧩", "By job"],
              ["people", "🧑‍🍳", "By person"],
            ] as const).map(([k, icon, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setView(k)}
                className={`mise-press rounded-lg px-3 py-2 text-xs font-medium transition ${
                  view === k ? "bg-brand-600 text-white" : "text-fg-faint hover:text-fg-soft"
                }`}
              >
                <span aria-hidden className="mr-1">{icon}</span>
                {label}
              </button>
            ))}
          </div>
          <label className={`min-w-[12rem] flex-1 ${view === "jobs" ? "hidden" : ""}`}>
            <span className="sr-only">Find a person</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍  Find a person…"
              className="mise-well w-full rounded-xl px-3.5 py-2.5 text-sm outline-none"
            />
          </label>
          {canWrite && view === "people" && (
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              {adding ? "Close" : "＋ Add a login"}
            </button>
          )}
        </div>
      }
      tally={
        <p className="text-xs leading-relaxed text-fg-faint">
          <b className="text-fg-soft tabular-nums">{users.length}</b> can sign in ·{" "}
          <b className="text-fg-soft tabular-nums">{tailored}</b> with tailored access · emails,
          passwords and history live on the{" "}
          <Link href="/employees" className="font-medium text-brand-400 hover:underline">
            Employees
          </Link>{" "}
          page.
        </p>
      }
    >
      {error && (
        <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {adding && canWrite && (
        <form onSubmit={addUser} className="mise-card3d mise-pop mb-5 p-4">
          <p className="text-sm font-semibold text-fg">A new login</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
            Pick one of your own roles, or a standard job — you can fine-tune exactly what they reach straight
            afterwards by tapping their card.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="chef@hotel.com"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="at least 8 characters"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">What are they?</span>
              {/* THE HOTEL'S OWN ROLES BELONG HERE TOO.
                  "I created a new role called super master, but this is not
                   reflecting in these areas."
                  Right — it existed, and the one place you go to make a person
                  could not see it. A role you cannot pick when creating
                  somebody is a role you have to remember to apply afterwards. */}
              <Select
                value={role}
                onChange={setRole}
                options={[
                  ...roles.map((r) => ({ value: `role:${r.id}`, label: `${r.name} (yours)` })),
                  // ROLES never contained KIOSK, so there is nothing to filter
                  // out here - it is not a job anybody is hired into.
                  ...ROLES.filter((r) => r !== "SUPER_ADMIN" || isSuperAdmin).map((r) => ({
                    value: r,
                    label: ROLE_LABELS[r],
                  })),
                ]}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-fg-soft">Link to a staff record</span>
              <Select
                value={linkEmpId}
                onChange={setLinkEmpId}
                options={[
                  { value: "", label: "— not linked —" },
                  ...employees.map((e) => ({ value: e.id, label: e.full_name })),
                ]}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="mise-press mt-3 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {saving ? "Creating…" : "Create the login"}
          </button>
        </form>
      )}

      {view === "jobs" ? (
        <>
          <p className="mb-3 rounded-xl border border-line bg-paper-2/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-soft">
            Set what a job reaches once, and everyone with that job gets it. Need one person to
            differ? Switch to <b>By person</b> — their own card always wins.
          </p>
          <ul
            className="mise-stagger grid auto-rows-fr gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(17rem, 100%), 1fr))" }}
          >
            {/* 2 — "that Create new role + icon, we can have as the 1st card, so
                the user doesn't need to scroll down to reach it." Making a role is
                the reason most people open this page; it was behind everything else. */}
            {canWrite && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setBuilding(true);
                  }}
                  className="mise-press grid h-full w-full place-items-center rounded-2xl border border-dashed border-line p-3.5 text-center hover:border-brand-400/60"
                >
                  <span>
                    <span aria-hidden className="block text-2xl">＋</span>
                    <span className="mt-1 block font-display text-base font-semibold text-fg">
                      Create a role
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-fg-faint">
                      Poori Master, Tandoor Lead, anything you call it —
                      <br />
                      then choose what they can reach
                    </span>
                  </span>
                </button>
              </li>
            )}

            {jobs.map((j) => {
              const reach = (() => {
                const held = new Set(j.permissions);
                // Pages, so the card and the popup it opens agree.
                const onSet = new Set<string>();
                const allSet = new Set<string>();
                for (const sec of SECTIONS)
                  for (const a of sec.areas) {
                    for (const pg of a.pages) allSet.add(pg);
                    if (levelOf(a, held) !== "none") for (const pg of a.pages) onSet.add(pg);
                  }
                return { on: onSet.size, total: allSet.size };
              })();
              return (
                <li key={j.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenJob(j)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenJob(j);
                      }
                    }}
                    className="mise-card3d mise-press relative flex h-full w-full flex-col cursor-pointer overflow-hidden p-3.5 pl-4 text-left"
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-1 ${
                        j.customised ? "bg-sky-400/60" : "bg-fg-faint/25"
                      }`}
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-base font-semibold text-fg">
                        {j.label.split("—")[0].trim()}
                      </span>
                      <span aria-hidden className="shrink-0 text-fg-faint">›</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg-faint">
                      {j.label.split("—")[1]?.trim() ?? ""}
                    </p>
                    <dl className="mt-2.5 space-y-0.5 border-t border-line/50 pt-2 text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">Reaches</dt>
                        <dd className="tabular-nums text-fg">
                          {reach.on} of {reach.total} pages
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">People</dt>
                        <dd className="tabular-nums text-fg-soft">{j.people}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">Set up</dt>
                        <dd>
                          {j.customised ? (
                            <span className="mise-tone-info">your own</span>
                          ) : (
                            <span className="text-fg-soft">DineAI default</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}

            {/* THE HOTEL'S OWN ROLES, beside the ones we shipped rather than
                filed away somewhere else. A named role that lives on a
                different screen from the jobs is how the last one ended up
                attached to nobody. */}
            {roles.map((r) => {
              const held = new Set(r.permissions);
              // Pages, like every other card and every sheet.
              const onSet = new Set<string>();
              const allSet = new Set<string>();
              for (const sec of SECTIONS)
                for (const a of sec.areas) {
                  for (const pg of a.pages) allSet.add(pg);
                  if (levelOf(a, held) !== "none") for (const pg of a.pages) onSet.add(pg);
                }
              const on = onSet.size;
              const total = allSet.size;
              const holders = users.filter((u) => u.custom_role_id === r.id).length;
              return (
                <li key={r.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setEditing(r);
                      setBuilding(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(r);
                        setBuilding(true);
                      }
                    }}
                    className="mise-card3d mise-press relative flex h-full w-full flex-col cursor-pointer overflow-hidden p-3.5 pl-4 text-left"
                  >
                    <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand-400/70" />
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-display text-base font-semibold text-fg">
                        {r.name}
                      </span>
                      <span aria-hidden className="shrink-0 text-fg-faint">›</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-fg-faint">
                      A role you made
                    </p>
                    <dl className="mt-2.5 space-y-0.5 border-t border-line/50 pt-2 text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">Reaches</dt>
                        <dd className="tabular-nums text-fg">
                          {on} of {total} pages
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">People</dt>
                        <dd className="tabular-nums text-fg-soft">{holders}</dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">Set up</dt>
                        <dd className="mise-tone-info">yours</dd>
                      </div>
                    </dl>
                  </div>
                </li>
              );
            })}

          </ul>
        </>
      ) : loading ? (
        <div className="grid place-items-center py-16">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-fg-faint">
            {users.length === 0 ? "No logins yet." : "Nobody matches that."}
          </p>
        </Card>
      ) : (
        <ul
          // EVERY CARD FILLS ITS ROW.
          //   "the cards are not aligned evenly - owner card and tailored card,
          //    it's not even."
          // A person with tailored access carries a "Stop access" row that a
          // plain card does not, so that card was taller and the whole grid row
          // grew around it, leaving the others with a gap under them.
          // `auto-rows-fr` makes every row the same height and `h-full` on the
          // card makes it actually fill it, so the bottoms line up whatever is
          // inside.
          className="mise-stagger grid auto-rows-fr gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(17rem, 100%), 1fr))" }}
        >
          {shown.map((u) => {
            const owner = u.role === "SUPER_ADMIN";
            const reach = reachOf(u);
            const name = u.preferred_name || u.email.split("@")[0];
            const jobLabel = ROLE_LABELS[u.role] ?? u.role;
            return (
              <li key={u.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(u as Person)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(u as Person);
                    }
                  }}
                  className={`mise-card3d mise-press relative flex h-full w-full flex-col cursor-pointer overflow-hidden p-3.5 pl-4 text-left ${
                    u.is_active === false ? "opacity-60" : ""
                  }`}
                >
                  {/* Colour is information: owner, tailored, or plain. */}
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 w-1 ${
                      owner ? "bg-amber-400/70" : u.custom_role_id ? "bg-sky-400/60" : "bg-fg-faint/25"
                    }`}
                  />
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="mise-well grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-base font-semibold text-fg-soft"
                    >
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-fg">{name}</span>
                        <span aria-hidden className="shrink-0 text-fg-faint">›</span>
                      </span>
                      <span className="block truncate text-[11px] text-fg-faint">{u.email}</span>
                    </span>
                  </div>

                  <dl className="mt-2.5 space-y-0.5 border-t border-line/50 pt-2 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-fg-faint">Job</dt>
                      <dd className="truncate text-fg-soft">{jobLabel}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-fg-faint">Can reach</dt>
                      <dd className="shrink-0 tabular-nums text-fg">
                        {owner ? "everything" : `${reach.on} of ${reach.all} pages`}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-fg-faint">Access</dt>
                      <dd className="shrink-0">
                        {owner ? (
                          <span className="text-amber-300">owner</span>
                        ) : u.custom_role_id ? (
                          <span className="mise-tone-info">tailored</span>
                        ) : (
                          <span className="text-fg-soft">standard</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  {canWrite && !owner && (
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleActive(u); }}
                        className="mise-press rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:text-fg"
                      >
                        {u.is_active === false ? "Restore" : "Stop access"}
                      </button>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removePermanently(u); }}
                          aria-label={`Permanently remove ${u.email}`}
                          className="mise-press rounded-lg border border-line px-2 py-1 text-[10px] text-fg-faint hover:border-rose-400/50 hover:text-rose-300"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AccessSheet person={open} onClose={() => setOpen(null)} onSaved={load} />
      <RoleBuilder
        open={building}
        role={editing}
        
        people={editing ? users.filter((u) => u.custom_role_id === editing.id).length : 0}
        onClose={() => {
          setBuilding(false);
          setEditing(null);
        }}
        onSaved={load}
      />

      <JobSheet
        job={openJob}
        everything={everything}
        onClose={() => setOpenJob(null)}
        onSaved={load}
      />
    </Workbench>
  );
}
