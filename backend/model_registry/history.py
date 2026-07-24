"""History management: load, save, and query inference history."""

import json
import threading
from datetime import datetime
from pathlib import Path
from typing import Optional

from config import HISTORY_FILE

_lock = threading.Lock()


def load_history() -> list[dict]:
    """Load all history entries."""
    if not HISTORY_FILE.exists():
        return []
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return []


def save_history(entries: list[dict]):
    """Atomically save history."""
    with _lock:
        HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = HISTORY_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, indent=2)
        tmp.replace(HISTORY_FILE)


def add_entry(
    task_id: str,
    mode: str,
    model_name: str,
    video_name: str,
    status: str,
    output_video_url: Optional[str] = None,
    total_frames: int = 0,
    total_detections: int = 0,
    batch_id: Optional[str] = None,
    extra: Optional[dict] = None,
):
    """Add a new history entry."""
    entries = load_history()
    entry = {
        "task_id": task_id,
        "mode": mode,
        "batch_id": batch_id,
        "model_name": model_name,
        "video_name": video_name,
        "status": status,
        "output_video_url": output_video_url,
        "total_frames": total_frames,
        "total_detections": total_detections,
        "created_at": datetime.now().isoformat(),
        "extra": extra or {},
    }
    entries.insert(0, entry)
    save_history(entries[:200])


def list_history(mode: Optional[str] = None, limit: int = 50) -> list[dict]:
    """List history, optionally filtered by mode."""
    entries = load_history()
    if mode and mode != "all":
        entries = [e for e in entries if e.get("mode") == mode]
    return entries[:limit]
