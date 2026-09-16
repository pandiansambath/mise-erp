# The Neural Map — the data

> "we need to createe a super speical impressive graphical NEURAL maps
>  treess...like which one is under whihc one...how they chained linked ot one
>  aother... and whihc point to which one etcet...entier thing abt our
>  project..under proejct how mamy hotels are ther..unders hotel what are all
>  ther..what using..what aws bill they consufe...what ai they using..hw muhc
>  time...how many token..ectect.... litrelly like a human brain sumilation
>  neural netork UI view we need"

`docs/FEEDBACK_2026-09-05.md` §46.1. This document is the DATA half only — node
taxonomy, edge taxonomy, provenance, and one endpoint. The visual (§46.2–46.3)
is being designed in parallel and nothing here prescribes it.

**Modelled on `backend/app/platform_admin/costs.py` + `/costs/hotels`.** That
pair already solves the hard half of this problem — two kinds of number with
different freshness, a modelled allocation that says it is modelled, and a
refusal to print `$0.00` for "we did not measure that". The graph is the same
discipline applied to a different shape. New code goes in
`backend/app/platform_admin/graph.py`; `router.py` is already 1,369 lines and
the house split is router thin, read-module thick (`costs.py`,
`observability.py`).

---

## 0. What the schema actually is

Read before designing, because four things in the brief I was given were wrong
and one of them changes the answer.

**`hotels` has no `user_count`, `admin_email`, `last_active` or `handle`
column.** `GET /platform/hotels` computes all four: `user_count = len(users for
hotel)`, `admin_email` = the `SUPER_ADMIN` user's email, `last_active =
max(users.last_login)`, and the handle is **`hotels.username`**.

**`usage_daily` has no `ai_calls` column.** It is `day, hotel_id, method,
endpoint, requests, errors_4xx, errors_5xx, duration_ms, db_selects, db_writes,
db_ms, flushed_at`. AI call counts exist **only** in `ai_usage`.

**`ai_usage.kind` is not `chat|vision|health`.** That is the model's docstring
and it is stale. The kinds actually written by `app/assistant/guard.record()`
are **`chat`, `vision`, `insights`, `kiosk-quote`**. Enumerate them with a
`GROUP BY`, never from a constant.

**Polly is not logged per hotel.** `cost_map.py` says in its docstring that
DIRECT is "measured per hotel. Bedrock and Polly — we log every call".
`app/assistant/voice.py` and `listen.py` never import `guard`, so no `ai_usage`
row is ever written for text-to-speech or transcription. Polly spend is
classified `DIRECT` and has **no ledger to attribute it with**. See §4.4.

Everything else checked out. `cloud_cost_daily` also carries `source`, `as_of`,
`fetched_at`, `is_estimate`; `audit_events` is the table name (`audit_logs` in
`deletion.ORDERED_TABLES` is the legacy hint list, which that file says out loud
is no longer the source of truth).

### Indexes that exist today

| Table | Index |
|---|---|
| `usage_daily` | `ix_usage_daily_day (day)`, `ix_usage_daily_hotel_day (hotel_id, day)`, `uq_usage_daily_key (day, hotel_id, method, endpoint)` |
| `ai_usage` | `ix_ai_usage_hotel_id`, `ix_ai_usage_created_at`, **`ix_ai_usage_hotel_time (hotel_id, created_at)`** |
| `cloud_cost_daily` | `ix_cloud_cost_daily_day (day)`, `uq_cloud_cost_key (day, service, usage_type, record_type)` |
| `audit_events` | `hotel_id` only — **no `created_at`, no composite.** |

**One new index is recommended**, §5.4.

---

## 1. The shape of the thing

A pure tree would not need the word "neural". The structure he described has
three overlapping layers over the *same* set of hotel nodes:

```
            +------------ platform ------------+
            |              |                   |
         plans          hotels             cost pools
            |           /  |  \                |
            +-entitles-/   |   \--shares---> aws services
                      /    |    \                ^
                 uses/     |     \invokes        |
                    v      |      v           billed_as
               features <--+-- models ------------+
                    overrides
