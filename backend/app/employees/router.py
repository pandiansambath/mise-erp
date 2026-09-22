"""Employee & attendance endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type
from datetime import datetime, timedelta

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import list_commit, list_io, lists, ratelimit, roundtrip, template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password
from app.employees import attendance_lock, service, timesheet
from app.employees import leave as leave_service
from app.employees.models import Employee, Leave, LeaveStatus
from app.employees.schemas import (
    AttendanceEdit,
    AttendanceOut,
    AttendanceRow,
    AttendanceSet,
    EmployeeAccountIn,
    EmployeeCreate,
    EmployeeOut,
    EmployeeUpdate,
    LeaveCreate,
    PunchRequest,
    VisaAlert,
)
from app.hotels.models import Hotel

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/employees", tags=["employees"])
attendance_router = APIRouter(prefix="/attendance", tags=["attendance"])


# ── Employees ─────────────────────────────────────────────────────────────
class RosterOut(BaseModel):
    """What a wall tablet is allowed to know: who to tap.

    `EmployeeOut` carries monthly_salary, hourly_rate, ni_number, bank_sort_code
    and bank_account_no. The kiosk needs none of them — it needs a name and an
    id — and its credential is a PIN typed on a device that sits out all night.
    """

    id: uuid.UUID
    full_name: str
    employee_code: str
    job_title: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}


# `response_model` is deliberately absent: this endpoint returns one of two
# shapes, and declaring either would SILENTLY STRIP the other — the trap this
# project has hit nine times.
@router.get("")
async def list_employees(
    include_suspended: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:roster")),
) -> list:
    """The roster. `include_suspended` is what makes suspension reversible.

    Without it, suspending someone hid them from the only page that could bring
    them back — a one-way door wearing a two-way label. The list is
    active-only by default because that is the roster you work from day to day.

    ⚠️ TWO SHAPES. Asking for `employees:roster` rather than `employees:read`
    lets the kiosk in — and then the kiosk gets NAMES ONLY. Anyone holding the
    full `employees:read` gets the full record as before. The permission decides
    the payload, so a narrower credential cannot widen itself by calling the
    same URL.
    """
    full = await _may_read_full(db, user)
    emps = await service.list_employees(
        db, user.hotel_id, active_only=not include_suspended
    )
    if not full:
        return [RosterOut.model_validate(e) for e in emps]
    return [EmployeeOut.model_validate(e) for e in emps]


async def _may_read_full(db: AsyncSession, user: User) -> bool:
    """Does this caller hold the FULL `employees:read`, or only the roster?

    Mirrors `require()`'s own resolution so a runtime-invented role behaves the
    same here as it does at the door: a custom role granted `employees:write`
    implies read, exactly as it does for the archetypes.
    """
    from app.auth.deps import effective_permissions
    from app.core.rbac import has_permission

    granted = await effective_permissions(db, user)
    if granted is None:
        return has_permission(user.role, "employees:read")
    return (
        "*" in granted
        or "employees:read" in granted
        or "employees:write" in granted
    )


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    emp = await service.create_employee(db, user.hotel_id, **payload.model_dump(exclude_none=True))
    return EmployeeOut.model_validate(emp)


@router.get("/visa-alerts", response_model=list[VisaAlert])
async def visa_alerts(
    within_days: int = Query(default=60, ge=0, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[VisaAlert]:
    alerts = await service.visa_alerts(db, user.hotel_id, within_days)
    return [VisaAlert.model_validate(a) for a in alerts]


# ⚠️ THESE LITERAL ROUTES MUST STAY ABOVE `/{id}`.
#
# Starlette matches in DECLARATION ORDER, so `@router.get("/{employee_id}")`
# declared first swallows the literal string "export.csv" and tries to parse it
# as a UUID — every one of these returned 422 while appearing, in the source, to
# exist. Declared below the id route they are dead code that reviews clean.
#
# `visa-alerts` above is placed correctly for the same reason; follow it.

# ── the round trip ────────────────────────────────────────────────────────
#
#     "exployee here also export fteayre not there"
#
# ⚠️ TWO EXPORTS, ON PURPOSE. The plain one carries names, roles and contact
# details. Pay and National Insurance live behind `payroll:read`, because an
# export is a file that ends up in email and on somebody's desktop, and "export
# the staff list" should never be the action that puts every salary in it.


def _emp_file(content: bytes, media: str, name: str) -> Response:
    return Response(
        content=content, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export.csv")
async def export_employees_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    rows = await service.list_employees(db, user.hotel_id, active_only=False)
    # Every home address and next-of-kin number in one file. Cheap to record,
    # and the only way to answer "who took the staff list" three months later.
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="employees.export",
        summary=f"Exported {len(rows)} staff records (no pay)",
    )
    return _emp_file(
        roundtrip.to_csv(lists.EMPLOYEES, rows), "text/csv", "dineai-employees.csv"
    )


@router.get("/export.xlsx")
async def export_employees_xlsx(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    rows = await service.list_employees(db, user.hotel_id, active_only=False)
    return _emp_file(
        roundtrip.to_xlsx(lists.EMPLOYEES, rows), XLSX_MIME, "dineai-employees.xlsx"
    )


@router.get("/export-with-pay.xlsx")
async def export_employees_with_pay(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
    # BOTH, and this is not belt-and-braces.
    #
    # The file is the pay fields PLUS the whole employee record — home address,
    # next of kin, their phone. A hotel that invents a "Payroll Clerk" role and
    # grants only `payroll:read` would otherwise have handed that person every
    # employee's home address in one click. Asking for the roster permission
    # too makes the file's real contents the thing being authorised.
    _roster: User = Depends(require("employees:read")),
) -> Response:
    """Salary and NI included. `payroll:read`, not `employees:read`.

    Anyone who can see the staff list is not thereby entitled to see what each
    of them earns — that is a different question and it has its own permission
    already. It is also audited, because a file containing every salary leaving
    the building is an event somebody may need to account for later.
    """
    # NOT IN A SUPPORT VIEW. `require()` lets impersonated sessions through any
    # permission ending in ":read", which is right for nearly everything and
    # wrong for this: it would let a platform operator click "view as" on any
    # tenant and download that restaurant's complete salary and NI list. The
    # audit row would name the RESTAURANT'S OWNER, because the token resolves to
    # them — so the one record of it would be false as well.
    if getattr(user, "is_impersonated_session", False):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Not available in a support view — ask the restaurant to export it.",
        )

    rows = await service.list_employees(db, user.hotel_id, active_only=False)
    out = roundtrip.to_xlsx(lists.EMPLOYEES_WITH_PAY, rows)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="employees.export_pay",
        summary=f"Exported {len(rows)} staff records INCLUDING pay and NI numbers",
    )
    return _emp_file(out, XLSX_MIME, "dineai-employees-with-pay.xlsx")


@router.get("/import-template.xlsx")
async def employees_template(user: User = Depends(require("employees:read"))) -> Response:
    return _emp_file(
        template_io.template_xlsx(lists.EMPLOYEES.template()),
        XLSX_MIME, "dineai-employees-template.xlsx",
    )


class _EmployeesRowsIn(BaseModel):
    """Rows from typing, or from the AI reading something. Not from a file."""

    rows: list[dict] = Field(default_factory=list)


@router.post("/import/preview-rows")
async def preview_employees_rows(
    payload: _EmployeesRowsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Classify rows that never came from a file. Writes nothing.

    Typing and the AI both produce rows, and `classify()` takes rows — it was
    split out of `build_plan` for precisely this and then had no HTTP door, so
    the only way to reach a preview was to upload something. Typed entry had
    no duplicate check at all.

    Same classify, same rules, same screen, same commit endpoint. A second
    path here would be the same thing built twice at half the quality.
    """
    rows = [r for r in payload.rows if isinstance(r, dict)][:list_commit.MAX_COMMIT_ROWS]
    allowed = {f.key for f in lists.EMPLOYEES.fields}
    cleaned = [{k: v for k, v in r.items() if k in allowed} for r in rows]
    existing = await service.list_employees(db, user.hotel_id, active_only=False)
    return list_io.classify(cleaned, lists.EMPLOYEES, existing).as_dict()


