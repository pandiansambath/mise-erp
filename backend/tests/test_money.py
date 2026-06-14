"""Money Intelligence (insights) tests — the read-only profit lens.

Exercises the new GET /reports/money queries: stock value, dish-margin ranking,
vendor price-rise alerts (from PO history) and the composed money_centre payload
(which also validates against the MoneyCentre schema — catching shape drift)."""
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.inventory import service as inv
from app.purchasing.models import POItem, PurchaseOrder
from app.recipes import service as rec
from app.reports import insights
from app.reports.schemas import MoneyCentre
from app.vendors import service as ven


@pytest.mark.asyncio
async def test_stock_value_by_category(db, hotel):
    veg = await inv.create_item(db, hotel.id, name="Tomato", unit="kg", category="Vegetables")
    oil = await inv.create_item(db, hotel.id, name="Sunflower Oil", unit="litre", category="Oils")
    # 10 kg @ £2 = £20 ; 5 litre @ £3 = £15
    await inv.record_movement(db, veg, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("2.00"))
    await inv.record_movement(db, oil, "PURCHASE_IN", Decimal("5"), unit_cost=Decimal("3.00"))

    sv = await insights.stock_value(db, hotel.id)
    assert sv["total"] == Decimal("35.00")
    assert sv["item_count"] == 2
    cats = {c["category"]: c["value"] for c in sv["by_category"]}
    assert cats["Vegetables"] == Decimal("20.00")
    assert cats["Oils"] == Decimal("15.00")
    # sorted by value desc
    assert sv["by_category"][0]["category"] == "Vegetables"


@pytest.mark.asyncio
async def test_dish_margins_ranks_and_flags_unpriced(db, hotel):
    cheap = await inv.create_item(db, hotel.id, name="Flour", unit="kg")
    pricey = await inv.create_item(db, hotel.id, name="Saffron", unit="kg")
    v = await ven.create_vendor(db, hotel.id, name="SK")
    await ven.upsert_vendor_item(db, v.id, cheap.id, Decimal("1.00"))
    await ven.upsert_vendor_item(db, v.id, pricey.id, Decimal("90.00"))

    # High margin: sells £20, ~£1 cost
    gold = await rec.create_recipe(db, hotel.id, name="Gold", servings_default=1, selling_price=Decimal("20.00"))
    await rec.upsert_ingredient(db, gold.id, cheap.id, Decimal("1"), "kg")
    # Thin margin: sells £10 but ~£9 cost
    thin = await rec.create_recipe(db, hotel.id, name="Thin", servings_default=10, selling_price=Decimal("10.00"))
    await rec.upsert_ingredient(db, thin.id, pricey.id, Decimal("1"), "kg")
    # No price set
    await rec.create_recipe(db, hotel.id, name="Unpriced", servings_default=1)

    for r in (gold, thin):
        await rec.calculate_recipe_cost(db, r.id, hotel.id)

    dm = await insights.dish_margins(db, hotel.id)
    assert dm["total_count"] == 3
    assert dm["priced_count"] == 2
    # every priced dish is listed, ranked best margin → thinnest
    assert [d["name"] for d in dm["ranked"]] == ["Gold", "Thin"]
    assert [d["name"] for d in dm["no_price"]] == ["Unpriced"]


