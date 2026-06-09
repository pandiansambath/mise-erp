"""File storage abstraction. LocalStorage for dev; S3Storage in the cloud
(the EC2 box disk is ephemeral — files must live in S3). Callers are unchanged:
both expose save()/read()/delete() with the same key shape {hotel_id}/{doc_id}/{filename}."""
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


class S3Storage:
    """Stores objects in a private S3 bucket. Auth comes from the EC2 instance
    role (no keys in the app). Same key shape as LocalStorage."""

    def __init__(self, bucket: str, region: str) -> None:
        import boto3  # imported lazily so local dev needn't install it

        self.bucket = bucket
        self._client = boto3.client("s3", region_name=region)

    def save(self, hotel_id: uuid.UUID, doc_id: uuid.UUID, filename: str, data: bytes) -> str:
        key = f"{hotel_id}/{doc_id}/{filename}"
        self._client.put_object(Bucket=self.bucket, Key=key, Body=data)
        return key

    def read(self, key: str) -> bytes:
        try:
            obj = self._client.get_object(Bucket=self.bucket, Key=key)
        except self._client.exceptions.NoSuchKey as exc:
            raise FileNotFoundError(key) from exc
        return obj["Body"].read()

    def delete(self, key: str) -> None:
        self._client.delete_object(Bucket=self.bucket, Key=key)


def get_storage() -> "LocalStorage | S3Storage":
    if settings.storage_backend == "s3" and settings.s3_bucket:
        return S3Storage(settings.s3_bucket, settings.aws_region)
    return LocalStorage(settings.upload_dir)
