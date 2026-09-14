"""Every `from app.…` import points at a module that exists.

WHY THIS TEST EXISTS

A deploy failed with:

    app/custom_fields/models.py:45: in <module>
        from app.core.db import Base
    E   ModuleNotFoundError: No module named 'app.core.db'

There is no `app/core/db.py`; the module is `app/core/database.py`, which is
what the other twenty-odd model files import. One wrong word.

It was expensive out of all proportion to the mistake:

  · `app/main.py` imports every router at module level, so the bad import was
    unconditional — the container would have failed to BOOT. Not a broken
    feature, the entire API down.
  · `tests/conftest.py` imports `app.main`, so pytest died during COLLECTION.
    Every test in the suite "failed" and the real cause was one line in a file
    none of them touch.
  · It got past me because a full `import app.main` needs the whole dependency
    set and a database, so I could not cheaply run it — and I shipped without.

This test needs neither. It walks the source with `ast`, finds every module
referenced by an `import app.…` or `from app.… import`, and checks a file is
actually there. No dependencies, no database, no import side effects — so it
runs anywhere, in under a second, and it fails with the exact file and line.
"""

from __future__ import annotations

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def _module_exists(dotted: str) -> bool:
    """Is `app.a.b` a real module or package under app/?

    Also accepts `app.a.b` where `b` is a NAME inside `app/a.py` — which is how
    `from app.core.config import settings` looks once you only have the dotted
    string. Checking the parent package covers that without importing anything.
    """
    parts = dotted.split(".")
    if parts[0] != "app":
        return True  # third-party; pip's problem, not ours
    rel = pathlib.Path(*parts[1:])
    base = APP / rel
    if base.with_suffix(".py").exists() or (base / "__init__.py").exists():
        return True
    # `from app.pkg.mod import thing` gives us app.pkg.mod — already handled.
    # This branch catches `import app.pkg.mod` where mod is a package dir with
    # no __init__.py (namespace package).
    return base.is_dir()


def _imports(path: pathlib.Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            # `from . import x` has no module; relative imports resolve against
            # the package and are not the failure mode this guards.
            if node.module and node.level == 0:
                found.append((node.lineno, node.module))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                found.append((node.lineno, alias.name))
    return found


def test_every_app_import_resolves_to_a_real_module():
    broken: list[str] = []
    for path in sorted(APP.rglob("*.py")):
        for lineno, dotted in _imports(path):
            if dotted.split(".")[0] != "app":
                continue
            if not _module_exists(dotted):
                rel = path.relative_to(APP.parent)
                broken.append(f"{rel}:{lineno} imports '{dotted}' — no such module")
    assert not broken, "Unresolvable imports:\n  " + "\n  ".join(broken)


def test_alembic_migrations_import_cleanly_too():
    """Migrations run on a box with the app importable; same rule applies."""
    versions = APP.parent / "alembic" / "versions"
    broken: list[str] = []
    for path in sorted(versions.rglob("*.py")):
        for lineno, dotted in _imports(path):
            if dotted.split(".")[0] != "app":
                continue
            if not _module_exists(dotted):
                broken.append(f"{path.name}:{lineno} imports '{dotted}' — no such module")
    assert not broken, "Unresolvable imports in migrations:\n  " + "\n  ".join(broken)
