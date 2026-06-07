// Client-side mirror of the backend RBAC matrix (app/core/rbac.py).
// The backend is the source of truth and ENFORCES access; this is only for
// UX — hiding nav/controls a role can't use. Keep in sync with the backend.

export const ROLES = [
  "SUPER_ADMIN",
  "MANAGER",
  "KITCHEN_MANAGER",
  "ACCOUNTANT",
  "CASHIER",
  "STAFF",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  MANAGER: "Manager",
  KITCHEN_MANAGER: "Kitchen Manager",
  ACCOUNTANT: "Accountant",
  CASHIER: "Cashier",
  STAFF: "Staff",
};

const PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["*"],
  MANAGER: [
    "users:read",
    "employees:write",
    "attendance:write",
    "payroll:read",
    "vendors:write",
    "inventory:write",
    "recipes:write",
    "indent:approve",
    "sales:read",
    "reports:read",
  ],
  KITCHEN_MANAGER: ["inventory:read", "recipes:write", "indent:write", "stock:read"],
  ACCOUNTANT: ["payroll:write", "vendor_payments:write", "vendors:read", "recipes:read", "reports:read"],
  CASHIER: ["sales:write", "cash:write"],
  STAFF: ["attendance:self", "payroll:self"],
};

export function can(role: string | undefined | null, permission: string): boolean {
  if (!role) return false;
  const perms = PERMISSIONS[role] ?? [];
  if (perms.includes("*") || perms.includes(permission)) return true;
  // write implies read on the same module
  if (permission.endsWith(":read")) {
    const moduleName = permission.split(":")[0];
    if (perms.includes(`${moduleName}:write`)) return true;
  }
  return false;
}
