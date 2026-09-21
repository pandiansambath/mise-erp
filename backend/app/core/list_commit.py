"""Writing a reviewed plan, and the rules that make that safe.

The second half of the two-call import. The first call said what WOULD happen;
this one does it — but only to rows carrying a decision a person made.

THE THREE THINGS THIS FILE EXISTS TO GUARANTEE
--------------------------------------------------------------------------
1. THE PREVIEW CANNOT BE SKIPPED, AND IT IS THE SHAPE THAT ENFORCES IT.
   Every row must carry an explicit `action`. There is no "commit this whole
   plan" call, so there is nothing a client — or a future agent — can invoke
   without first producing per-row decisions. The assistant cannot reach this
   at all: its entire vocabulary is its tool list and it has no HTTP tool.

2. THE PLAN IS RE-CHECKED AGAINST THE DATABASE AS IT IS NOW.
   A plan is a photograph. Between the preview and the tap, another manager can
   add the same supplier, or the phone can sit on a counter overnight. So the
   verdict is recomputed at write time and a decision is honoured only where
   the world still matches. One function call buys the race, the stale plan,
   and idempotency-without-a-table: tap twice and the second pass finds
   everything already there and writes nothing.

3. THE CLIENT SENDS DECISIONS, AND THE SERVER OWNS THE VALUES.
   Keys are whitelisted to the spec's own fields. An `id` or a `hotel_id`
   arriving in a request body is never dereferenced — the target is re-resolved
   server-side by (hotel, name). That is the difference between an import and a
   way to write into another restaurant.

WHY PARTIAL AND NOT ALL-OR-NOTHING
--------------------------------------------------------------------------
`create_vendor`, `create_employee` and `create_item` each commit internally,
and `create_employee` RETRIES on IntegrityError with a freshly minted code —
which needs its own commit boundary to work at all. Wrapping the batch in one
transaction means rewriting three services that every hand-written create in
the product depends on, to win a rollback nobody asked for.

So: partial, with a report where EVERY ROW IS ACCOUNTED FOR. created + updated
+ skipped + failed equals the number sent. A count that does not add up is how
silent loss hides, and silent loss is the whole reason this feature exists.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core.list_io import _key, classify
from app.core.roundtrip import ListSpec

#: One commit call. A larger file becomes several confirmed batches, each one
#: looked at by a person — which is the point, not a limitation.
MAX_COMMIT_ROWS = 200


@dataclass
class Decision:
    n: int
    action: str  # create | update | skip
    values: dict[str, Any]


@dataclass
class Report:
    created: list[dict] = field(default_factory=list)
    updated: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)

    def as_dict(self, sent: int) -> dict:
        out = {
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "failed": self.failed,
            "counts": {
                "sent": sent,
                "created": len(self.created),
                "updated": len(self.updated),
                "skipped": len(self.skipped),
                "failed": len(self.failed),
            },
            #: The ids to reverse, so an undo is one tap rather than a hunt.
            "undo_ids": [r["id"] for r in self.created if r.get("id")],
        }
        # THE ARITHMETIC IS PART OF THE RESPONSE. If these ever disagree, rows
        # went somewhere nobody can see, and the caller should be able to tell
        # without counting by hand.
        got = sum(out["counts"][k] for k in ("created", "updated", "skipped", "failed"))
        out["counts"]["accounted_for"] = got == sent
        return out


def clean_decisions(raw: list[dict], spec: ListSpec) -> tuple[list[Decision], list[str]]:
    """Take the client's decisions and throw away everything else it sent.

    Keys are whitelisted to the spec's own fields. The tempting shape here is
    `rows: list[dict]` passed straight to `create_x(**fields)` — which accepts
    ANY key, so `id` lands as a caller-chosen primary key and `hotel_id` is a
    500 at best. The existing inventory importer is safe only because of an
    explicit whitelist a few lines further down; this copies the whitelist, not
    the signature.
    """
    allowed = {f.key for f in spec.fields}
    errors: list[str] = []
    out: list[Decision] = []

    if len(raw) > MAX_COMMIT_ROWS:
        return [], [
            f"That is {len(raw)} rows — more than {MAX_COMMIT_ROWS} in one go. "
            "Confirm these, then send the rest."
        ]

    for i, r in enumerate(raw, start=1):
        action = str(r.get("action") or "").strip().lower()
        if action not in ("create", "update", "skip"):
            # NOT a default. A row with no decision means nobody looked at it,
            # and guessing on their behalf is the exact thing the two-call
            # design exists to prevent.
            errors.append(f"Row {r.get('n', i)} has no decision on it.")
            continue
        vals = {k: v for k, v in (r.get("values") or {}).items() if k in allowed}
        out.append(Decision(n=int(r.get("n") or i), action=action, values=vals))

    return out, errors


async def apply(
    decisions: list[Decision],
    spec: ListSpec,
    existing: list[Any],
    *,
    create,
    update,
) -> Report:
    """Write the decisions that still make sense, and report on every row.

    `create` and `update` are the module's own service functions, passed in so
    this file never imports vendors or employees — it is the mechanism, they
    are the policy about what a vendor IS.
    """
    rep = Report()

    # Re-classify against the CURRENT rows, not the ones the preview saw.
    fresh = classify([d.values for d in decisions], spec, existing)
    by_n = {row.n: row for row in fresh.rows}
    have = {_key(spec, _as_dict(o, spec)): o for o in existing}

    for i, d in enumerate(decisions, start=1):
        label = _label(d.values, spec)
        verdict = by_n.get(i).verdict if by_n.get(i) else "new"

        if d.action == "skip":
            rep.skipped.append({"n": d.n, "name": label, "why": "you chose to leave it"})
            continue

        if d.action == "create" and verdict == "duplicate":
            # Somebody added it between the preview and the tap. Not an error,
            # and not a silent overwrite either.
            rep.skipped.append({
                "n": d.n, "name": label,
                "why": "already here — added while you were looking at this",
            })
            continue

        target = have.get(_key(spec, d.values))
        if d.action == "update" and target is None:
            rep.skipped.append({
                "n": d.n, "name": label,
                "why": "the record to update is no longer here",
            })
            continue

        try:
            if d.action == "update":
                obj = await update(target, d.values)
                rep.updated.append({"n": d.n, "name": label, "id": str(getattr(obj, "id", ""))})
            else:
                obj = await create(d.values)
                rep.created.append({"n": d.n, "name": label, "id": str(getattr(obj, "id", ""))})
        except Exception as exc:  # noqa: BLE001
            # ONE BAD ROW MUST NEVER STOP THE BATCH — thirty-nine good rows are
            # not worth losing to the fortieth. The reason is a sentence,
            # because "IntegrityError" is not something a restaurant can act on.
            rep.failed.append({"n": d.n, "name": label, "why": _why(exc)})

    return rep


def _as_dict(obj: Any, spec: ListSpec) -> dict:
    return {
        f.key: (obj.get(f.key) if isinstance(obj, dict) else getattr(obj, f.key, None))
        for f in spec.fields
    }


def _label(values: dict, spec: ListSpec) -> str:
    first = next((f.key for f in spec.fields if f.required), spec.fields[0].key)
    return str(values.get(first) or "(no name)")


def _why(exc: Exception) -> str:
    text = str(exc)
    low = text.lower()
    if "duplicate" in low or "unique" in low:
        return "there is already one with this name"
    if "too long" in low or "truncat" in low:
        return "one of the values is too long for its field"
    if "invalid" in low or "value" in low:
        return "one of the values was not something we could store"
    return text[:160] or "we could not save this one"
