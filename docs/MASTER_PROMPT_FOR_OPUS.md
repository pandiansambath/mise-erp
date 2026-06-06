# Master Prompt for Claude Opus 4.8
## NIRAI Restaurant ERP — Complete Architecture Review & Planning

---

> **HOW TO USE THIS PROMPT**: Copy everything from the line below this box all the way to the end of the document. Paste it directly into your Claude Opus 4.8 chat. Nothing else needed — all context is self-contained.

---

---

You are a **Senior Software Architect and CTO-level consultant** with deep expertise in:
- Full-stack SaaS product architecture
- Restaurant/hospitality domain ERP systems
- AWS cloud infrastructure (Lambda, ECS, RDS, SQS, S3, API Gateway)
- UK business compliance (payroll law, VAT, visa requirements, food delivery APIs)
- Microservices design, CI/CD pipelines, and production-grade testing strategies
- Cost optimisation for early-stage startups and SaaS products

I need you to do a **complete architectural review and planning session** for a real project we are about to build. I will give you everything: the backstory, the client's problems, the official product requirements, what we've already decided, and the open questions we need you to answer definitively.

**Do not truncate your response. This is a planning session, not a quick Q&A. Be thorough, opinionated, and specific. Use real numbers, real AWS prices, real code patterns where helpful.**

---

## PART 1 — THE STORY (Read This First)

### How This Project Started

I am a Software Development Engineer at Tata Consultancy Services (TCS) in Chennai, India, working on the British Airways cloud platform. I joined TCS in January 2024 and have about 2.5 years of experience. My day-to-day work involves AWS ECS, SQS, DynamoDB, Python, and Java — so I'm not a beginner, but I'm not yet a senior architect either. I'm intermediate level in Python. For frontend I have some experience with Next.js but I lean on AI tools to help.

My senior at TCS has a close friend who owns a restaurant in the UK. The restaurant is called **NIRAI**. It serves South Indian and North Indian cuisine — think Biryani, Dosas, Chettinad dishes, curries. It is in England and deals with UK law, UK delivery apps (Deliveroo, Uber Eats, Just Eat, FoodHub), and UK staff regulations.

### The Restaurant's Real Problems

My senior's friend is bleeding money and doesn't know exactly why. When we dug into his actual business data (he gave us his spreadsheets and monthly reports), here's what we found:

- **July 2023**: Restaurant made a ₹1,31,518 (approximately £1,300) **net loss in one month**. Grocery spending hit ₹1,26,681 — the highest of the year — while sales were dropping. Nobody noticed because there was no automated tracking.
- **Vendor problem**: He buys 219 items across multiple vendors. Nobody compares prices. Chicken from Vendor A might be £8.50/kg while Vendor B offers £7.50/kg. £1 × 100kg/month = £100 wasted. Across all items this adds up to thousands per month.
- **Recipe problem**: Nobody knows the exact cost to make one plate of Biryani. The selling price was set by gut feeling years ago. If Basmati rice price increased 30%, nobody updated the selling price. He might be selling Biryani at a loss.
- **Manual Excel hell**: Attendance register = paper. Payroll = Excel. Vendor orders = WhatsApp messages. Monthly P&L = manually filled Excel. This takes days every month and has errors constantly.
- **Staff compliance risks**: Some kitchen staff are on UK work visas. Nobody is tracking visa expiry dates. If a visa expires and the staff member keeps working, the restaurant owner faces a **£20,000 fine per illegal worker** under UK law. This nearly happened once already.

### What We're Building

My senior asked me and my teammate to build a full ERP system for NIRAI. The goal: one web application that manages the entire restaurant — staff, attendance, payroll, vendors, inventory, kitchen orders, daily sales, reports, documents — from a single dashboard.

### What We've Already Planned

Over two planning sessions (with another AI assistant), we have:
1. Identified all modules
2. Done a gap analysis comparing our ideas vs the official PRD
3. Identified UK-specific requirements that are critical (NI Numbers, Visa tracking, UK delivery app commissions, VAT)
4. Chosen a preliminary tech stack
5. Created a phase-by-phase roadmap with code examples and testing strategies

