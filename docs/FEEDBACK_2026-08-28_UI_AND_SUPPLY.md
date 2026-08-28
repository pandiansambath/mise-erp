# 2026-08-28 — the UI sweep and the supply-side features

| # | What he asked for | State |
|---|---|---|
| 1 | Every page to follow the **Roles & Access / Purchasing** UI. Sales + Expenses: core numbers FIRST, pie charts LAST | ◑ built — Sales & Expenses reordered (totals → work → charts). The wider style sweep is still open |
| 2 | Change an item's vendor **from the Inventory screen** | ✅ built — supplier list in the item's detail sheet, per-base price, one tap to switch |
| 3 | Purchasing: **show by** category / vendor / price high-low | ✅ built — three buttons above the pad; price mode ranks per BASE unit |
| 4 | Keep edit-in-place everywhere it makes sense | ◑ inventory supplier switch is in place; nothing removed anywhere |
| 5 | Purchasing: showing by vendor → move that vendor's **whole list into the basket** | ✅ built — "Add all" on each supplier tile, quantities topped up to minimum |
| 6 | Vendors: **download** a vendor's items with prices | ✅ built — `GET /vendors/{id}/price-list.xlsx`, hotel-scoped on the item |
| 7 | PO / indent PDF: **no prices**; and show the PACK he ordered ("1 pack"), not "1 litre" | ✅ built — 10 kg → "1 pack", 20 → "2 packs", 15 → stays "15 kg" |

## 7 is a correctness bug, not a preference

If he orders one pack that holds ten kilos, the PDF has been printing "1 kg".
The supplier reads the PDF. A quantity that is wrong by a factor of ten, on the
document that goes to the person filling the order, is the same class of fault
as the shift that landed on the wrong day.


## Two deploys failed and I did not look

`36a8520` (the supply-side tools) and `b9cad09` (the PO fix + vendor download)
both went red, and I reported them as shipped. The site stayed on `c234369` the
whole time, so none of it was ever on his tenant.

The cause was not flaky. Coverage fell to **69% against a 70% floor** — about
500 statements of new tool code with no tests behind it. The gate did its job;
I was the one who did not read it.

Fixed by writing the tests that were missing rather than by moving the floor:

- `tests/test_assistant_supply_tools.py` — all twelve new tools against an
  EMPTY hotel as well as a populated one, because an empty restaurant is what a
  new tenant is on day one, and a tool that raises is indistinguishable from a
  tool that was never built.
- `tests/test_po_pack_wording.py` — 1 pack / 2 packs / and the 15 kg case that
  must NOT convert.
- `tests/test_vendor_price_list.py` — including a vendor id from another tenant,
  since that id travels in the URL.

**Rule for me:** watch every deploy to green before saying a thing shipped.

## Still open

- The wider style sweep for item 1 (vendors, price-comparison, expenses tables
  are still plain where purchasing is tactile).
- Live verification of everything above on his tenant, with screenshots.
