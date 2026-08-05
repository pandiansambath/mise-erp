# DineAI — the full task ledger

**Every task you have given me, what I did about it, and whether it is live.**

Built 5 Aug 2026 by re-reading all 49 memory files, the whole conversation, and
**probing the live site for each claim** rather than trusting a note. Several
older notes were wrong in both directions — things marked "pending" that shipped
weeks ago, and one thing marked "done" that was only half-built.

Status key: **LIVE** = deployed and probed · **BUILT** = merged, deploy pending ·
**OPEN** = not done · **NEEDS YOU** = blocked on you.

---

## 🔴 OPEN RIGHT NOW — reported by you today, not yet fixed

### Control Room "View as" still lands on the login page
**Status: OPEN — my second fix was also wrong.**
First attempt relied on the Control Room's subdomain being a different origin
from the apex. It is reachable at `dineai.cloud/control-room` too, where the
origins are identical, so the support token overwrote your own session. Second
attempt moved the session to `sessionStorage` (per-tab) — I confirmed that code
IS in the deployed bundle, and you still see the login page. So the cause is
something else and I have not found it yet. `/auth/me` does accept the
impersonation token, and the middleware passes `/impersonate` and `/dashboard`
through untouched, so those two are ruled out. **Next: capture the actual
network response in that new tab.**

### "Permanently delete this restaurant" does nothing when clicked
**Status: OPEN.** The endpoint is live (`deletion-preview` answers 403 to an
unauthenticated probe, so it exists and is guarded). The button calls it and
should swap to a preview panel listing what would be destroyed. Not yet
diagnosed — most likely the call is failing inside the modal and the error is
not surfacing where you can see it.

---

## 🟢 FIXED TODAY (built, deploying)

### Cash history always said "no changes recorded"
**Your report:** *"I changed so many times in opening and closing cash and
saved, but still not even a single history."*
**Cause found:** the panel fetched the history **once per page load** and cached
it (`if (history === null)`). Save the till three times and it still showed the
empty list it cached before your first save. Also never refreshed when you
changed the date.
**Fix:** re-reads every time you open it, and again after each save. An audit
trail that lies is worse than not having one.

### The Sales sticky header covered the page
**Your report:** UI bug screenshot.
**Cause:** I had pinned the *entire* header — title, subtitle and a large figure,
about 130px of permanently fixed chrome, as a translucent band sitting over the
content. **Fix:** only the number is pinned now, in a slim bar. That was the
actual request — "always show current amount in my cash box" — not the header.

### The skills solar system stopped revolving
**Your report:** *"after sometime revolution is stopped."*
**Cause:** hover-to-pause. On a phone `onMouseEnter` fires on tap and
`onMouseLeave` frequently never does, so one tap set "paused" permanently.
**Fix:** pause only where a real pointer exists (`hover: hover`), and the photo
swap no longer depends on the pause state at all.

### Portrait now swaps every 5 seconds
Was 65s (what I heard the first time). Cross-fade plus a slow drift, not a cut.

### The AI bubble can be moved anywhere
**Your report:** *"our bubble ai dot is hiding some important thing… user touch
and try to move then it need to move… click means it need to open."*
**Built exactly that:** no long-press, no drag handle, no mode. Move past ~6px
and it is a drag; release under that and it opens. Pointer events, so finger,
mouse and stylus share one path. Position is remembered, and it is kept on
screen when you rotate or resize.

### The AI panel no longer competes with the page
**Your report:** *"when I open our bubble ai it's really making the UI clumsy
and it's literally covered full UI."*
**What professionals do, and what I did:** on a phone the panel is already
capped at 68% height — what was missing is a **scrim**. Dimming the page behind
makes it read as a sheet *over* a page instead of two UIs fighting for the same
screen. Tapping the dimmed area closes it. On desktop the panel is a small
corner card with plenty of page around it, so a scrim there would be theatre and
is deliberately not used.

### Water-ripple on touch
**Your report:** *"if I touch somewhere I need an animation like dropping a
stone in water."* Two rings at different speeds spread from the exact contact
point, on mobile and desktop. The layer can never swallow a click, rings remove
themselves, and it is transform/opacity only so it costs no frames.

### Price Comparison rendered too wide on mobile
The three evidence tabs (`Suppliers (4)` · `What you paid` · `Changes`) did not
fit 390px, so they pushed the card wider than the screen and the **whole page**
scrolled sideways. The tab row scrolls on its own now.

### Education, with proof
17th University Rank · Gold Medalist · B.Tech IT · 2023 · **CGPA 9.19** ·
Panimalar Institute of Technology, affiliated to Anna University.
The rank-list PDF you sent is **self-hosted** now (`/dev/RANK_AFF_UG_2023.pdf`).
The third-party link 302s to a sign-in wall for anyone without a STUCOR
session — it only worked for you because you were logged in. A verify button
that lands a recruiter on a signup form proves nothing. The card also names
**page 35**, so nobody has to scroll 49 pages.
Your registration number is deliberately **not** published.