But we have **major open architectural decisions** we have not settled yet, especially around microservices vs monolith, Lambda vs ECS, cost comparison, and CI/CD design for a multi-service system. That's what we need you for.

---

## PART 2 — THE OFFICIAL CLIENT REQUIREMENTS (Senior's PRD)

This is the exact requirements document my senior gave me. Treat this as the authoritative source of what the client wants.

---

### NIRAI Restaurant ERP & Business Management System

**Project Overview**: Develop a cloud-based Restaurant ERP and Business Management System for NIRAI Restaurant. The application should be mobile-friendly, role-based, and accessible from desktop, tablet, and mobile devices.

The system should help manage:
1. Staff Attendance & Payroll
2. Vendor Management
3. Inventory & Purchase Management
4. Business Accounting & Expense Tracking
5. Daily Sales & Reporting
6. Dashboard & Analytics
7. User & Role Management
8. Document Management

---

#### Module 1 — User Management & Role-Based Access

**Roles:**

**Super Admin (Owner)**
- Full access to all modules
- Create/edit users
- Approve expenses
- View all reports
- Manage payroll
- Vendor approvals

**Restaurant Manager**
- Staff management
- Attendance approval
- Salary processing
- Inventory management
- Vendor payments
- Daily sales reports

**Kitchen Manager**
- Kitchen inventory
- Indent preparation
- Purchase requests
- Stock monitoring

**Staff**
- Login
- Attendance punch
- Break management
- View own attendance
- View own salary records

**Accountant**
- Vendor payments
- Expense management
- Payroll calculations
- Financial reports

---

#### Module 2 — Staff Attendance Management

**Employee Master captures:**
- Employee ID, Name, Mobile Number, Address
- Emergency Contact
- Role, Salary Type (Monthly / Hourly), Hourly Rate, Monthly Salary
- Joining Date, Bank Details
- **NI Number** (National Insurance — UK legal requirement)
- **Visa Expiry Date** (critical for UK compliance)
- Active/Inactive Status

**Attendance System — Employee functions:**
- Clock In, Clock Out, Break Start, Break End
- Total Working Hours = (Clock Out − Clock In) − Break Time
- Daily summary: Present / Half Day / Absent / Overtime

**Reports:** Attendance %, Late Arrivals, Overtime Hours, Missing Punches

---

#### Module 3 — Payroll & Salary Management

**Monthly Salary Staff:**
Salary = Monthly Salary + Overtime − Absent Deductions − Advances − Other Deductions

**Hourly Staff:**
Salary = Total Hours Worked × Hourly Rate

**Features:**
- Weekly Payroll & Monthly Payroll
- Payslip Generation (PDF export)
- Salary History, Employee Advances
- Bonus and Deduction Management

---

#### Module 4 — Vendor Management

**Vendor Categories:**
- Food Vendors: Vegetables, Chicken, Mutton, Fish, Eggs, Rice, Spices
- Beverage Vendors: Soft Drinks, Juices, Water
- Bar Vendors: Wine, Beer, Spirits
- Utility Vendors: Electricity, Gas, Water, Internet
- Service Vendors: Waste Management, Cleaning, Pest Control, Maintenance
- Property Vendors: Rent, Equipment Lease

**Vendor Profile captures:**
- Name, Category, Contact Person, Mobile, Email, Address
- **VAT Number** (UK legal)
- Bank Details (UK Sort Code + Account Number)
- Payment Terms, Payment Frequency (Weekly / Monthly / Quarterly)
- Documents: Contracts, Invoices, Agreements, Certifications

**Payment Tracking:** Invoice number, dates, amounts, payment method, receipt upload
**Alerts:** Due payments, overdue payments

---

#### Module 5 — Inventory Management

**Categories:** Vegetables, Meat, Seafood, Rice, Flour, Spices, Dairy, Beverages, Packaging, Cleaning Supplies

**Item Master:** Name, Category, Unit, Current Stock, Minimum Stock, **Maximum Stock**, Cost Price, **Average Cost**

**Stock Movements:** Purchase In, Kitchen Consumption, Waste, Returns, Adjustments

**Reports:** Current Stock, Low Stock Alert, Stock Valuation, Consumption Report

---

