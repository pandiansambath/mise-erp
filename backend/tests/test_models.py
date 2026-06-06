"""Tests for core domain models."""
from app.auth.models import Role, User


def test_six_roles_defined():
    """RBAC depends on exactly these 6 roles existing."""
    assert {r.value for r in Role} == {
        "SUPER_ADMIN",
        "MANAGER",
        "KITCHEN_MANAGER",
        "ACCOUNTANT",
        "CASHIER",
        "STAFF",
    }


def test_role_is_str_enum():
    # str-enum lets us compare/serialize role values directly.
    assert Role.MANAGER == "MANAGER"
    assert Role.MANAGER.value == "MANAGER"


def test_user_construction():
    u = User(email="owner@nirai.com", password_hash="hashed", role=Role.SUPER_ADMIN.value)
    assert u.email == "owner@nirai.com"
    assert u.role == "SUPER_ADMIN"
    assert "owner@nirai.com" in repr(u)
