# Taking payments with Stripe — a plain-English guide

Written for someone who has never set up online payments. No jargon without an
explanation. Read it once end to end before touching anything.

---

## 1. What Stripe actually is

Stripe is the company that handles the card payment for you. You never see or
store a customer's card number — that would make you responsible for protecting
it, which is a legal and technical burden you do not want.

What happens when a restaurant subscribes to DineAI:

1. They click **Upgrade** in our app.
2. We send them to a page **hosted by Stripe** (not by us).
3. They type their card details **into Stripe's page**.
4. Stripe charges them, keeps the money briefly, then **pays it into your bank
   account** on a schedule.
5. Stripe tells our server "this hotel paid" — and our server switches their
   plan on.

The important consequence: **card details never touch our server.** That is the
single biggest reason to use Stripe rather than building payments yourself.

---

## 2. Test mode vs Live mode — read this twice

Stripe gives you **two completely separate worlds**, and this is the thing
newcomers get wrong.

| | Test mode | Live mode |
|---|---|---|
| Money | **Fake.** Nothing real moves. | **Real.** Real cards, real bank. |
| Card to use | `4242 4242 4242 4242`, any future expiry, any CVC | The customer's real card |
| Bank account needed? | **No** | **Yes** |
| Identity checks? | **No** | **Yes** |
| Keys look like | `sk_test_...` | `sk_live_...` |
| Products/prices | Separate list | Separate list |

**They do not share data.** A product you create in test mode does not exist in
live mode. Keys from one do not work in the other.

**How to tell which you are in:** there is a toggle in the Stripe dashboard,
usually top-right, labelled *Test mode*. Also just look at your key: if it
starts `sk_test_` you are in test mode.

> **Do everything in test mode first.** You can complete the entire flow —
> subscribe, upgrade, cancel — without a bank account and without any real
> money moving. Only switch to live when you have a paying customer.

---

## 3. What YOU need to provide

### For test mode — nothing much
- A Stripe account (email + password). That is genuinely it.
- **No bank account. No ID. No company documents.**

You can build and test the entire subscription flow like this.

### For live mode — this is where the real-world bits come in

Stripe has to know who is receiving the money. This is a legal requirement
(anti-money-laundering), not Stripe being awkward. For a UK business:

1. **Business type** — sole trader or limited company. If you have not
   registered a company, sole trader is fine to start.
2. **Your details** — legal name, date of birth, home address. If a limited
   company: the company number from Companies House.
3. **Photo ID** — passport or driving licence. Uploaded, checked automatically,
   usually minutes.
4. **A UK bank account** — sort code and account number, in the name of the
   business or yourself as sole trader. **This is where your money lands.**
5. **A description of what you sell** — "restaurant management software,
   monthly subscription" is enough.

**When do you get paid?** Stripe holds funds briefly then transfers to your bank
— typically **7 days** for a new UK account, dropping to 2 days once you have a
track record. The first payout is often the slowest.

**What Stripe charges you:** for UK cards, roughly **1.5% + 20p** per successful
payment. On a £99/month subscription that is about **£1.69**, so you keep about
£97.31. European and international cards cost more. You pay nothing monthly and
nothing for failed payments.

---

## 4. What I need from you before I can wire it up

Two answers:

1. **Which mode is the key in `docs/secrets/stripe.txt`?** Check whether it
   starts `sk_test_` or `sk_live_`. If it is `sk_live_`, I would rather you
   generate a test key and we build against that first.
2. **Do you want me to create the products and prices for you?** I can do it
   through the Stripe API in a couple of minutes. I have not, because it writes
   into your real account and I will not do that uninvited. You can also create
   them by hand — see below.

---

## 4b. ✅ ALREADY DONE FOR YOU (test mode)

I created these through the API, so you don't need section 5 unless you want to
change something:

| Product | Monthly | Yearly |
|---|---|---|
| DineAI Starter | £39 | £390 |
| DineAI Pro | £99 | £990 |
| DineAI Enterprise | £249 | £2,490 |

Also cleaned up: the old **"Mise Pro £49"** product is archived, and the test
subscription that was on it has been moved onto DineAI Pro (with
`metadata[plan]=pro`, so our webhook grants the right plan).

### ⚠️ One thing only YOU can do — 30 seconds

The customer billing portal still says **"mise erp sandbox"** at the top. That
is the Stripe ACCOUNT name, and Stripe blocks changing your own account name via
the API on purpose (*"You cannot use this method on your own account"*). So:

1. Stripe Dashboard → **Settings** (gear, top right)
2. **Business → Public details** (sometimes "Account details")
3. Change the name to **DineAI**, and set the support email / website while you
   are there — both appear on receipts and the billing portal
4. Save

Do it once in test mode and again later in live mode; they are separate accounts.

---

## 5. Creating the plans by hand (if you prefer)

In the Stripe dashboard, with **Test mode ON**:

**Products → Add product**, three times:

| Product name | Price | Billing |
|---|---|---|
| DineAI Starter | £39 | Monthly, recurring |
| DineAI Pro | £99 | Monthly, recurring |
| DineAI Enterprise | £249 | Monthly, recurring |

Optionally add a second **yearly** price to each (£390 / £990 / £2,490 — ten
months for twelve).

After saving each one, copy its **Price ID** — it looks like `price_1Ab2Cd...`.
**The price ID is what our code needs, not the product ID.** That trips
everyone up the first time.

Send me the six IDs (three monthly, three yearly) and I will wire them in.

---

## 6. What I build once you say go

- **Per-plan checkout** — each plan's Upgrade button opens the right Stripe page.
- **Webhook** — Stripe tells our server when a payment succeeds, fails, or a
  subscription is cancelled. This matters: without it, someone could pay and not
  get their plan, or cancel and keep it.
- **Subscription status enforcement** — right now a hotel marked `past_due`
  keeps full access. It should degrade gracefully with a warning, not silently.
- **14-day trial** — declared in the plan config, but nothing starts or ends a
  trial yet.
- **Customer portal** — a Stripe-hosted page where a customer can update their
  card or cancel, so you never handle that by hand.

---

## 7. Things that will bite you if nobody warns you

- **Test and live are separate.** Creating products in test mode does not create
  them in live. You will do it twice, and that is normal.
- **Never put a secret key in the frontend.** `sk_...` is server-only. The
  frontend uses a publishable key (`pk_...`), which is safe to expose.
- **The webhook needs its own secret** (`whsec_...`), separate from the API key.
  Without it we cannot verify a webhook genuinely came from Stripe — and an
  unverified webhook endpoint is a way for anyone to grant themselves a plan.
- **Prices cannot be deleted**, only archived. So do not create a dozen test
  prices in live mode to experiment — that is what test mode is for.
- **Changing a price does not change existing subscribers.** They stay on the
  price they signed up to until you migrate them deliberately. This is Stripe
  protecting you from accidentally re-pricing your whole customer base.

---

## 8. The shortest path from here

1. Log into Stripe, confirm **Test mode** is on.
2. Tell me the key is `sk_test_...` (or generate one).
3. Either create the three products yourself and send me the price IDs, or tell
   me to create them.
4. I wire up checkout, webhooks, trials and status enforcement.
5. We test end to end with card `4242 4242 4242 4242`.
6. **Only then**, when you have a real customer waiting: complete the live-mode
   business details and bank account, create the same products in live mode, and
   swap the keys.

You do not need a bank account to get all the way to step 5.
