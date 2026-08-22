# Batch 5 — Roles & Access, 22 Aug

Grow/shrink signed off ("perfect now"). Everything below is what came next.

| # | What he said | Status |
|---|---|---|
| 17 | "the last 2 cards is hitting bottom… last category I can't click" | ✅ rail can scroll as a last resort; Dashboard note moved out of the cards |
| 18 | "this popup UI you can make better to look — it looks simple now" | ⬜ |
| 19 | "while adding new login… make this a POPUP instead of in-place" | ✅ `AddLoginModal` |
| 20 | "'What are they?' — why the word they?" | ✅ "What is this person?" |
| 21 | **Bulk import** via template + preview + one click | ✅ download, upload, preview table, confirm |
| 22 | **AI bulk add** in plain English with follow-ups | ✅ `/auth/users/draft-from-text` → same preview |
| 23 | placement without making it clumsy | ✅ three routes INSIDE the one popup, not three new buttons |

---

## 17 · The clipping

His screenshots show the bottom row of switch cards cut off by the footer, and
the last item in the left rail unreachable. Same on both tabs.

Measured at 1280×800 the panel is 535px tall in an 800px viewport and nothing
overflows — so this only bites at his height, where the content grows past
`max-h-[94dvh]`. The rail is `overflow-visible` (deliberately, so it never
scrolls) which means when it *does* exceed the space it is simply clipped, and
the last category becomes unclickable rather than reachable.

Needs measuring at his viewport, not mine.

## 19 + 20 · The add-login form

In-place, it pushes the whole board down — "makes the UI stretch". It becomes a
popup. And "What are they?" is wrong for a single person; it reads as a group.

## 21 + 22 · Two ways to add a hundred people

> "suppose hotel has 100 workers, owner can't add 100 one by one."

Both end at the same place — a **preview of every row in a popup**, checked, then
one click to create — because creating 100 logins is not something anybody
should do blind.

- **Template**: download CSV/XLSX, fill it, upload, preview, confirm.
- **AI**: paste or type anything ("I've got 12 kitchen staff, here are their
  names…"), Sonnet reads it, asks what is missing, and produces the same preview
  table for the same confirm step.

## 23 · Where the buttons go

The toolbar already carries By job · By person · search · Add a login. Four
controls is the limit before it reads as a cockpit, so the new ways to add
people belong **inside** the add-login popup as its three routes — one at a
time, one on screen — rather than three more buttons on the page.
