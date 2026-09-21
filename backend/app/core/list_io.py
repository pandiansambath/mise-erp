"""Reading a list back in: what is new, what is already here, what is wrong.

    "if duplcaite ask user to chekc and remove duplcaite by showing the previw
     of duplcaute before ading wihtut confirmaiton"

Two rules in one sentence, and the second is the important one:

  * a duplicate is SHOWN, with what we already hold beside what the file says;
  * nothing is written until a person has looked at it.

The failure this replaces is not an error message — it is an import that
"succeeds". Silently skipping duplicates loses the rows the file was carrying;
silently overwriting loses the rows the restaurant already had. Both look like
success, and the person only finds out weeks later when a phone number is wrong.

So the import is TWO calls. The first reads the file and returns a plan; the
second executes a plan the person has actually seen. The plan is carried back
rather than cached server-side, because a cache adds an expiry and a
`preview_id` that can be stale, and the file is small.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.core.roundtrip import ListSpec
from app.core.template_io import parse_upload


@dataclass
class Row:
    """One line of the file, and what we think should happen to it."""

    n: int
    values: dict[str, Any]
    #: new | duplicate | invalid
    verdict: str
    #: For a duplicate: what we already hold, so the two can be compared.
    existing: dict[str, Any] | None = None
    #: What differs between the file and what we hold. Empty means the row is
    #: identical to what is already stored — importing it would do nothing,
    #: which is worth saying rather than counting as a change.
    differences: list[str] | None = None
    reason: str | None = None


@dataclass
class Plan:
    rows: list[Row]
    errors: list[str]

    @property
    def new(self) -> list[Row]:
        return [r for r in self.rows if r.verdict == "new"]

    @property
    def duplicates(self) -> list[Row]:
        return [r for r in self.rows if r.verdict == "duplicate"]

    def as_dict(self) -> dict:
        return {
            "errors": self.errors,
            "counts": {
                "new": len(self.new),
                "duplicates": len(self.duplicates),
                "unchanged": len(
                    [r for r in self.duplicates if r.differences == []]
                ),
                "total": len(self.rows),
            },
            "rows": [
                {
                    "n": r.n,
                    "values": r.values,
                    "verdict": r.verdict,
                    "existing": r.existing,
                    "differences": r.differences,
                    "reason": r.reason,
                }
                for r in self.rows
            ],
        }


def _key(spec: ListSpec, rec: dict) -> str:
    """What makes two rows 'the same thing'.

    The first required field — the name — case-folded and whitespace-collapsed.
    Deliberately NOT the code or the id: a restaurant re-importing its own
    export has ids, but a restaurant typing a list from paper does not, and the
    person's idea of a duplicate is two suppliers with the same name.
    """
    first = next((f.key for f in spec.fields if f.required), spec.fields[0].key)
    return " ".join(str(rec.get(first) or "").split()).casefold()


def build_plan(
    file_bytes: bytes,
    filename: str,
    mime: str,
    spec: ListSpec,
    existing: list[Any],
) -> Plan:
    """Read the file and say what would happen. Writes nothing."""
    raw, errors = parse_upload(file_bytes, filename, mime, spec.template())
    if errors:
        return Plan(rows=[], errors=errors)

    have: dict[str, dict] = {}
    for obj in existing:
        rec = {
            f.key: (obj.get(f.key) if isinstance(obj, dict) else getattr(obj, f.key, None))
            for f in spec.fields
        }
        have[_key(spec, rec)] = {k: _jsonable(v) for k, v in rec.items()}

    rows: list[Row] = []
    seen_in_file: dict[str, int] = {}

    for i, rec in enumerate(raw, start=1):
        clean = {k: _jsonable(v) for k, v in spec.clean(rec).items()}
        k = _key(spec, clean)

        # A FILE CAN REPEAT ITSELF. Two rows for "Fresh Farms" in one upload is
        # a duplicate just as much as a clash with the database, and it is the
        # kind a person genuinely wants to see — it usually means two lists were
        # pasted together.
        if k and k in seen_in_file:
            rows.append(Row(
                n=i, values=clean, verdict="duplicate",
                existing=None, differences=None,
                reason=f"the same name appears earlier in this file, on row {seen_in_file[k]}",
            ))
            continue
        if k:
            seen_in_file[k] = i

        if k and k in have:
            prior = have[k]
            diffs = [
                f.header
                for f in spec.fields
                if f.key in clean
                and str(clean.get(f.key) or "") != str(prior.get(f.key) or "")
            ]
            rows.append(Row(
                n=i, values=clean, verdict="duplicate", existing=prior,
                differences=diffs,
                reason=(
                    "already here, and identical" if not diffs
                    else "already here — these differ: " + ", ".join(diffs)
                ),
            ))
        else:
            rows.append(Row(n=i, values=clean, verdict="new"))

    return Plan(rows=rows, errors=[])


def _jsonable(v: Any) -> Any:
    from datetime import date, datetime
    from decimal import Decimal

    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, date | datetime):
        return v.isoformat()
    return v
