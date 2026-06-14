// Typed client for the Mise backend API. Stores the JWT in localStorage and
// attaches it to every request. Keep this the single place that talks to the API.

// Unset (local dev) -> localhost; set to "" (prod behind a reverse proxy) ->
// relative same-origin /api; set to a URL -> that URL.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL === undefined
    ? "http://localhost:8000"
    : process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");

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

/** POST multipart form-data (file uploads) with auth. */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (body as { detail?: string })?.detail || "Upload failed";
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Upload failed");
  }
  return body as T;
}

/** Fetch a file (with auth) and trigger a browser download. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// ── Domain types (mirror backend schemas) ──────────────────────────────────
export interface UserOut {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
}

export interface Hotel {
  id: string;
  name: string;
  country: string;
  city: string | null;
  base_currency: string;
  break_allowance_minutes: number;
  break_penalty_per_min: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserOut;
  hotel: Hotel;
}

export interface MeResponse {
  user: UserOut;
  hotel: Hotel;
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
  vendor_count?: number; // active vendors pricing this item (0 = not orderable yet)
  best_vendor?: string | null; // chosen (★) vendor, else cheapest provisional (null = no vendor)
  best_vendor_chosen?: boolean; // true only when a supplier was actually picked (★ preferred)
  best_vendor_price?: string | null; // that vendor's price for this item
  allergens?: string | null; // CSV of allergen codes; null = not reviewed, "" = none
}

export interface Vendor {
  id: string;
  name: string;
  category: string | null;
  sub_category?: string | null;
  contact_person?: string | null;
  mobile?: string | null;
  email?: string | null;
  credit_days?: number;
  rating: string;
  is_active: boolean;
}

export interface VendorItem {
  id: string;
  vendor_id: string;
  item_id: string;
  price_per_unit: string;
  last_updated: string;
  is_preferred: boolean;
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

export interface SalesChannel {
  id: string;
  name: string;
  commission_pct: string;
  is_active: boolean;
}

export interface SalesLine {
  id: string;
  channel_id: string;
  channel_name: string;
  gross_amount: string;
  commission: string;
  net_amount: string;
  payment_method: string;
}

export interface DayTotals {
  gross: string;
  commission: string;
  net: string;
  cash_sales: string;
  card_sales: string;
}

export interface DaySummary {
  id: string | null;
  date: string;
  opening_cash: string;
  cash_counted: string | null;
  expected_cash: string;
  cash_variance: string | null;
  notes: string | null;
  lines: SalesLine[];
  totals: DayTotals;
}

export interface DocumentItem {
  id: string;
  title: string;
  doc_type: string;
  related_entity_type: string | null;
  expiry_date: string | null;
  filename: string;
  mime_type: string | null;
  file_size: number;
  uploaded_at: string;
}

export interface ExpiringDoc {
  id: string;
  title: string;
  doc_type: string;
  expiry_date: string;
  days_left: number;
}

export interface DocRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  doc_type: string;
  title: string;
  status: string; // PENDING | UPLOADED | APPROVED
  document_id: string | null;
  created_at: string;
}

export interface IndentItemRow {
  item_id: string;
  item_name: string;
  required_qty: string;
  unit: string;
  vendor_id?: string | null; // per-line supplier override, if one was picked
  vendor_name?: string | null;
}

export interface SupplierOption {
  vendor_id: string;
  vendor_name: string;
  price_per_unit: string;
  is_preferred: boolean;
}

export interface ItemSuppliers {
  item_id: string;
  vendors: SupplierOption[];
}

export interface Indent {
  id: string;
  date: string;
  status: string;
  notes: string | null;
  items: IndentItemRow[];
}

export interface POSummary {
  id: string;
  vendor_id: string;
  vendor_name: string;
  po_number: string;
  status: string;
  total_amount: string;
}

export interface POItemOut {
  item_id: string;
  item_name: string;
  ordered_qty: string;
  received_qty: string;
  unit_price: string;
  line_total: string;
}

// GET /purchasing/reorder-suggestions — orderable items below min, topped up to par.
export interface ReorderSuggestion {
  item_id: string;
  item_name: string;
  unit: string;
  current_stock: string;
  suggested_qty: string;
}

// Full purchase order with its lines — GET /purchasing/purchase-orders/{id}.
export interface POOut {
  id: string;
  vendor_id: string;
  vendor_name: string;
  po_number: string;
  status: string;
  total_amount: string;
  items: POItemOut[];
}

export interface PayrollRow {
  id: string;
  employee_id: string;
  employee_name: string;
  pay_period: string;
  gross_pay: string;
  overtime_pay: string;
  advance_deduction: string;
  other_deductions: string;
  net_pay: string;
  status: string;
}

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  job_title: string | null;
  salary_type: string;
  monthly_salary: string | null;
  hourly_rate: string | null;
  mobile: string | null;
  ni_number: string | null;
  visa_expiry_date: string | null;
  bank_sort_code: string | null;
  bank_account_no: string | null;
  joining_date: string | null;
  is_active: boolean;
  user_id: string | null;
}

export interface VisaAlert {
  employee_id: string;
  full_name: string;
  visa_expiry_date: string;
  days_left: number;
}

export interface AttendanceRow {
  employee_id: string;
  employee_name: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_end: string | null;
  break_minutes: number;
  working_hours: string | null;
  status: string;
  on_break: boolean;
  over_break_minutes: number;
  break_penalty: string;
}

export interface PnL {
  date_from: string;
  date_to: string;
  gross_sales: string;
  commission: string;
  net_sales: string;
  cost_of_sales: string;
  gross_profit: string;
  operating_expenses: string;
  net_profit: string;
  food_cost_pct: string;
  gross_margin_pct: string;
  net_margin_pct: string;
  expense_breakdown: { category_id: string; category_name: string; kind: string; total: string }[];
}

export interface DashboardKpis {
  month_start: string;
  today: string;
  today_net_sales: string;
  month_net_sales: string;
  month_expenses: string;
  month_net_profit: string;
  month_net_margin_pct: string;
  low_stock_count: number;
  recipe_count: number;
  avg_recipe_margin_pct: string;
}

// ── Money Intelligence (GET /reports/money) ──────────────────────────────────
export interface StockByCategory {
  category: string;
  value: string;
}
export interface StockValue {
  total: string;
  item_count: number;
  by_category: StockByCategory[];
}
export interface DishMarginRow {
  recipe_id: string;
  name: string;
  selling_price: string | null;
  cost_per_serving: string | null;
  margin_pct: string | null;
}
export interface DishMargins {
  avg_margin_pct: string | null;
  priced_count: number;
  total_count: number;
  ranked: DishMarginRow[]; // every priced dish, best margin → thinnest
  no_price: DishMarginRow[];
}
export interface PriceAlert {
  item_id: string;
  item_name: string;
  prev_price: string;
  latest_price: string;
  change_pct: string;
  vendor_name: string | null;
  last_ordered: string;
}
export interface BreakEven {
  fixed_costs: string;
  contribution_margin_pct: string;
  break_even_sales: string | null;
  net_sales: string;
  gap: string | null;
  break_even_per_day: string | null;
  days_elapsed: number;
}
export interface WasteSummary {
  total: string;
  entry_count: number;
}
export interface FoodCostVariance {
  has_data: boolean;
  ideal_pct: string;
  actual_pct: string;
  gap_points: string;
  theoretical_cost: string;
  actual_cost: string;
}
// Menu engineering (GET /reports/menu-engineering) + dish-sales entry (/sales/dishes/{day})
export interface DishCount {
  recipe_id: string;
  qty: number;
}
export interface DishSalesOut {
  date: string;
  counts: DishCount[];
}
export interface MenuDish {
  recipe_id: string;
  name: string;
  qty_sold: number;
  margin_pct: string | null;
  selling_price: string | null;
  cost_per_serving: string | null;
  revenue: string;
  klass: string; // star | plowhorse | puzzle | dog | none
}
export interface MenuEngineering {
  date_from: string;
  date_to: string;
  has_data: boolean;
  total_units: number;
  revenue: string;
  theoretical_food_cost: string;
  theoretical_food_cost_pct: string;
  dishes: MenuDish[];
}

export interface MoneyCentre {
  date_from: string;
  date_to: string;
  net_sales: string;
  net_profit: string;
  food_cost_pct: string;
  gross_margin_pct: string;
  net_margin_pct: string;
  stock_value: StockValue;
  waste: WasteSummary;
  food_cost_variance: FoodCostVariance;
  break_even: BreakEven;
  dish_margins: DishMargins;
  price_alerts: PriceAlert[];
}

// Budget vs actual (GET/PUT /reports/budget)
export interface BudgetTargets {
  monthly_sales: string | null;
  food_cost_pct: string | null;
  labour_pct: string | null;
  net_margin_pct: string | null;
}
export interface BudgetVsActual {
  month_start: string;
  today: string;
  targets: BudgetTargets;
  actual: { monthly_sales: string; food_cost_pct: string; labour_pct: string; net_margin_pct: string };
}

// Rota (GET/POST/DELETE /rota/shifts, GET /rota/labour)
export interface Shift {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  start_time: string;
  end_time: string;
  hours: string;
  cost: string;
  notes: string | null;
}
export interface LabourByEmployee {
  employee_id: string;
  employee_name: string;
  hours: string;
  cost: string;
}
export interface LabourSummary {
  date_from: string;
  date_to: string;
  total_hours: string;
  total_cost: string;
  net_sales: string;
  labour_pct: string;
  by_employee: LabourByEmployee[];
}

// Food safety (GET/POST /safety/logs)
export interface SafetyLog {
  id: string;
  date: string;
  kind: string; // TEMP | CHECK
  label: string;
  reading: string | null;
  status: string; // OK | FAIL | DONE
  notes: string | null;
  created_at: string;
}

// GET /recipes/allergen-matrix — per-dish allergens (Natasha's Law)
export interface AllergenRow {
  recipe_id: string;
  name: string;
  allergens: string[];
  unreviewed: string[];
}

// GET /reports/price-history/{item_id} — what you actually paid over time
export interface PricePoint {
  date: string;
  price: string;
  vendor_name: string | null;
}

// ── Audit log (GET /audit) ───────────────────────────────────────────────────
export interface AuditEvent {
  id: string;
  user_email: string;
  action: string;
  summary: string;
  entity_type: string | null;
  created_at: string;
}

// ── Waste log (GET/POST /inventory/waste) ────────────────────────────────────
export interface WasteRow {
  id: string;
  item_id: string;
  item_name: string;
  unit: string;
  quantity: string;
  unit_cost: string | null;
  value: string;
  reason: string | null;
  created_at: string;
}
export interface WasteListResponse {
  total_value: string;
  entry_count: number;
  rows: WasteRow[];
}

export interface ExpenseCategory {
  id: string;
  name: string;
  kind: string;
  is_active: boolean;
}

export interface Expense {
  id: string;
  category_id: string;
  category_name: string;
  kind: string;
  date: string;
  amount: string;
  vat_amount: string;
  description: string | null;
  payment_method: string;
  is_recurring: boolean;
}

export interface ExpenseSummary {
  date_from: string;
  date_to: string;
  fixed_total: string;
  variable_total: string;
  vat_total: string;
  grand_total: string;
  by_category: { category_id: string; category_name: string; kind: string; total: string }[];
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
