"""Catch names imported from a module that does not define them.

Written after a deploy died on `cannot import name 'MovementType' from
'app.vendors.models'` — a careless string replace had split one import line and
glued its remainder onto another. Ruff cannot see this: it checks each file in
isolation and the import LOOKS fine. Only pytest caught it, and only after the
whole test job had spun up.

Pure AST, no imports executed, so it runs anywhere in well under a second.

    python scripts/check_imports.py     # exit 1 if anything is broken
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "backend"


def top_level_names(tree: ast.Module) -> set[str]:
    """What a module exposes: classes, functions, assignments and re-exports."""
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(t.id for t in node.targets if isinstance(t, ast.Name))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            # A re-export is a legitimate way to expose a name.
            names.update(a.asname or a.name.split(".")[0] for a in node.names)
    return names


def main() -> int:
    defined: dict[str, set[str]] = {}
    trees: dict[pathlib.Path, ast.Module] = {}
    for path in ROOT.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        trees[path] = tree
        defined[".".join(path.relative_to(ROOT).with_suffix("").parts)] = top_level_names(tree)

    broken = 0
    for path, tree in trees.items():
        for node in ast.walk(tree):
            if not (isinstance(node, ast.ImportFrom) and node.module and node.level == 0):
                continue
            if not node.module.startswith("app."):
                continue
            target = defined.get(node.module)
            if target is None:
                continue  # a package __init__ or a module we cannot see
            for alias in node.names:
                if alias.name != "*" and alias.name not in target:
                    rel = path.relative_to(ROOT)
                    print(f"{rel}:{node.lineno}: {alias.name!r} is not defined in {node.module}")
                    broken += 1

    print(f"{'FAIL' if broken else 'ok'}: {broken} broken cross-module import(s)")
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
