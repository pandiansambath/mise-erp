# syntax=docker/dockerfile:1
# Pin Python 3.12 — local machine runs 3.14 (no wheels yet for many libs),
# so the container is the source of truth for the backend runtime.
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt ./
RUN pip install -r requirements.txt

# ── dev: includes test/lint deps, hot reload ──
FROM base AS dev
RUN pip install -r requirements-dev.txt
COPY . .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── prod: lean, non-root, used by App Runner ──
FROM base AS prod
COPY . .
RUN useradd --create-home --uid 1000 appuser && chown -R appuser /app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
