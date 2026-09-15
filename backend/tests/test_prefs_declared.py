"""Every preference the app READS is a preference the app DECLARES.

WHY THIS TEST EXISTS

Twice, in the same file, for the same reason.

`app/hotels/router.py` refuses a PATCH containing a preference key it does not
recognise — which is right, because a request can only be wrong about what it
sends. But `prefs.DEFAULTS` is a hand-written list, and the code that READS
preferences is somewhere else entirely. When the two drift, the failure is
silent until somebody tries to use the setting:

  · `kds_code` — written by the ordering module, never declared. Its mere
    presence in the stored bag made EVERY later preference save fail with 422.
    Fixed, with a comment saying "a setting the app writes is a setting the app
    knows".
  · `kds_pin_required` — read by `_kds_locked()`, never declared. So
    `PATCH /hotels/me {"prefs": {"kds_pin_required": true}}` returned 422 and
    the kitchen screen's PIN lock could not be switched on AT ALL. `/kds/<code>`
    stayed a bare URL showing a restaurant's live orders, table numbers and
    guest messages to anyone with the link.

The second one was found by an audit, not by a test, and it had been shipped.
The lesson from the first was written down but not generalised — which is what
a test is for.

This scans the source for `prefs.get("x")` and asserts every key found is in
DEFAULTS. It needs no database and runs in milliseconds.
"""

from __future__ import annotations

import pathlib
import re

from app.hotels import prefs as prefs_mod

APP = pathlib.Path(__file__).resolve().parent.parent / "app"

#: `prefs.get("x")`, `(hotel.prefs or {}).get("x")`, `h.prefs.get("x")` …
READ = re.compile(r"prefs[^)\n]{0,20}\)?\s*\.get\(\s*[\"'](\w+)[\"']")


def test_every_preference_read_is_declared():
    missing: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        for m in READ.finditer(src):
            key = m.group(1)
            if key in prefs_mod.DEFAULTS:
                continue
            line = src[: m.start()].count("\n") + 1
            missing.append(
                f"{path.relative_to(APP.parent)}:{line} reads prefs['{key}'], "
                f"which is not in DEFAULTS — a PATCH setting it would 422"
            )
    assert not missing, (
        "Preferences read but never declared:\n  " + "\n  ".join(missing)
    )


def test_allowed_values_only_constrain_declared_keys():
    """A whitelist for a key nobody declares is a rule that never runs."""
    stray = set(getattr(prefs_mod, "_ALLOWED", {})) - set(prefs_mod.DEFAULTS)
    assert not stray, f"_ALLOWED constrains undeclared keys: {sorted(stray)}"


def test_the_two_keys_that_caused_this_are_declared():
    """Named explicitly, so deleting them fails loudly rather than quietly."""
    for key in ("kds_code", "kds_pin_required"):
        assert key in prefs_mod.DEFAULTS, f"{key} must stay declared"
