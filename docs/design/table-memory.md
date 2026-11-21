# Table memory (32.27 / §93.4) — design, 21 Nov 2026

"there is no persistent history of table — like what they ordered, timing, what
and all they asked as chat, what and all they asked to our AI etc."

## What exists
Clearing a table deletes nothing: `release_table` stamps `orders.sitting_ended_at`
and `table_messages.cleared_at`. Both chat threads survive, both sides of every
diner AI turn, with the dish (`topic`). Most of this is a reader and a UI.

Gaps: no "cooking started" time, no "served by", failed AI turns not stored,
deleting a table CASCADE-deletes its chat (orders survive with table_id NULL).

Live bugs found and FIXED 21 Nov (this commit): (a) release stamped orders with
Python now() and messages with Postgres now(); (b) an AI-only party never showed a
sitting, so the next party read its questions; (c) GET /ordering/tables needed
orders:write.

## A sitting — derived, no new table
Everything on one table between two releases; the boundary is the release
timestamp (one value on both columns after fix a). Rows whose stamp EQUALS the
boundary belong to it; NULL stamps = the open sitting. Migration (step 1):
`orders.preparing_at`, `orders.served_by_user_id` (FK users, SET NULL),
`orders.served_via` (staff | kds | release), and a data step moving each old
`cleared_at` onto the order boundary 0–5 s later on the same table. No backfill of
missing facts: older rows say "not recorded then".

## Endpoints (orders:read, hotel_id on every query, 404 cross-tenant)
- GET /api/ordering/tables/{id}/sittings?before=<iso>&limit=20 (keyset)
- GET /api/ordering/tables/{id}/sittings/{key|open} → summary, orders[], counter[],
  ai[{at, topic, question, answer}], truncated (caps 200 orders / 500 messages)

## UI
Third column of the table sheet: last 6 sittings as tiles; a tile opens a stacked
SheetPopup (Rounds | Chat | AI on desktop, a three-way switch on a phone). Times in
hotel.timezone.

## Owner's questions (asked 21 Nov)
1. orders:read includes cashiers and chefs — should chat and AI text be limited to
   manager and owner?
2. Retention: keep orders and timings; delete chat and AI text after 90 days
   (configurable)? Diner text can be health data under UK GDPR ("I'm coeliac").
3. Store failed AI turns too?

## Build order
1. Migration + stamps (+ table.release audit after commit) — tests per path
2. Read API — tenant 404, paging, AI-only and pre-Sept sittings
3. UI — screenshots 390/1440 on nirai1, test sitting cleaned up
4. Soft-close delete so history survives a deleted table
5. Retention, only after the owner answers
