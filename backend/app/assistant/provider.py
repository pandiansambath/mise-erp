"""Legacy shim — the Gemini client used to live here.

The assistant, document ingest and bill scanning all run on Claude via Bedrock
now: see `brain.py` for the tool-calling loop and `bedrock.py` for the
transport. Everything Google-specific has been deleted.

Two things survive because call sites still use them, and renaming them would
churn several files for no behavioural gain:

* `ProviderError` — raised and caught when a document can't be read.
* `is_configured()` — now reports whether the REAL brain is reachable, so
  `/assistant/status` tells the truth instead of reporting on a key nothing
  reads. That mismatch is exactly what made a working AI look switched off.
"""
from __future__ import annotations


class ProviderError(RuntimeError):
    """The model could not be reached, or returned something unusable."""


def is_configured() -> bool:
    """Is the assistant's brain available?

    Bedrock authenticates through the EC2 instance role, so there is no key to
    check — if boto3 is importable we can reach it, and a genuine outage
    surfaces as a BedrockUnavailable at call time rather than as a config flag.
    """
    try:
        import boto3  # noqa: F401
    except ImportError:
        return False
    return True