```

* **Every hotel has exactly one spine edge** (`hosts`, from the platform). That
  is the tree, it is what a radial layout needs, and every node carries
  `parent` so the designer never has to walk the edge list to find it.
* **Everything else is a cross-link.** A feature is one node used by many
  hotels. A Bedrock model is one node invoked by many hotels. The EC2 box is
  one node shared by all of them. Those three are exactly the "how they chained
  linked to one another" he asked for, and they are what make the picture a
  mesh instead of an org chart.
* **A hotel sits under two parents at once** — the platform (infrastructure)
  and its plan (commerce). The plan layer costs 3 nodes and gives the graph a
  second, genuinely different, grouping over the same nodes.

---

## 2. Node types

Seven. Every node carries the common envelope:

```jsonc
{
  "id":       "hotel:9f3c1d2e-...",  // opaque. THE UI MUST NEVER SPLIT IT.
  "type":     "hotel",
  "subtype":  "tenant",
  "label":    "NIRAI",
  "sublabel": "@nirai1 · Pro",
  "parent":   "platform:dineai",     // null for the root; set from the spine edge
  "ref":      { "hotel_id": "9f3c1d2e-..." },       // machine-readable identity
  "href":     "/control-room/hotels/9f3c1d2e-...",  // or null if not clickable
  "presence": { },                   // §4.1
  "metrics":  { }                    // every value an envelope, §4.2
}
```

> **Ids are opaque.** Service keys contain spaces, dots, hyphens and
> parentheses (`Claude Sonnet 4.6 (Amazon Bedrock Edition)`, `EC2 - Other`) and
> model ids contain dots and colons (`eu.anthropic.claude-sonnet-4-6`). Any
> client that recovers a UUID by splitting on `:` or `-` breaks on the first
> Bedrock node. `ref` exists so nobody has to.

### 2.1 `platform` — 1 node

The root. `id: "platform:dineai"`, `parent: null`.

| Field | Source |
|---|---|
| `hotels_total`, `hotels_active`, `hotels_comp` | `count(hotels.id)`, `... FILTER (WHERE is_active)`, `... FILTER (WHERE is_comp)` |
| `users_total` | `count(users.id)` |
| `gross_usd`, `net_usd`, `credits_usd` | `costs.billed()` over `cloud_cost_daily.amount_usd`, split on `record_type` |
| `requests`, `db_selects`, `db_writes`, `db_ms`, `duration_ms` | `sum(usage_daily.*)` in the window, plus the un-flushed in-memory delta |
| `ai_calls`, `ai_tokens_in`, `ai_tokens_out`, `ai_cost_usd`, `ai_latency_ms` | `ai_usage` |
| `operator_requests` | `usage_daily` rows whose endpoint starts `/api/platform` — see §2.4 |
| `aws_account`, `region` | constants: `887514555232`, `eu-west-2` |

### 2.2 `hotel` — 1 + N + orphans

`subtype` is one of three, and the difference is load-bearing:

**`tenant`** — a row in `hotels`. Carries `ref.hotel_id` and an `href` to its
Control Room page.

**`anonymous`** — the `ANON_HOTEL` sentinel
`00000000-0000-0000-0000-000000000000` (`platform_admin/models.py:114`).
Public, diner and unauthenticated traffic — about 72% of all requests, so it is
the second-biggest node on the map, and it is *not a restaurant*.
`label: "Public / anonymous traffic"`, `href: null`, `linkable: false`.
Clicking through to `/control-room/hotels/0000...` would 404.

**`orphan`** — a `hotel_id` present in `ai_usage`, `usage_daily` or
`audit_events` with **no row in `hotels`**. This exists today: one such id, 6
calls, $0.05. It exists because `ai_usage.hotel_id` deliberately has no FK
(`assistant/models.py`: "denormalised on purpose ... so the ledger survives a
staff member being removed"), and because `usage_daily` and `cloud_cost_daily`
have no FK to `hotels` either and are deliberately untouched by
`deletion.purge()` — "deleting a restaurant must not rewrite last month's bill"
(`models.py:104`).

> **An orphan is never dropped.** It holds real spend. Drop it and the
> per-hotel column stops summing to the platform total, which is exactly the
> failure `meta.checks` exists to catch. `presence.identity.seen = false`,
> `reason: "parent_missing"`, and the spine edge is still emitted with
> `provenance: "inferred_from_usage"` so the node does not float loose.
>
> **Give it its real name.** `deleted_hotels` (hotel_id, hotel_name, handle,
> plan, deleted_at, total_rows) is the deletion ledger and it outlives the
> deletion by design. Look the orphan up there: "Milagu (deleted 2 Sep)" beats
> "(deleted restaurant)", which is what `/ai/by-hotel` prints today.

Fields on every hotel node: `name`, `handle`, `city`, `country`, `plan`,
`subscription_status`, `trial_ends_on`, `is_active`, `is_comp`, `created_at`,
`timezone`, `users`, `users_active`, `last_login`, `features_enabled` (count),
`features_overridden` (count), `ai_daily_override`, `ai_monthly_override`, plus
the measured blocks (`requests`, `errors_4xx`, `errors_5xx`, `db_selects`,
`db_writes`, `db_ms`, `duration_ms`, `ai_calls`, `ai_tokens`, `ai_cost_usd`,
`ai_latency_ms`, `ai_failures`, `actions`) and `shared_usd` (modelled).

**Never on this node: `admin_email`.** `/platform/hotels` returns it and this
endpoint does not need it — one fewer place an address exists is one fewer
place it leaks, and the `href` gets you to the page that has it.

### 2.3 `plan` — 3 nodes

Straight from `features.PLANS`, no query. `starter` / `pro` / `enterprise`,
with `price_hint` (overridden by `platform_config.plan_prices`, exactly as
`/plans` does), `max_users`, `ai_model`, `ai_daily_requests`,
`ai_monthly_tokens`, `trial_days`, and `hotels` — the count of hotel nodes
whose `canonical_plan(plan)` matches. Remember `_LEGACY_PLANS` maps
`kitchen|service|group` onto the current three; a hotel created in that window
must not become a fourth plan node.

### 2.4 `feature` — 33 nodes

One per `features.FEATURES`, in registry order. Fields: `key`, `label`,
`description`, `core`, `enforced`, `is_ai`, `in_plans` (list of plan keys),
`hotels_enabled`, `hotels_using`, `requests`, and — the important one —
**`measurable`**.

> **`measurable: false` is not a bug, it is the truth.** There are 33 features
> and about 30 router areas, and they do not map one to one. `waste`,
> `stock_take`, `money`, `allergens` and `multi_site` have no endpoint of their
> own; they are served under `/api/inventory`, `/api/sales`, `/api/expenses`,
> `/api/recipes`. Those nodes can honestly report *enabled* and can never
> report *used*. They must say so — `"requests": {"value": null, "kind":
> "unmeasured", "reason": "no_endpoint_of_its_own"}` — rather than render a `0`
> that reads as "nobody touched it".

**Where the endpoint-to-feature map lives, and why it must not be a second
dict.** The shape that has cost this project repeatedly is two places kept in
step by hand — `deletion.ORDERED_TABLES` rotted exactly that way and broke
deleting a hotel for any restaurant that had actually been used. So: **add
`areas: tuple[str, ...]` to the existing `Feature` dataclass in `features.py`**,
next to the entitlement and plan data that already drives the Control Room. One
registry, three consumers.

And add the self-check that file already has the pattern for — `PLANS` fails at
import if a plan does not price a feature:

```python
# Every mounted router area must be claimed by exactly one Feature, or
# declared platform/infra. A new router nobody prices is revenue quietly
# lost, which is the same reason the PLANS self-check exists.
for _area in mounted_areas():            # walked off app.routes at startup
    if _area not in _CLAIMED and _area not in PLATFORM_AREAS | UNSOLD_AREAS:
        raise RuntimeError("router area is claimed by no feature: " + _area)
