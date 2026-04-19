"""Persistent storage for uploaded ТЗ/КП files.

Files are streamed to disk under ``UPLOADS_DIR`` (bind-mounted volume in
docker-compose.prod.yml), hashed for integrity / dedup, and referenced from
the ``PurchaseFile`` row via ``storage_path`` (relative to ``UPLOADS_DIR``).
Reads always resolve the path back under ``UPLOADS_DIR`` to block traversal.
"""

import hashlib
import logging
import os
import uuid
from pathlib import Path
from typing import BinaryIO

logger = logging.getLogger(__name__)

UPLOADS_DIR = Path(os.getenv("UPLOADS_DIR", "/app/data/uploads"))
CHUNK_SIZE = 1024 * 1024  # 1 MB


def _user_purchase_dir(user_id: int, purchase_id: int) -> Path:
    path = UPLOADS_DIR / str(user_id) / str(purchase_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_stream(user_id: int, purchase_id: int, original_filename: str, stream: BinaryIO) -> dict:
    """Stream ``stream`` into disk storage. Returns storage metadata.

    Never loads the whole file into memory; suitable for 25 MB PDFs.
    """
    suffix = Path(original_filename).suffix.lower()
    # UUID name avoids leaking original filenames to disk (original kept in DB)
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    dest_dir = _user_purchase_dir(user_id, purchase_id)
    dest = dest_dir / stored_name

    hasher = hashlib.sha256()
    size = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = stream.read(CHUNK_SIZE)
                if not chunk:
                    break
                hasher.update(chunk)
                size += len(chunk)
                out.write(chunk)
    except Exception:
        if dest.exists():
            dest.unlink()
        raise

    rel = dest.relative_to(UPLOADS_DIR).as_posix()
    logger.info("[file_storage] saved user=%s purchase=%s path=%s size=%s", user_id, purchase_id, rel, size)
    return {
        "storage_path": rel,
        "size_bytes": size,
        "sha256": hasher.hexdigest(),
    }


def resolve(storage_path: str) -> Path:
    """Resolve a relative ``storage_path`` to an absolute path inside UPLOADS_DIR.

    Raises FileNotFoundError if traversal escapes UPLOADS_DIR or file is missing.
    """
    if not storage_path:
        raise FileNotFoundError("empty storage_path")
    full = (UPLOADS_DIR / storage_path).resolve()
    base = UPLOADS_DIR.resolve()
    if base not in full.parents and full != base:
        raise FileNotFoundError(f"path escapes uploads dir: {storage_path}")
    if not full.exists():
        raise FileNotFoundError(f"file not found: {storage_path}")
    return full


def unlink(storage_path: str) -> None:
    try:
        full = resolve(storage_path)
        full.unlink()
    except FileNotFoundError:
        pass
    except Exception:
        logger.exception("[file_storage] unlink failed path=%s", storage_path)
