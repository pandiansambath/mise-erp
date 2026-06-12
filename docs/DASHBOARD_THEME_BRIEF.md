# Brief for the design AI — make the DASHBOARD match the landing

You built our landing page (`app/page.tsx`) and it's gorgeous — premium dark
"kitchen-at-midnight" green-black with a drifting **aurora**, Fraunces display
type, copper money accents. **The problem:** once you log in, the dashboard is a
plain **light** (white / slate / emerald) app. It feels like a different product.

**Your mission:** bring that same premium aesthetic into the logged-in dashboard
so Mise feels like *one* product from landing → auth → app. Read this whole doc
first — it has the files, the rules, and exactly how to ship + verify.

---

## 0. Tech facts (important)
- **Next.js 16 (App Router) + React 19 + TypeScript. Tailwind CSS v4** — there is
  **no `tailwind.config.js`**; theme tokens live in `@theme` blocks in
  `app/globals.css`.
- ⚠️ **Tailwind v4 gotcha:** `@theme inline { … }` **bakes the hex into the
  utility class** (not overridable at runtime). Our **brand ramp is in a separate
  NON-inline `@theme { … }`** block on purpose, so the theme switcher can remap it
  via CSS variables. If you add **surface/text tokens that must theme at runtime,
  put them in a non-inline `@theme` or plain CSS variables** — not `@theme inline`.
- There is already a **theme switcher** (`lib/theme.tsx`, control in the top bar):
  6 accent palettes that remap `--color-brand-*` on the dashboard shell. **Keep it
  working** — your dark theme is the *base surfaces*; brand-* stays the *accent*.
- Reusable dark ingredients **already exist** in `globals.css`: the `ink-*`
  green-blacks (`--color-ink-950/900/800`), the `.mise-aurora` / `.mise-aurora-shift`
  drifting aurora, `copper-*` accents, and Fraunces via `font-display`.
- Build output is `output: "standalone"` — don't change that.

## 1. What to build
Make the dashboard premium + cohesive with the landing. Recommended approach
(maintainable, keeps the accent switcher intact):

1. **Introduce semantic surface tokens** (e.g. CSS vars `--surface`, `--surface-2`,
   `--text`, `--text-muted`, `--border`) with **dark green-black values**, and a
   subtle **aurora backdrop** on the dashboard shell.
2. **Convert the shared components first** — they cover most of the app:
   `components/ui.tsx` (`Card`, `StatCard`, `PageHeader`, `Badge`, `Spinner`),
   `components/AppShell.tsx` (sidebar, top bar), `components/ComboBox.tsx`,
   `components/confirm.tsx`, and the input styling.
3. **Then sweep the pages** to use the tokens instead of hard-coded
   `bg-white` / `text-slate-900` / `bg-slate-50` / `border-slate-200`.
4. **Readability is non-negotiable** — data tables (Inventory, Reports/P&L,
   Payroll) must stay crisp and legible on dark. Money figures can use copper.
5. Respect `prefers-reduced-motion` (aurora already does).

*(If you'd rather ship in two passes — "dark shell + light cards" first, then full
dark — that's fine; just keep each pass self-consistent.)*

## 2. Files
**Edit these (the dashboard):**
- `frontend/app/globals.css` — add dark surface tokens (mind the inline gotcha).
- `frontend/components/AppShell.tsx` — sidebar + top bar + shell background/aurora.
- `frontend/components/ui.tsx` — `Card`, `StatCard`, `PageHeader`, `Badge`, `Spinner`.
- `frontend/components/ComboBox.tsx`, `frontend/components/confirm.tsx`.
- `frontend/app/(app)/layout.tsx` and every page under **`frontend/app/(app)/`**:
  `dashboard, reports, vendors, price-comparison, inventory, recipes, purchasing,
  sales, expenses, employees, attendance, payroll, documents, staff, profile, my,
  settings`.

**DO NOT touch:**
- `frontend/app/page.tsx` (landing), `frontend/app/signup/`, `frontend/app/login/`
  (these are already the dark theme — leave them).
- `frontend/components/Reveal.tsx`, `frontend/app/icon.svg`, `frontend/components/Logo.tsx`.
- `frontend/lib/theme.tsx` logic (you may *use* it; don't break the 6-accent switcher).
- Anything in `backend/` or `infra/`.

## 3. Conventions
- Match the existing component style; keep class lists tidy. TypeScript strict.
- Keep the brand accent driven by `brand-*` (so the theme switcher still recolours).
- Mobile-first + responsive (there's a Playwright device test — see §5).

## 4. Ship it (our exact flow)
```bash
# 1. verify locally — ALL must pass
cd backend && py -m ruff check .            # ruff 0.8.4 (CI-pinned); you won't change backend, but run it
cd ../frontend
npx tsc --noEmit            # types
npm run lint                # eslint (0 errors)
npm run build               # Next build — must succeed (needs internet for fonts)
npx playwright test         # responsive device test (see §5)

# 2. commit + push to main (the project deploys from main)
git add frontend
git commit -m "feat(ui): dark premium dashboard to match the landing"
git push origin main
```
Then **trigger the deploy** (deploys are **manual**, never automatic on push):
- GitHub → repo **mise-erp** → **Actions** → **"Deploy (eu-west-2)"** → **Run workflow** on `main`.

**How the deploy works** (so you know what to expect):
- CI runs the test gate (backend ruff+pytest, frontend lint+build) → builds Docker
  images → `terraform apply` **replaces the EC2 box** (new image) → it boots, pulls
  images, runs migrations. The **Elastic IP is stable**, so the URL never changes.
- Takes ~12–18 min, then ~2–3 min for the new box to boot.
- ⚠️ The CI step **"Initialize containers"** (a Postgres test service) is
  **intermittently flaky** — if a run fails there (not your code), just **re-run** it.

## 5. Check the live UI
- **Live URL: http://18.133.95.137** — log in, then **hard-refresh (Ctrl+Shift+R)**
  or use Incognito (HTTP caching is aggressive).
- Local preview: `cd frontend && npm run dev` → http://localhost:3000.
- **Responsive check:** `npx playwright test` runs `frontend/e2e/responsive.spec.ts`
  across device viewports — keep it green (update it if you intentionally change layout).

## 6. Definition of done
- Dashboard reads as the *same product* as the landing (dark, aurora, premium),
  **readable** on every page, **landing/auth untouched**, **theme switcher still
  works**, and `tsc + lint + build + playwright` all green.
- Deeper infra/runbook detail if you need it: **`docs/MASTER_GUIDE.md`**.

## 7. Never commit
`github_token.txt`, `pandiansambath_accessKeys.csv`, any client `*.xlsx/*.pdf/*.csv`.
All credit goes to the owner — no AI attribution in commits/PRs.
