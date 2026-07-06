"""Draw the hotel's uploaded logo onto an fpdf2 PDF header. Best-effort: any failure
(no logo, missing file, bad image) is swallowed so a document never breaks over its
branding. Returns True when a logo was drawn, so callers can shift the title across."""
import io


def draw_hotel_logo(pdf, hotel, x: float = 13, y: float = 6, height: float = 18) -> bool:
    key = getattr(hotel, "logo_key", None)
    if not key:
        return False
    try:
        from app.core.storage import get_storage

        data = get_storage().read(key)
        pdf.image(io.BytesIO(data), x=x, y=y, h=height)  # width auto-scales to keep ratio
        return True
    except Exception:  # noqa: BLE001 — branding is never worth a 500
        return False
