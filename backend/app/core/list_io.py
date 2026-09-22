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
    #: What differs, one entry per field, each carrying BOTH values:
    #: {field, label, ours, theirs}. Empty means the row is identical to what
    #: is already stored — importing it would do nothing, which is worth
    #: saying rather than counting as a change.
    differences: list[dict] | None = None
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

    @property
    def invalid(self) -> list[Row]:
        return [r for r in self.rows if r.verdict == "invalid"]

    def as_dict(self) -> dict:
        return {
            "errors": self.errors,
            "counts": {
                "new": len(self.new),
                "duplicates": len(self.duplicates),
                "unchanged": len(
                    [r for r in self.duplicates if r.differences == []]
                ),
                "invalid": len(self.invalid),
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


def _same(field, a, b) -> bool:
    """Is the file's value the same as ours?

    NOT `str(a) != str(b)`. Every kind="number" column is parsed as
    `float(Decimal(...))` on the way in, so an INTEGER column round-trips as
    25 -> "25" -> 25.0, and a string comparison calls that a change. It made
    a restaurant's own untouched menu export come back reading "17 already
    here but different" — which is precisely the false alarm the preview
    exists to avoid, and the fastest way to teach somebody to stop reading it.
    """
    if getattr(field, "kind", "text") == "number":
        na, nb = _num(a), _num(b)
        if na is not None or nb is not None:
            return na == nb
    # Booleans arrive as bool from `from_cell` and as bool from the ORM, but a
    # CSV that skipped the column leaves the key absent rather than false.
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    return str(a if a is not None else "").strip() == str(b if b is not None else "").strip()


def _num(v):
    from decimal import Decimal, InvalidOperation

    if v is None or v == "":
        return None
    try:
        return Decimal(str(v).replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return None


def _shown(v) -> str:
    """What a person should see for this value in the comparison table."""
    if v is None or v == "":
        return "—"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float) and v.is_integer():
        # 25.0 is a parsing artefact, never something anybody typed.
        return str(int(v))
    return str(v)


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
    mapping: dict[str, int] | None = None,
) -> Plan:
    """Read a FILE and say what would happen. Writes nothing.

    `mapping` is {field_key: column_index}, confirmed by a person on the
    column-mapping screen. It overrides the header guess — which is the
    difference between a suggestion and a decision, and the reason a stock
    list can no longer be imported as a supplier list without anybody saying
    so.
    """
    raw, errors = parse_upload(file_bytes, filename, mime, spec.template(), mapping)
    if errors:
        return Plan(rows=[], errors=errors)
    return classify(raw, spec, existing)


def classify(raw: list[dict], spec: ListSpec, existing: list[Any]) -> Plan:
    """Rows in, plan out — WHEREVER THE ROWS CAME FROM.

    Split out of `build_plan` because the assistant has no file: somebody pastes
    a list of suppliers into the chat and the model turns prose into rows. Those
    rows need the same treatment a spreadsheet's rows get.

    The reason this is one function rather than two is stronger than saving
    code. `_key()` is the only place in the product that knows what "already
    here" MEANS — the name, case-folded, whitespace-collapsed, because that is
    a person's idea of a duplicate. A second copy of that rule in the chat path
    would be the same definition living in two files, which is exactly how the
    export and the import drifted until our own files stopped importing.
    """
    have: dict[str, dict] = {}
    for obj in existing:
        rec = {
            f.key: (obj.get(f.key) if isinstance(obj, dict) else getattr(obj, f.key, None))
            for f in spec.fields
        }
        have[_key(spec, rec)] = {k: _jsonable(v) for k, v in rec.items()}

    rows: list[Row] = []
    seen_in_file: dict[str, int] = {}

    required = [f for f in spec.fields if f.required]

    for i, rec in enumerate(raw, start=1):
        clean = {k: _jsonable(v) for k, v in spec.clean(rec).items()}
        k = _key(spec, clean)

        # A ROW MISSING ITS REQUIRED FIELD COSTS ONE ROW, NOT THE LIST.
        #
        # `verdict` has documented `invalid` since this file was written and
        # nothing ever emitted it: `parse_upload` rejects the WHOLE FILE on any
        # row error and returns zero rows, so a plan was always all-or-nothing.
        # That is survivable for a spreadsheet somebody can edit. It is not
        # survivable for the chat path, where one nameless row out of forty
        # would throw away thirty-nine good ones the model got right.
        missing = [f.header for f in required if not str(clean.get(f.key) or "").strip()]
        if missing:
            rows.append(Row(
                n=i, values=clean, verdict="invalid",
                reason=(
                    ("no " + " or ".join(m.lower() for m in missing))
                    + " — add it and this row goes in with the rest"
                ),
            ))
            continue

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
            # EACH DIFFERENCE CARRIES ITS OWN TWO VALUES. The popup used to be
            # handed a list of headers and had to find the matching key itself,
            # by swapping underscores for spaces — so "Serves" went looking for
            # a key called "serves" while the data held "servings_default", and
            # the one field it had flagged displayed as "— vs —".
            diffs = [
                {
                    "field": f.key,
                    "label": f.header,
                    "ours": _shown(prior.get(f.key)),
                    "theirs": _shown(clean.get(f.key)),
                }
                for f in spec.fields
                if f.key in clean and not _same(f, clean.get(f.key), prior.get(f.key))
            ]
            rows.append(Row(
                n=i, values=clean, verdict="duplicate", existing=prior,
                differences=diffs,
                reason=(
                    "already here, and identical" if not diffs
                    else "already here — these differ: "
                    + ", ".join(d["label"] for d in diffs)
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


def _mapping(raw: str) -> dict[str, int] | None:
    """A confirmed column mapping, or None.

    Bad JSON is treated as "no mapping" rather than an error: the worst case
    is the guess being used, which is where we were, and failing the upload
    over a malformed optional field would be worse than that.
    """
    import json

    if not (raw or "").strip():
        return None
    try:
        got = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return got if isinstance(got, dict) else None