#### Module 6 — Kitchen Indent & Purchase Ordering

**Kitchen Indent:** Daily request by kitchen staff. Fields: Item Name, Current Stock, Required Quantity, Suggested Quantity, Notes. Manager approval required.

**Vendor Mapping:** Each item maps to multiple vendors (e.g., Tomato → Vendor A, B, C)

**Price Comparison Engine:**
- Store last purchase price, current vendor price, historical prices
- Suggest: Cheapest Vendor, Best by Quality Rating, Best by Delivery Performance

**Purchase Order Generation:**
- Separate vendor-wise orders (Vegetable PO, Chicken PO, Egg PO)
- Export: PDF, Excel
- Send via: **WhatsApp, Email**

---

#### Module 7 — Daily Sales & Cash Management

**Sales Channels:**
- Dine-In Sales
- Takeaway Sales
- **Deliveroo Sales**
- **Uber Eats Sales**
- **Just Eat Sales**
- **FoodHub Sales**

**Payment Methods:** Cash, Card, Online, Bank Transfer

**Daily Cash Management:**
Opening Cash + Sales − Expenses = Closing Cash

**Petty Cash Management:** Daily expenses, staff purchases, emergency purchases. Upload receipts.

---

#### Module 8 — Business Expense Management

**Fixed:** Rent, Salaries, Electricity, Gas, Internet, Insurance, Waste Collection

**Variable:** Vegetables, Meat, Seafood, Packaging, Marketing, Repairs

Track Daily / Weekly / Monthly. Upload Bills, Receipts, Invoices.

---

#### Module 9 — Reporting & Analytics

**Daily:** Sales, Expense, Attendance, Cash reports
**Weekly:** Revenue, Profit, Payroll, Vendor Payments, Stock Consumption
**Monthly:** P&L Summary, Sales Trend, Expense Trend, Vendor Analysis, Payroll Analysis, Inventory Cost Analysis

**Dashboard KPIs:**
Today's Sales, Today's Expenses, Today's Profit, Current Cash Position, Low Stock Items, Pending Vendor Payments, Staff Present Today, Weekly Revenue, Monthly Revenue, Monthly Profit

---

#### Module 10 — Document Management

Store and manage: Employee Documents, Vendor Contracts, Rent Agreements, Licenses, Insurance Documents, Utility Bills, Payroll Records, Purchase Orders.
Search and download anytime.

---

#### Module 11 — Notifications & Alerts

Triggers: Staff Missing Punches, Low Stock, Vendor Payment Due, Utility Bill Due, Rent Due, **Visa Expiry**, Employee Contract Expiry

Channels: Email, SMS, WhatsApp

---

#### Technology Recommendation (from Senior's PRD)

- Frontend: Next.js + React + Tailwind CSS
- Backend: Python FastAPI
- Database: PostgreSQL
- Auth: JWT + Role-Based Access
- Storage: AWS S3
- Hosting: AWS ECS/Fargate
- Reporting: PDF Generation, Excel Export
- Integrations: WhatsApp API, Email, Deliveroo, Uber Eats, FoodHub, Accounting Export

---

#### Phase 2 Enhancements (Senior's PRD)

Recipe Costing, Menu Profitability, AI Sales Forecasting, Stock Prediction, QR Attendance, Face Recognition Attendance, Purchase Automation, Multi-Branch Support, Kitchen Display System (KDS), POS Integration, Mobile App (Android & iOS)

---

## PART 3 — WHAT WE HAVE DECIDED SO FAR

### 3.1 Tech Stack (Confirmed)

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Next.js 14 + TypeScript | Developer knows this already |
| UI | Tailwind CSS + shadcn/ui | Fast, production-quality |
| Charts | Recharts + Tremor | Dashboard visuals |
| Forms | React Hook Form + Zod | Validation |
| Backend | Python FastAPI | Client specified it |
| ORM | SQLAlchemy 2.0 (async) + Alembic | Migrations, type safety |
| Auth | Supabase Auth + JWT | Developer knows Supabase |
| Database | PostgreSQL (Supabase) | Developer knows it, generous free tier |
| Cache | Redis (Upstash) | Serverless Redis |
| Storage | AWS S3 | Document storage |
| PDF | WeasyPrint | HTML-to-PDF |
| Email | Resend | Developer-friendly, free tier |
| WhatsApp | Twilio | PO sending to vendors |
| Containers | Docker + Docker Compose | Local dev |
| CI/CD | GitHub Actions | Standard |
| Monitoring | Grafana + Prometheus | Developer has this on CV |

