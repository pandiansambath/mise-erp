"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";

const COUNTRIES = [
  { code: "GB", label: "United Kingdom (£ GBP)" },
  { code: "IN", label: "India (₹ INR)" },
  { code: "US", label: "United States ($ USD)" },
  { code: "AE", label: "UAE (AED)" },
  { code: "EU", label: "Eurozone (€ EUR)" },
];

export default function SignupPage() {
  const { registerHotel } = useAuth();
  const [hotelName, setHotelName] = useState("");
  const [country, setCountry] = useState("GB");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerHotel({ hotel_name: hotelName, country, city: city || undefined, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={56} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Register your hotel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Set up your restaurant on Mise — you&apos;ll be the Super Admin.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label htmlFor="hotel" className="block text-sm font-medium text-slate-700">Restaurant name</label>
            <input id="hotel" value={hotelName} onChange={(e) => setHotelName(e.target.value)} required placeholder="e.g. NIRAI" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="country" className="block text-sm font-medium text-slate-700">Country</label>
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls}>
                {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="city" className="block text-sm font-medium text-slate-700">City (optional)</label>
              <input id="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Your email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="owner@restaurant.com" className={inputCls} />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
            <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="min 8 characters" className={inputCls} />
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Creating your restaurant…" : "Create my restaurant"}
          </button>

          <p className="text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
