"""Hotel brand logo — upload, public serve, reject non-image, remove."""
import pytest

from app.auth.models import Role

# a valid 1x1 PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf"
    b"\xc0\xf0\x1f\x00\x05\x05\x02\x00\x84\x9e\xd6\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.mark.asyncio
async def test_hotel_logo_upload_serve_remove(client, make_user, auth_header):
    admin = await make_user("logo@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    me = (await client.get("/api/hotels/me", headers=h)).json()
    assert me["has_logo"] is False
    hotel_id = me["id"]

    up = await client.post(
        "/api/hotels/logo", headers=h, files={"file": ("logo.png", _PNG, "image/png")}
    )
    assert up.status_code == 200 and up.json()["has_logo"] is True

    # PUBLIC serve (no auth header) returns the image bytes
    img = await client.get(f"/api/hotels/{hotel_id}/logo")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert img.content[:4] == b"\x89PNG"

    # a non-image is rejected
    bad = await client.post(
        "/api/hotels/logo", headers=h, files={"file": ("x.txt", b"nope", "text/plain")}
    )
    assert bad.status_code == 400

    # remove → back to default, serve 404s
    rm = await client.delete("/api/hotels/logo", headers=h)
    assert rm.status_code == 200 and rm.json()["has_logo"] is False
    assert (await client.get(f"/api/hotels/{hotel_id}/logo")).status_code == 404
