# Landing Page — files to hand to a design AI

Give the AI **this document + the files listed below**. Goal: a brand-new, premium,
animated **public landing page** for Mise (a UK restaurant ERP/SaaS). Only the
files here are relevant — everything else (the logged-in app, the backend) must
stay untouched.

## Tech facts the AI must know
- **Next.js 16 (App Router) + React 19 + TypeScript.**
- **Tailwind CSS v4** — there is **no `tailwind.config.js`**. Theme tokens
  (brand colours, etc.) live in an `@theme` block inside `app/globals.css`.
  Brand colour = emerald green (`--color-brand-500: #10b981`, 600 `#059669`).
- Animations are **pure CSS keyframes** in `app/globals.css` (aurora glow, the
  3-D ecosystem carousel, scroll-reveal). No animation library.
- Keep `output: "standalone"` in `next.config.ts` (needed for the Docker build).
- The page must stay **fast and responsive** (mobile-first). It is the first
  thing clients see.

## Files that ARE the landing page (edit these)
| File | What it is |
|---|---|
| `frontend/app/page.tsx` | **THE landing page** (388 lines): hero, 3-D dashboard preview, aurora background, 3-D "ecosystem" carousel, feature sections, fixed CTA. This is the main file to redesign. |
| `frontend/app/globals.css` | Tailwind v4 `@theme` tokens **+ every landing animation keyframe** (aurora, carousel, reveal). Edit/extend animations here. |
| `frontend/components/Reveal.tsx` | Small `IntersectionObserver` wrapper that fades/slides children in on scroll. Used throughout the landing. |
| `frontend/app/signup/page.tsx` | The **"Register your hotel"** page the landing CTA links to (100 lines). Style to match the new landing. |
| `frontend/components/Logo.tsx` | The Mise SVG logo (the "M" rising-chart mark). |
| `frontend/app/icon.svg` | Favicon / app icon. |
| `frontend/app/layout.tsx` | Root layout — fonts, `<metadata>` (SEO title/description), global providers. Update copy/fonts here. |

## Supporting files (only touch if changing signup behaviour)
- `frontend/lib/auth.tsx` — `registerHotel()` calls `POST /auth/register-hotel`.
- `frontend/lib/api.ts` — `API_BASE` + the `RegisterHotel` request shape. Signup
  sends: `hotel_name, country (ISO-2), city, email, password, full_name`.

## DO NOT touch
- `frontend/app/(app)/**` — the entire logged-in dashboard (inventory, recipes,
  vendors, purchasing, etc.). Different concern.
- Anything under `backend/` or `infra/`.

## How to preview the result
```bash
cd frontend
npm install        # first time only
npm run dev        # http://localhost:3000  → landing page
```
Build check before handing back: `npm run lint && npm run build` must pass.