```

Proposed initial `areas` — the templated path after `/api/`, longest-prefix
match wins:

| Feature | areas |
|---|---|
| `inventory` | `inventory` |
| `vendors` | `vendors` |
| `price_comparison` | `vendors/compare` |
| `purchasing` | `purchasing` |
| `recipes` | `recipes` |
| `sales` | `sales` |
| `expenses` | `expenses` |
| `reports` | `reports` |
| `settings` | `hotels`, `custom-fields` |
| `food_safety` | `safety` |
| `party_orders` | `party-quotes` |
| `documents` | `documents` |
| `audit` | `audit` |
| `employees` | `employees` |
| `attendance` | `attendance` |
| `rota` | `rota` |
| `payroll` | `payroll` |
| `self_service` | `me` |
| `hiring` | `jobs`, `public/jobs` |
| `talent` | `talent`, `public/talent` |
| `ordering` | `ordering`, `public/order`, `public/table`, `public/kds` |
| `delivery` | `rider` |
| `branded_site` | `public/hotel-landing` |
| `ai_copilot` | `assistant` |
| `waste`, `stock_take`, `money`, `allergens`, `dashboard`, `multi_site`, `api_access` | none — `measurable: false` |

`PLATFORM_AREAS = {auth, roles, billing, notifications, events, platform,
health}`. `UNSOLD_AREAS = {chat}` — team chat has a router and no Feature, so it
is an unpriced capability. That is a finding the self-check surfaces, not a
reason to fudge the map; `UNSOLD_AREAS` lets this ship while keeping it visible.

`ai_scan`, `ai_insights` and `ai_web` are measured from **`ai_usage.kind`**, not
from a path: `vision -> ai_scan`, `insights -> ai_insights`, `chat ->
ai_copilot`, `kiosk-quote -> ordering`. That map belongs in `features.py` beside
`AI_KEYS`, for the same reason.

> **Two areas must never become hotel traffic.**
>
> **`/api/platform/*` is the operator's own browsing**, and it is stamped with
> *his* hotel_id, because `auth/deps.py:52` sets `request.state.log_hotel =
> str(user.hotel_id)` on every authenticated call and the middleware reads that
> straight into `usage.end_request()`. Left in, his restaurant renders as the
> busiest tenant on the map: wrong, plausible, and exactly the class of number
> this project keeps getting burned by. Route it to
> `platform.metrics.operator_requests` instead.
>
> **`/api/health` and `/api/health/db` are counted.** `main.py` skips paths
> starting with `"/health"` and the router is mounted at `/api/health`, which
> does not. `costs.measured()`'s own caveat string already admits it ("includes
> pool pre-ping and health checks"). Bucket them as infra, off the hotel nodes.

### 2.5 `model` — 2 to 6 nodes

One per `DISTINCT ai_usage.model` **over all time**, plus any model a plan
entitles (`features.PLANS[*].ai_model`) that has never been called — present,
with `calls: null` and `reason: "entitled_never_used"`. A model node that
vanishes because it was quiet in the selected month would make the map lie
about what the platform runs on.

`label` is derived by substring on the id (`haiku` / `sonnet` / `opus`),
falling back to the raw id. **Not** by equality against `features.HAIKU` /
`SONNET`: `cost_map.py` warns in capitals that Bedrock keys move with the model
name and that July billed three models at once. A display map may be
incomplete; it must degrade to the raw string, never to a wrong one.

Fields: `model`, `label`, `provider: "bedrock"`, `hotels` (count), `calls`,
`tokens_in`, `tokens_out`, `cost_usd` (our ledger), `avg_latency_ms`,
`max_latency_ms`, `failures`, `first_seen`, `last_seen`.

No p95. Over six calls a p95 is noise in a statistical costume; avg and max
answer "how much time" honestly at this volume, and `percentile_cont` is one
line away if the fleet grows.

### 2.6 `pool` — 4 nodes

`direct`, `shared`, `platform`, `unclassified` — the four constants in
`cost_map.py`, no more and no fewer. Fields: `amount_usd`, `services` (count)
and `explain`, the pool's own sentence lifted from that module's docstring so
there is one wording rather than two.

`unclassified` is a node **even when it is empty**, because "a new service
quietly folded into a pool is exactly how a $10/month surprise hides".

### 2.7 `aws_service` — 8 to 14 nodes

One per distinct `cloud_cost_daily.service` in the window, **grouped by service,
not by `(service, usage_type)`**. The money page currently renders 13
`EC2 - Other` rows worth $0.0000 between them; as nodes that is 13 dots of
noise. The `usage_type` breakdown rides on the node as a `lines[]` array for the
detail sheet.

Two exceptions, both deliberate:

* **`EC2 - Other` is split**, because `classify()` splits it: `EBS:` lines are
  `shared`, `-AWS-Out-Bytes` and `DataTransfer` are `platform`. One node per
  resulting pool — `aws:EC2 - Other#shared`, `aws:EC2 - Other#platform`.
* **Every key containing `bedrock` collapses into one node**, `aws:bedrock`,
  labelled "Bedrock (all models)". Substring, never equality: the key is
  `Claude Sonnet 4.6 (Amazon Bedrock Edition)` and it changes every time the
  model does.

`label` comes from a **display-only** map (`SERVICE_LABEL`, in `cost_map.py`
beside `classify`): `Amazon Elastic Compute Cloud - Compute` becomes "The app
server (t3.micro)", `Amazon Relational Database Service` becomes "The database
(db.t4g.micro)". Default to the raw key on a miss — a display map is allowed to
be incomplete, a money map is not.

**The shared box nodes are what every restaurant cross-links to.** There is no
separate "machine" or "resource" node type; inventing one would create a second
place where the box's cost lives.

---

## 3. Edge types

Nine. Common shape:

```jsonc
{
  "id":       "uses|hotel:9f3c...|feature:payroll",
  "type":     "uses",
  "source":   "hotel:9f3c...",
  "target":   "feature:payroll",
  "kind":     "measured",        // measured | billed | estimate | static
  "primary":  "requests",
  "w":        0.42,              // measures[primary] / type max. null if unmeasured.
  "measures": { "requests": 812, "db_writes": 64, "errors": 3, "duration_ms": 120400 }
}
```

**Weight is what makes it read as a brain rather than a diagram**, so three
rules:

1. `w` is normalised **within its edge type**, server-side. A client
   normalising across types would be dividing tokens by dollars.
2. `meta.edge_types[t].max` and `.sum` ship too, so the designer can apply
   their own curve (sqrt, log) without scanning the array to find the maximum.
3. When a type's max is 0 or null, **every `w` in that type is `null`** — not
   1.0, not 0.5. Equal thickness on a graph where nothing was measured reads as
   "everything is equally busy", which is the edge-shaped version of printing
   `$0.00`.

| Type | source -> target | kind | primary | What the weight means | From |
|---|---|---|---|---|---|
| `hosts` | platform -> hotel | measured | `requests` | how much of the platform's traffic this restaurant is | `usage_daily` |
| `on_plan` | hotel -> plan | static | none | what they bought | `hotels.plan` via `canonical_plan()` |
| `entitles` | plan -> feature | static | none | the plan includes it. Emitted only where true | `features.plan_matrix()` |
| `overrides` | hotel -> feature | static | none, plus `on: bool` | the operator turned this on or off against the plan | `hotels.features` vs `plan_features(plan)` |
| `uses` | hotel -> feature | measured | `requests` | requests to the endpoints belonging to that feature, in the window | `usage_daily` grouped by area |
| `invokes` | hotel -> model | measured | `tokens` | tokens in + out through that model | `ai_usage` |
| `shares` | hotel -> aws_service | **estimate** | `usd` | modelled share of that shared line | `allocate_shared_cost()` |
| `bills` | pool -> aws_service, platform -> pool | billed | `usd` | what AWS charged | `cloud_cost_daily` |
| `billed_as` | model -> `aws:bedrock` | billed | `usd` | our ledger cost times the reconciliation factor k | `ai_usage` and `reconcile_bedrock()` |

**`overrides`, not the full 33 x N grid.** A hotel's true entitlement is
`plan_features(plan)` merged with its own `features` JSON, which is exactly what
`feature_enabled()` computes. Emitting all of it is ~1,650 edges at 50
restaurants that mostly restate the plan. Emitting only the deltas is typically
0 to 3 edges per hotel, is reconstructible by the client from the `entitles`
edges, and — the actual point — **a visible override is interesting**. A hotel
with Payroll switched on outside its plan is a fact worth seeing. The counts
(`features_enabled`, `features_overridden`) stay on the node so nothing has to
be recomputed to display a number.

**`uses` is the thick one.** It is the flow: which restaurant pushes traffic
into which capability. Emitted only where `requests > 0`, so it is naturally
sparse and never draws a dead line.

**`invokes` carries both axes.** `measures` holds `tokens`, `calls`,
`cost_usd`, `latency_ms` and `failures`. `primary` is `tokens` because that is
what he asked to see, but the UI can drive thickness off `cost_usd` with no
second request. That is why `measures` is a bag and not a scalar.

**Deliberately optional, off by default: `talks_to`** — hotel to hotel, weight
= `chat_messages` count, from `chats.hotel_a` / `hotel_b`. A real cross-link,
and tempting. It is also the only edge on this map made of a relationship
between two customers rather than of infrastructure, so it lives behind
`?include=chat` and is not in the default payload.

---

## 4. Honesty

### 4.1 `presence` — per axis, never one boolean

The two ledgers disagree about who is alive, and the disagreement is real.
`/platform/ai/by-hotel?days=90` returns three restaurants; `/platform/costs/hotels`
returns two rows. **NIRAI.Reading has AI usage — 60 calls, $0.54, 127,458
tokens, last used 2026-09-13 — and no `usage_daily` rows at all.**

The explanation is almost certainly rule four of this project rather than a bug.
`usage_daily` counters started days ago (`min(usage_daily.day)`); `ai_usage` has
been filling for months. A hotel quiet since the 13th is invisible on the
traffic axis because nothing was watching, not because it did nothing. The
check is one line — compare `min(usage_daily.day)` against that hotel's
`max(ai_usage.created_at)` — and the payload must let anyone looking at the
picture make it.

**So liveness is per EDGE TYPE, not per node.** Four independent axes, each
with its own coverage window:

```jsonc
"presence": {
  "identity": { "seen": true,  "since": "2026-05-02T09:14:00Z" },
  "traffic":  { "seen": false, "reason": "not_measured_yet",
                "coverage_from": "2026-09-15",
                "note": "the request counters began after this period started" },
  "ai":       { "seen": true,  "first": "2026-06-30T...", "last": "2026-09-13T...",
                "in_window": true },
  "actions":  { "seen": true,  "last": "2026-09-13T...", "in_window": false }
}
```

`reason` is a closed set:

| reason | means |
|---|---|
| `not_measured_yet` | the window starts before this axis's coverage. **Unknowable, not zero.** |
| `no_activity` | the window is entirely inside coverage and the count is genuinely 0. This one may render as 0. |
| `never` | no rows on this axis, ever, for this node |
| `no_such_source` | nothing anywhere records it. Polly — see 4.4 |
| `no_endpoint_of_its_own` | a feature served under another area. See 2.4 |
| `parent_missing` | orphan — the `hotels` row is gone |

`coverage_from` per axis is global (when that collector started) and lives in
`meta.coverage`. `first` and `last` are per node and come free from the same
`GROUP BY` — 5.2 gets the lifetime and windowed aggregates in one pass, which
is what makes per-axis presence cost nothing extra.

### 4.2 Every number is an envelope

Reuse `costs.envelope()` unchanged. A present number:

```jsonc
"ai_cost_usd": { "value": 2.65, "kind": "measured",
                 "source": "ai_usage reconciled to AWS",
                 "raw_usd": 2.31, "reconciliation_k": 1.147 }
```

An absent one — never `0`, never a dash, never omitted:

```jsonc
"requests": { "value": null, "kind": "unmeasured",
              "reason": "not_measured_yet", "since": "2026-09-15" }
```

Add `costs.UNMEASURED = "unmeasured"` and a one-line
`costs.unmeasured(reason, since=None)` beside `envelope()`, so there is exactly
one place that constructs the absent form.

> **One frontend note, small and real.** `Source.tsx` declares its kind union as
> live, billed, estimate, entered_by_hand — **`measured` is not in it**, and
> `costs.MEASURED = "measured"` is already shipped by `/costs/hotels` on every
> `ai_usd` envelope. Today nothing renders a `Source` chip for those cells, so
> it is latent; feed it one and the ternary chain falls through and labels a
> measured figure "entered by hand" with a slate chip. Extend the union with
> `measured` and `unmeasured`, and give each a `COPY` entry, before this
> endpoint is wired to a chip.

### 4.3 Modelled numbers say so

`shares` edges and each hotel's `shared_usd` are **`kind: "estimate"`**, and the
`shared` pool node carries the model's whole working straight off
`allocate_shared_cost().meta` — `basis_version`, `weights`, `inputs`,
`share_total`, `renormalised` — plus the two sentences that make it honest:

> share = w_app * (app_ms / sum_app_ms) + w_db * (db_ms / sum_db_ms), where
> app_ms = max(0, duration - db - ai_latency)
>
> the shared box costs the same with one restaurant or with fifty. This is a
> split of rent, not of blame.

**Splitting the allocation across the two box nodes.** `allocate_shared_cost()`
returns one combined `allocated_usd`, but the graph needs it per service so the
EC2 edge and the RDS edge each carry their own number. Every input is already on
the returned object:

```
total   = alloc.meta[pool_usd]
w_app   = alloc.meta[weights][app];  S_app = alloc.meta[inputs][sum_app_ms]
w_db    = alloc.meta[weights][db];   S_db  = alloc.meta[inputs][sum_db_ms]

app_usd = total * w_app * (row[app_ms] / S_app)     -> edge to the EC2 node
db_usd  = total * w_db  * (row[db_ms]  / S_db)      -> edge to the RDS node
```

When S_app is 0 the function folds w_app into w_db and records
`renormalised: "app"`. **Emit no EC2 edge at all in that case.** An edge
weighted 0 is a claim that a restaurant used the app server and cost nothing,
which is a different and false statement from "we could not measure it".

While implementing this: `/costs/hotels` currently derives each hotel's
`ai_latency_ms` as avg_latency_ms times calls, round-tripping through an integer
average. `sum(ai_usage.latency_ms)` is the same figure without the loss and is
already in the aggregate below. Use the sum here; the existing endpoint should
adopt it too.

### 4.4 Polly cannot be attributed, so it is not

`classify()` puts `Amazon Polly` in `DIRECT`, whose definition in that file is
"measured per hotel. Bedrock and Polly, we log every call". **We do not.**
`voice.py` and `listen.py` never call `guard.record()`, and `ai_usage` has no
voice or speech kind. So Polly — and Transcribe, if it ever appears on the
bill — is a `direct`-pool `aws_service` node with **no `shares` edge and no
per-hotel edge of any kind**, carrying `attributable: false` and
`reason: "no_such_source"` with the sentence "TTS and STT calls are not logged
per hotel".

It is $0.03 a month, so this is a labelling decision and not a money decision.
But dividing it by request share to tidy the picture would be inventing a
measurement, and sooner or later somebody reads it as one.

### 4.5 The arithmetic must visibly balance

`meta.checks`, in the spirit of `share_total` — so a viewer can see the model is
self-consistent without having to trust it:

```jsonc
"checks": {
  "shared_share_total": 1.0,     // must be 1.0000, or the model has a bug
  "ai_cost_hotels_sum": 3.24,    // sum over hotel nodes, orphans included
  "ai_cost_platform":   3.24,    // platform total. Must match.
  "billed_pools_sum":   16.669,
  "billed_gross":       16.669,
  "orphans": 1,
  "reconciliation_k":   1.147    // null when nothing was logged. NEVER 1.0.
}
```

---

## 5. The endpoint

```
GET /api/platform/graph
    ?from=2026-09-01&to=2026-09-16      # aliases, exactly like /costs/summary
    &days=30                            # fallback when from/to are absent
    &depth=2                            # 1 = spine only, 2 = full (default)
    &include=chat                       # optional extra edge types
    &refresh=1                          # bypass the cache
```

`Depends(require_platform_owner)`. **Returns a plain dict. No `response_model`.**
Nine occurrences of that trap silently dropping fields, and this payload is
deeply nested with dynamic keys — `/costs/summary` says the same thing in its
own docstring and is right to.

```jsonc
{
  "meta": {
    "generated_at": "2026-09-16T11:04:02Z",
    "cached_at": "2026-09-16T11:03:20Z", "cache_ttl_s": 60, "built_ms": 143,
    "window": { "from": "2026-09-01", "to": "2026-09-16",
                "label": "September 2026", "is_open": true, "days": 16 },
    "months": [ /* costs.months(db) - the same strip the money page uses */ ],
    "coverage": {
      "traffic": { "from": "2026-09-15", "source": "min(usage_daily.day)" },
      "ai":      { "from": "2026-06-30", "source": "min(ai_usage.created_at)" },
      "billed":  { "from": "2026-07-01", "source": "min(cloud_cost_daily.day)" },
      "actions": { "from": "2026-06-11", "source": "min(audit_events.created_at)" }
    },
    "collectors": { "usage_flush": {}, "aws_costs": {} },
    "counters_flushed_seconds_ago": 41,
    "node_types": { "hotel": { "label": "Restaurant", "count": 5 } },
    "edge_types": {
      "uses": { "label": "uses", "from": "hotel", "to": "feature",
                "kind": "measured", "primary": "requests",
                "weight_means": "requests to the endpoints belonging to that feature",
                "measures": ["requests","db_writes","errors","duration_ms"],
                "max": { "requests": 1940 }, "sum": { "requests": 5231 },
                "count": 27 }
    },
    "checks": {},
    "caveats": [
      "Request counts include connection-pool pre-ping SELECT 1s and health checks; an executemany counts once.",
      "Operator traffic to /api/platform is held on the platform node, not on the operator's restaurant.",
      "Shared-box figures are a model, not a measurement.",
      "Polly is billed but not logged per restaurant, so it is not attributed."
    ],
    "counts": { "nodes": 41, "edges": 96, "truncated": false }
  },
  "nodes": [],
  "edges": []
}
```

### 5.1 Query count: 8, fixed

Nine with the month strip. **None of them is per hotel, and the count does not
move when the fleet goes from 3 to 50.** The failure mode being designed against
is explicit: a `for hotel in hotels:` with a query inside is 50 round trips per
page load, on a t3.micro sharing a db.t4g.micro with the app everyone is using.
This endpoint is one round trip by contract.

| # | Table | Shape | Rows back |
|---|---|---|---|
| 1 | `hotels` left join `users` | group by hotel | N |
| 2 | `usage_daily` | window, group by hotel x area | N x ~40 |
| 3 | `usage_daily` | lifetime min/max(day) per hotel, index-only | N |
| 4 | `ai_usage` | group by hotel x model x kind, windowed and lifetime in one pass | N x ~6 |
| 5 | `cloud_cost_daily` | `costs.billed()`, unchanged | ~50 |
| 6 | `audit_events` | count in window + max(created_at) per hotel | N |
| 7 | `telemetry_sync` | DISTINCT ON (job) | 2 |
| 8 | `deleted_hotels` | WHERE hotel_id = ANY(:orphans). Skipped when there are none | ~0 |
| 9 | `cloud_cost_daily` | `costs.months()` - the period strip | ~3 |

Plus `usage_mod.COUNTERS.snapshot()`, which is in memory and not a query. It
**must** be composed in — the same live delta that makes `/costs/summary`
current to the second. It is keyed by (day, hotel, method, endpoint), so it is
bucketed to an area in Python exactly as query 2's rows are. Without it the
graph freezes at the last five-minute flush while claiming to be live.

### 5.2 The main aggregate

**Traffic — one grouped scan, not one per restaurant:**

```sql
SELECT u.hotel_id,
       split_part(u.endpoint, '/', 3)   AS seg1,
       split_part(u.endpoint, '/', 4)   AS seg2,
       sum(u.requests)                  AS requests,
       sum(u.errors_4xx)                AS errors_4xx,
       sum(u.errors_5xx)                AS errors_5xx,
       sum(u.duration_ms)               AS duration_ms,
       sum(u.db_selects)                AS db_selects,
       sum(u.db_writes)                 AS db_writes,
       sum(u.db_ms)                     AS db_ms
