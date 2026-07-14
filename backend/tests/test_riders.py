"""The rider door: PIN login, assignment, two-leg flow, live beacon on tracking."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_rider_delivery_lifecycle(client, make_user, auth_header):
    owner = await make_user("rideboss@x.com", Role.SUPER_ADMIN.value)
    hdr = auth_header(owner)

    dish = await client.post("/api/ordering/menu", headers=hdr,
                             json={"name": "Biryani", "price": "12.00"})
    dish = dish.json()

    # hotel creates the rider (phone + PIN)
    r = await client.post("/api/ordering/riders", headers=hdr,
                          json={"name": "Ravi", "phone": "07700111222", "pin": "4321"})
    assert r.status_code == 201
    rider_id = r.json()["id"]

    # rider signs in at the rider door
    bad = await client.post("/api/rider/login", json={"phone": "07700111222", "pin": "9999"})
    assert bad.status_code == 401
    login = await client.post("/api/rider/login", json={"phone": "07700111222", "pin": "4321"})
    assert login.status_code == 200
    rhdr = {"Authorization": f"Bearer {login.json()['access_token']}"}
    await client.post("/api/rider/online", headers=rhdr, json={"online": True})

    # a delivery order arrives and reaches READY
    placed = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={"customer_name": "Zara", "phone": "07700", "fulfilment": "DELIVERY",
              "address_text": "1 High St", "address_lat": "51.5", "address_lng": "-0.1",
              "items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    oid = placed.json()["id"]
    for nxt in ["CONFIRMED", "PREPARING", "READY"]:
        await client.patch(f"/api/ordering/orders/{oid}", headers=hdr, json={"status": nxt})

    # kitchen assigns; the rider sees the job as leg ① (collect)
    a = await client.post(f"/api/ordering/orders/{oid}/assign", headers=hdr,
                          json={"rider_id": rider_id})
    assert a.status_code == 200
    me = await client.get("/api/rider/me", headers=rhdr)
    assert me.json()["active"]["code"] == placed.json()["code"]

    # pickup -> OUT_FOR_DELIVERY; beacon flows to the PUBLIC tracking payload
    up = await client.post(f"/api/rider/orders/{oid}/pickup", headers=rhdr)
    assert up.status_code == 200 and up.json()["status"] == "OUT_FOR_DELIVERY"
    await client.post("/api/rider/location", headers=rhdr,
                      json={"lat": "51.4990", "lng": "-0.1200"})
    track = await client.get(f"/api/public/order/track/{oid}")
    body = track.json()
    assert body["rider"]["name"] == "Ravi"
    assert body["rider"]["lat"] == "51.499000"

    # handover needs the CUSTOMER's PIN (public tracking reveals it) + a photo
    pin = (await client.get(f"/api/public/order/track/{oid}")).json()["delivery_pin"]
    assert pin and len(pin) == 4
    wrong = await client.post(
        f"/api/rider/orders/{oid}/deliver", headers=rhdr,
        data={"pin": "0000" if pin != "0000" else "1111"},
        files={"photo": ("door.jpg", b"fake-jpeg-bytes", "image/jpeg")},
    )
    assert wrong.status_code == 400
    done = await client.post(
        f"/api/rider/orders/{oid}/deliver", headers=rhdr,
        data={"pin": pin},
        files={"photo": ("door.jpg", b"fake-jpeg-bytes", "image/jpeg")},
    )
    assert done.status_code == 200 and done.json()["status"] == "COMPLETED"

    # a rider can't touch another kitchen's orders (wrong-rider 409/404 path)
    replay = await client.post(f"/api/rider/orders/{oid}/pickup", headers=rhdr)
    assert replay.status_code == 409