async def _po_with_price(db, hotel, vendor, item, price, when, n):
    po = PurchaseOrder(
        hotel_id=hotel.id,
        vendor_id=vendor.id,
        po_number=f"PO-{n}",
        total_amount=price * 10,
        created_at=when,
    )
    db.add(po)
    await db.flush()
    db.add(
        POItem(
            po_id=po.id,
            item_id=item.id,
            ordered_qty=Decimal("10"),
            unit_price=price,
            line_total=price * 10,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_price_alerts_flags_rise(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Tomato", unit="kg")
    risen = await inv.create_item(db, hotel.id, name="Onion", unit="kg")
    v = await ven.create_vendor(db, hotel.id, name="SK")

    # Tomato: 2.00 -> 2.50 (a 25% rise) across two orders
    await _po_with_price(db, hotel, v, item, Decimal("2.00"), datetime(2026, 1, 1, tzinfo=UTC), 1)
    await _po_with_price(db, hotel, v, item, Decimal("2.50"), datetime(2026, 2, 1, tzinfo=UTC), 2)
    # Onion: 5.00 -> 4.00 (a fall) — must NOT alert
    await _po_with_price(db, hotel, v, risen, Decimal("5.00"), datetime(2026, 1, 1, tzinfo=UTC), 3)
    await _po_with_price(db, hotel, v, risen, Decimal("4.00"), datetime(2026, 2, 1, tzinfo=UTC), 4)

    alerts = await insights.price_alerts(db, hotel.id, threshold_pct=Decimal("5"))
    assert len(alerts) == 1
    a = alerts[0]
    assert a["item_name"] == "Tomato"
    assert a["prev_price"] == Decimal("2.00")
    assert a["latest_price"] == Decimal("2.50")
    assert a["change_pct"] == Decimal("25.00")
    assert a["vendor_name"] == "SK"


@pytest.mark.asyncio
async def test_money_centre_payload_validates(db, hotel):
    """Smoke: the composed payload must build and validate against MoneyCentre
    even on a near-empty hotel (no sales/expenses) — no divide-by-zero, no shape drift."""
    await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    data = await insights.money_centre(db, hotel.id)
    model = MoneyCentre.model_validate(data)  # raises if keys/types drift
    assert model.break_even.break_even_sales is None  # no sales/margin yet
    assert model.stock_value.total == Decimal("0.00")
    assert model.dish_margins.total_count == 0
    assert model.price_alerts == []
    assert model.waste.total == Decimal("0.00")
    assert model.waste.entry_count == 0
    assert model.food_cost_variance.has_data is False  # no dish sales yet


@pytest.mark.asyncio
async def test_waste_decrements_stock_and_values_at_avg_cost(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Milk", unit="litre")
    # 10 litre in @ £1.50 → avg cost 1.50, stock 10
    await inv.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("1.50"))

    mv = await inv.record_waste(db, item, Decimal("4"), "spoiled", created_by=None)
    assert item.current_stock == Decimal("6.000")  # 10 − 4 wasted
    assert mv.unit_cost == Decimal("1.50")  # stamped at weighted-avg cost

    rows = await inv.list_waste(db, hotel.id)
    assert len(rows) == 1
    assert rows[0]["quantity"] == Decimal("4.000")  # positive magnitude
    assert rows[0]["value"] == Decimal("6.00")  # 4 × £1.50
    assert rows[0]["reason"] == "spoiled"

    # …and it shows up as a £ leak on the Money page
    today = datetime.now(UTC).date()
    wc = await insights.waste_cost(db, hotel.id, today, today)
    assert wc["total"] == Decimal("6.00")
    assert wc["entry_count"] == 1


@pytest.mark.asyncio
async def test_menu_engineering_classifies(db, hotel):
    from app.sales import service as sales_svc

    flour = await inv.create_item(db, hotel.id, name="Flour", unit="kg")
    v = await ven.create_vendor(db, hotel.id, name="SK")
    await ven.upsert_vendor_item(db, v.id, flour.id, Decimal("1.00"))
    # Star: sells £20, ~£1 cost (high margin). Dog: sells £5, ~£4 cost (low margin).
    star = await rec.create_recipe(db, hotel.id, name="Star Dish", servings_default=1, selling_price=Decimal("20.00"))
    await rec.upsert_ingredient(db, star.id, flour.id, Decimal("1"), "kg")
    dog = await rec.create_recipe(db, hotel.id, name="Dog Dish", servings_default=1, selling_price=Decimal("5.00"))
    await rec.upsert_ingredient(db, dog.id, flour.id, Decimal("4"), "kg")
    for r in (star, dog):
        await rec.calculate_recipe_cost(db, r.id, hotel.id)

    day = datetime.now(UTC).date()
    # Star sells a lot; Dog sells few → popularity + margin both split them
    await sales_svc.upsert_dish_sales(db, hotel.id, day, {star.id: 30, dog.id: 2})

    me = await insights.menu_engineering(db, hotel.id, day, day)
    assert me["has_data"] is True
    assert me["total_units"] == 32
    klass = {d["name"]: d["klass"] for d in me["dishes"]}
    assert klass["Star Dish"] == "star"
    assert klass["Dog Dish"] == "dog"