### 3.2 Modules Confirmed (10 modules + 1 conflict)

1. User Management & RBAC (6 roles: Super Admin, Manager, Kitchen Manager, Accountant, Cashier, Staff)
2. Employee Master & Attendance (with UK: NI Number, Visa Expiry, Break tracking)
3. Payroll (Monthly + Hourly + Weekly cycle, UK min wage validation)
4. Vendor Management (all 6 categories, VAT, price comparison engine)
5. Inventory Management (219 items, stock movements, weighted average cost)
6. Kitchen Indent & Purchase Orders (approval workflow, vendor-wise PO, WhatsApp send)
7. Daily Sales & Cash (6 channels with commission deduction, cash reconciliation)
8. Reports & Dashboard (10 KPIs, daily/weekly/monthly P&L)
9. Document Management (S3, linked to employees/vendors, expiry tracking)
10. Notifications & Alerts (email + WhatsApp, visa/stock/payment triggers)

**CONFLICT**: Recipe Costing — PRD says Phase 2. We believe it should be Phase 1 backend logic at minimum, because it is the core value engine of the product. Need your opinion.

### 3.3 UK-Specific Requirements We Identified

- NI Number (National Insurance) mandatory in employee master
- Visa expiry date with 60/30/7 day alerts — UK legal compliance
- UK bank format: Sort Code (XX-XX-XX) + Account Number (8 digits)
- VAT Number on vendors, VAT stored separately on invoices
- Delivery app commissions tracked per channel (Deliveroo ~30-35%, Uber Eats ~30%, Just Eat ~14%, FoodHub ~5%)
- Hourly staff with UK minimum wage validation (£11.44/hour in 2024)
- Weekly payroll option (common in UK hospitality)
- Accounting export (likely Xero CSV format — standard in UK)

### 3.4 Approach We Discussed (But Not Fully Decided)

We talked about starting with a **Modular Monolith** — one FastAPI app with modules — and splitting into microservices when needed. But we haven't made a final decision on:
- Whether to go Lambda for some/all services
- How many services if we split
- Which services should be always-on (ECS) vs event-driven (Lambda)
- Real cost comparison between options
- CI/CD design for a multi-service system

---

## PART 4 — WHAT WE NEED FROM YOU

This is the main ask. Please answer all of the following with full reasoning, real numbers, and concrete recommendations. Don't hedge — give us a definitive decision for each one.

---

### QUESTION 1 — Product Name

Suggest **5 product names** for this restaurant ERP system.

Requirements:
- Should work as a SaaS product name (in case we sell to other restaurants later)
- Must not conflict with existing major products
- Should sound professional and possibly hint at restaurant/operations/efficiency
- Short (1-2 words ideally), memorable, domain-available-feeling
- The restaurant is Indian-origin UK-based, so a name that bridges both worlds is a bonus
- For each name, explain why you chose it and what makes it work

---

### QUESTION 2 — Architecture Decision: Monolith vs Microservices

We need a definitive answer on this.

**Option A: Modular Monolith**
One FastAPI application with 10 internal modules. One deployment, one database.

**Option B: Full Microservices (ECS)**
Each major module = separate FastAPI service in its own ECS task. Shared PostgreSQL with schema-per-service or separate databases. API Gateway routes requests.

**Option C: Hybrid (Monolith core + Lambda for async jobs)**
Main CRUD operations in one ECS service (or modular monolith). Async/scheduled operations (reports, alerts, PDF generation) in Lambda functions triggered by SQS or EventBridge.

**Tell us:**
- Which option is best for this project at this stage?
- If microservices, how many services should we have? What are they?
- Which specific functions/jobs should be Lambda vs always-on containers?
- What is the clear decision point to split from monolith to microservices? (user count? request count? team size?)
- What are the real downsides of each option that we should know before deciding?