### Skills — SQL removed, grouped as you describe them
They lived in three places and had drifted; the terminal was still claiming SQL.
**One list now** (`frontend/dev/skills.ts`) read by the orbit, the cards and the
terminal, so they cannot disagree again.
**AWS** EC2 · ECS · Lambda · S3 · DynamoDB · SQS · SNS · IAM · VPC · Security
Groups · Subnets — **Python** Python · FastAPI · Django · DSA — **Tooling**
Docker · GitHub Actions · Git & GitHub · SonarQube · Snyk · CodeScene

### All dev-page code in one folder
`dev/` (scripts + a README mapping every file) and `frontend/dev/` (components).
Only the route and the images sit outside — Next requires those two locations,
and the README says so and why.

---

## ✅ LIVE AND VERIFIED (probed today)

### The role designer — you were right to ask
**Your task:** *"super admin can design the lower login UI… manager, staff etc.
what they can have, whether read-only or write."*
The designer existed. **But it was half a feature:** you could design "Kitchen
Manager, view-only payroll" and never give it to anyone, because nothing could
write `custom_role_id` — the Staff dropdown only ever offered the six built-ins.
**Fixed:** assignable now, listing only roles built on that archetype. A role
from another restaurant is refused (cross-tenant privilege grant) and one built
on a different archetype is refused (its overrides were clipped against a
different envelope). Both covered by tests.
The safety model is unchanged and deliberate: a Staff-based role has **no hiring
toggle to mis-tick**. The mistake is unrepresentable, not merely blocked.

### Stop making me scroll
**Your words:** *"this scrolling is big hectic for me… every time is wasted in
scrolling itself."*
- **Expenses** — the form was under every chart. Pinned top-right; on a phone
  the order is totals → form → charts.
- **Sales** — the till figure was three sections down.
- **Price Comparison** — pick left, answer right, both pinned; vendor cards
  instead of a table; history behind tabs.
- **Purchasing** — grid and tray side by side, Submit *inside* the tray so
  adding items stops pushing it away.

### Rota ↔ Attendance leave, both directions, with legends
A 🌴 Leave button on every attendance row; the rota shows who is off inside the
day itself instead of only refusing at the moment you drop a shift; both pages
carry a key explaining every marker.
**A real bug surfaced doing it:** `list_attendance` only returned rows for people
who *punched*. "On leave" and "rota'd but absent" are defined by nothing being
recorded, so those flags could never land on anyone they applied to.

### The assistant streams now
**Your words:** *"when I give a prompt I was waiting for so long without
confirmation whether the AI is working or not."*
`POST /assistant/chat/stream` sends what it is thinking, which tool it is
reading, then the reply as it is written. Text from a lap that then calls a tool
is never shown as the answer — that is the model talking to itself.

### Onboarding wizard
A new restaurant no longer lands on a dashboard of zeroes. One next step with a
reason, in dependency order, and every step that can be bulk-imported hands a
spreadsheet or PDF to the assistant. Progress is counted from real rows.

### Sub-sections on every page
Employees, attendance, rota, payroll, reports, money and orders were the last
seven without one.

### Images 48% smaller
52 files, 7.9MB → 4.2MB. `<picture>` with JPEG fallback. Verified live: 102KB
WebP vs 205KB JPEG.

### Safe permanent hotel deletion
Archive to S3 first and refuse to delete if that fails · counts what will be
destroyed · the handle must be typed exactly.

### Control Room
Operator AI renders markdown (it was printing raw `##` and `**`) · sub-nav so
sections are reachable without scrolling 1,200 lines · invisible text fixed.

### Also live
Purchasing price history in the item sheet · deep link landing on the right item
· create a stock item from the Vendors page without leaving · time filters on
Waste and Audit (audit was capped at 150 events) · staff-lending autocomplete ·
back button closes modals · session filter memory · expense bill upload.

---

## 📌 STILL OPEN (older, agreed)

| # | Task | Note |
|---|---|---|
| 1 | **Mobile pass** on inventory, recipes, money, reports, payroll, orders | Overflow tests cannot detect "cramped" — send screenshots |
| 2 | **Vendor credit / part-payment** | bought vs paid vs still pending; you flagged it complex yourself |
| 3 | **Purchasing indent/PO cards** | still want a slide-in detail drawer |
| 4 | **Detail sheets** for attendance, documents, audit, food-safety | deep links need a sheet first |
| 5 | **Sheet jump-tabs** | vendor sheet's supply table sits below its own fold |
| 6 | **Daily AI nudge** | "here's how to make today better" — never started |
| 7 | **Shared brand component** | one source of truth across landing + app |
| 8 | **CloudWatch terraform follow-up** | patch was applied live; a rebuilt box would lose logging |

## 🟡 NEEDS YOU
- **Screenshots** of any mobile page that still feels wrong.
- Rename the Stripe account (cosmetic).

---

## ⚠️ Two traps that cost real time

1. **`git push` runs CI. It does NOT deploy.** Only `bash scripts/deploy.sh`
   dispatches the deploy workflow. Three green CI runs read exactly like three
   deploys while production sat five commits behind. `scripts/check_live.sh`
   now compares live to HEAD and says so.
2. **There is no local Postgres or Docker here**, so the backend suite cannot
   run on this machine. CI is the only real gate — the run has to be read, never
   assumed. Two deploys failed on a coverage gate I could not see locally.
