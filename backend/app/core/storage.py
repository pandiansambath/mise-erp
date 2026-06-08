"""File storage abstraction. LocalStorage now; swap to an S3 backend at deploy
(App Runner is ephemeral) without touching callers."""
import uuid
from pathlib import Path

from app.core.config import settings


class LocalStorage:
    def __init__(self, base: str) -> None:
        self.base = Path(base)

    def save(self, hotel_id: uuid.UUID, doc_id: uuid.UUID, filename: str, data: bytes) -> str:
        key = f"{hotel_id}/{doc_id}/{filename}"
        path = self.base / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read(self, key: str) -> bytes:
        return (self.base / key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            (self.base / key).unlink()
        except FileNotFoundError:
            pass


def get_storage() -> LocalStorage:
    return LocalStorage(settings.upload_dir)