@router.post("/import/read-ai")
async def read_employees_with_ai(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Read ANY documents as this list, with the AI. Writes nothing.

        "everytime they wont have a tempate ... let them add whatever
         document they have like csv image pdf word whatsever"

    A spreadsheet with unfamiliar headings, a supplier's PDF, twenty
    photographs of a handwritten book. The deterministic reader runs first
    and is free; this is for everything it cannot parse, and telling somebody
    to go and fill in a blank template instead is the extra job he is
    describing.

    N FILES, ONE PREVIEW. Each is read separately — a photo of page three
    knows nothing about page two — then pooled before a single `classify`,
    so a dish appearing on two photographs is caught as a duplicate of itself
    rather than added twice.
    """
    from app.assistant import docbytes, ingest
    from app.assistant.provider import ProviderError

    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files")
    if len(files) > 25:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That is more than 25 files. Send them in a couple of goes so you "
            "can check each batch.",
        )

    rows: list[dict] = []
    read: list[str] = []
    failed: list[dict] = []

    for f in files:
        data = await f.read()
        name = f.filename or "file"
        if not data:
            continue
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            failed.append({"name": name, "why": "too large"})
            continue
        if docbytes.is_unreadable(name):
            failed.append({"name": name, "why": "that is an archive or a video"})
            continue
        try:
            got = await ingest.read_as(data, f.content_type or "", name, "employees")
        except ProviderError as exc:
            # ONE BAD FILE MUST NOT LOSE THE OTHER NINETEEN. He is uploading a
            # stack of photographs; failing the batch on the blurry one is
            # the worst possible way to spend his afternoon.
            failed.append({"name": name, "why": str(exc)[:120]})
            continue
        rows.extend(got)
        read.append(name)

    if not rows:
        return {
            "plan": None,
            "read": read,
            "failed": failed,
            "why": (
                "I read those, but couldn't find any employees in them. If they "
                "are the right documents, tell me what I missed and I'll look "
                "again."
            ),
        }

    existing = await service.list_employees(db, user.hotel_id, active_only=False)
    plan = list_io.classify(rows[:list_commit.MAX_COMMIT_ROWS], lists.EMPLOYEES, existing)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="employees.read_ai",
        summary=(
            f"AI read {len(read)} document(s) as employees "
            f"({len(rows)} rows, nothing saved yet)"
        ),
    )
    return {
        "plan": plan.as_dict(),
        "read": read,
        "failed": failed,
        "truncated": len(rows) > list_commit.MAX_COMMIT_ROWS,
    }


@router.post("/import/inspect")
async def inspect_employees_import(
    file: UploadFile = File(...),
    user: User = Depends(require("employees:write")),
) -> dict:
    """What is in this file, and what we would guess each column means.

    Reads nothing from the database and writes nothing. It exists so a file
    whose headings we do not recognise is a QUESTION rather than a dead end —
    and so a guess is never silently acted on.
    """
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    return template_io.inspect_upload(
        data, file.filename or "", file.content_type or "", lists.EMPLOYEES.template()
    )


@router.post("/import/preview")
async def preview_employee_import(
    file: UploadFile = File(...),
    # THE MAPPING THE PERSON CONFIRMED, as a JSON string: this request is
    # multipart because it carries a file, and multipart has no objects.
    mapping: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """What would happen. Writes nothing — see `core/list_io`."""
    # THE SIZE CHECK EVERY OTHER UPLOAD IN THIS APP DOES, and these two did not.
    #
    # XLSX is zipped XML: a repetitive sheet compresses about a thousand to one,
    # so a few megabytes becomes gigabytes of Python objects when the parser
    # materialises the rows. One authenticated user with write access could OOM
    # the container and take every other restaurant down with it — and there is
    # no body cap at the edge either, the Caddyfile sets none.
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    existing = await service.list_employees(db, user.hotel_id, active_only=False)
    plan = list_io.build_plan(
        data, file.filename or "", file.content_type or "",
        lists.EMPLOYEES, existing,
    )
    return plan.as_dict()


class _EmpCommitIn(BaseModel):
    """Per-row decisions from a plan a person has actually looked at.

    Deliberately NOT `{plan_id}` or `{rows: list[dict]}`. Every row must carry
    its own `action`, so there is no shape of request that means "just do the
    whole thing" — which is what makes the preview impossible to skip rather
    than merely expected.
    """

    rows: list[dict] = Field(default_factory=list)
    #: Where it came from, for the audit line. "file" | "copilot".
    source: str = "file"


@router.post("/import/commit")
async def commit_employee_import(
    payload: _EmpCommitIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Write the decided rows. Re-checks the world first.

    `require("employees:write")` rather than a bare session, and that matters
    more than it looks: it is the only path that resolves CUSTOM ROLES, refuses
    a support-view session, and returns 402 on an unpaid account. The
    assistant's own write path does none of those, so routing bulk through here
    fixes all three for free — and is why this endpoint, not a new bulk verb on
    the assistant.
    """
    decisions, errors = list_commit.clean_decisions(payload.rows, lists.EMPLOYEES)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errors[:3]))

    existing = await service.list_employees(db, user.hotel_id, active_only=False)

    async def _create(values: dict):
        return await service.create_employee(db, user.hotel_id, **values)

    async def _update(target, values: dict):
        return await service.update_employee(db, target, **values)

    report = await list_commit.apply(
        decisions, lists.EMPLOYEES, existing, create=_create, update=_update
    )
    out = report.as_dict(sent=len(decisions))

    # AFTER the writes: `audit.record` commits internally, so calling it
    # mid-loop would commit a half-finished batch.
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="employees.import",
        summary=(
            f"Imported staff from {payload.source}: "
            f"{out['counts']['created']} added, {out['counts']['updated']} updated, "
            f"{out['counts']['skipped']} left, {out['counts']['failed']} failed"
        ),
    )
    return out