FROM usage_daily u
WHERE u.day >= :day_from AND u.day <= :day_to
GROUP BY u.hotel_id, 2, 3;
```

`endpoint` is already templated by `main._template()` (`/api/hotels/{id}/staff`),
so the segments are stable. `seg1` is the router area; `seg2` gives the two
cases that need a second level — `public/order` vs `public/table` vs
`public/kds` vs `public/hotel-landing`, and `vendors/compare`, since price
comparison is a sub-router of vendors gated by
`require_feature("price_comparison")`. Python then does longest-prefix matching
of seg1/seg2, then seg1, against the registry's `areas`. Rows back are hotels
times distinct (seg1, seg2), roughly 40 per hotel.

**AI — windowed and lifetime in ONE pass**, which is what makes per-axis
presence free:

```sql
SELECT a.hotel_id, a.model, a.kind,
       count(*)                      FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to) AS calls,
       coalesce(sum(a.input_tokens)  FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to), 0) AS tokens_in,
       coalesce(sum(a.output_tokens) FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to), 0) AS tokens_out,
       coalesce(sum(a.cost_usd)      FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to), 0) AS cost_usd,
       coalesce(sum(a.latency_ms)    FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to), 0) AS latency_ms_sum,
       max(a.latency_ms)             FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to)     AS latency_ms_max,
       count(*)                      FILTER (WHERE a.created_at >= :ts_from
                                               AND a.created_at <  :ts_to
                                               AND NOT a.ok)                   AS failures,
       count(*)                                                                AS calls_ever,
       min(a.created_at)                                                       AS first_ever,
       max(a.created_at)                                                       AS last_ever
