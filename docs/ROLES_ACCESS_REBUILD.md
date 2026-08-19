# Roles & Access — rebuild from zero

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
Roles & Access** — see [[nirai-kiosk-decision]]. Removing it is a bounded first
step of the rebuild.

## Order of work
1. ~~The permissions bug~~ — done, `3d45222`.
2. Prove what is broken: a live pass creating a hotel, staff and logins.
3. Rebuild the model around the PERSON; roles become a saved shortcut.
4. Then the surface, in the purchasing material.

**Not started.** Purchasing came first by his own page-by-page rule, and this is
the next page.
