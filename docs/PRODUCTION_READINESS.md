# What's missing before DineAI is a professional SaaS

An honest audit. Ordered by *what hurts first*, not by effort. Written after
building the commercial layer, so it reflects the real state, not the plan.

---

## 🔴 Would hurt on day one with a paying customer

**1. No backups you have restored from.**
There are backup scripts. Nobody has done a restore drill. An untested backup is
a hope, not a backup — you find out it was incomplete on the day you need it.
*Do: restore last night's dump into a scratch database, count rows, log the time it took.*

**2. No error tracking.**
Logs now have codes and land in CloudWatch, but nothing tells you a customer hit
an error — you find out when they email. A restaurant that hits a 500 mid-service
does not email; they stop using it.
*Do: Sentry (free tier is enough) on both frontend and backend, wired to the same codes.*

**3. No uptime monitoring.**
If the box dies at 2am you learn at 9am from an angry owner.
*Do: any external pinger on `/api/health` with an alert. Five minutes' work.*

**4. Single point of failure.**
One EC2 instance, one AZ. A hardware failure is a full outage of unknown length.
*Accept deliberately while small — but know it, and keep the restore drill sharp.*

**5. No staging environment.**
Every change goes from a laptop to the only environment customers use. The test
gate catches logic errors, not "this migration locks a table for 40 seconds".
*Do: one small staging stack, or at minimum restore prod data into a scratch DB before risky migrations.*

## 🟠 Will hurt within weeks

**6. Nothing enforces backup freshness.** No alert if backups stop.
**7. No rate limiting at the edge.** The AI is capped; login and signup are not — brute force and signup spam are unmetered.
**8. Password reset and email verification aren't load-bearing tested.** They work; nobody has tested them under a real provider failure.
**9. No GDPR export/delete.** UK customers can legally demand both. There is a "permanent removal" path for staff, but no "give me everything you hold on me".
**10. No audit of who saw what.** There is an audit trail of *changes*. There is no record of who *read* payroll.
**11. Frontend errors vanish.** `DINE-F*` codes exist; nothing reports them yet.

## 🟡 Professional polish, real revenue impact

**12. No email beyond transactional.** No trial-ending nudge, no failed-payment warning, no "you haven't logged in for a week". These are the cheapest retention levers and none exist.
**13. No in-app changelog.** Customers can't see they're getting value for the subscription.
**14. No usage analytics.** You cannot answer "which feature do people actually use", so you can't decide what to build next.
**15. Onboarding has no completion tracking.** The wizard exists; nobody knows how many finish it.
**16. No data export for the customer.** Lock-in by inability to leave is a support problem and an ethical one.
**17. No mobile app / PWA install.** A kitchen uses a phone, not a laptop.

## 🟢 Known gaps in what's already built

- **Chat titles** are auto-written but the rename UI isn't wired to the endpoint.
- **Control Room** has no screen for the new flags (comp, AI overrides) or the operator AI — endpoints only.
- **`price_comparison`, `hiring`, `payslip`** still lack detail sheets.
- **Click-to-exact-record** is done for Inventory→Purchasing; not audited elsewhere.
- **Stripe is test mode.** Live needs business details, bank account and ID.
- **`assistant_threads`** has no cleanup — conversations accumulate forever.
- **Prompt caching** is on, but nothing reports what it saved.

---

## If I could only do five

1. **Restore drill** — prove the backups work.
2. **Sentry** — know about errors before customers tell you.
3. **Uptime alert** — know about outages before customers tell you.
4. **Rate limit auth endpoints** — the cheapest security win available.
5. **Trial-ending + failed-payment emails** — the two highest-ROI messages in any SaaS.

The first three are all "find out before your customer does", which is the
actual difference between a side project and a product people pay for.
