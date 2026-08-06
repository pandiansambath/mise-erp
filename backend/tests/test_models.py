"""Tests for core domain models."""
from app.auth.models import Role, User


def test_six_roles_defined():
    """RBAC depends on exactly these roles existing.

    Six belong to PEOPLE. KIOSK is the odd one out — a device identity for the
    attendance tablet, which is why it is excluded from the assignable-role
    list in schemas and why its permission envelope cannot be widened.
    """
    people = {
        "SUPER_ADMIN",
        "MANAGER",
        "KITCHEN_MANAGER",
        "ACCOUNTANT",
        "CASHIER",
        "STAFF",
    }
    assert {r.value for r in Role} == people | {"KIOSK"}

    # The distinction is the point: a person can hold any of `people`, and
    # nobody can ever hold KIOSK — schemas refuses it, so the audit trail can
    # never claim a wall screen did something a human did.
    from app.auth.schemas import _VALID_ROLES

    assert _VALID_ROLES == people


def test_role_is_str_enum():
    # str-enum lets us compare/serialize role values directly.
    assert Role.MANAGER == "MANAGER"
    assert Role.MANAGER.value == "MANAGER"


def test_user_construction():
    u = User(email="owner@nirai.com", password_hash="hashed", role=Role.SUPER_ADMIN.value)
    assert u.email == "owner@nirai.com"
    assert u.role == "SUPER_ADMIN"
    assert "owner@nirai.com" in repr(u)
