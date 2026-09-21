# The AI's reach — bulk actions, the boundary, and what it can see

> "ai bugs: ai is not capabale to do all tasks... please give all access to ai
> please...i tried like 'thsi si the list of vendor please add this to our
> vendor' but ai said i cant able to add"

Three complaints in one sentence: he pasted a **list** (a bulk gap, not a
permission gap); "give all access" read literally is far more dangerous than
what he needs; and "not capable to do all tasks" is also about **reading**.

## Why it actually said "i cant able to add"

Not policy. Three mechanical reasons, all verified:

1. **No tool matches the request shape.** `propose_vendor`'s own description is
   "Propose adding ONE supplier" (`tools.py:1753`). Given fifteen suppliers its
   options were fifteen calls or an apology.
2. **The loop cannot hold a list.** `brain.MAX_LAPS = 4`, tool results truncated
   at 6000 chars, `max_tokens=1600`. Forty vendors fails HALF WAY, which is
   worse than failing.
3. **The prompt forbids the refusal without providing a mechanism** —
   `knowledge.py:202` says "never say a bulk action is impossible", an
   instruction to be cheerful about something it cannot do.

## The shape

He pastes a list → the model makes ONE tool call carrying parsed rows → the
SERVER classifies them against what the restaurant already has → the chat shows
**the same preview the file import shows** → he taps Add → the **same commit
endpoint the file import uses** writes them → one Undo reverses the batch.

The model's only job is prose → rows. Duplicate detection, permission, tenancy,
the write and the audit are all server work on the existing path. "The server
authorises" is unchanged.

### `classify()` is the hinge

`build_plan()` starts with `parse_upload`, and chat has no file. Split it:

```python
def classify(raw, spec, existing) -> Plan   # everything after parsing
def build_plan(file_bytes, ...) -> Plan     # parse, then classify
```

One classifier, two readers. This matters more than convenience: `_key()` is the
only place that knows what "already here" MEANS. A second duplicate check in the
chat path would be that definition existing twice, and drifting — the failure
this codebase keeps paying for.

## The confirm surface: ONE screen

The chat hands off to the same component the file path uses. The data is already
identical (`Plan.as_dict()`), he learns it once, and a 40-row table does not
belong in a `max-h-44` scroller inside a phone-width chat bubble. The bubble
keeps the sentence and the count; a `SheetPopup` holds the table.

## Blast radius

- **`MAX_PLAN_ROWS = 200`** at commit, **`MAX_MODEL_ROWS = 200`** from the model.
  The second exists for the case the message limit does not cover: a model that
  PADS. A 40-line paste returning 300 rows is a hallucination, and the cap makes
  it a refusal rather than 260 invented suppliers. Over the cap = truncate and
  SAY SO, never a silent drop.
- **The preview cannot be skipped, enforced by shape.** Commit accepts only rows
  carrying an explicit per-row `action`. There is no "commit this plan"
  shortcut, so there is nothing for a client — or a future agent — to call
  without producing decisions first. And the model cannot reach the endpoint at
  all: its entire vocabulary is `EXECUTORS`, and it has no HTTP tool.
- **Re-classify at commit time** against the database as it is NOW. One function
  call buys three things: the two-manager race, a stale plan left open
  overnight, and idempotency without a table (a double-tap finds everything
  duplicate and creates nothing).
- **Partial with a report, not all-or-nothing** — and the reason is in the code:
  `create_vendor`, `create_employee` and `create_item` each commit internally,
  and `create_employee` RETRIES on IntegrityError with a fresh code, which needs
  its own commit boundary. Every row is accounted for:
  `created + updated + skipped + failed` equals the number sent, because a count
  that does not add up is how silent loss hides.

### Which kinds may go bulk

vendors · employees · items · recipes — **yes**.
vendor prices · expenses · sales · purchase orders · stock counts · waste —
**no**.

The rule behind the table, checkable in code rather than remembered: **a kind
may go bulk only if its single-record undo already exists.**

### Undo cannot do a batch today