FROM ai_usage a
GROUP BY a.hotel_id, a.model, a.kind;
```

Expressible in SQLAlchemy 2 as `func.count().filter(cond)` — no raw SQL needed,
which matters because every other read module here is Core.

> **`< :ts_to`, half-open.** `ts_to` is midnight UTC of the day AFTER `to`.
> `created_at <= to` on a `timestamptz` silently drops everything after
> 00:00:00 on the last day, which is the whole last day. `usage_daily.day` is a
> `Date`, so `<= :day_to` is correct there. The two tables genuinely need
> different comparisons, and that is the trap.
>
> **Everything is UTC.** `usage_daily.day` is UTC because AWS bills in UTC and
> the money page says so; `cloud_cost_daily.day` is the AWS day. Do not bring
> `hotels.timezone` into this. It is an infrastructure map, not a trading day.

Query 4 is a full scan of `ai_usage` — about 400 rows today, perhaps 200k a year
into a 50-restaurant fleet, so tens of milliseconds, once per cache period. It
buys existence, lifetime bounds and windowed measures in one statement. If it
ever stops being cheap, split it: windowed on `ix_ai_usage_hotel_time`, plus a
tiny `GROUP BY hotel_id, model` for the bounds. Do not split it before
measuring.

### 5.3 The other five

```sql
-- 1. identity and people, one query for the whole fleet.
--    /platform/hotels currently loads every User row into Python to do this.
SELECT h.id, h.name, h.username, h.city, h.country, h.plan, h.subscription_status,
       h.trial_ends_on, h.is_active, h.is_comp, h.created_at, h.features, h.timezone,
       h.ai_daily_override, h.ai_monthly_override,
       count(u.id)                             AS users,
       count(u.id) FILTER (WHERE u.is_active)  AS users_active,
       max(u.last_login)                       AS last_login
