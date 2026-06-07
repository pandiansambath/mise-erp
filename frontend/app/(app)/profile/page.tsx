"use client";

import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";

export default function ProfilePage() {
  const { user, hotel } = useAuth();
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" subtitle="Your account in Mise." />

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
            {initial}
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">{user?.email}</p>
            <p className="text-sm text-slate-500">{user?.role.replace(/_/g, " ")}</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-slate-100 pt-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-800">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium text-slate-800">{user?.role.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium text-brand-600">
              {user?.is_active ? "Active" : "Inactive"}
            </dd>
          </div>
        </dl>
      </Card>

      {hotel && (
        <Card className="mt-6">
          <h3 className="font-semibold text-slate-900">Restaurant</h3>
          <dl className="mt-3 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium text-slate-800">{hotel.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Location</dt>
              <dd className="font-medium text-slate-800">
                {hotel.city ? `${hotel.city}, ` : ""}
                {hotel.country}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Base currency</dt>
              <dd className="font-medium text-slate-800">{hotel.base_currency}</dd>
            </div>
          </dl>
        </Card>
      )}

      <Card className="mt-6">
        <h3 className="font-semibold text-slate-900">Security</h3>
        <p className="mt-1 text-sm text-slate-500">
          Change-password, two-factor, and Google sign-in are on the roadmap.
        </p>
        <button
          disabled
          className="mt-3 cursor-not-allowed rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-400"
        >
          Change password (coming soon)
        </button>
      </Card>
    </div>
  );
}
