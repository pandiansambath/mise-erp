"use client";

// The fleet — every hotel, every feature flag, every plan — fetched ONCE in
// the Control Room layout and shared by every page underneath it. A page
// that mutates a hotel (toggle a feature, apply a plan, suspend it) writes
// through the API directly and then calls `reload()`; it never re-derives a
// number the server owns locally. `api.get` already invalidates its cache on
// any POST/PATCH/PUT/DELETE (lib/api.ts), so `reload()` after a mutation
// always re-fetches the real state rather than replaying a stale one.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
  default: boolean;
  enforced: boolean;
};

export type PlanDef = {
  key: string;
  label: string;
  price_hint: string;
  max_users: number;
  blurb: string;
  highlights: string[];
  off_features: string[];
};

/** The fleet row — GET /platform/hotels, every key verified live 2026-09-14. */
export type HotelRow = {
  id: string;
  name: string;
  city: string | null;
  country: string;
  base_currency: string;
  created_at: string;
  has_logo: boolean; // there is NO logo_url — build the src from has_logo
  is_active: boolean;
  handle: string | null;
  user_count: number;
  admin_email: string | null;
  plan: string;
  max_users: number;
  is_comp: boolean;
  ai_daily_override: number | null;
  ai_monthly_override: number | null;
  features: Record<string, boolean>;
  has_traded: boolean;
  last_active: string | null;
  sales_entries_7d: number;
};

type FleetState = {
  hotels: HotelRow[];
  features: FeatureDef[];
  plans: PlanDef[];
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
};

const FleetContext = createContext<FleetState | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [plans, setPlans] = useState<PlanDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([
      api.get<{ features: FeatureDef[] }>("/platform/features"),
      api.get<{ plans: PlanDef[] }>("/platform/plans"),
      api.get<{ hotels: HotelRow[] }>("/platform/hotels"),
    ])
      .then(([f, p, h]) => {
        if (!alive) return;
        setFeatures(f.features);
        setPlans(p.plans);
        setHotels(h.hotels);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof ApiError ? e : new ApiError(0, "Could not load the fleet."));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  return (
    <FleetContext.Provider value={{ hotels, features, plans, loading, error, reload }}>
      {children}
    </FleetContext.Provider>
  );
}

export function useFleet(): FleetState {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used within <FleetProvider>");
  return ctx;
}
