# Roles & Access — rebuilt (2026-08-19)

> "how you made the UI UX of purchase section this much awesome — like this we
> need to do for next section which is roles and access section. Keep purchase
> section UI as a reference."
> "literally redesign UI UX functionality literally from zero to hero."

Purchasing is the reference. Its rules are in
[PURCHASING_DESIGN_SYSTEM.md](PURCHASING_DESIGN_SYSTEM.md) and they carry over
unchanged: one material, depth is a side, colour is information, motion shows
cause and effect.

---

## The bug, fixed (2026-08-14)

> "even when I create a role with expense for manager and add this role, when I
> login in that manager account I can't able to see expense section."

**Cause:** the frontend held a hardcoded copy of the permission matrix keyed on
the base role name, so a custom role could not possibly change what it showed —
and the copy had drifted from the server as well (backend MANAGER could write
expenses; the client's MANAGER list did not mention expenses at all).

**Fix:** the server now sends the person's EFFECTIVE permissions at sign-in and
on every `/me`, custom role resolved. The client's table survives only as a
fallback for the moment before the first answer and can never override the
server. Shipped in `3d45222`.

---

## What is still wrong — the redesign

### 1. The model asks a layman to think like an administrator
> "creating role for role like manager and assigning to role like manager or
> staff, it's confusing the laymans bro. We definitely do something simpler for
> them to easily do whatever they want (here layman I mean is the superadmin
> itself, a layman sometimes)."

Today: pick a BASE ROLE → toggle permissions inside its envelope → save a named
role → separately ATTACH it to a person. Four concepts (archetype, envelope,
role, attachment) to answer one question: *what should Ravi be allowed to do?*

**The direction:** start from the PERSON, not the abstraction.
- Open a person → see what they can reach, in plain sections (Money, Stock,
  People, Kitchen), each a simple three-way: **can't see · can see · can change**.
- "Save this as a role" is an OPTIONAL second step, offered only once a
  combination has been built — the way one saves a filter, not a prerequisite.
- Base archetypes stay underneath as safety rails, but nobody has to name one.

### 2. The owner must be able to do anything
> "super admin can do anything (as he is the leader owner) — he can give access
> to anyone."

Confirm no envelope, no toggle and no guard can stop a SUPER_ADMIN, and that
granting is never blocked, only warned about.

### 3. Things that do not work
> "here some features and buttons and toggle are not working."

Needs a pass with a real hotel, real staff and real logins — his instruction:
*"create your own hotel, own staff and own logins and check deeply please."*
Every toggle, every attach, every deactivate, signed in AS that person.

### 4. The page's UI
Three summary cards, a bare add-a-member form, a role card, an attach panel —
none of it in the purchasing material. Wants the same treatment.

---

## What the live page actually shows (2026-08-19, screenshot)

Driven with his superadmin login, not read from notes:

```
Who can sign in    13 accounts
What roles grant    1 role designed
Who holds one       0 attached        <-- nobody holds it
```

**The one role that exists — "sub-admin, behaves like manager, 15 things" — is
attached to NOBODY.** That is his complaint measured rather than described:
somebody designed a role and it never reached a person, because designing and
attaching are two separate acts and only the first one feels like the job.

The create flow on screen is exactly the chain he called confusing:

> "Create a role — Start from the job it most resembles. That choice sets the
>  ceiling — you can turn things off, and on again, but never beyond what that
>  job should ever reach."
> Manager · Chef/kitchen · Accounts · Till · Staff · Kiosk

Four concepts (archetype → ceiling → named role → attachment) before anyone can
answer "what should Ravi be allowed to do?".

**Also visible and wrong:** `Kiosk` is offered as a base role. Per his standing
decision the kiosk is PIN-only at `<hotel>/kiosk` and **nothing kiosk belongs in
Roles & Access**.

Where it comes from — traced, not guessed: `Role.KIOSK` is a **backend** role
(`app/auth/models.py:24`) whose envelope is deliberately **sealed**
(`app/auth/kiosk.py`), and `components/RoleBuilder.tsx` renders its archetype
tiles from the server's role list rather than from `lib/permissions.ts` — which
is why the frontend `ROLES` array has no KIOSK and the tile appears anyway.
**The fix is to filter KIOSK out of the archetypes the builder offers, NOT to
touch the role itself** — the tablet login depends on it.

✅ **DONE (`91f3910`), confirmed by screenshot:** the archetype grid now ends at
Staff. Filtered in `RoleBuilder`, backend untouched, kiosk still works.

## Order of work
1. ~~The permissions bug~~ — done, `3d45222`.
2. Prove what is broken: a live pass creating a hotel, staff and logins.
3. Rebuild the model around the PERSON; roles become a saved shortcut.
4. Then the surface, in the purchasing material.

**Not started.** Purchasing came first by his own page-by-page rule, and this is
the next page.


---

# ✅ REBUILT AND SHIPPED — `84246e8`

## What it is now
A list of PEOPLE. Tap one, set what they can reach, save. That is the whole
interaction, and it replaces: choose an archetype → toggle inside an envelope
you cannot see → name and save a role → find the attach panel → attach.

- **`PUT /roles/user/{id}/access`** does the four old steps in one call. It
  creates the custom role, names it after the person, attaches it, and — when
  the access matches their job exactly — deletes it again rather than leaving an
  empty role pretending to be a decision.
- **39 permissions became 14 areas** a chef would recognise (`lib/access.ts`),
  each with ONE control at three positions: **No access · Can see · Can change**.
  A segmented control makes "can change but cannot see" unrepresentable, which
  two on/off switches did not.
- **The ceiling is untouched.** `resolve_permissions` still discards anything
  outside the archetype envelope, and a test proves a waiter cannot reach hiring
  *through the new door*.
- **Nothing saves until pressed.** Changed rows are ringed and say *"was 'Can
  see' · not saved yet"*; the footer arms with Save / Undo. His confirmation
  gate: "even in that 1 sec they will change their mind and regret."
- `RoleBuilder` and `RoleAttach` are deleted.

## Two things only the screenshots caught
1. **Staff read "0 of 0 areas"** — the commonest job on the page looking broken.
   All their permissions are the `:self` kind and I had filed none of them.
   There is now a **"Their own"** section — their own rota, payslips, documents
   — which is what a staff login is actually FOR.
2. **The attendance tablet was listed as a person to tap.** KIOSK accounts are
   filtered out, same reasoning as removing Kiosk from the jobs.

## Verified live, by picture not by string
Opened balaji (Staff), moved "Their own rota & hours" to **No access**: the row
ringed, the subtitle became *was "Can see" · not saved yet*, the headline fell
from **2 of 3** to **1 of 3** as it was clicked, Save armed, the save landed and
the card now reads **tailored**.