`UndoRequest` is `{type, id}` — one id — and half the actions return `undo = {}`
(waste, set_supplier, vendor_price, stock_count, recipe_ingredients, purchase).
Add `ids: list[str]`, loop, check `hotel_id` on each. Semantics stay **archive,
not delete**: for a 400-row mistake nothing is destroyed and a wrong undo is
itself reversible.

## Three guard bypasses bulk would multiply

`/assistant/act` uses `get_current_user`, and `actions.execute` checks
`has_permission(user.role, …)` — **base role only**. Three things `require()`
does that the assistant's write path does not:

1. **Custom roles ignored.** A hotel that REMOVED `vendors:write` from its
   managers still has a Copilot that writes vendors for them.
2. **Impersonation is not read-only.** An operator in a support view can have
   the AI write into a tenant.
3. **Billing never checked** — no 402.

Each is real today at one row. Routing bulk through
`POST /api/{list}/import/commit` with `Depends(require("…:write"))` fixes all
three for free, which is the strongest argument for reusing that endpoint.

## What "all access" must not mean

He asked for all access. Give him the boundary as a list he can overrule, not a
refusal. **The AI may PROPOSE anything. These it must not DO:**

| # | Never unsupervised | Why |
|---|---|---|
| 1 | Delete anything (undo archives) | A deleted supplier takes its price history with it |
| 2 | Pay anyone or mark anything paid | Money leaving has no undo button anywhere in the world |
| 3 | Change who can see what — roles, permissions, PINs, logins | Permissions are the lock on everything else, **including the AI**. This is specifically how "give all access" goes wrong |
| 4 | Touch another restaurant | Enforced by the views, not by asking the model nicely |
| 5 | Read private messages | Staff talk to each other in there |
| 6 | Anything irreversible in bulk | One mistaken bulk write is 400 rows |
| 7 | Export pay data | Salary and NI in a file that lands in email |
| 8 | Spend without a ceiling | The AI is the only unbounded bill in this product |

**Where "all access" IS right:** reading everything in his own restaurant;
creating and updating the operational lists in bulk with a preview and an undo;
and never saying "I do not have permission" when it means "I have no tool".

If he overrules a line, change this table and the code it names — a boundary
living only in the prompt is a suggestion.

## Read gaps — no tool AND no view, so `query_data` cannot save it

Highest value first:

| Missing | The question that fails |
|---|---|
| `sales_lines` | "How much did we take on card yesterday?" |
| `petty_cash`, `cash_events` | "Does the cash box balance?" — the thing he called why we're building this |
| `stock_movements` | "Which items moved most last week" |
| `vendor_payments` | "What do we owe Fresh Farms?" |
| `item_pack_levels` | The AI sees prices but not the pack rungs, so it will divide a box price to get a loose one — the exact error the money law exists to prevent |
| `leaves` | "Who is off next week?" |
| `document_requests` | "Whose right-to-work is outstanding?" |
| `hotels` (own row, narrowed) | Knows the date, not whether the venue is open |
| `custom_fields` | Whatever the restaurant thought worth tracking is what the AI cannot see |

`chats`, `chat_messages`, `users` stay invisible, deliberately.

Every gap is closed by adding a **view** — never by relaxing the allow-list. The
views ARE the tenant boundary.

## Build order

1. **`classify()` out of `build_plan()`**, plus the `invalid` verdict that is
   documented and never emitted.
2. **`POST /api/{vendors,employees}/import/commit`** — onboarding needs this
   too; build it once, here.
3. **`components/ImportPlan.tsx`**, shared. *At this point the file round trip
   is complete and shippable with no AI at all* — deliberate, so a stall in the
   AI work does not block the thing he hit on Friday.
4. **`propose_list`**, schema generated from `lists.EXPORTABLE`.
5. **Batch undo.**
6. **The read views.**
7. **Retire `ingest.commit`'s duplicate schemas** — they re-declare columns
   `lists.py` now owns and have already diverged, five fields against ten.
8. **The three guard bypasses**, as a security change with its own review.

## The one-line defence

He asked for all access. What he needed was one tool shaped like a list, the
preview screen we were already building for files, and an undo that reverses
forty rows in one tap — and the honest answer to "all access" is a short table
of the eight things that stay behind a human finger.
