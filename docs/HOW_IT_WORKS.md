# Mise — How It Works (the whole site, explained)

This is the plain-English reference for the product: what every number means, who
can do what, and how users get created. Keep it updated as modules are added.

---

## 1. The core idea
Mise connects the chain that decides whether a restaurant makes money:

```
Vendor prices → Item cost (weighted avg) → Recipe cost/plate → Dish margin → Profit
```

A change anywhere (a vendor raises chicken £1/kg) ripples into dish cost and margin.

---

## 2. Glossary — every metric & column

### Recipes screen
| Term | Meaning |
|------|---------|
| **Cost / serving** | Ingredient cost to make **one plate**. |
| **Sells at** | The **menu price** you charge a customer for one plate (you set this). |
| **Margin** | `(Sells at − Cost/serving) ÷ Sells at × 100`. This is **gross food margin** (ingredients only) — NOT net profit. Net profit also subtracts rent, wages, gas, delivery commissions (Expenses/Sales modules, later). Healthy food margin ≈ 65–75%. |
| **Batch (N)** | Total ingredient cost to cook the whole recipe batch of N servings. |
| Ingredient **Qty** | Amount the batch needs. |
| Ingredient **Unit price** | The **cheapest active vendor's** price per unit. |
| Ingredient **Line cost** | `Qty × Unit price`. |
| Ingredient **Source** | Which vendor that price came from (or `average_cost` / `none` if no vendor price). |

### Inventory screen
| Term | Meaning |
|------|---------|
| **Stock** | Quantity on hand now (+ unit). |
| **Min stock** | Reorder threshold. At/below it → "Low" badge + dashboard alert. |
| **Avg cost** | **Weighted-average** price actually paid per unit, blended across purchases at different prices. |

### Price Comparison screen
Each active vendor's **price/unit** for an item, sorted cheapest-first, with the
**Cheapest** badge and the **£ saving** vs the priciest vendor.

### Dashboard
Tracked items · Low-stock count · Recipes count · Average margin across dishes.

---

## 3. Vendor selection — who picks the supplier?
- Mise **auto-uses the cheapest active vendor** for each ingredient when computing recipe cost.
- Cost is **recomputed every time you open a recipe** (reads current prices) — "live on view."
- Mise **advises**; a human **decides** what to actually order (Purchase-Order module, later).
- A `is_preferred` flag exists per vendor-item (not used in costing yet). Planned: option
  to cost using the **preferred** vendor instead of the absolute cheapest (quality/reliability).

---

## 4. Roles & permissions (RBAC)
RBAC = a `role` on each user + a permission matrix in code
([backend/app/core/rbac.py](../backend/app/core/rbac.py)). The token carries the role;
every endpoint checks it. `write` implies `read` on the same module.

| Capability | SUPER_ADMIN | MANAGER | KITCHEN_MANAGER | ACCOUNTANT | CASHIER | STAFF |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|
| Create/edit **users** | ✅ | 👁 read | — | — | — | — |
| **Inventory** items & stock | ✅ | ✅ | 👁 read | — | — | — |
| **Vendors** & prices | ✅ | ✅ | — | 👁 read | — | — |
| **Recipes** & costing | ✅ | ✅ | ✅ | 👁 read | — | — |
| Sales / cash (later) | ✅ | 👁 | — | — | ✅ | — |
| Payroll (later) | ✅ | 👁 | — | ✅ | — | own |
| Reports (later) | ✅ | ✅ | — | ✅ | — | — |

✅ = create/edit · 👁 = read-only · — = no access.

---

## 5. Editability — who can edit what (today)
| Entity | Create / Edit | Read |
|--------|---------------|------|
| Items (+ stock movements) | SUPER_ADMIN, MANAGER | + KITCHEN_MANAGER |
| Vendors (+ prices) | SUPER_ADMIN, MANAGER | + ACCOUNTANT |
| Recipes (+ ingredients) | SUPER_ADMIN, MANAGER, KITCHEN_MANAGER | + ACCOUNTANT |
| Users | SUPER_ADMIN | + MANAGER (read) |

> Delete isn't exposed yet — we deactivate (`is_active = false`) instead of hard-delete,
> so history/costs stay intact. A "deactivate" control will sit next to Edit.

---

## 6. How users are created (provisioning) — important
There are **two different "sign-ups":**

1. **Staff inside a restaurant → NO self sign-up.** The **Super Admin (owner) creates**
   each staff account and assigns a role. (We built this: `POST /api/auth/users`.) The
   owner controls who sees costs/payroll. A Manager may be allowed to add lower roles.
2. **A new restaurant joining Mise (SaaS level) → optional self sign-up** ("Start trial")
   that creates a **new hotel + its first Super Admin**. Often sales-led instead.

**Who adds whom:** Platform → onboards a hotel + its Super Admin. Super Admin → adds
that hotel's staff. Nobody self-registers as staff.

Roadmap (see memory checklist): restaurant self-sign-up, Google sign-in, email
verification, password reset, 2FA.

---

## 7. Multi-tenancy (many hotels)
**Model: shared database + `hotel_id`.** One DB; a `hotels` table; every domain row
carries a `hotel_id`; every query is scoped to the logged-in user's hotel. So two
hotels logging in see completely separate worlds (items, vendors, recipes, staff).
The 6 roles are global *definitions*; the *users* holding them are per-hotel.

**Country-aware:** each hotel has a `country` + `base_currency`. UK hotels get
UK-specific fields (NI number, visa expiry — in the Employee module) and default to £;
India hotels default to ₹. The currency toggle is display-only on top of this.
