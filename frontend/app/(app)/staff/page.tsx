"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type UserOut } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { can, ROLE_LABELS, ROLES } from "@/lib/permissions";

export default function StaffPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "users:write");
  const canRead = can(user?.role, "users:read");

  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<string>("STAFF");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    return api
      .get<UserOut[]>("/auth/users")
      .then(setUsers)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 403) setDenied(true);
      });
  }

  useEffect(() => {
    if (!canRead) {
      setDenied(true);
      setLoading(false);
      return;
    }
    load().finally(() => setLoading(false));
  }, [canRead]);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post<UserOut>("/auth/users", { email, password, role });
      setEmail("");
      setPassword("");
      setRole("STAFF");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add user");
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(id: string, newRole: string) {
    await api.patch<UserOut>(`/auth/users/${id}`, { role: newRole });
    await load();
  }

  async function toggleActive(u: UserOut) {
    const ok = await confirm({
      title: u.is_active ? "Deactivate this user?" : "Reactivate this user?",
      message: u.is_active
        ? `${u.email} will no longer be able to log in.`
        : `${u.email} will be able to log in again.`,
      confirmText: u.is_active ? "Deactivate" : "Reactivate",
      tone: u.is_active ? "danger" : "default",
    });
    if (!ok) return;
    await api.patch<UserOut>(`/auth/users/${u.id}`, { is_active: !u.is_active });
    await load();
  }

  if (denied) {
    return (
      <div>
        <PageHeader title="Staff" />
        <Card>
          <p className="py-6 text-center text-sm text-slate-500">
            You don&apos;t have permission to manage staff. Ask your Super Admin.
          </p>
        </Card>
      </div>
    );
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <PageHeader
        title="Staff"
        subtitle="People who can log in to this restaurant, and what they can do."
      />

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-slate-700">Add a team member</p>
          <form onSubmit={addUser} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex-1 sm:min-w-[14rem]">
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="chef@restaurant.com"
                className={inputCls}
              />
            </div>
            <div className="w-full sm:w-44">
              <label className="block text-sm font-medium text-slate-700">Temp password</label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="min 8 chars"
                className={inputCls}
              />
            </div>
            <div className="w-full sm:w-48">
              <label className="block text-sm font-medium text-slate-700">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Adding…" : "Add member"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
          <p className="mt-2 text-xs text-slate-400">
            Share the email + temp password with them. They sign in directly — staff don&apos;t
            self-register.
          </p>
        </Card>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="px-5 py-3 font-medium text-slate-800">
                        {u.email}
                        {isSelf && <span className="ml-2 text-xs text-slate-400">(you)</span>}
                      </td>
                      <td className="px-5 py-3">
                        {canWrite && !isSelf ? (
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u.id, e.target.value)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-slate-600">{ROLE_LABELS[u.role] ?? u.role}</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        {u.is_active ? (
                          <Badge tone="green">Active</Badge>
                        ) : (
                          <Badge tone="red">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canWrite && !isSelf && (
                          <button
                            onClick={() => toggleActive(u)}
                            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            {u.is_active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
