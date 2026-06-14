"""Mise API — FastAPI application entrypoint."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.health import router as health_router
from app.audit.router import router as audit_router
from app.auth.router import router as auth_router
from app.core.config import settings
from app.documents.router import router as documents_router
from app.employees.router import attendance_router
from app.employees.router import router as employees_router
from app.events.router import router as events_router
from app.expenses.router import router as expenses_router
from app.hotels.router import router as hotels_router
from app.inventory.router import router as inventory_router
from app.payroll.router import router as payroll_router
from app.purchasing.router import router as purchasing_router
from app.recipes.router import router as recipes_router
from app.reports.router import router as reports_router
from app.safety.router import router as safety_router
from app.sales.router import router as sales_router
from app.selfservice.router import router as selfservice_router
from app.vendors.router import router as vendors_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup / shutdown hooks go here (warm caches, etc.).
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
    )

    # We authenticate with Bearer tokens (no cookies), so a "*" origin is safe;
    # browsers forbid credentials + "*", so only enable credentials for explicit origins.
    _wildcard = "*" in settings.cors_origins
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=not _wildcard,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(audit_router, prefix="/api")
    app.include_router(inventory_router, prefix="/api")
    app.include_router(vendors_router, prefix="/api")
    app.include_router(recipes_router, prefix="/api")
    app.include_router(sales_router, prefix="/api")
    app.include_router(expenses_router, prefix="/api")
    app.include_router(reports_router, prefix="/api")
    app.include_router(safety_router, prefix="/api")
    app.include_router(employees_router, prefix="/api")
    app.include_router(attendance_router, prefix="/api")
    app.include_router(payroll_router, prefix="/api")
    app.include_router(purchasing_router, prefix="/api")
    app.include_router(documents_router, prefix="/api")
    app.include_router(selfservice_router, prefix="/api")
    app.include_router(hotels_router, prefix="/api")
    app.include_router(events_router, prefix="/api")

    @app.get("/", tags=["root"])
    async def root() -> dict:
        return {"name": settings.app_name, "version": __version__, "status": "ok"}

    return app


app = create_app()
