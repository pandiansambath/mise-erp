"""Fields a hotel adds for itself, on top of the ones we ship.

    "have a customisation button like — what if super admin wants one field
     like he wants to get staff's address."

A restaurant keeps things about its staff and its suppliers that no schema can
predict: a locker number, a rep's mobile, whose van it is. The alternative to
this table is what every ERP without it ends up with — everything important
crammed into a free-text "notes" box that nothing can search, sort, or warn on.

TWO TABLES, NOT ONE
`CustomField` is the DEFINITION (this hotel keeps "Locker number", it is text,
it sits in the "Day to day" group). The VALUE lives in a JSONB column on the
row it belongs to — `employees.custom`, `vendors.custom`.

Values could have been a third table, one row per field per employee. They are
not, because every read of an employee would then need a join and a pivot to
show a form, and the form is the only thing anybody ever wants. JSONB keeps a
record whole: one row, one SELECT, and Postgres can still index into it if we
ever need to query by a custom field.

The cost of that choice is honest and worth stating: a value whose definition
is deleted becomes an orphan key in the JSON. That is deliberate — deleting a
field definition should not silently destroy the data somebody typed. It is
hidden from the form and comes back if the field is re-added.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CustomField(Base):
    """One extra field this hotel keeps about its staff or its suppliers."""

    __tablename__ = "custom_fields"
    __table_args__ = (
        # A hotel cannot have the same key twice on the same kind of record.
        # Scoped to the ENTITY as well as the hotel, so "notes" on a vendor and
        # "notes" on an employee are different fields — they are different
        # forms and there is no reason one should block the other.
        UniqueConstraint("hotel_id", "entity", "key", name="uq_custom_field_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    #: "employee" | "vendor". A plain string rather than an enum so adding the
    #: third kind of record is a catalogue entry, not a migration.
    entity: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    #: The JSON key the value is stored under. Immutable once created — the
    #: label can be renamed freely, but changing the key would orphan every
    #: value already saved.
    key: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    #: See `catalogue.FieldType`. Validated at the API edge, not here, so a
    #: type we stop supporting does not make old rows unreadable.
    type: Mapped[str] = mapped_column(String(20), nullable=False, default="text")
    group: Mapped[str | None] = mapped_column(String(60))
    hint: Mapped[str | None] = mapped_column(Text)
    #: Choices for a `select`, newline-separated. Newlines rather than JSON so
    #: the admin UI can present it as a plain textarea.
    options: Mapped[str | None] = mapped_column(Text)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Warn as the date approaches, the way visa expiry already does.
    expires: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: Where it sits in the form. Sparse on purpose (10, 20, 30…) so a field
    #: can be dropped between two others without renumbering the rest.
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    #: Hidden rather than deleted keeps the values readable. A field somebody
    #: stopped using is not the same as a field that was a mistake.
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Which marketplace entry this came from, or NULL if hand-made. Lets the
    #: marketplace grey out what a hotel already has.
    from_catalogue: Mapped[str | None] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(UTC)
    )


# The value side is a JSONB column added to `employees` and `vendors` by the
# migration; see `custom` on those models.
JSONB_DEFAULT = JSONB
