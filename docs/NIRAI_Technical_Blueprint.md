# NIRAI ERP — Complete Technical Blueprint
### Gap Analysis + Implementation Roadmap + Testing Strategy

---

## 📌 Table of Contents

1. [Gap Analysis: What We Discussed vs Official PRD](#1-gap-analysis)
2. [Conflicts to Resolve (Important)](#2-conflicts-to-resolve)
3. [UK-Specific Requirements — Things We Missed Completely](#3-uk-specific-requirements)
4. [Final Confirmed Tech Stack](#4-final-tech-stack)
5. [Complete Database Schema](#5-complete-database-schema)
6. [Phase-by-Phase Roadmap with Implementation + Testing](#6-roadmap)
   - Phase 0: Foundation
   - Phase 1: Auth & User Management
   - Phase 2: Employee Master & Attendance
   - Phase 3: Payroll Engine
   - Phase 4: Vendor Management
   - Phase 5: Inventory Management
   - Phase 6: Kitchen Indent & Purchase Orders
   - Phase 7: Daily Sales & Cash Management
   - Phase 8: Reports & Dashboard
   - Phase 9: Document Management & Notifications
   - Phase 10: Recipe Costing (Moved to Phase 1 — Recommended)
7. [Full Testing Strategy](#7-testing-strategy)
8. [CI/CD Pipeline](#8-cicd-pipeline)
9. [Definition of Done — Per Phase](#9-definition-of-done)

---

## 1. Gap Analysis

### Feature-by-Feature Comparison

| Module | Our Discussion (Yesterday) | Senior's Official PRD | Status |
|--------|--------------------------|----------------------|--------|
| Roles | 5 roles (Admin, Manager, Chef, Cashier, Staff) | 5 roles (Super Admin, Restaurant Manager, Kitchen Manager, Staff, Accountant) | ✅ Match — minor name differences |
| Employee Master | Basic fields | + NI Number, Visa Expiry, Bank Details, Hourly Rate, Emergency Contact | ⚠️ PRD has UK-specific fields we missed |
| Attendance | Clock in/Clock out | + Break Start/Break End tracking, Missing Punch reports | ⚠️ PRD more detailed |
| Payroll | Monthly salary only | + Hourly staff payroll, Weekly payroll cycle | ⚠️ PRD covers both types |
| Vendor Categories | Basic (Food, Cleaning) | + Bar Vendors, Utility Vendors, Service Vendors, Property Vendors | ⚠️ PRD more complete |
| Vendor Profile | Contact, payment type | + VAT Number, Bank Details, Document uploads, Payment Frequency | ⚠️ PRD adds UK VAT |
| Inventory | Stock register, min level | + Max Stock, Average Cost, Returns, Adjustments | ⚠️ PRD more detailed |
| Kitchen Indent | ✅ Covered | ✅ Matches — with approval workflow | ✅ Match |
| Purchase Orders | Basic PO | + WhatsApp/Email send, PDF & Excel export | ⚠️ PRD adds delivery channels |
| Daily Sales | Cash / Card / Paytm | + Deliveroo, Uber Eats, Just Eat, FoodHub, Dine-In, Takeaway split | ❌ Major gap — UK delivery platforms missing |
| Cash Management | Mentioned briefly | Opening Cash → Sales → Expenses → Closing Cash + Petty Cash | ⚠️ PRD has full cash register logic |
| Business Reports | ✅ Monthly P&L | ✅ Daily + Weekly + Monthly | ✅ Match |
| Dashboard KPIs | ✅ General | Specific list of 10 KPIs | ✅ Match |
| Document Management | ❌ Not discussed | ✅ Full module — employee docs, vendor contracts, licenses | ❌ COMPLETELY MISSING from our doc |
| Notifications | WhatsApp only mentioned | Email + SMS + WhatsApp, 8+ alert triggers | ⚠️ PRD more comprehensive |
| Recipe Costing | **Phase 1** (recommended) | **Phase 2** | ⚡ CONFLICT — see Section 2 |
| Menu Profitability | **Phase 1** | **Phase 2** | ⚡ CONFLICT |
| Multi-Branch | Future mention | Phase 2 | ✅ Match |
| Monitoring (Grafana) | ✅ We added | Not in PRD | ✅ We added extra value |
| Redis Cache | ✅ We added | Not in PRD | ✅ We added extra value |

---

### Summary Counts

| Type | Count |
|------|-------|
| ✅ Features that match | 7 |
| ⚠️ Features in PRD with more detail than our version | 10 |
| ❌ Features in PRD completely missing from our doc | 2 (Document Mgmt, UK delivery platforms) |
| ⚡ Genuine conflicts | 2 (Recipe Costing phase, Menu Profitability phase) |
| ✅ Extra features WE added (not in PRD) | 3 (Redis, Grafana, Monitoring) |

---

## 2. Conflicts to Resolve

### Conflict 1: Recipe Costing — Phase 1 (us) vs Phase 2 (senior)

**Senior's PRD says**: Recipe Costing & Menu Profitability → Phase 2

**We recommended**: Recipe Costing → Phase 1

**My position: We are correct. Here's why.**

The entire reason this project exists — from your senior's own explanation — is:

> *"Excess amount spent, waste of items buying and going to garbage"*

That problem is **only** solvable with Recipe Costing. Without it:
- You have attendance tracking (useful but not the core problem)
- You have vendor comparison (useful, but you don't know how much of each item to buy)
- You have expense reports (tells you money was lost, but not WHY)

Recipe costing is the **engine** that connects inventory → purchase orders → cost per dish → pricing. Without it, you've built a fancy Excel replacement, not a restaurant intelligence system.

**What to tell your senior**:
> *"The PRD puts recipe costing in Phase 2, but I think if we add it alongside Phase 1 at module level — not as a UI feature, just the database tables and cost calculation logic — it won't add much time and will make every other module more valuable from Day 1."*

**Compromise**: Build the recipe_costing database tables and calculation engine in Phase 1 (backend only, ~1 week extra). Show recipe costs in the UI in Phase 2. This way the engine is there from Day 1 but you don't delay the rest.

---

### Conflict 2: "Accountant" Role vs Our Role Design

**Our design**: Admin, Manager, Chef, Cashier, Staff

**PRD says**: Super Admin, Restaurant Manager, Kitchen Manager, Staff, Accountant

**Resolution**: Use the PRD's role names. Add one more that the PRD missed:

```
SUPER_ADMIN     → Owner, full access
MANAGER         → Restaurant Manager  
KITCHEN_MANAGER → Chef (corrected name)
ACCOUNTANT      → NEW — vendor payments, payroll, financial reports
CASHIER         → Not in PRD but needed for daily sales entry
STAFF           → General staff
```

Use the PRD names **plus** add Cashier since someone needs to enter daily sales.

---

## 3. UK-Specific Requirements

> **This is important, bro.** The restaurant is called **NIRAI** and it's in the UK. The PRD has clear UK indicators that we completely missed yesterday. If you build a system without these, it won't work for the client.

### 3.1 Staff Fields — UK Legal Requirements

| Field | Why It's Required in the UK |
|-------|----------------------------|
| **NI Number** (National Insurance) | Required for UK payroll. Every employee must have one for tax calculation. It's like India's PAN card but for employment. |
| **Visa Expiry Date** | Many UK restaurant staff are on work visas. If visa expires and staff still works, restaurant gets fined up to £20,000 per illegal worker. System must alert 60/30/7 days before expiry. |
| **Bank Account + Sort Code** | UK bank transfers use Sort Code (6 digits) + Account Number (8 digits). Not IFSC like India. |
| **P45/P60 Documents** | UK tax documents when employee joins/leaves. Store these in Document Management. |

### 3.2 Sales Channels — UK Delivery Apps

This is the biggest gap. UK restaurants use delivery apps. The client's sales come from multiple places:

```
Daily Sales Breakdown (UK Restaurant)
───────────────────────────────────────────────────────
Channel          | Commission | How money arrives
─────────────────|────────────|─────────────────────────
Dine-In          | 0%         | Cash/Card at till
Takeaway         | 0%         | Cash/Card at till
Deliveroo        | 30-35%     | Weekly bank transfer
Uber Eats        | 30%        | Weekly bank transfer
Just Eat         | 14% + fees | Weekly bank transfer
FoodHub          | ~5%        | Weekly bank transfer
───────────────────────────────────────────────────────
```

**Important**: When you record sales, the system must know:
- Gross sale on Deliveroo: £100
- Commission deducted: -£32
- Net received: £68

The report must show both gross (what customers paid) and net (what restaurant actually got).

### 3.3 Vendor VAT

UK vendors charge VAT (20%). When recording vendor invoices:
- Vendor invoice: £120 (including VAT)
- VAT amount: £20
- Net cost: £100
- If restaurant is VAT-registered: they can claim £20 back from HMRC

The system must store VAT amounts separately for accounting export.

### 3.4 Accounting Export

The PRD mentions "Accounting Export" but doesn't say where. In the UK, restaurants use:
- **Xero** (most common for restaurants)
- **QuickBooks**
- **Sage**

Phase 2: Export transactions in Xero CSV format so the accountant can import directly.

### 3.5 Payroll — UK Specifics

| Type | UK Reality |
|------|-----------|
| Hourly Rate | Minimum wage in UK is £11.44/hour (2024). System must warn if hourly rate set below this. |
| Weekly Pay | Many UK hospitality staff are paid weekly. System needs weekly payroll cycle. |
| Holiday Pay | UK law: staff get 5.6 weeks holiday/year. System tracks holiday accrual. |

---

## 4. Final Tech Stack

```
┌────────────────────────────────────────────────────────┐
│                  NIRAI ERP TECH STACK                  │
├─────────────────┬──────────────────────────────────────┤
│ FRONTEND        │ Next.js 14 + TypeScript               │
│ UI Library      │ Tailwind CSS + shadcn/ui              │
│ Charts          │ Recharts + Tremor (dashboard)         │
│ Forms           │ React Hook Form + Zod                 │
│ Data Fetching   │ TanStack Query (React Query)          │
├─────────────────┼──────────────────────────────────────┤
│ BACKEND         │ Python FastAPI                        │
│ ORM             │ SQLAlchemy 2.0 (async)                │
│ Migrations      │ Alembic                              │
│ Validation      │ Pydantic v2                           │
│ Background Jobs │ Celery + Redis                        │
├─────────────────┼──────────────────────────────────────┤
│ AUTH            │ Supabase Auth + JWT                  │
│ DATABASE        │ PostgreSQL (Supabase)                 │
│ CACHE           │ Redis (Upstash)                      │
│ FILE STORAGE    │ AWS S3 (documents, PDFs, invoices)   │
├─────────────────┼──────────────────────────────────────┤
│ NOTIFICATIONS   │ Resend (email) + Twilio (WhatsApp)   │
│ PDF GENERATION  │ WeasyPrint (Python, server-side)     │
│ EXCEL EXPORT    │ openpyxl (Python)                    │
├─────────────────┼──────────────────────────────────────┤
│ HOSTING FE      │ Vercel (free tier)                   │
│ HOSTING BE      │ Railway → AWS ECS (when scaling)     │
│ CI/CD           │ GitHub Actions                        │
│ MONITORING      │ Grafana Cloud + Prometheus            │
│ DOMAIN          │ Namecheap (you have it!)             │
└─────────────────┴──────────────────────────────────────┘
```

**Why Resend for email?** It's developer-friendly, free tier (3000 emails/month), works perfectly with Python. Better than raw SES for small projects.

**Why WeasyPrint for PDF?** It generates PDF from HTML/CSS — meaning your payslip template is just an HTML file. Beautiful, easy to maintain.

---

## 5. Complete Database Schema

### Auth / Users

```sql
users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL,  -- SUPER_ADMIN | MANAGER | KITCHEN_MANAGER | ACCOUNTANT | CASHIER | STAFF
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW()
)
```

### Staff / HR

```sql
employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES users(id),
  employee_code     VARCHAR(20) UNIQUE,          -- EMP001, EMP002...
  full_name         VARCHAR(100) NOT NULL,
  mobile            VARCHAR(20),
  address           TEXT,
  emergency_contact VARCHAR(100),
  emergency_phone   VARCHAR(20),
  role              VARCHAR(50),                  -- Chef, Cashier, Waiter...
  salary_type       VARCHAR(20),                  -- MONTHLY | HOURLY
  monthly_salary    DECIMAL(10,2),
  hourly_rate       DECIMAL(8,2),
  -- UK-specific fields
  ni_number         VARCHAR(20),                  -- National Insurance
  visa_expiry_date  DATE,                         -- NULL if UK/EU citizen
  bank_account_no   VARCHAR(20),                  -- 8-digit UK account
  bank_sort_code    VARCHAR(10),                  -- XX-XX-XX format
  joining_date      DATE NOT NULL,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
)

attendance (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID REFERENCES employees(id),
  date           DATE NOT NULL,
  clock_in       TIMESTAMPTZ,
  clock_out      TIMESTAMPTZ,
  break_start    TIMESTAMPTZ,
  break_end      TIMESTAMPTZ,
  break_minutes  INT DEFAULT 0,
  working_hours  DECIMAL(4,2),                   -- calculated: (out-in) - break
  status         VARCHAR(20),                     -- PRESENT | ABSENT | HALF_DAY | LEAVE
  notes          TEXT,
  UNIQUE(employee_id, date)
)

salary_advances (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID REFERENCES employees(id),
  amount       DECIMAL(10,2) NOT NULL,
  reason       TEXT,
  given_date   DATE NOT NULL,
  deduct_month VARCHAR(7),                        -- 2024-01 format
  is_deducted  BOOLEAN DEFAULT false,
  created_by   UUID REFERENCES users(id)
)

payroll (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID REFERENCES employees(id),
  pay_period        VARCHAR(20) NOT NULL,          -- 2024-01 (monthly) or 2024-W03 (weekly)
  pay_period_type   VARCHAR(10),                   -- MONTHLY | WEEKLY
  working_days      INT,
  days_present      INT,
  days_absent       INT,
  half_days         INT DEFAULT 0,
  total_hours       DECIMAL(6,2),                  -- for hourly staff
  gross_pay         DECIMAL(10,2) NOT NULL,
  overtime_pay      DECIMAL(10,2) DEFAULT 0,
  advance_deduction DECIMAL(10,2) DEFAULT 0,
  other_deductions  DECIMAL(10,2) DEFAULT 0,
  net_pay           DECIMAL(10,2) NOT NULL,
  status            VARCHAR(20) DEFAULT 'DRAFT',   -- DRAFT | APPROVED | PAID
  processed_by      UUID REFERENCES users(id),
  processed_at      TIMESTAMPTZ,
  payslip_url       VARCHAR(500)                   -- S3 URL to PDF payslip
)
```

### Vendors

```sql
vendors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  category         VARCHAR(50),        -- FOOD | BEVERAGE | BAR | UTILITY | SERVICE | PROPERTY
  sub_category     VARCHAR(50),        -- Vegetables | Chicken | Electricity | Gas...
  contact_person   VARCHAR(100),
  mobile           VARCHAR(20),
  email            VARCHAR(255),
  address          TEXT,
  vat_number       VARCHAR(50),        -- UK VAT number
  payment_type     VARCHAR(20),        -- CASH | CREDIT
  payment_frequency VARCHAR(20),       -- WEEKLY | MONTHLY | QUARTERLY
  credit_days      INT DEFAULT 0,
  bank_account_no  VARCHAR(20),
  bank_sort_code   VARCHAR(10),
  rating           DECIMAL(2,1) DEFAULT 5.0,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
)

vendor_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID REFERENCES vendors(id),
  item_id         UUID REFERENCES items(id),
  price_per_unit  DECIMAL(10,2) NOT NULL,
  last_updated    DATE NOT NULL,
  is_preferred    BOOLEAN DEFAULT false,
  notes           TEXT
)

vendor_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID REFERENCES vendors(id),
  invoice_number  VARCHAR(100),
  invoice_date    DATE,
  due_date        DATE,
  paid_date       DATE,
  gross_amount    DECIMAL(10,2),
  vat_amount      DECIMAL(10,2) DEFAULT 0,
  net_amount      DECIMAL(10,2),
  payment_method  VARCHAR(50),          -- CASH | BANK_TRANSFER | CARD
  receipt_url     VARCHAR(500),         -- S3 URL
  status          VARCHAR(20),          -- PENDING | PAID | OVERDUE
  created_by      UUID REFERENCES users(id)
)
```

### Inventory

```sql
items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,
  category         VARCHAR(50),          -- Vegetables | Meat | Dairy | Spices...
  unit             VARCHAR(20),          -- kg | litre | piece | pack
  current_stock    DECIMAL(10,3) DEFAULT 0,
  min_stock_level  DECIMAL(10,3),
  max_stock_level  DECIMAL(10,3),
  cost_price       DECIMAL(10,2),
  average_cost     DECIMAL(10,2),        -- weighted average, recalculated on each purchase
  is_active        BOOLEAN DEFAULT true
)

stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         UUID REFERENCES items(id),
  movement_type   VARCHAR(20),           -- PURCHASE_IN | CONSUMPTION | WASTE | RETURN | ADJUSTMENT
  quantity        DECIMAL(10,3) NOT NULL, -- positive = in, negative = out
  unit_cost       DECIMAL(10,2),
  reference_id    UUID,                  -- po_id or recipe_log_id
  reference_type  VARCHAR(30),           -- PURCHASE_ORDER | RECIPE | MANUAL
  notes           TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

### Kitchen Indent & Purchase Orders

```sql
kitchen_indents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID REFERENCES employees(id),   -- kitchen manager
  date          DATE NOT NULL,
  status        VARCHAR(20) DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
  approved_by   UUID REFERENCES employees(id),
  approved_at   TIMESTAMPTZ,
  notes         TEXT
)

indent_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id         UUID REFERENCES kitchen_indents(id),
  item_id           UUID REFERENCES items(id),
  current_stock     DECIMAL(10,3),               -- snapshot at time of indent
  required_quantity DECIMAL(10,3) NOT NULL,
  approved_quantity DECIMAL(10,3),
  notes             TEXT
)

purchase_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id       UUID REFERENCES vendors(id),
  indent_id       UUID REFERENCES kitchen_indents(id),
  po_number       VARCHAR(50) UNIQUE,             -- PO-2024-001
  status          VARCHAR(20) DEFAULT 'DRAFT',    -- DRAFT | SENT | RECEIVED | PARTIAL
  total_amount    DECIMAL(10,2),
  created_by      UUID REFERENCES users(id),
  sent_at         TIMESTAMPTZ,
  expected_delivery DATE,
  pdf_url         VARCHAR(500)
)

po_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           UUID REFERENCES purchase_orders(id),
  item_id         UUID REFERENCES items(id),
  ordered_qty     DECIMAL(10,3),
  received_qty    DECIMAL(10,3) DEFAULT 0,
  unit_price      DECIMAL(10,2),
  line_total      DECIMAL(10,2)
)
```

### Sales & Cash

```sql
daily_sales (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date             DATE UNIQUE NOT NULL,
  -- Channel breakdown
  dine_in_cash     DECIMAL(10,2) DEFAULT 0,
  dine_in_card     DECIMAL(10,2) DEFAULT 0,
  takeaway_cash    DECIMAL(10,2) DEFAULT 0,
  takeaway_card    DECIMAL(10,2) DEFAULT 0,
  deliveroo_gross  DECIMAL(10,2) DEFAULT 0,
  deliveroo_comm   DECIMAL(10,2) DEFAULT 0,       -- commission (negative)
  ubereats_gross   DECIMAL(10,2) DEFAULT 0,
  ubereats_comm    DECIMAL(10,2) DEFAULT 0,
  justeat_gross    DECIMAL(10,2) DEFAULT 0,
  justeat_comm     DECIMAL(10,2) DEFAULT 0,
  foodhub_gross    DECIMAL(10,2) DEFAULT 0,
  foodhub_comm     DECIMAL(10,2) DEFAULT 0,
  total_gross      DECIMAL(10,2),                 -- sum of all gross
  total_commission DECIMAL(10,2),                 -- sum of all commissions
  total_net        DECIMAL(10,2),                 -- gross - commission
  entered_by       UUID REFERENCES users(id)
)

cash_register (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date           DATE UNIQUE NOT NULL,
  opening_cash   DECIMAL(10,2) NOT NULL,
  cash_sales     DECIMAL(10,2) DEFAULT 0,         -- from daily_sales
  petty_expenses DECIMAL(10,2) DEFAULT 0,         -- from petty_cash
  closing_cash   DECIMAL(10,2),                   -- calculated: opening + sales - expenses
  variance       DECIMAL(10,2),                   -- actual physical count vs calculated
  notes          TEXT
)

petty_cash (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE NOT NULL,
  description  VARCHAR(200) NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,
  category     VARCHAR(50),
  receipt_url  VARCHAR(500),
  entered_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW()
)
```

### Documents

```sql
documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type  VARCHAR(50),    -- EMPLOYEE_DOC | VENDOR_CONTRACT | LICENSE | UTILITY_BILL | PAYROLL...
  title          VARCHAR(200) NOT NULL,
  description    TEXT,
  file_url       VARCHAR(500),   -- S3 URL
  file_size      INT,
  mime_type      VARCHAR(100),
  related_entity_type VARCHAR(50),  -- 'employee' | 'vendor' | 'system'
  related_entity_id   UUID,
  expiry_date    DATE,              -- for contracts, licenses
  is_active      BOOLEAN DEFAULT true,
  uploaded_by    UUID REFERENCES users(id),
  uploaded_at    TIMESTAMPTZ DEFAULT NOW()
)
```

### Recipe Costing (Build Schema in Phase 1, UI in Phase 2)

```sql
recipes (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(100) NOT NULL,    -- 'Chicken Biryani'
  category         VARCHAR(50),              -- 'Main Course' | 'Starter' | 'Dessert'
  servings_default INT NOT NULL,             -- recipe is for how many portions
  selling_price    DECIMAL(10,2),
  calculated_cost  DECIMAL(10,2),           -- auto-calculated, updated when vendor prices change
  profit_margin    DECIMAL(5,2),            -- auto-calculated
  is_active        BOOLEAN DEFAULT true
)

recipe_ingredients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   UUID REFERENCES recipes(id),
  item_id     UUID REFERENCES items(id),
  quantity    DECIMAL(10,3) NOT NULL,
  unit        VARCHAR(20) NOT NULL
)
```

---

## 6. Roadmap

> **Reading guide**: Each phase shows: What to Build → How to Build (real code/technique) → How to Test → Definition of Done

---

### Phase 0 — Project Foundation (Week 1–2)

**What to Build**
- Monorepo structure (frontend + backend in one repo)
- Docker Compose for local development
- CI/CD pipeline (auto-test on PR, auto-deploy on merge)
- Environment configuration
- Database initial setup + Alembic

**Folder Structure**
```
nirai-erp/
├── frontend/
│   ├── app/                    ← Next.js App Router
│   ├── components/
│   │   ├── ui/                 ← shadcn/ui components
│   │   └── modules/            ← feature-specific components
│   ├── lib/
│   │   ├── api.ts              ← API client
│   │   └── auth.ts             ← auth helpers
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── core/
│   │   │   ├── config.py       ← env vars (pydantic settings)
│   │   │   ├── database.py     ← SQLAlchemy async engine
│   │   │   └── security.py     ← JWT, password hashing
│   │   ├── auth/
│   │   ├── employees/
│   │   ├── attendance/
│   │   ├── payroll/
│   │   ├── vendors/
│   │   ├── inventory/
│   │   ├── sales/
│   │   └── reports/
│   ├── alembic/
│   │   ├── versions/           ← migration files
│   │   └── env.py
│   ├── tests/
│   ├── main.py
│   ├── Dockerfile
│   └── requirements.txt
│
├── docker-compose.yml          ← local dev
├── .github/
│   └── workflows/
│       ├── test.yml            ← run tests on every PR
│       └── deploy.yml          ← deploy on merge to main
└── README.md
```

**How to Build — Docker Compose**
```yaml
# docker-compose.yml
version: "3.9"
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql+asyncpg://postgres:pass@db:5432/nirai
      REDIS_URL: redis://redis:6379
      SECRET_KEY: your-secret-key
    depends_on: [db, redis]
    volumes:
      - ./backend:/app         # hot reload in dev

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000

  db:
    image: postgres:16
    environment:
      POSTGRES_DB: nirai
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine

volumes:
  postgres_data:
```

**How to Test — Phase 0**
```bash
# Verify the whole stack starts
docker compose up --build
curl http://localhost:8000/health  # should return {"status": "ok"}
curl http://localhost:3000          # should return HTML page

# Verify migrations work
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current  # should show latest revision
```

**Done When**: `docker compose up` starts everything, health endpoint works, first migration runs cleanly.

---

### Phase 1 — Auth & User Management (Week 2–4)

**What to Build**
- Login / Logout
- JWT token generation and validation
- Role-based permission guards
- User CRUD (admin creates users, assigns roles)
- Protected route middleware on frontend

**How to Build — Backend (FastAPI)**

```python
# backend/app/core/security.py
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext

SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8 hours (full shift)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

```python
# backend/app/core/rbac.py
from functools import wraps
from fastapi import Depends, HTTPException

# Permission matrix — what each role can do
PERMISSIONS = {
    "SUPER_ADMIN":      ["*"],          # everything
    "MANAGER":          ["attendance:write", "payroll:read", "vendor:write", "inventory:write", "reports:read"],
    "KITCHEN_MANAGER":  ["inventory:read", "indent:write", "stock:read"],
    "ACCOUNTANT":       ["payroll:write", "vendor_payment:write", "reports:read"],
    "CASHIER":          ["sales:write", "cash:write"],
    "STAFF":            ["attendance:self", "payroll:self"],
}

def require_permission(permission: str):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, user=Depends(get_current_user), **kwargs):
            role_perms = PERMISSIONS.get(user.role, [])
            if "*" not in role_perms and permission not in role_perms:
                raise HTTPException(403, f"Role {user.role} cannot {permission}")
            return await func(*args, user=user, **kwargs)
        return wrapper
    return decorator

# Usage in a route:
@router.get("/reports/monthly")
@require_permission("reports:read")
async def get_monthly_report(user=Depends(get_current_user)):
    ...
```

**How to Build — Frontend (Next.js)**

```typescript
// frontend/lib/auth.ts
export const ROLE_ROUTES = {
  SUPER_ADMIN:      ["/dashboard", "/staff", "/payroll", "/vendors", "/inventory", "/sales", "/reports", "/settings"],
  MANAGER:          ["/dashboard", "/staff", "/payroll", "/vendors", "/inventory", "/reports"],
  KITCHEN_MANAGER:  ["/dashboard", "/inventory", "/indent"],
  ACCOUNTANT:       ["/dashboard", "/payroll", "/vendors", "/reports"],
  CASHIER:          ["/dashboard", "/sales"],
  STAFF:            ["/dashboard/my-attendance", "/dashboard/my-payslip"],
}

// middleware.ts — runs on every request
export function middleware(request: NextRequest) {
  const token = request.cookies.get("token")?.value
  const { role } = decodeJWT(token)
  const allowedRoutes = ROLE_ROUTES[role] || []
  
  if (!allowedRoutes.some(r => request.nextUrl.pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/unauthorized", request.url))
  }
}
```

**How to Test — Phase 1**

```python
# backend/tests/test_auth.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    response = await client.post("/api/auth/login", json={
        "email": "admin@nirai.com",
        "password": "correct_password"
    })
    assert response.status_code == 200
    assert "access_token" in response.json()

@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    response = await client.post("/api/auth/login", json={
        "email": "admin@nirai.com",
        "password": "wrong_password"
    })
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_kitchen_manager_cannot_see_reports(client: AsyncClient, kitchen_manager_token: str):
    response = await client.get(
        "/api/reports/monthly",
        headers={"Authorization": f"Bearer {kitchen_manager_token}"}
    )
    assert response.status_code == 403  # Forbidden

@pytest.mark.asyncio
async def test_super_admin_can_see_reports(client: AsyncClient, admin_token: str):
    response = await client.get(
        "/api/reports/monthly",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_staff_can_only_see_own_payslip(client: AsyncClient, staff_token: str, other_employee_id: str):
    # Staff cannot see another employee's payslip
    response = await client.get(
        f"/api/payroll/payslip/{other_employee_id}/2024-01",
        headers={"Authorization": f"Bearer {staff_token}"}
    )
    assert response.status_code == 403
```

**Done When**: All 6 roles can log in, each role is blocked from routes they shouldn't access, token expires after 8 hours.

---

### Phase 2 — Employee Master & Attendance (Week 4–7)

**What to Build**
- Employee CRUD with all UK-required fields
- Attendance punch system (in / out / break)
- Daily, weekly, monthly attendance views
- Missing punch alerts
- Visa expiry alerts

**How to Build — Attendance Logic**

```python
# backend/app/attendance/service.py

async def punch(employee_id: UUID, punch_type: str, db: AsyncSession):
    today = datetime.date.today()
    record = await get_attendance_today(employee_id, today, db)

    match punch_type:
        case "CLOCK_IN":
            if record and record.clock_in:
                raise HTTPException(400, "Already clocked in today")
            record = Attendance(
                employee_id=employee_id,
                date=today,
                clock_in=datetime.now(),
                status="PRESENT"
            )
            db.add(record)

        case "BREAK_START":
            if not record or not record.clock_in:
                raise HTTPException(400, "Must clock in first")
            record.break_start = datetime.now()

        case "BREAK_END":
            if not record.break_start:
                raise HTTPException(400, "Break not started")
            break_duration = (datetime.now() - record.break_start).seconds // 60
            record.break_minutes = (record.break_minutes or 0) + break_duration
            record.break_start = None

        case "CLOCK_OUT":
            if not record or not record.clock_in:
                raise HTTPException(400, "Not clocked in")
            record.clock_out = datetime.now()
            # Calculate working hours: (out - in) minus break time
            total_seconds = (record.clock_out - record.clock_in).seconds
            break_seconds = (record.break_minutes or 0) * 60
            record.working_hours = round((total_seconds - break_seconds) / 3600, 2)

    await db.commit()
    return record
```

**How to Build — Visa Expiry Alert (Celery Scheduled Task)**

```python
# backend/app/employees/tasks.py
from celery import shared_task
from datetime import date, timedelta

@shared_task
def check_visa_expiry_alerts():
    """Runs every day at 9am. Checks all employees for upcoming visa expiry."""
    thresholds = [60, 30, 7]  # days before expiry

    for days in thresholds:
        alert_date = date.today() + timedelta(days=days)
        employees = get_employees_with_visa_expiry(alert_date)

        for emp in employees:
            send_email(
                to="manager@nirai.com",
                subject=f"⚠️ Visa Expiry Alert — {emp.full_name}",
                body=f"{emp.full_name}'s visa expires in {days} days ({emp.visa_expiry_date}). Please take action immediately."
            )
```

**How to Test — Phase 2**

```python
# backend/tests/test_attendance.py

def test_clock_in_success():
    emp = create_test_employee()
    result = punch(emp.id, "CLOCK_IN")
    assert result.clock_in is not None
    assert result.status == "PRESENT"

def test_cannot_clock_in_twice():
    emp = create_test_employee()
    punch(emp.id, "CLOCK_IN")
    with pytest.raises(HTTPException) as exc:
        punch(emp.id, "CLOCK_IN")
    assert exc.value.status_code == 400

def test_working_hours_calculation():
    emp = create_test_employee()
    # Simulate: clocked in 9am, break 30 mins, clocked out 5pm
    clock_in_time = datetime(2024, 1, 15, 9, 0, 0)
    clock_out_time = datetime(2024, 1, 15, 17, 0, 0)
    break_minutes = 30

    working_hours = calculate_working_hours(clock_in_time, clock_out_time, break_minutes)
    assert working_hours == 7.5   # 8 hours - 30 mins break

def test_break_start_without_clock_in_fails():
    emp = create_test_employee()
    with pytest.raises(HTTPException):
        punch(emp.id, "BREAK_START")

def test_missing_punch_report():
    # Employee clocked in but never clocked out
    emp = create_test_employee()
    create_attendance(emp.id, date=date.today(), clock_in=datetime.now(), clock_out=None)

    missing = get_missing_punch_employees(date.today())
    assert emp.id in [e.id for e in missing]
```

**Done When**: Staff can punch on their phone/tablet, manager sees live attendance dashboard, visa expiry alerts fire correctly.

---

### Phase 3 — Payroll Engine (Week 7–9)

**What to Build**
- Monthly salary calculation (with absent deductions, advances, overtime)
- Hourly salary calculation (weekly)
- UK minimum wage validation
- Payslip PDF generation
- Payroll approval workflow

**How to Build — Salary Calculation**

```python
# backend/app/payroll/calculator.py

def calculate_monthly_payroll(employee: Employee, month: str, db) -> PayrollResult:
    """
    month: "2024-01" format
    """
    attendance_records = get_month_attendance(employee.id, month, db)
    working_days = get_working_days_in_month(month)  # e.g., 26 days
    advances = get_pending_advances(employee.id, month, db)

    days_present = sum(1 for a in attendance_records if a.status == "PRESENT")
    half_days    = sum(1 for a in attendance_records if a.status == "HALF_DAY")
    overtime_hrs = sum(max(0, a.working_hours - 8) for a in attendance_records)

    daily_rate  = employee.monthly_salary / working_days
    base_pay    = days_present * daily_rate
    half_deduct = half_days * (daily_rate / 2)
    overtime    = overtime_hrs * (daily_rate / 8) * 1.5   # 1.5x for overtime
    advance_ded = sum(a.amount for a in advances)

    gross = base_pay + overtime
    net   = gross - half_deduct - advance_ded

    return PayrollResult(
        employee_id=employee.id,
        pay_period=month,
        days_present=days_present,
        half_days=half_days,
        gross_pay=round(gross, 2),
        overtime_pay=round(overtime, 2),
        advance_deduction=round(advance_ded, 2),
        net_pay=round(net, 2)
    )

def calculate_hourly_payroll(employee: Employee, week: str, db) -> PayrollResult:
    """
    week: "2024-W03" format
    UK minimum wage check: £11.44/hour (2024)
    """
    MIN_WAGE_UK = 11.44  # update annually

    if employee.hourly_rate < MIN_WAGE_UK:
        raise ValueError(f"Hourly rate £{employee.hourly_rate} is below UK minimum wage £{MIN_WAGE_UK}")

    attendance_records = get_week_attendance(employee.id, week, db)
    total_hours = sum(a.working_hours for a in attendance_records)
    net_pay = total_hours * employee.hourly_rate

    return PayrollResult(
        employee_id=employee.id,
        pay_period=week,
        total_hours=total_hours,
        gross_pay=round(net_pay, 2),
        net_pay=round(net_pay, 2)
    )
```

**How to Build — Payslip PDF**

```python
# backend/app/payroll/payslip.py
from weasyprint import HTML
from jinja2 import Template

PAYSLIP_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial; margin: 40px; }
    .header { background: #1a1a1a; color: white; padding: 20px; }
    .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    .total { font-weight: bold; font-size: 1.2em; }
  </style>
</head>
<body>
  <div class="header">
    <h1>NIRAI Restaurant</h1>
    <p>Pay Slip — {{ month }}</p>
  </div>
  <h2>{{ employee.full_name }}</h2>
  <p>Employee ID: {{ employee.employee_code }} | Role: {{ employee.role }}</p>
  <div class="row"><span>Gross Pay</span><span>£{{ payroll.gross_pay }}</span></div>
  <div class="row"><span>Overtime</span><span>£{{ payroll.overtime_pay }}</span></div>
  <div class="row"><span>Advance Deduction</span><span>-£{{ payroll.advance_deduction }}</span></div>
  <div class="row total"><span>NET PAY</span><span>£{{ payroll.net_pay }}</span></div>
  <p>NI Number: {{ employee.ni_number }}</p>
</body>
</html>
"""

def generate_payslip_pdf(employee, payroll) -> bytes:
    html = Template(PAYSLIP_TEMPLATE).render(
        employee=employee,
        payroll=payroll,
        month=payroll.pay_period
    )
    return HTML(string=html).write_pdf()
```

**How to Test — Phase 3**

```python
# backend/tests/test_payroll.py

def test_full_month_salary():
    emp = create_employee(monthly_salary=30000, salary_type="MONTHLY")
    attendance = [create_attendance(status="PRESENT") for _ in range(26)]
    result = calculate_monthly_payroll(emp, "2024-01")
    assert result.gross_pay == 30000
    assert result.net_pay == 30000

def test_absent_deduction():
    emp = create_employee(monthly_salary=26000, salary_type="MONTHLY")
    # 26 working days, 2 absent
    attendance = [create_attendance(status="PRESENT") for _ in range(24)]
    result = calculate_monthly_payroll(emp, "2024-01")
    daily_rate = 26000 / 26  # = £1000/day
    assert result.gross_pay == 24 * daily_rate  # £24,000
    assert result.net_pay == 24 * daily_rate

def test_advance_deduction():
    emp = create_employee(monthly_salary=30000, salary_type="MONTHLY")
    attendance = [create_attendance(status="PRESENT") for _ in range(26)]
    create_advance(employee=emp, amount=5000, deduct_month="2024-01")
    result = calculate_monthly_payroll(emp, "2024-01")
    assert result.advance_deduction == 5000
    assert result.net_pay == 25000

def test_hourly_below_minimum_wage_raises():
    emp = create_employee(salary_type="HOURLY", hourly_rate=10.00)  # below £11.44
    with pytest.raises(ValueError, match="below UK minimum wage"):
        calculate_hourly_payroll(emp, "2024-W03")

def test_hourly_pay_calculation():
    emp = create_employee(salary_type="HOURLY", hourly_rate=12.00)
    attendance = [create_attendance(working_hours=8) for _ in range(5)]  # 40 hours
    result = calculate_hourly_payroll(emp, "2024-W03")
    assert result.total_hours == 40
    assert result.net_pay == 480.00  # 40 × £12

def test_payslip_pdf_generates():
    emp = create_employee()
    payroll = create_payroll_record(emp)
    pdf_bytes = generate_payslip_pdf(emp, payroll)
    assert len(pdf_bytes) > 0
    assert pdf_bytes[:4] == b'%PDF'  # valid PDF magic bytes
```

**Done When**: Admin clicks "Process Payroll" for a month → system calculates all employees → generates payslip PDFs → saves to S3.

---

### Phase 4 — Vendor Management (Week 9–11)

**What to Build**
- Vendor CRUD (all categories including Bar, Utility, Property)
- Vendor item pricing
- Payment tracking with VAT support
- Overdue payment alerts
- Document upload per vendor (contracts, invoices)

**How to Build — Price Comparison Engine**

```python
# backend/app/vendors/service.py

async def compare_vendor_prices(item_id: UUID, db: AsyncSession):
    """Returns all vendor prices for an item, sorted cheapest first."""
    prices = await db.execute(
        select(VendorItem, Vendor)
        .join(Vendor)
        .where(VendorItem.item_id == item_id)
        .where(Vendor.is_active == True)
        .order_by(VendorItem.price_per_unit.asc())
    )
    results = prices.fetchall()

    if not results:
        return {"message": "No vendors supply this item yet"}

    price_list = [
        {
            "vendor_id": r.Vendor.id,
            "vendor_name": r.Vendor.name,
            "price_per_unit": r.VendorItem.price_per_unit,
            "last_updated": r.VendorItem.last_updated,
            "is_preferred": r.VendorItem.is_preferred,
        }
        for r in results
    ]

    cheapest = price_list[0]
    most_expensive = price_list[-1]
    potential_saving = (most_expensive["price_per_unit"] - cheapest["price_per_unit"])

    return {
        "item_id": item_id,
        "comparisons": price_list,
        "cheapest_vendor": cheapest,
        "potential_saving_per_unit": round(potential_saving, 2),
    }
```

**How to Test — Phase 4**

```python
def test_vendor_price_comparison():
    item = create_item(name="Chicken Breast")
    vendor_a = create_vendor(name="Al-Halal")
    vendor_b = create_vendor(name="Leicester Foods")
    vendor_c = create_vendor(name="Local Market")
    
    create_vendor_price(vendor_a, item, price=7.50)
    create_vendor_price(vendor_b, item, price=8.20)
    create_vendor_price(vendor_c, item, price=8.50)

    result = compare_vendor_prices(item.id)
    
    assert result["cheapest_vendor"]["vendor_name"] == "Al-Halal"
    assert result["comparisons"][0]["price_per_unit"] == 7.50   # sorted asc
    assert result["potential_saving_per_unit"] == 1.00           # 8.50 - 7.50

def test_overdue_payment_alert():
    vendor = create_vendor(name="Fish Market")
    # Invoice due yesterday, not paid
    create_vendor_payment(vendor, due_date=date.today() - timedelta(days=1), status="PENDING")
    
    overdue = get_overdue_payments()
    assert len(overdue) == 1
    assert overdue[0].vendor.name == "Fish Market"

def test_vat_amount_stored_correctly():
    vendor = create_vendor(vat_number="GB123456789")
    payment = create_vendor_payment(vendor, gross_amount=120.00, vat_amount=20.00)
    
    assert payment.net_amount == 100.00
    assert payment.vat_amount == 20.00
```

**Done When**: Manager can compare chicken prices across 5 vendors in 1 click. Overdue payment alerts fire on due date.

---

### Phase 5 — Inventory Management (Week 11–14)

**What to Build**
- Item master CRUD (bulk import from Excel)
- Stock movement recording (IN/OUT/WASTE/RETURN)
- Average cost calculation (weighted average)
- Low stock and max stock alerts
- Current stock dashboard

**How to Build — Weighted Average Cost**

When you buy the same item from different vendors at different prices, the average cost keeps changing. This is the accounting standard:

```python
def update_average_cost(item: Item, new_qty: float, new_unit_cost: float) -> float:
    """
    Weighted Average Cost formula:
    new_avg = (existing_stock × existing_avg + new_qty × new_price) / (existing + new)
    """
    existing_value = item.current_stock * (item.average_cost or 0)
    new_value = new_qty * new_unit_cost
    total_qty = item.current_stock + new_qty

    if total_qty == 0:
        return new_unit_cost
    
    return round((existing_value + new_value) / total_qty, 4)

async def receive_stock(po_item: POItem, db: AsyncSession):
    """Called when vendor delivers goods."""
    item = await get_item(po_item.item_id, db)
    
    # Update average cost
    item.average_cost = update_average_cost(item, po_item.received_qty, po_item.unit_price)
    item.current_stock += po_item.received_qty
    
    # Record the movement
    movement = StockMovement(
        item_id=item.id,
        movement_type="PURCHASE_IN",
        quantity=po_item.received_qty,
        unit_cost=po_item.unit_price,
        reference_id=po_item.po_id,
        reference_type="PURCHASE_ORDER"
    )
    db.add(movement)
    await db.commit()
```

**How to Test — Phase 5**

```python
def test_stock_increases_on_purchase():
    item = create_item(name="Basmati Rice", current_stock=10.0)
    receive_stock_for_item(item, qty=20.0, unit_cost=5.00)
    
    updated = get_item(item.id)
    assert updated.current_stock == 30.0

def test_weighted_average_cost():
    item = create_item(current_stock=10.0, average_cost=5.00)
    # Buy 10 more kg at £6/kg
    new_avg = update_average_cost(item, new_qty=10.0, new_unit_cost=6.00)
    
    # (10 × 5 + 10 × 6) / 20 = 5.50
    assert new_avg == 5.50

def test_low_stock_alert_triggered():
    item = create_item(name="Saffron", current_stock=50.0, min_stock_level=100.0)
    
    alerts = get_low_stock_alerts()
    assert any(a.item_id == item.id for a in alerts)

def test_stock_does_not_go_negative():
    item = create_item(current_stock=2.0)
    with pytest.raises(ValueError, match="Insufficient stock"):
        deduct_stock(item.id, quantity=5.0)  # trying to take more than available
```

**Done When**: Every stock movement is recorded. Manager can see "Current Stock" dashboard with red/yellow/green levels.

---

### Phase 6 — Kitchen Indent & Purchase Orders (Week 14–16)

**What to Build**
- Indent form (kitchen manager creates, restaurant manager approves)
- Auto-suggest required quantity (current stock vs min level)
- PO generation grouped by vendor
- PDF export of PO
- WhatsApp/Email send to vendor

**How to Build — PO to WhatsApp**

```python
# backend/app/purchase_orders/service.py
from twilio.rest import Client

async def send_po_to_vendor_whatsapp(po_id: UUID, db: AsyncSession):
    po = await get_po_with_items(po_id, db)
    vendor = await get_vendor(po.vendor_id, db)

    # Build message text
    items_text = "\n".join([
        f"• {item.item.name}: {item.ordered_qty} {item.item.unit}"
        for item in po.items
    ])

    message = f"""
🛒 *Purchase Order from NIRAI Restaurant*

PO Number: {po.po_number}
Date: {date.today().strftime('%d %b %Y')}

*Items Required:*
{items_text}

Please confirm delivery date.
Thank you — NIRAI Restaurant
"""

    client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    client.messages.create(
        from_="whatsapp:+14155238886",       # Twilio WhatsApp sandbox
        to=f"whatsapp:{vendor.mobile}",
        body=message
    )

    po.status = "SENT"
    po.sent_at = datetime.now()
    await db.commit()
```

**How to Test — Phase 6**

```python
def test_indent_creates_po_for_deficit_items():
    # Setup: Rice stock is 5kg, indent wants 20kg
    rice = create_item(name="Basmati Rice", current_stock=5.0)
    create_indent_item(rice, required_qty=20.0)
    
    # When indent is approved
    po_list = generate_purchase_orders_from_indent(indent_id)
    
    # PO should be created for 15kg (20 needed - 5 in stock)
    rice_po = next(p for po in po_list for p in po.items if p.item_id == rice.id)
    assert rice_po.ordered_qty == 15.0

def test_pos_grouped_by_vendor():
    veg_vendor = create_vendor(name="Veg Supplier")
    chicken_vendor = create_vendor(name="Chicken Supplier")
    
    tomato = create_item_with_preferred_vendor(veg_vendor)
    chicken = create_item_with_preferred_vendor(chicken_vendor)
    
    indent = create_indent([tomato, chicken])
    pos = generate_purchase_orders_from_indent(indent.id)
    
    assert len(pos) == 2  # one PO per vendor
    assert any(po.vendor_id == veg_vendor.id for po in pos)
    assert any(po.vendor_id == chicken_vendor.id for po in pos)

def test_po_pdf_generates():
    po = create_purchase_order()
    pdf = generate_po_pdf(po)
    assert pdf[:4] == b'%PDF'
    assert po.po_number.encode() in pdf   # PO number is in the PDF
```

**Done When**: Chef creates indent on tablet → manager approves → system generates vendor-specific POs → sends to vendors via WhatsApp in under 2 minutes.

---

### Phase 7 — Daily Sales & Cash Management (Week 16–18)

**What to Build**
- Multi-channel sales entry (Dine-in, Takeaway, Deliveroo, Uber Eats, Just Eat, FoodHub)
- Commission deduction per channel
- Cash register (opening → closing with reconciliation)
- Petty cash tracking

**How to Build — Cash Reconciliation**

```python
# backend/app/sales/service.py

async def close_daily_cash(date: datetime.date, actual_closing_cash: float, db: AsyncSession):
    """
    Called at end of day. Compares calculated closing cash vs physical count.
    Variance alerts manager if difference > £5.
    """
    sales = await get_daily_sales(date, db)
    cash_reg = await get_cash_register(date, db)
    petty = await get_petty_cash_total(date, db)

    # Formula: Opening + Cash Sales - Petty Expenses = Expected Closing
    expected_closing = (
        cash_reg.opening_cash
        + sales.dine_in_cash
        + sales.takeaway_cash
        - petty
    )

    variance = actual_closing_cash - expected_closing

    cash_reg.closing_cash = actual_closing_cash
    cash_reg.variance = variance

    if abs(variance) > 5.00:   # £5 tolerance
        await send_alert_to_manager(
            f"⚠️ Cash variance on {date}: Expected £{expected_closing:.2f}, "
            f"Actual £{actual_closing_cash:.2f}, Difference: £{variance:.2f}"
        )

    await db.commit()
    return cash_reg
```

**How to Test — Phase 7**

```python
def test_net_sales_after_deliveroo_commission():
    sales = create_daily_sales(
        deliveroo_gross=500.00,
        deliveroo_comm=175.00    # 35% commission
    )
    assert sales.total_net == sales.total_gross - 175.00

def test_cash_reconciliation_exact():
    create_cash_register(opening_cash=100.00)
    create_daily_sales(dine_in_cash=500.00, takeaway_cash=200.00)
    create_petty_cash_entries(total=50.00)
    
    # Expected: 100 + 500 + 200 - 50 = 750
    result = close_daily_cash(actual_closing_cash=750.00)
    assert result.variance == 0.00

def test_cash_variance_alert_triggered():
    create_cash_register(opening_cash=100.00)
    create_daily_sales(dine_in_cash=500.00)
    
    # Physical count is £10 less than expected
    with assert_alert_sent(contains="Cash variance"):
        close_daily_cash(actual_closing_cash=590.00)  # expected 600, got 590

def test_sales_totals_sum_correctly():
    sales = create_daily_sales(
        dine_in_cash=200, dine_in_card=300,
        deliveroo_gross=500, deliveroo_comm=175,
        ubereats_gross=300, ubereats_comm=90
    )
    expected_gross = 200 + 300 + 500 + 300      # = 1300
    expected_comm  = 175 + 90                    # = 265
    expected_net   = expected_gross - expected_comm  # = 1035

    assert sales.total_gross == expected_gross
    assert sales.total_commission == expected_comm
    assert sales.total_net == expected_net
```

**Done When**: Cashier enters sales for all channels in under 5 minutes. Manager sees closing cash screen with variance highlighted if wrong.

---

### Phase 8 — Reports & Dashboard (Week 18–21)

**What to Build**
- Dashboard with 10 KPIs (from PRD)
- Daily / Weekly / Monthly P&L report
- PDF and Excel export
- Expense breakdown charts

**How to Build — Monthly P&L**

```python
async def generate_monthly_report(month: str, db: AsyncSession) -> MonthlyReport:
    """month: '2024-01'"""
    start_date, end_date = get_month_range(month)

    # Sales
    sales = await get_total_sales_for_period(start_date, end_date, db)

    # Expenses by category
    expenses = await get_expenses_grouped_by_category(start_date, end_date, db)
    # Returns: {"Chicken": 65000, "Vegetables": 28000, "Gas": 35000, ...}

    # Payroll
    payroll_total = await get_payroll_total_for_month(month, db)

    # Fixed costs
    fixed_costs = await get_fixed_expenses(start_date, end_date, db)
    # Returns: {"Rent": 67976, "Electricity": 23000, "Internet": 1507}

    total_expenses = sum(expenses.values()) + payroll_total + sum(fixed_costs.values())
    net_profit = sales.total_net - total_expenses
    profit_margin = (net_profit / sales.total_net * 100) if sales.total_net > 0 else 0

    return MonthlyReport(
        month=month,
        total_sales=sales.total_net,
        total_expenses=total_expenses,
        net_profit=net_profit,
        profit_margin_pct=round(profit_margin, 2),
        expense_breakdown=expenses,
        fixed_costs=fixed_costs,
        payroll=payroll_total,
        raw_material_pct=round(sum(expenses.values()) / sales.total_net * 100, 1)
    )
```

**Dashboard KPIs to implement (from PRD)**

```
1. Today's Sales              → query daily_sales for today
2. Today's Expenses           → query expenses for today
3. Today's Profit             → sales - expenses
4. Current Cash Position      → latest cash_register.closing_cash
5. Low Stock Items            → items where current_stock < min_stock_level
6. Pending Vendor Payments    → vendor_payments where status = PENDING
7. Staff Present Today        → count attendance where date=today and status=PRESENT
8. Weekly Revenue             → sum daily_sales for last 7 days
9. Monthly Revenue            → sum daily_sales for current month
10. Monthly Profit            → monthly revenue - monthly expenses
```

**How to Test — Phase 8**

```python
def test_monthly_report_profit_calculation():
    # Seed: sales = 550000, expenses = 540000
    create_monthly_sales_data(month="2024-04", total=550000)
    create_monthly_expenses_data(month="2024-04", total=540000)
    
    report = generate_monthly_report("2024-04")
    
    assert report.total_sales == 550000
    assert report.total_expenses == 540000
    assert report.net_profit == 10000
    assert report.profit_margin_pct == round(10000 / 550000 * 100, 2)

def test_raw_material_percentage_alert():
    # Raw materials = 70% of sales → should flag
    create_sales(total=100000)
    create_expenses({"Chicken": 40000, "Vegetables": 30000})  # 70%
    
    report = generate_monthly_report("2024-04")
    assert report.raw_material_pct == 70.0
    assert report.alerts  # should have a "high raw material cost" alert

def test_pdf_export_contains_key_data():
    report = generate_monthly_report("2024-04")
    pdf = export_report_pdf(report)
    
    assert b"NIRAI Restaurant" in pdf
    assert b"2024-04" in pdf
    assert str(report.net_profit).encode() in pdf
```

**Done When**: Owner opens dashboard on their phone at 11pm and sees exactly how much money the restaurant made today, this week, this month.

---

### Phase 9 — Document Management & Notifications (Week 21–23)

**What to Build**
- S3 file upload for any document
- Document linked to employee / vendor / system
- Expiry tracking for licenses, contracts
- Full notification system (email + WhatsApp)

**How to Build — S3 Upload**

```python
# backend/app/documents/service.py
import boto3
from uuid import uuid4

s3 = boto3.client("s3", region_name="eu-west-2")  # London region for UK data
BUCKET = "nirai-erp-documents"

async def upload_document(file: UploadFile, entity_type: str, entity_id: UUID, doc_type: str, db) -> Document:
    # Generate unique key
    file_ext = file.filename.split(".")[-1]
    s3_key = f"{entity_type}/{entity_id}/{doc_type}/{uuid4()}.{file_ext}"

    # Upload to S3
    s3.upload_fileobj(
        file.file,
        BUCKET,
        s3_key,
        ExtraArgs={"ContentType": file.content_type}
    )

    file_url = f"https://{BUCKET}.s3.eu-west-2.amazonaws.com/{s3_key}"

    document = Document(
        document_type=doc_type,
        title=file.filename,
        file_url=file_url,
        related_entity_type=entity_type,
        related_entity_id=entity_id,
    )
    db.add(document)
    await db.commit()
    return document
```

**How to Test — Phase 9**

```python
def test_document_upload_saves_to_s3(mock_s3):
    file = create_test_file("contract.pdf", content=b"PDF content")
    result = upload_document(file, entity_type="vendor", entity_id=vendor.id)
    
    assert result.file_url.startswith("https://nirai-erp-documents.s3")
    assert mock_s3.upload_called  # verify S3 was actually called

def test_visa_expiry_alert_fires_30_days_before():
    emp = create_employee(visa_expiry_date=date.today() + timedelta(days=30))
    
    with capture_emails() as emails:
        check_visa_expiry_alerts()
    
    assert len(emails) == 1
    assert emp.full_name in emails[0].body

def test_low_stock_alert_not_fired_when_stock_ok():
    item = create_item(current_stock=100.0, min_stock_level=50.0)
    
    with capture_whatsapp_messages() as messages:
        check_stock_alerts()
    
    assert len(messages) == 0   # no alert when stock is fine
```

---

### Phase 10 — Recipe Costing (Week 23–26)

**What to Build**
- Recipe builder with ingredients from item master
- Auto cost calculation using cheapest vendor prices
- Profit margin per dish
- Alert when vendor price change affects dish margin

**How to Build**

```python
async def calculate_recipe_cost(recipe_id: UUID, db: AsyncSession) -> RecipeCost:
    recipe = await get_recipe_with_ingredients(recipe_id, db)
    
    total_cost = 0.0
    ingredient_costs = []

    for ing in recipe.ingredients:
        # Get cheapest vendor price for this item
        best_price = await get_cheapest_vendor_price(ing.item_id, db)
        cost_for_ingredient = ing.quantity * best_price.price_per_unit
        total_cost += cost_for_ingredient

        ingredient_costs.append({
            "item": ing.item.name,
            "quantity": ing.quantity,
            "unit": ing.unit,
            "unit_price": best_price.price_per_unit,
            "cost": round(cost_for_ingredient, 2),
            "vendor": best_price.vendor.name,
        })

    cost_per_serving = total_cost / recipe.servings_default
    margin_pct = ((recipe.selling_price - cost_per_serving) / recipe.selling_price * 100
                  if recipe.selling_price else 0)

    # Auto-update stored calculated_cost
    recipe.calculated_cost = round(cost_per_serving, 2)
    recipe.profit_margin = round(margin_pct, 2)
    await db.commit()

    return RecipeCost(
        recipe_name=recipe.name,
        servings=recipe.servings_default,
        total_cost=round(total_cost, 2),
        cost_per_serving=round(cost_per_serving, 2),
        selling_price=recipe.selling_price,
        profit_margin_pct=round(margin_pct, 2),
        ingredients=ingredient_costs
    )
```

**How to Test — Phase 10**

```python
def test_biryani_cost_calculation():
    rice  = create_item("Basmati Rice")
    chkn  = create_item("Chicken")
    create_vendor_price(rice, price=5.00)   # £5/kg
    create_vendor_price(chkn, price=8.00)   # £8/kg

    recipe = create_recipe("Chicken Biryani", servings=50, selling_price=15.00)
    add_ingredient(recipe, rice,  qty=5.0)  # 5kg rice
    add_ingredient(recipe, chkn,  qty=4.0)  # 4kg chicken

    result = calculate_recipe_cost(recipe.id)

    assert result.total_cost == (5 * 5.00) + (4 * 8.00)   # 25 + 32 = 57
    assert result.cost_per_serving == round(57 / 50, 2)    # £1.14
    # Margin: (15 - 1.14) / 15 = 92.4%
    assert result.profit_margin_pct == round((15 - 57/50) / 15 * 100, 2)

def test_margin_drops_when_vendor_price_increases():
    # Initial: cost = £1.14/serving, margin = 92%
    setup_biryani_recipe()
    initial = calculate_recipe_cost(biryani.id)
    
    # Vendor increases chicken price
    update_vendor_price(chicken, new_price=12.00)
    updated = calculate_recipe_cost(biryani.id)
    
    assert updated.profit_margin_pct < initial.profit_margin_pct
    assert updated.cost_per_serving > initial.cost_per_serving
```

---

## 7. Testing Strategy

### The Three Levels You Must Have

```
            ╱─ E2E Tests (Playwright) ─╲      ~10-20 tests
           ╱  Full user journeys         ╲     Slow, catch real bugs
          ╱────────────────────────────────╲
         ╱ Integration Tests (pytest+httpx) ╲  ~50-100 tests
        ╱  API → DB together                  ╲  Medium speed
       ╱──────────────────────────────────────╲
      ╱    Unit Tests (pytest)                  ╲  ~200+ tests
     ╱   Pure functions — payroll, cost calc     ╲  Fast (< 1 second each)
    ╱──────────────────────────────────────────────╲
```

### Backend Testing Setup

```python
# backend/tests/conftest.py
import pytest
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from httpx import AsyncClient
from app.main import app

# Use a separate TEST database — never test against production
TEST_DB_URL = "postgresql+asyncpg://postgres:pass@localhost:5432/nirai_test"

@pytest.fixture(scope="session")
def event_loop():
    return asyncio.get_event_loop()

@pytest.fixture(autouse=True)
async def reset_db():
    """Wipe tables before each test — ensures clean state."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield

@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c

@pytest.fixture
async def admin_token(client):
    """Returns a valid admin JWT for use in tests."""
    user = await create_test_user(role="SUPER_ADMIN")
    resp = await client.post("/api/auth/login", json={"email": user.email, "password": "test123"})
    return resp.json()["access_token"]
```

### Key Tests to Prioritise (In Order of Importance)

| Priority | Test | Why |
|----------|------|-----|
| 🔴 Critical | Payroll calculation (all edge cases) | Wrong calculation = paying staff wrong |
| 🔴 Critical | RBAC — each role blocked from wrong endpoints | Security issue if wrong |
| 🔴 Critical | Stock never goes negative | Kitchen runs out without warning |
| 🔴 Critical | Cash reconciliation formula | Money discrepancy |
| 🟡 High | Visa expiry alerts fire correctly | UK legal compliance |
| 🟡 High | UK minimum wage validation | UK legal compliance |
| 🟡 High | Vendor price comparison sorts correctly | Business decision based on this |
| 🟡 High | Recipe cost recalculates when vendor price changes | Core value feature |
| 🟢 Medium | PDF generation produces valid PDF | Documents module |
| 🟢 Medium | WhatsApp message format is correct | Vendor orders |
| 🟢 Medium | S3 upload saves file and returns URL | Document management |

### Frontend Testing Setup

```bash
# Install
npm install --save-dev @testing-library/react jest-environment-jsdom playwright

# Run tests
npm test                     # unit + component tests
npx playwright test          # E2E tests
```

**Example E2E Test (Playwright)**

```typescript
// frontend/tests/e2e/payroll.spec.ts
import { test, expect } from '@playwright/test'

test("admin can process monthly payroll", async ({ page }) => {
  // Login as admin
  await page.goto("/login")
  await page.fill('[name=email]', 'admin@nirai.com')
  await page.fill('[name=password]', 'admin123')
  await page.click('[type=submit]')

  // Navigate to payroll
  await page.goto("/payroll")
  await page.click("text=Process January 2024 Payroll")

  // Should show all employees
  await expect(page.locator('[data-testid=payroll-employee-row]')).toHaveCount(10)

  // Approve all
  await page.click("text=Approve All")
  await page.click("text=Confirm")

  // Should show success
  await expect(page.locator("text=Payroll processed successfully")).toBeVisible()

  // PDF should download
  const download = await page.waitForEvent("download")
  expect(download.suggestedFilename()).toContain("payroll-2024-01")
})

test("cashier cannot access payroll page", async ({ page }) => {
  await loginAs(page, "cashier@nirai.com", "cashier123")
  await page.goto("/payroll")
  
  // Should redirect to unauthorized
  await expect(page).toHaveURL("/unauthorized")
  await expect(page.locator("text=You don't have permission")).toBeVisible()
})
```

---

## 8. CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Suite
on:
  pull_request:           # runs on every PR
  push:
    branches: [main]

jobs:
  backend-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: nirai_test
          POSTGRES_PASSWORD: pass
        ports: ["5432:5432"]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r backend/requirements.txt

      - name: Run migrations on test DB
        run: alembic upgrade head
        working-directory: backend

      - name: Run unit + integration tests
        run: pytest tests/ -v --cov=app --cov-report=xml

      - name: Fail if coverage below 70%
        run: pytest tests/ --cov=app --cov-fail-under=70

  frontend-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
        working-directory: frontend
      - run: npm test -- --watchAll=false
        working-directory: frontend

  e2e-tests:
    runs-on: ubuntu-latest
    needs: [backend-tests, frontend-tests]   # only run E2E if unit tests pass
    steps:
      - uses: actions/checkout@v4
      - run: npx playwright install --with-deps
      - run: npx playwright test

# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    needs: [test suite passes]
    steps:
      - name: Deploy frontend to Vercel
        run: vercel --prod --token=${{ secrets.VERCEL_TOKEN }}

      - name: Deploy backend to Railway
        run: railway up --service backend
```

---

## 9. Definition of Done — Per Phase

Use this to know when a phase is truly complete before moving to the next one.

| Phase | Done When... |
|-------|-------------|
| **0 — Foundation** | `docker compose up` works. Health endpoint returns 200. First migration runs. GitHub Actions runs on PR. |
| **1 — Auth** | All 6 roles can log in. Wrong-role API calls return 403. Token expires after 8 hrs. Frontend redirects unauthorized users. |
| **2 — Attendance** | Staff punches in/out on phone. Working hours auto-calculated including break. Missing punch report shows in manager dashboard. Visa expiry alert fires. |
| **3 — Payroll** | Monthly payroll calculates correctly for all edge cases (absent, half-day, advance, overtime). Hourly payroll calculates weekly. PDF payslip downloads. Below-minimum-wage is blocked. |
| **4 — Vendors** | Vendor CRUD done. Price comparison shows cheapest vendor for any item. Overdue payment alert fires on due date. VAT stored separately. |
| **5 — Inventory** | All 219 items seeded via bulk import. Stock movements recorded. Low/max stock alerts fire. Average cost recalculates on purchase. Stock cannot go negative. |
| **6 — Indent & PO** | Chef submits indent on tablet. Manager approves. PO generated per vendor. PDF exports correctly. WhatsApp message sent to vendor with correct item list. |
| **7 — Sales & Cash** | All 6 channels entered daily. Deliveroo commission deducted correctly. Cash register opens/closes. Variance alert fires if >£5 difference. |
| **8 — Reports** | Monthly P&L matches manually calculated numbers. All 10 dashboard KPIs show live data. PDF export and Excel export work. |
| **9 — Docs & Alerts** | Files upload to S3. Documents searchable and downloadable. All alert types fire correctly. No false positives. |
| **10 — Recipe Costing** | Recipe cost calculates using cheapest vendor. Margin updates when vendor price changes. Owner can see "Biryani costs £1.14 per plate, margin is 92%". |

---

## Final Summary

```
PROJECT:     NIRAI Restaurant ERP
TIMELINE:    ~26 weeks (6.5 months) for all 10 phases
STACK:       Next.js 14 + FastAPI + PostgreSQL (Supabase) + Redis + S3
HOSTING:     Vercel (FE) + Railway → ECS (BE) + Supabase (DB)
TESTING:     pytest (unit+integration) + Playwright (E2E) + GitHub Actions (CI)
UK-SPECIFIC: NI Number, Visa Expiry, Hourly Pay, UK Delivery Apps, VAT, Bank Sort Code

CONFLICT RESOLVED:
  Recipe Costing: Build DB schema + engine in Phase 1 (no extra UI)
                  Show in frontend in Phase 10
                  This gives best of both: core logic early, full UI later
```

---

*Document Version: 2.0*
*Supersedes: RestaurantOS_Project_Plan.md*
*Status: Technical Specification — Ready for Development*
