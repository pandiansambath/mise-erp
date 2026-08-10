"""Reading a hotel's display preferences, with sane answers when unset.

He asked for these to be configurable rather than chosen for him. The defaults
are what the app did before, so an existing hotel sees no change until somebody
actually picks something.
"""

DEFAULTS: dict = {
    # How order and stock PDFs are laid out. "category" puts every vegetable
    # together, which is what his users asked for; "none" keeps the old flat
    # alphabetical list for anyone who preferred it.
    "pdf_group_by": "category",
    # "no need like 1.5000, want like 1.5 kilo" — trailing zeros are trimmed
    # regardless; this caps how much precision is ever shown.
    "qty_decimals": 3,
    "money_decimals": 2,
    # Receiving stock posts its value to Expenses, so it reaches cost of sales
    # in the P&L. On by default because without it the P&L is simply wrong for
    # anyone who buys through Purchasing. Off for kitchens that key their
    # supplier invoices in by hand — posting both would double their food cost.
    "post_purchases_to_expenses": True,
}

_ALLOWED = {
    "pdf_group_by": {"category", "none"},
}


def pref(hotel, key: str):
    """One preference, falling back to the default when unset or nonsense."""
    if hotel is None:
        return DEFAULTS.get(key)
    value = (getattr(hotel, "prefs", None) or {}).get(key, None)
    if value is None:
        return DEFAULTS.get(key)
    allowed = _ALLOWED.get(key)
    if allowed and value not in allowed:
        return DEFAULTS.get(key)
    return value