FROM hotels h
LEFT JOIN users u ON u.hotel_id = h.id
GROUP BY h.id;                     -- legal: h.id is the primary key

-- 3. traffic coverage per hotel. Index-only on ix_usage_daily_hotel_day.
SELECT hotel_id, min(day) AS first_day, max(day) AS last_day
FROM usage_daily
GROUP BY hotel_id;

-- 6. what they have been doing. NOTHING from `summary` - that is tenant content.
SELECT hotel_id,
       count(*) FILTER (WHERE created_at >= :ts_from AND created_at < :ts_to) AS actions,
       max(created_at) AS last_action
FROM audit_events
GROUP BY hotel_id;

-- 7. collector freshness, so a gap in collection is visible
SELECT DISTINCT ON (job) job, started_at, finished_at, ok, rows_written, api_calls, error
FROM telemetry_sync
ORDER BY job, started_at DESC;

-- 8. give the orphans their real names
SELECT hotel_id, hotel_name, handle, plan, deleted_at, total_rows
FROM deleted_hotels
WHERE hotel_id = ANY(:orphan_ids);
```

Query 5 is `costs.billed(db, start, end)` called as-is and query 9 is
`costs.months(db)`. Neither is reimplemented — one AWS-cost reader, not two.

### 5.4 Indexes

Queries 1 to 5, 7 and 9 are served by what already exists. **Query 6 is not.**
`audit_events` is indexed on `hotel_id` alone, so `GROUP BY hotel_id` with
`max(created_at)` has to visit the heap for every row, and `audit_events` is the
fastest-growing table in this set.

```python
op.create_index("ix_audit_events_hotel_time", "audit_events", ["hotel_id", "created_at"])
```

It mirrors `ix_ai_usage_hotel_time`, which exists for exactly this shape, and it
also helps `observability.hotel_activity()` — `WHERE hotel_id = ... ORDER BY
created_at DESC LIMIT 200` does the same heap walk today.

Nothing else. Query 2 reads the whole window out of `usage_daily` because that
IS the data, and a covering index would have to include `endpoint` and would end
up the size of the table. At 50 restaurants across 30 days that scan is roughly
1.2M rows and low seconds — which is an argument for the cache, not for an
index. If it is ever measured above ~2s, the right fix is a
`(day, hotel_id, area)` rollup written by the same five-minute flush that
already writes `usage_daily`. Measure first.

---

## 6. Scale, level of detail, cache

### At 3 restaurants (today)

About 41 nodes and 96 edges, ~25 KB of JSON. Nothing needs collapsing.

### At 50 restaurants, 30 days of usage_daily

| Nodes | n | Edges | n |
|---|---|---|---|
| platform | 1 | `hosts` | 54 |
| pools | 4 | `on_plan` | 50 |
| aws services | ~13 | `entitles` | ~70 |
| plans | 3 | `overrides` | ~100 |
| features | 33 | `uses` | ~750 |
| models | ~5 | `invokes` | ~100 |
| hotels (50 + anon + ~3 orphans) | 54 | `shares` | ~100 |
| | | `bills` + `billed_as` | ~20 |
| **~113** | | **~1,240** | |

**About 340 KB raw, ~40 KB gzipped.** For one viewer on a page he opens
deliberately, that is not a payload problem. Nodes barely grow — 33 features and
about 5 models are fixed — so growth is almost entirely `uses` and `shares`,
both linear in the fleet.

### Where it actually breaks

Not the payload; the layout. A force simulation is comfortable to roughly 2,000
edges and starts costing frames past that, which arrives at about **150 to 200
restaurants**. So:

* **Never paginate.** A graph cut into pages is not a graph. You cut it by
  DEPTH, not by page.
* `depth=1` — platform, hotels, plans, pools, aws services. Spine and money, no
  capability layer. About 75 nodes at 50 restaurants.
* `depth=2` (default) — everything above.
* `?hotel=<id>` — one restaurant's full sub-graph plus the shared nodes it
  touches. This is the "expand a node" call, and it is the same endpoint
  returning the same shape, so the client merges rather than branches.
* Above 2,000 edges the builder emits the top 8 `uses` edges per hotel by
  requests, folds the rest into `hotel.metrics.requests_other`, and sets
  `meta.counts.truncated = true` alongside what was dropped. Truncation that
  does not announce itself is the same lie as a zero.

### Cache

**In-process dict, keyed by (from, to, depth, include).** One container, one
viewer, no Redis.

* **60s TTL when the window includes today.** Long enough that opening four node
  sheets in a row does not rebuild the graph four times; short enough that
  "live" stays true, given the counters flush every five minutes and today is
  composed with the in-memory delta on top of the stored rows.
* **900s for a closed period.** A finished month cannot change — except that
  Cost Explorer restates the last few days, which is why it is fifteen minutes
  rather than forever.
* `meta.cached_at` and `meta.cache_ttl_s` ride in the payload so the UI can say
  "as of 12s ago" and offer a refresh, and `?refresh=1` forces a rebuild.
* Cap the dict at about 8 entries and evict oldest. He can click twelve months
  in the strip; twelve full graphs pinned in a t3.micro's memory is not free.

Deliberately **not** an HTTP `Cache-Control`. A browser caching this would make
the refresh button lie, which is the same class of fault as a health check that
looks identical for slow and failed.

---

## 7. Time

**Yes, it takes a period — the same one the money page takes.** `from` / `to`
aliases, `days` as a fallback, and `meta.months` is `costs.months(db)`, so the
graph and `/control-room/money` are driven by an identical month strip reading
identical rows. The alternative — a second period control with its own semantics
— is the two-places-kept-in-step failure again, and that page already carries a
written apology for having had two windows that disagreed.

**What the period changes:** every `w` and every `measures` on `uses`,
`invokes`, `shares`, `bills`, `billed_as` and `hosts`; every windowed figure in
`node.metrics`; the `aws_service` node set, since a service AWS did not bill
that month is not a node; and each model's windowed counts.

**What the period must NOT change: which nodes exist.** Hotels, features, plans,
models and orphans are the platform's identity, and identity does not depend on
a date range. A restaurant that vanished from the map because it was quiet in
September would be the same failure as printing 0 for it — worse, in fact,
because there would be nothing on screen to question. A quiet node is drawn,
ghosted, with `presence.*.seen = false` and a reason.

The one thing that genuinely narrows the node set is `depth`, which is a request
about detail, not about time.

---

## 8. Multi-tenant safety

This is the one endpoint in DineAI that legitimately crosses tenants, and the
standard is the one `platform_admin/ai.py` already sets: **aggregates and
metadata, never a restaurant's actual operating data.** It is an infrastructure
map, not a data browser.

**Never in this payload, at any depth:**

- dish, menu, recipe, ingredient or item names; any price, cost or margin
- vendor names, invoice numbers, PO contents
- sales, takings, petty cash, P&L or budget figures
- staff or employee names, payroll, payslips, wages, visas, document names
- customer or diner names, addresses, phone numbers, order contents, table codes
- assistant message bodies **and thread titles** — a title is auto-written from
  the first question, so the title IS the question
- `audit_events.summary` — it contains entity names ("Changed price of Basmati
  20kg from 38 to 41"). **Count the rows, never carry the text.**
- `chat_messages` content, and hotel-to-hotel relationships unless
  `?include=chat` is passed
- `users.email` — including `admin_email`, which `/platform/hotels` returns and
  this endpoint has no need of

**Allowed:** hotel name, handle, city, country, plan, subscription status,
active and comp flags, created and last-login timestamps, counts, sums of
requests, DB statements, tokens, latency and cost, feature keys, model ids, AWS
service keys.

Three more:

1. **`require_platform_owner`, no exceptions** — including the `?hotel=`
   variant, which must be guarded by the same dependency and never by a
   comparison against `user.hotel_id`, or an operator-shaped route quietly
   becomes a tenant-shaped one.
2. **The anonymous node is not clickable.** `href: null`, `linkable: false`.
   `/control-room/hotels/0000...` is a 404, and the sentinel is not a
   restaurant.
3. **No new AWS API calls.** Everything comes from our own Postgres.
   `cloud_cost_daily` is the cache and `/costs/refresh` is the only button in
   this app that spends money. The graph must never sit on that path, or opening
   it costs a cent a look.

---

## 9. What could go wrong, specifically

1. **A query inside a `for hotel in hotels:`.** The failure this design exists
   to prevent. 50 restaurants means 50 round trips per page load, on a t3.micro
   sharing a db.t4g.micro with the app everyone is using. **Pin it with a
   test**: attach a `before_cursor_execute` counter, call the endpoint with 3
   hotels and again with 12, and assert the statement count is identical and no
   more than 9.
2. **`response_model` drops half the payload.** Nine occurrences. Plain dict.
3. **A zero where the truth is "not measured".** The whole of section 4. The
   specific trap: `sum()` over an empty group returns 0 in Python, and
   `coalesce(..., 0)` returns 0 in SQL. Both produce a confident zero for a
   restaurant nobody was watching. `presence` is computed from the coverage
   dates BEFORE the metrics are formatted, and it decides which of them become
   `null`.
4. **An orphan silently dropped** by an inner join to `hotels`. Then the
   per-hotel AI column stops summing to the platform total, and `meta.checks`
   catches it — which only works if the check is actually emitted. Every
   aggregate joins `hotels` with `isouter=True`, exactly as
   `observability.ai_by_hotel()` already does.
5. **Matching a Bedrock service key by equality.** `cost_map.py` warns about
   this in capitals: the model name is INSIDE the key, July billed three models
   at once, and the key changes when the model does. Substring on "bedrock",
   everywhere, collapsed to one node.
6. **`created_at <= :to`** dropping the last day of every window. See 5.2.
7. **The operator's own traffic counted as his restaurant's.**
   `/api/platform/*` is stamped with his hotel_id by `auth/deps.py:52`. Left in,
   the busiest node on the map is an artefact of him looking at the map.
8. **Health checks and pool pre-pings inflating every hotel.**
   `costs.measured()`'s caveat string is the evidence, and `/api/health` is
   counted because `main.py` tests its skip-list against a path that starts
   `/api/`.
9. **Normalising weights across edge types** — dividing tokens by dollars. `w`
   is computed server-side, per type, or not at all.
10. **The cache freezing "live".** A payload served from a 60-second cache and
    labelled `kind: "live"` with no `cached_at` cannot be dated from a
    screenshot. Both fields ship.
11. **A client parsing node ids.** Service keys contain " - " and parentheses;
    model ids contain dots and colons. `ref` is the contract.
12. **The area map rotting** the way `deletion.ORDERED_TABLES` did — a new
    router appears, no feature claims it, and a whole capability silently
    disappears from the map. The import-time self-check in `features.py` turns
    that from an invisible omission into a failed deploy.

---

## 10. What I deliberately did NOT include

1. **A node per user.** 750 nodes at 50 restaurants, carrying names and email
   addresses, telling you nothing the count does not. The hotel node carries
   `users` and `users_active`; `/platform/hotels/{id}/users` already covers the
   rest.
2. **A node per endpoint.** Cardinality explodes and the feature layer already
   aggregates them. Escape hatch if it is ever wanted:
   `?hotel=<id>&detail=endpoints`, scoped to one restaurant.
3. **Per-hotel row counts, "data volumes".** He asked "under hotel what are all
   there", and the honest answer is a `COUNT(*)` per table per hotel — about 50
   queries for ONE restaurant, via `deletion._delete_plan()`. That must never be
   inside a graph build. **It already exists as its own endpoint:**
   `GET /api/platform/hotels/{id}/deletion-preview` returns
   `{counts: {table: n}, total_rows}` derived from the live FK graph. Call it on
   node expand. If a fleet-wide figure is ever wanted, it is a nightly rollup
   table, not a page load.
4. **Per-hotel Polly and Transcribe cost.** Not logged anywhere (4.4). Dividing
   it by request share would be inventing a measurement.
5. **Splitting the anonymous node across restaurants.** Tempting, since it is
   72% of traffic. But the public routes carry either a UUID (templated to
   `{id}`) or a table code; the only one carrying a handle is
   `/api/public/hotel-landing/{handle}`, and `_template()` leaves short handles
   intact only by accident of its length-and-hex rule. A v2 could attribute that
   one route by joining seg2 to `hotels.username`. Guessing at the others would
   be fiction.
6. **Per-hotel S3 storage.** Attributable by key prefix
   (`{hotel_id}/{doc_id}/{filename}`) and immaterial at $0.014/month —
   `cost_map.S3_IS_ATTRIBUTABLE_BUT_IMMATERIAL` already records that as a
   decision with a written reason. Reading it would also need an S3 API call,
   which is out of scope by constraint.
7. **`talks_to` edges by default** (hotel to hotel chat). Behind
   `?include=chat`, because it is the only edge made of a relationship between
   two customers rather than of infrastructure.
8. **Live streaming or websockets.** A 60-second cache and a refresh button. He
   opens this deliberately; it is not a wallboard.
9. **Stored snapshots, "what changed since last month".** The period selector
   answers it by re-querying. A snapshot table would be a second source of truth
   for numbers that already have one.
10. **p95 latency.** Over six calls it is noise in a statistical costume. Avg
    and max, and `percentile_cont` is one line away when the fleet grows.
11. **A separate machine or resource node type.** The EC2 and RDS `aws_service`
    nodes ARE the boxes. A parallel type would create a second place where the
    box's cost lives.
12. **`hotels.prefs`, `landing`, `login_page`, `theme`, kiosk settings.** They
    are configuration, not structure, and putting them on the map would turn an
    infrastructure graph into a settings browser.

---

## 11. Build order

1. `features.py` — add `areas` to `Feature`, the `ai_usage.kind` to feature map
   beside `AI_KEYS`, `PLATFORM_AREAS` and `UNSOLD_AREAS`, and the import-time
   self-check. Expect it to fail on the first run; that is it working.
2. `costs.py` — `UNMEASURED` and `unmeasured()` beside `envelope()`.
3. Migration — `ix_audit_events_hotel_time`. Revision id from
   `secrets.token_hex(6)`, single head.
4. `graph.py` — the eight aggregates, the presence resolver, the node and edge
   builders, the normaliser, `meta.checks`, the cache.
5. `router.py` — `@router.get("/graph")`, plain dict, `require_platform_owner`.
6. `Source.tsx` — `measured` and `unmeasured` in the kind union and in `COPY`.
7. Tests, `backend/tests/test_platform_graph.py`:
   - statement count flat across 3 and 12 hotels, and no more than 9
   - a hotel with no `usage_daily` rows renders `not_measured_yet`, not `0`
   - an orphan survives, keeps its spend, and `meta.checks` balances
   - `share_total` is 1.0 when anything was measured, and the EC2 edge is absent
     rather than zero when `sum_app_ms` is 0
   - no `audit_events.summary`, no `users.email`, no `assistant_threads.title`
     anywhere in the serialised payload. Assert on the JSON string: it is the
     cheap version of the privacy rule and it catches the field somebody adds
     next year.