---

### QUESTION 3 — Infrastructure Cost Comparison (Real Numbers)

Compare the following hosting options with **real monthly cost estimates** for this project.

Assume: 1 restaurant client, ~5,000 API requests/day, ~10 concurrent users max.

Compare:
1. **AWS Lambda + API Gateway** (fully serverless backend)
2. **AWS ECS Fargate** (containerised, always-on)
3. **Railway.app** (managed container hosting)
4. **Render.com** (managed hosting)
5. **Fly.io** (container hosting)
6. **DigitalOcean App Platform**
7. **Namecheap VPS** (self-managed)

For each, give:
- Estimated monthly cost (in £ or $)
- Cold start issues? (yes/no and impact)
- Scaling behaviour
- Best for which stage (MVP / growth / scale)
- One key risk

Also: For the database separately, compare **Supabase vs AWS RDS vs PlanetScale vs Neon** with real costs.

Give us a **final recommended stack** for:
- Stage 1: 0-1 paying clients (cheapest possible)
- Stage 2: 1-10 paying clients (stable, professional)
- Stage 3: 10-100 clients (SaaS scale)

---

### QUESTION 4 — Microservices Split (If We Go That Route)

If we choose microservices, tell us exactly how to split the 10 modules.

For each proposed service, tell us:
- Service name
- What modules/features it contains
- Technology (FastAPI ECS or Lambda or something else?)
- Own database or shared?
- Communication: REST? SQS message? Event? Direct call?
- Estimated ECS cost per month (if applicable)
- Can it go to zero when not used? (i.e., Lambda-worthy?)

Also: How do you handle **database migrations** in a microservices setup? (This is a common pain point — one service changing a shared schema breaks everything.)

---

### QUESTION 5 — CI/CD Pipeline Design

Design the complete CI/CD pipeline for this project.

Tell us:
- If monolith: what does the GitHub Actions workflow look like? What runs on PR, what runs on merge?
- If microservices: how do you handle multiple services in one repo (monorepo)? Does each service have its own workflow? How do you avoid re-deploying Service A when only Service B changed?
- What is the deployment strategy for zero-downtime? (Blue-green? Rolling? Canary?)
- How do we handle database migrations in the pipeline without downtime?
- What Docker registry do we use? (AWS ECR vs Docker Hub vs GHCR — compare cost and ease)
- What does a complete GitHub Actions workflow YAML look like for this project? (Give us the actual YAML structure)

---

### QUESTION 6 — Testing Strategy for Microservices

If we go microservices, testing becomes harder because services talk to each other. Tell us:

- How do you test a service in isolation when it depends on another service? (Mocking? Contract testing? Stub servers?)
- What is **contract testing** and should we use Pact for this project? Is it worth the setup overhead for a small team?
- For the Price Comparison Engine specifically: what are the top 10 test cases to write?
- For Payroll specifically: what edge cases must be tested? (This is financial — errors cost money)
- For RBAC specifically: what is the minimum test matrix to be confident it's secure?
- What is an acceptable test coverage percentage for this project? (80%? 90%? Is 100% worth pursuing?)
- What testing tools — give us the exact Python and JavaScript libraries and their purpose

---

### QUESTION 7 — Recipe Costing: Phase 1 or Phase 2?

This is our one big disagreement with the official PRD.

**PRD says**: Recipe Costing → Phase 2

**We believe**: Recipe Costing logic should be in Phase 1 because:
- It's the core value engine (connects inventory → vendor prices → dish cost → profitability)
- Without it, you've built an expensive attendance tracker, not a food cost tool
- Building the DB schema and calculation engine early costs ~1 week but powers the whole product

**Tell us:**
- Who is right?
- If we build the schema and backend logic in Phase 1 but no UI, is that the right compromise?
- What database schema and calculation logic should the Recipe Costing engine have?
- How do you handle the case where a vendor's price changes and all recipe costs need to recalculate? (Batch job? Reactive event? On-demand?)

---

### QUESTION 8 — UK-Specific Features We Might Still Be Missing

We've identified these UK requirements:
- NI Number, Visa Expiry, Sort Code + Account Number, VAT, UK Minimum Wage, Delivery App commissions, Xero export

