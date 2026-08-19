# Dine-in — what he asked for next

Everything below is his, quoted. Built in this order.

---

## ✅ Done in `ed29ebc`

- **Printing.** Seven sheets for six tables, one card stranded per page, sidebar
  and mobile nav printed down the middle. Now: navigation gone, two cards
  across, each card refuses to break across a page.
- **Seats.** *"how you know each table will have 4 seats... it depends, so we
  need to get these datas from super admin."* Asked for on both creators.
- **Freeing a table.** *"how we will release the table? Let super admin or chef
  release the table so that new customer can come and occupy and cycle goes
  on."* Completes what is open on it, keeps the history.
- **Kitchen screen with no login.** *"so that the kitchen staff no need to have
  my super admin creds in tab."* Own long random address, rotatable, reads and
  moves tickets and nothing else.
- **The estimate.** *"where we will choose the estimate time?"* On the kitchen
  page, beside the tickets it governs.

---

## 1. The QR is printed once and lives on a table — treat it that way

> "everytime hotel wont generate qr and keep on changing... they will create qr
> once and they will print and paste in table, that's it, it stays. Later if
> hotel need means they can again do this. It's not like frequent process, so we
> need to be careful with qr and link to manage in app."

He is right and it changes the emphasis: the code is **permanent by default**.
Already true — the code is minted once, `label` is editable and `code` is not,
so renaming a table never kills a printed card. What is still missing:

- **A visible warning** anywhere a code could change, and no accidental path to
  it at all.
- **Reprint one card** without reprinting the sheet (a card gets spilled on).
- **Deleting a table** should say plainly that the printed card dies with it.
- **Download the sheet as PDF** so a print shop can do it properly.

## 2. Menu management, and an AI that reads a menu

> "we need a menu feature like super admin can decide the menu page or he can
> upload the menu so that our AI can see the menu photo or excel and he can add
> to menu... super admin can delete the menu, delete any recipe, mark as out of
> stock, or over, or not served, only served at this particular time etc — all
> these kinda feature we need."

Four separate things:

1. **A menu page** for the owner: add, edit, reorder, delete, with photos.
   Partly exists (`/orders` has menu CRUD) but is not a first-class page.
2. **Upload a menu and have the AI read it** — photo or spreadsheet in,
   proposed items out, confirm before anything is written. The bill-scanning
   path already does exactly this shape (`bedrock.understand_document`), so it
   is a new prompt and a confirm screen rather than new machinery.
3. **Availability, properly.** Not one boolean:
   - *out of stock* — temporarily gone, comes back
   - *finished for today* — gone until tomorrow, clears itself overnight
   - *not served* — off the menu, kept for history
4. **Served only at certain times.** Breakfast until 11, thali at lunch only.
   Needs `serve_from` / `serve_to` per item and filtering on the diner's page.

## 3. The diner can send a message, and ask the AI

> "customer sitting in table can also msg using that QR in that same menu page
> itself — we need a send msg feature, he can send whatever he want (have some
> suggestions here so that customer no need to type). Have our Sonnet AI also
> here, so that customer can ask any details abt this hotel — what's so special,
> what famous, branches of this hotel, origin, contact, owner name etc."
>
> **"make our ai not to answer profit or revenue kinda question abt hotels"**

Two features sharing one box:

- **A message to the kitchen** with tap-to-send suggestions (more water, extra
  napkins, the bill, less spicy, a highchair) so nobody has to type. Lands on
  the kitchen screen exactly like the 🔔 does.
- **A guest assistant**, scoped hard. It answers about the hotel — story,
  specialities, branches, hours, contact — and **must refuse anything
  commercial**: revenue, profit, margins, costs, wages, supplier prices, what a
  dish costs to make.

  **This is a hard boundary, not a prompt suggestion.** A guest-facing model
  that will discuss margins if asked nicely is a data leak with a chat box in
  front of it. Design: a separate public endpoint with its own system prompt and
  its own allow-list of context — it is handed the hotel's *public* profile and
  menu only, never the P&L, never inventory costs, never payroll. It cannot leak
  what it was never given, which is the only guarantee that survives a clever
  question.

---

## Order of work
1. Menu page + availability states + serving times (the owner's daily tool).
2. AI menu import (photo/Excel → confirm → menu).
3. Diner messaging + suggestions.
4. The guest assistant, on a starved context.
5. QR care: reprint one, PDF sheet, louder warnings.
