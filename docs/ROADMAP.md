# Mise — Build Roadmap & Checklist

Each phase ships a complete vertical (backend models+service+API+migration+tests →
frontend page → Playwright) and must be **green (lint + tests + CI)** before the next.

Legend: ✅ done · 🚧 in progress · ⬜ planned

## Foundations
- ✅ **Phase 0 — Foundation**: FastAPI, async SQLAlchemy, Alembic, Docker, CI/CD.
- ✅ **Phase 1 — Auth, RBAC & Staff**: JWT, 6 roles, permission matrix, user/staff management, role-gated nav.
- ✅ **Phase 2 — Money core**: Inventory (weighted-avg cost), Vendors + Price Comparison, Recipe Costing & margin.
- ✅ **Multi-tenancy + currency**: hotels, per-hotel isolation, country-aware ₹/£ toggle.

## Money & operations (next)
- 🚧 **Phase 3 — Daily Sales & Cash**: configurable channels (Dine-in/Takeaway/Deliveroo/UberEats/JustEat/FoodHub) with commission %, gross→commission→net, payment-method split, daily entry, cash open/close + variance.
- ⬜ **Phase 4 — Expenses**: fixed + variable categories, recurring, supplier link, receipts, petty cash.
- ⬜ **Phase 5 — Reports & Dashboard**: live P&L (sales − COGS − expenses − payroll), 10 KPIs, daily/weekly/monthly trends, CSV/PDF export.

## People
- ⬜ **Phase 6 — Employees & Attendance**: employee master (UK: NI number, visa expiry, sort code), clock in/out + breaks, working hours, missing-punch.
- ⬜ **Phase 7 — Payroll**: monthly + hourly + weekly, UK min-wage check, advances/deductions, payslip PDF, holiday accrual.

## Procurement & records
- ⬜ **Phase 8 — Kitchen Indent & Purchase Orders**: indent → approval → vendor-wise PO → PDF / WhatsApp / email → receive stock.
- ⬜ **Phase 9 — Documents**: uploads (S3), link to employee/vendor, expiry tracking.
- ⬜ **Phase 10 — Notifications & Alerts**: visa expiry (60/30/7d), low stock, payment due, cash variance.

## Ship
- ⬜ **Phase 11 — Deploy**: AWS ECR + App Runner + RDS, two regions (London eu-west-2 / Mumbai ap-south-1), CD pipeline, custom domain.

## Cross-cutting feature
- ⬜ **PDF & Excel/CSV export everywhere useful** (user-requested): inventory, price
  comparison, recipes, sales, expenses, and especially Reports/P&L. Excel via
  openpyxl, PDF via a server-side renderer; "Download" buttons on each list/report.

## "Should-have-been-there" touches (woven in across phases)
Search & filters on every list · CSV/Excel export · empty-state guidance · inline
validation · optimistic toasts · audit trail (who changed what) · keyboard-friendly
forms · onboarding wizard for a new hotel · printable reports · mobile-first polish.
