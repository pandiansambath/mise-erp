"""Comments on a document request — the conversation about ONE piece of paper.

    "here i need comment feature. superadmin and staff can comment on that doc.
     suppose anything is missing or needed he can comment and superadmin can
     read and request again nah. keep comment persistent."

WHY THIS IS NOT JUST A CHAT MESSAGE. The whole point is that it is attached to
the request: "this passport photo is blurred, send another" belongs beside the
passport photo, not scrolling away in a room where tomorrow it is forty messages
up. Six months later, when somebody asks why a document was re-requested three
times, the answer has to be in the same place as the document.

It reuses no other table for the same reason. `staff_messages` is a person
talking to their manager and `chat_room_messages` is a room; neither can say
WHICH request a sentence is about, and a thread that cannot name its subject is
a thread nobody can find twice.
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import Base, get_db
from app.core.events import publish
from app.documents.models import DocumentRequest
from app.employees.models import Employee

router = APIRouter(prefix="/documents", tags=["documents"])


class DocComment(Base):
    __tablename__ = "document_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False)
    request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("document_requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    #: Kept as a name as well as an id, so the thread still reads after a login
    #: is removed — the reason a document was rejected outlives the person.
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Which side said it. Not derived from the role at READ time: somebody
    #: promoted from staff to manager must not retrospectively have been
    #: speaking as a manager.
    from_staff: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class CommentOut(BaseModel):
    id: str
    body: str
    author_name: str
    from_staff: bool
    created_at: datetime


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


async def _request_i_can_see(
    db: AsyncSession, request_id: uuid.UUID, user: User
) -> tuple[DocumentRequest, bool]:
    """The request, and whether this person is the staff member it is about.

    Everyone who can open Documents may read and reply; so may the employee the
    request belongs to, who usually has no document permissions at all — being
    asked for your own passport does not make you an administrator.
    """
    req = await db.get(DocumentRequest, request_id)
    if req is None or req.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such request")

    mine = False
    emp = await db.get(Employee, req.employee_id)
    if emp is not None and emp.user_id == user.id:
        mine = True

    from app.auth.deps import effective_permissions
    from app.core.rbac import has_permission

    granted = await effective_permissions(db, user)
    may_admin = (
        ("*" in granted or "documents:read" in granted or "documents:write" in granted)
        if granted is not None
        else has_permission(user.role, "documents:read")
    )
    if not (mine or may_admin):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such request")
    return req, mine


@router.get("/requests/{request_id}/comments", response_model=list[CommentOut])
async def list_comments(
    request_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CommentOut]:
    await _request_i_can_see(db, request_id, user)
    rows = await db.execute(
        select(DocComment)
        .where(DocComment.request_id == request_id)
        .order_by(DocComment.created_at)
    )
    return [
        CommentOut(
            id=str(c.id),
            body=c.body,
            author_name=c.author_name,
            from_staff=c.from_staff,
            created_at=c.created_at,
        )
        for c in rows.scalars()
    ]


@router.post("/requests/{request_id}/comments", response_model=CommentOut)
async def add_comment(
    request_id: uuid.UUID,
    payload: CommentIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CommentOut:
    """Say something about this document. Either side, and it stays."""
    req, mine = await _request_i_can_see(db, request_id, user)
    body = payload.body.strip()
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Write something first.")

    from datetime import UTC

    row = DocComment(
        hotel_id=user.hotel_id,
        request_id=req.id,
        author_user_id=user.id,
        author_name=(user.preferred_name or user.email.split("@")[0] or "Someone")[:120],
        from_staff=mine,
        body=body,
        created_at=datetime.now(UTC),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    await publish(user.hotel_id, {"type": "documents.comment", "request_id": str(req.id)})
    return CommentOut(
        id=str(row.id),
        body=row.body,
        author_name=row.author_name,
        from_staff=row.from_staff,
        created_at=row.created_at,
    )
