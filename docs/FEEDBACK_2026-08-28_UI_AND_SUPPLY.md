# 2026-08-28 — the UI sweep and the supply-side features

| # | What he asked for | State |
|---|---|---|
| 1 | Every page to follow the **Roles & Access / Purchasing** UI. Sales + Expenses: core numbers FIRST, pie charts LAST | ☐ |
| 2 | Change an item's vendor **from the Inventory screen** | ☐ |
| 3 | Purchasing: **show by** category / vendor / price high-low | ☐ |
| 4 | Keep edit-in-place everywhere it makes sense | ☐ |
| 5 | Purchasing: showing by vendor → move that vendor's **whole list into the basket** | ☐ |
| 6 | Vendors: **download** a vendor's items with prices | ☐ |
| 7 | PO / indent PDF: **no prices**; and show the PACK he ordered ("1 pack"), not "1 litre" | ☐ |

## 7 is a correctness bug, not a preference

If he orders one pack that holds ten kilos, the PDF has been printing "1 kg".
The supplier reads the PDF. A quantity that is wrong by a factor of ten, on the
document that goes to the person filling the order, is the same class of fault
as the shift that landed on the wrong day.