**What else are we missing?** Think about:
- UK food safety compliance (Food Standards Agency, HACCP records)
- UK GDPR (staff PII data storage rules, right to be forgotten)
- UK employment law (holiday pay accrual — 5.6 weeks/year)
- UK pension auto-enrolment (Workplace Pension — mandatory if staff earn over £10,000/year)
- UK payslip legal requirements (what must appear on a UK payslip by law)
- Allergen tracking (UK food allergen law — 14 major allergens must be disclosed)
- Tips and service charge handling (UK tipping law changed in 2024)
- Real-time PAYE reporting to HMRC (RTI submissions)

For each UK requirement you identify that we haven't covered: tell us whether it needs its own module, can be part of an existing module, or is out of scope for V1.

---

### QUESTION 9 — Security & Compliance

This system handles:
- Staff PII (names, addresses, NI Numbers, bank details, visa status)
- Financial data (payroll, vendor payments, daily revenue)
- UK-regulated data (GDPR applies)

Tell us:
- What are the minimum security requirements we must implement? (HTTPS, encryption at rest, audit logs?)
- How should we handle NI Numbers and bank account details? (Encrypt in DB? Use a vault?)
- What is our GDPR obligation for "Right to be Forgotten" when a staff member leaves?
- Do we need SOC2 or ISO27001 for this project? Or is that overkill?
- What AWS security features are worth enabling from Day 1 vs later? (KMS, CloudTrail, GuardDuty, WAF)

---

### QUESTION 10 — Data Seeding & Onboarding

The client has real data right now in Excel and PDFs:
- 219 inventory items (categorised)
- Multiple vendors with payment history
- Historical monthly P&L data going back to 2023
- Staff list with salaries

Tell us:
- What is the best way to build the data import/migration pipeline?
- Should we build an admin import tool into the product itself (useful for future clients too) or do a one-time migration script?
- What format should the import accept? (Our Excel as-is? A template we create? CSV?)
- How do we handle data that doesn't fit our schema perfectly (messy Excel)?
- In what order should data be seeded to respect foreign key relationships?

---

### QUESTION 11 — What Did We Miss?

Read everything above. Think about this project from the perspective of someone who has built restaurant/hospitality SaaS products before.

Tell us:
- What important features or modules did we miss that a real UK restaurant would need?
- What technical decisions did we make that you'd change?
- What will cause us the most pain during development that we haven't prepared for?
- What will cause us the most pain in production (after launch)?
- What should be the first thing we build and demo to the client to validate that we're on the right track?

---

## PART 5 — OUTPUT FORMAT

Please structure your full response as follows:

### 1. Product Name Recommendation
(5 names with reasoning, your top pick highlighted)

### 2. Architecture Decision
(Definitive recommendation: Monolith / Microservices / Hybrid — with the split if Hybrid)

### 3. Infrastructure & Cost Comparison
(Table with real numbers, final recommended stack per stage)

### 4. Microservices Design (if applicable)
(Each service: name, scope, tech, DB strategy, communication, cost)

### 5. CI/CD Pipeline Design
(Workflow diagram description + actual YAML structure)

### 6. Testing Strategy
(Per-service testing approach, key test cases for Payroll and RBAC, tools)

### 7. Recipe Costing Decision
(Phase 1 or Phase 2 — and the schema + calculation logic recommendation)

### 8. UK Requirements We Missed
(New items with module assignment and V1 vs V2 classification)

### 9. Security & Compliance Checklist
(Priority-ordered — what to implement Day 1 vs later)

### 10. Data Seeding Strategy
(Import pipeline design + seeding order)

### 11. What You'd Change / What We Missed
(Your top 10 findings — be direct and critical)

---

**One final instruction**: We are a small team (2 developers), one of whom is intermediate-level in Python and knows AWS from enterprise work but has never built a production SaaS from scratch. The other (me) is at a similar level. Be practical — don't recommend a 15-microservice Kubernetes setup that a 2-person team can't maintain. But also don't undersell the architecture and then have us redesign everything in 6 months. Find the real sweet spot.

**Take your time. This is the most important planning document for this project.**

---

*End of prompt.*