@router.get("/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> EmployeeOut:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return EmployeeOut.model_validate(emp)


@router.patch("/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    emp = await service.update_employee(db, emp, **payload.model_dump(exclude_unset=True))
    return EmployeeOut.model_validate(emp)


@router.post("/{employee_id}/account", response_model=EmployeeOut)
async def create_employee_account(
    employee_id: uuid.UUID,
    payload: EmployeeAccountIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    """Create a login for this employee so they can sign in (self-service)."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        emp = await service.create_account_for_employee(
            db, emp, email=payload.email, password=payload.password, role=payload.role
        )
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.account_created",
        summary=f"Login created for {emp.full_name} ({payload.email}) — verification sent",
        entity_type="employee", entity_id=emp.id,
    )
    return EmployeeOut.model_validate(emp)


# ── Staff-login management (superadmin/manager) + strict email verification ──
class StaffEmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class StaffPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class StaffActiveIn(BaseModel):
    is_active: bool


@router.get("/{employee_id}/login")
async def staff_login(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """The linked login's email + verified/active state (drives the admin chips)."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return {"login": await service.staff_login_status(db, emp)}


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    """Every field declared, because response_model drops what it is not told
    about and this project has lost figures to that four times."""

    id: str
    body: str
    from_staff: bool
    sender_name: str
    created_at: datetime


class ThreadOut(BaseModel):
    messages: list[MessageOut]
    unread: int


@router.get("/{employee_id}/messages", response_model=ThreadOut)
async def staff_thread(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> ThreadOut:
    """The manager's side of the conversation with one member of staff."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    msgs = await service.thread_for(db, emp)
    unread = await service.unread_count(db, emp, for_staff=False)
    # Opening it is reading it.
    await service.mark_thread_seen(db, emp, as_staff=False)
    return ThreadOut(messages=[MessageOut(**m) for m in msgs], unread=unread)


@router.post("/{employee_id}/messages", response_model=MessageOut)
async def staff_thread_post(
    employee_id: uuid.UUID,
    payload: MessageIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> MessageOut:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        msg = await service.post_message(db, emp, body=payload.body, from_staff=False, user=user)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return MessageOut(**msg)


@router.get("/{employee_id}/impact")
async def removal_impact(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """What a permanent removal would take with it.

    Every foreign key pointing at an employee is ON DELETE CASCADE — attendance,
    payslips, documents and rota shifts all go. That is a lot to destroy behind a
    button labelled with one word, so the count is fetched BEFORE the question is
    asked and the confirmation names it. An informed yes is the only kind worth
    collecting for something this final.
    """
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return await service.removal_impact(db, emp)


@router.delete("/{employee_id}")
async def remove_employee(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Permanently remove an employee AND their login.

    The direction matters and is deliberate: "if we remove from employee then
    role's page need to catch that, but if we remove from staff, employee don't
    catch." A person can exist without an account; an account cannot exist
    without a person. So this takes the login with it, while removing a login
    (DELETE /auth/users/{id}) leaves the employee record standing.

    Super Admin only, like the login equivalent — suspending is the reversible
    door and it is right there next to this one.
    """
    if user.role != "SUPER_ADMIN":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only a Super Admin can permanently remove someone. You can suspend them instead.",
        )
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    if emp.user_id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't remove your own record")
    name = emp.full_name
    impact = await service.removal_impact(db, emp)
    try:
        await service.remove_employee_permanently(db, emp)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="employee.removed",
        summary=(
            f"Permanently removed {name} — with "
            f"{impact['attendance']} attendance rows, {impact['payslips']} payslips, "
            f"{impact['documents']} documents and {impact['shifts']} shifts"
            + (f", and the login {impact['login_email']}" if impact["login_email"] else "")
        ),
        entity_type="employee", entity_id=employee_id,
    )
    return {"removed": True, "name": name}


@router.post("/{employee_id}/login/email")
async def change_email(
    employee_id: uuid.UUID,
    payload: StaffEmailIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.change_staff_email(db, emp, payload.email)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.email_changed",
        summary=f"Email for {emp.full_name} changed to {payload.email} — re-verification sent",
        entity_type="employee", entity_id=emp.id,
    )
    return {"login": await service.staff_login_status(db, emp)}


@router.post("/{employee_id}/login/password")
async def reset_password(
    employee_id: uuid.UUID,
    payload: StaffPasswordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.reset_staff_password(db, emp, payload.password)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.password_reset",
        summary=f"Password reset for {emp.full_name} by admin — staff notified by email",
        entity_type="employee", entity_id=emp.id,
    )
    return {"ok": True}


@router.post("/{employee_id}/login/active")
async def set_active(
    employee_id: uuid.UUID,
    payload: StaffActiveIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.set_staff_active(db, emp, payload.is_active)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    verb = "reactivated" if payload.is_active else "deactivated"
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=f"staff.{verb}",
        summary=f"Login for {emp.full_name} {verb}",
        entity_type="employee", entity_id=emp.id,
    )
    return {"login": await service.staff_login_status(db, emp)}


@router.post("/{employee_id}/login/resend-verification")
async def resend_verification(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None or not emp.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No login for this employee")
    from app.auth.models import User as UserModel

    u = await db.get(UserModel, emp.user_id)
    if u.email_verified:
        return {"already_verified": True}
    await service._mark_unverified_and_email(db, u, hotel_name=None)
    await db.commit()
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.verification_resent",
        summary=f"Verification email resent to {emp.full_name}",
        entity_type="employee", entity_id=emp.id,
    )
    return {"sent": True}


@router.get("/{employee_id}/history")
async def employee_history(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """The admin action timeline for this employee (added, email set, verified,
    password reset, (de)activated…) — a clean audit story on the Employees page."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    events = await audit.list_for_entity(db, user.hotel_id, "employee", employee_id)
    return {
        "events": [
            {
                "action": e.action,
                "summary": e.summary,
                "by": e.user_email,
                "at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ]
    }


# ── Attendance ────────────────────────────────────────────────────────────
@attendance_router.get("/hours")
async def attendance_hours(
    date_from: date_type,
    date_to: date_type,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> dict[str, list[float]]:
    """Hours worked per person, per day, across a range — in ONE request.

    The attendance page draws a seven-day bar under each name, and it was
    fetching it as seven separate calls to `?on=`. Measured from his desk that
    is seven round trips to London for one small picture: about 300ms of pure
    latency each, and the browser only runs six at a time.

    The shape is `{employee_id: [h, h, h, h, h, h, h]}`, indexed the same way
    the caller built its date list, so the client does no matching.
    """
    if date_to < date_from:
        date_from, date_to = date_to, date_from
    span = (date_to - date_from).days + 1
    if span > 62:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That range is too wide.")

    out: dict[str, list[float]] = {}
    for i in range(span):
        day = date_from + timedelta(days=i)
        for row in await service.list_attendance(db, user.hotel_id, day):
            # `list_attendance` returns DICTS, not ORM rows — see
            # `_attendance_row`, which flattens the Attendance/Employee pair and
            # adds the computed break penalty. Attribute access raised
            # `AttributeError: 'dict' object has no attribute 'employee_id'` on
            # every single call, so this endpoint has been a hard 500 for as
            # long as it has existed and the weekly hours strip has always been
            # empty.
            slot = out.setdefault(str(row["employee_id"]), [0.0] * span)
            slot[i] = float(row["working_hours"] or 0)
    return out


@attendance_router.get("", response_model=list[AttendanceRow])
async def list_attendance(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> list[AttendanceRow]:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)

    # Someone on booked leave is not "absent" in the sense that needs chasing.
    # Without this the attendance sheet reads the same for a person on holiday
    # and a person who simply did not turn up, which is the distinction the
    # manager actually cares about at 09:00.
    off = await leave_service.employee_ids_off(db, user.hotel_id, day)
    # What the rota expected today. Without this the sheet cannot tell "nobody
    # was due" from "somebody did not turn up" — completely different mornings,
    # and only the second one needs a phone call.
    scheduled = await leave_service.scheduled_on(db, user.hotel_id, day)

    out = []
    seen: set[uuid.UUID] = set()
    for r in rows:
        emp = r["employee_id"]
        seen.add(emp)
        if emp in off:
            r = {**r, "status": "LEAVE", "no_punch": False, "on_leave": True}
        elif emp in scheduled:
            shift = scheduled[emp]
            r = {
                **r,
                "scheduled": True,
                "scheduled_start": shift.start_time.strftime("%H:%M") if shift.start_time else None,
                # Rota'd, not on leave, and no clock-in. This is the row a
                # manager needs at 09:00, and nothing surfaced it before.
                "missing": r.get("clock_in") is None,
            }
        out.append(AttendanceRow.model_validate(r))

    # The rows above only exist for people who PUNCHED. But the two states worth
    # surfacing — on holiday, and rota'd yet nowhere to be seen — are precisely
    # the ones with nothing recorded, so decorating existing rows could never
    # reach them. Anyone off or expected today gets a row whether or not they
    # touched the clock.
    absentees = (off | set(scheduled)) - seen
    if absentees:
        found = await db.execute(select(Employee).where(Employee.id.in_(absentees)))
        for employee in found.scalars():
            shift = scheduled.get(employee.id)
            out.append(
                AttendanceRow(
                    employee_id=employee.id,
                    employee_name=employee.full_name,
                    date=day,
                    clock_in=None,
                    clock_out=None,
                    working_hours=None,
                    status="LEAVE" if employee.id in off else "ABSENT",
                    on_leave=employee.id in off,
                    scheduled=shift is not None,
                    scheduled_start=(
                        shift.start_time.strftime("%H:%M")
                        if shift is not None and shift.start_time
                        else None
                    ),
                    # Expected, not on leave, and never clocked in.
                    missing=shift is not None and employee.id not in off,
                )
            )
        out.sort(key=lambda r: r.employee_name)
    return out


class PinSet(BaseModel):
    """Setting the door code needs the owner's own password.

    A code that unlocks a screen must not be changeable by whoever happens to
    be sitting at an unlocked one.
    """

    password: str
    pin: str
    # Optional, so a caller that only rotates the PIN keeps whatever was
    # chosen last time rather than silently switching the panels off.
    show_rota: bool | None = None
    show_leave: bool | None = None
    theme: str | None = None


class PinUnlock(BaseModel):
    pin: str


@attendance_router.get("/lock")
async def attendance_lock_status(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> dict:
    """Whether this restaurant has an attendance PIN set."""
    hotel = await db.get(Hotel, user.hotel_id)
    return {
        "has_pin": attendance_lock.has_pin(hotel) if hotel else False,
        "can_manage": attendance_lock.can_manage_pin(user),
        "show_rota": bool(hotel and hotel.kiosk_show_rota),
        "show_leave": bool(hotel and hotel.kiosk_show_leave),
        # kiosk-specific choice, else the RESTAURANT's theme, else dark.
        #
        # This used to be `kiosk_theme or "dark"`, and "dark" is truthy — so a
        # restaurant that had never set a kiosk theme got "dark" handed to it as
        # though it were a decision, and the client had no way to tell that
        # apart from a real one. It then never fell through to the hotel's own
        # theme. "Carbon (Dark)" carries an emerald accent, which is exactly the
        # green he kept seeing on a burgundy restaurant.
        "theme": (hotel.kiosk_theme or hotel.theme or "dark") if hotel else "dark",
    }


@attendance_router.post("/lock/pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_attendance_pin(
    payload: PinSet,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> None:
    """Set or change the PIN. Owner only, and only with their password."""
    if not attendance_lock.can_manage_pin(user):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can set this PIN.")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That password is not right.")
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    # The panels are decided here rather than in a settings page nobody
    # visits: generating the PIN is the one moment the owner is already
    # thinking about what this screen is for.
    if payload.show_rota is not None:
        hotel.kiosk_show_rota = payload.show_rota
    if payload.show_leave is not None:
        hotel.kiosk_show_leave = payload.show_leave
    if payload.theme is not None:
        hotel.kiosk_theme = payload.theme[:24]
    try:
        await attendance_lock.set_pin(db, hotel, payload.pin)
    except attendance_lock.PinError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


class KioskOpen(BaseModel):
    """Opening the attendance screen from a cold tablet.

    `site` is the restaurant's handle from the subdomain — the tablet is at
    <hotel>.dineai.cloud/kiosk and nobody has signed in, so the PIN alone has
    to say WHICH restaurant as well as prove the right to open it.
    """

    site: str
    pin: str


@attendance_router.post("/kiosk-open")
async def open_kiosk(
    payload: KioskOpen,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """PIN in, attendance-only session out. No login required.

    Deliberately unauthenticated: the whole point is that a tablet on the wall
    boots to this screen and a manager types four digits. Requiring a sign-in
    first would mean somebody's real session lives on that device, which is
    exactly what this design avoids.

    What comes back is KIOSK-scoped — record a punch, read staff names, nothing
    else. A wrong PIN and a wrong restaurant give the same answer, so this
    cannot be used to discover which handles exist.

    ⚠️ RATE-LIMITED, because this is a PASSWORD PROMPT that happens to be called
    a PIN. It was the only unauthenticated door in the product with no limiter
    on it: six digits is a million candidates, and what a correct guess returns
    is a fourteen-hour token for the whole restaurant. Metered per site as well
    as per IP — one tablet behind one NAT address is the normal case, and a
    script from many addresses against one handle is the attack.
    """
    site = (payload.site or "").strip().lower()
    ratelimit.guard(request, "kiosk_open", site)
    rows = await db.execute(select(Hotel).where(Hotel.username == site))
    hotel = rows.scalars().first()

    if hotel is None or not hotel.is_active or not attendance_lock.has_pin(hotel):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That PIN is not right.")
    if not attendance_lock.verify(hotel, payload.pin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That PIN is not right.")

    token = await attendance_lock.kiosk_token_for(db, hotel.id)
    await audit.record(
        db, hotel_id=hotel.id, user=None, action="attendance.kiosk",
        summary="Attendance screen opened with the PIN",
    )
    return {
        "token": token,
        "hotel": hotel.name,
        # So a tablet that has never been here draws itself correctly the
        # moment it opens, instead of flashing the default first.
        "theme": hotel.kiosk_theme or hotel.theme or "dark",
    }


@attendance_router.post("/lock/verify")
async def verify_attendance_pin(
    payload: PinUnlock,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> dict:
    """Is this the PIN? Used to LEAVE the attendance screen.

    Reachable by the kiosk session itself — otherwise the screen could never
    check the code it needs to let somebody out, and the lock would be a door
    that only opens from outside.
    """
    hotel = await db.get(Hotel, user.hotel_id)
    ok = hotel is not None and attendance_lock.verify(hotel, payload.pin)
    return {"ok": ok}


@attendance_router.get("/timesheet.pdf")
async def timesheet_pdf(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = timesheet.generate_timesheet_pdf(rows, hotel, day)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="timesheet-{day}.pdf"'},
    )


@attendance_router.get("/timesheet.xlsx")
async def timesheet_xlsx(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)
    hotel = await db.get(Hotel, user.hotel_id)
    xlsx = timesheet.generate_timesheet_xlsx(rows, hotel, day)
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="timesheet-{day}.xlsx"'},
    )


@attendance_router.get("/history/{employee_id}")
async def attendance_history(
    employee_id: uuid.UUID,
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> dict:
    """One person, ANY range — full timeline + totals + indicative pay."""
    out = await service.attendance_history(db, user.hotel_id, employee_id, date_from, date_to)
    if not out:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return out


@attendance_router.get("/range.xlsx")
async def attendance_range_xlsx(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    """The download: everyone (or one person) across any date range."""
    rows = await service.list_attendance_range(db, user.hotel_id, date_from, date_to)
    if employee_id:
        rows = [r for r in rows if str(r.get("employee_id")) == str(employee_id)]
    hotel = await db.get(Hotel, user.hotel_id)
    xlsx = timesheet.generate_range_xlsx(rows, hotel, date_from, date_to)
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition":
                 f'attachment; filename="attendance-{date_from}-to-{date_to}.xlsx"'},
    )


@attendance_router.post("/punch", response_model=AttendanceOut)
async def punch(
    payload: PunchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        rec = await service.punch(db, emp, payload.type)
    except service.PunchError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return AttendanceOut.model_validate(rec)


@attendance_router.post("", response_model=AttendanceOut, status_code=status.HTTP_201_CREATED)
async def set_attendance(
    payload: AttendanceSet,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    rec = await service.set_attendance(
        db, emp, payload.date, status=payload.status,
        working_hours_value=payload.working_hours, notes=payload.notes,
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="attendance.set",
        summary=f"Attendance: {emp.full_name} {payload.date} = {payload.status}",
        entity_type="attendance", entity_id=rec.id,
    )
    return AttendanceOut.model_validate(rec)


@attendance_router.post("/edit", response_model=AttendanceOut)
async def edit_attendance(
    payload: AttendanceEdit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    """Manually set/fix clock in/out for any date (incl. back-dated) — for
    missed punches. Times are in the hotel's local time; stored as UTC."""
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    hotel = await db.get(Hotel, user.hotel_id)
    rec = await service.edit_attendance(
        db, emp, payload.date, hotel.country if hotel else None,
        clock_in=payload.clock_in, clock_out=payload.clock_out,
        break_minutes=payload.break_minutes,
    )
    return AttendanceOut.model_validate(rec)


# ── Leave ───────────────────────────────────────────────────────────────────
# Time off as a RANGE, so "is anybody off next Tuesday?" is one question rather
# than seven. The rota consults this before scheduling; attendance consults it
# before calling somebody absent.


@router.get("/leave/list")
async def list_leave(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[dict]:
    """Leave overlapping a window, soonest first."""
    q = select(Leave, Employee).join(Employee, Leave.employee_id == Employee.id).where(
        Leave.hotel_id == user.hotel_id
    )
    # Overlap, not containment: leave that STARTED before the window but runs
    # into it is exactly the leave you need to see.
    if date_from:
        q = q.where(Leave.end_date >= date_from)
    if date_to:
        q = q.where(Leave.start_date <= date_to)
    rows = await db.execute(q.order_by(Leave.start_date))
    return [
        {
            "id": str(lv.id),
            "employee_id": str(lv.employee_id),
            "employee_name": emp.full_name,
            "start_date": lv.start_date.isoformat(),
            "end_date": lv.end_date.isoformat(),
            "days": (lv.end_date - lv.start_date).days + 1,
            "kind": lv.kind,
            "status": lv.status,
            "reason": lv.reason,
        }
        for lv, emp in rows.all()
    ]


@router.post("/leave", status_code=status.HTTP_201_CREATED)
async def create_leave(
    payload: LeaveCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Book time off, and say if it collides with shifts already rota'd.

    A collision does NOT block the booking — plans change, and the leave is the
    newer decision. But it must be SAID, or the rota keeps showing somebody who
    is on holiday and nobody finds out until the day.
    """
    if payload.end_date < payload.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The end date is before the start date.")

    employee = await db.get(Employee, payload.employee_id)
    if employee is None or employee.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    clashes = await leave_service.shifts_clashing(
        db, user.hotel_id, payload.employee_id, payload.start_date, payload.end_date
    )

    row = Leave(
        hotel_id=user.hotel_id,
        employee_id=payload.employee_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        kind=payload.kind,
        status=payload.status,
        reason=payload.reason,
        approved_by=user.id if payload.status == LeaveStatus.APPROVED.value else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {
        "id": str(row.id),
        "clashing_shifts": [
            {"id": str(sh.id), "date": sh.date.isoformat()} for sh in clashes
        ],
        "warning": (
            f"{employee.full_name} is already rota'd on "
            f"{', '.join(sh.date.isoformat() for sh in clashes)}. "
            "Remove those shifts, or the rota will still show them working."
            if clashes
            else None
        ),
    }


@router.delete("/leave/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_leave(
    leave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> Response:
    row = await db.get(Leave, leave_id)
    if row is None or row.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such leave")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
