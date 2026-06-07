// Typed client for the Mise backend API. Stores the JWT in localStorage and
// attaches it to every request. Keep this the single place that talks to the API.

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

const TOKEN_KEY = "mise_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, { ...options, headers });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const detail =
      (body as { detail?: string })?.detail || res.statusText || "Request failed";
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Request failed");
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
};

// ── Domain types (mirror backend schemas) ──────────────────────────────────
export interface UserOut {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserOut;
}

export interface Item {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  current_stock: string;
  min_stock_level: string | null;
  max_stock_level: string | null;
  cost_price: string | null;
  average_cost: string;
  is_active: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  rating: string;
  is_active: boolean;
}

export interface VendorPriceRow {
  vendor_id: string;
  vendor_name: string;
  price_per_unit: string;
  is_preferred: boolean;
  last_updated: string;
}

export interface PriceComparison {
  item_id: string;
  item_name: string;
  unit: string;
  vendor_count: number;
  comparisons: VendorPriceRow[];
  cheapest_vendor: VendorPriceRow | null;
  most_expensive_vendor: VendorPriceRow | null;
  potential_saving_per_unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: string | null;
  servings_default: number;
  selling_price: string | null;
  calculated_cost: string;
  profit_margin: string | null;
  is_active: boolean;
}

export interface IngredientCost {
  item_id: string;
  item_name: string;
  quantity: string;
  unit: string;
  unit_price: string;
  price_source: string;
  vendor_name: string | null;
  line_cost: string;
}

export interface RecipeCostBreakdown {
  recipe_id: string;
  recipe_name: string;
  servings: number;
  total_cost: string;
  cost_per_serving: string;
  selling_price: string | null;
  profit_margin_pct: string | null;
  has_missing_prices: boolean;
  ingredients: IngredientCost[];
}
