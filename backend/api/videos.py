"""API endpoints for video upload and management."""

import json
import os
import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, HTTPException, UploadFile, File

from config import UPLOADS_DIR, ALLOWED_VIDEO_EXTENSIONS, MAX_VIDEO_SIZE_MB

router = APIRouter()

# Scene tags file
SCENES_FILE = UPLOADS_DIR / "_scenes.json"


def _load_scenes() -> list[str]:
    if SCENES_FILE.exists():
        try:
            return json.loads(SCENES_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    return ["测试", "训练", "验证"]


def _save_scenes(tags: list[str]):
    SCENES_FILE.parent.mkdir(parents=True, exist_ok=True)
    SCENES_FILE.write_text(json.dumps(tags, ensure_ascii=False), encoding="utf-8")


def _read_meta(video_dir: Path) -> dict:
    """Read video meta.json, init with defaults if missing."""
    meta_path = video_dir / "meta.json"
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError):
            pass
    # Default: use filename as name, scene = 测试
    video_files = list(video_dir.glob("original.*"))
    original_name = video_files[0].name if video_files else "unknown"
    return {"custom_name": "", "scene": "测试", "original_name": original_name}


def _write_meta(video_dir: Path, meta: dict):
    meta_path = video_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _get_display_name(meta: dict) -> str:
    """Return display name: custom_name or original_name."""
    return meta.get("custom_name") or meta.get("original_name", "unknown")


@router.post("/videos/upload")
async def upload_video(file: UploadFile = File(...)):
    """Upload a video file."""
    # Validate extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{ext}'. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}",
        )

    # Create video directory
    video_id = uuid.uuid4().hex[:12]
    video_dir = UPLOADS_DIR / video_id
    video_dir.mkdir(parents=True, exist_ok=True)

    # Save file
    safe_name = f"original{ext}"
    file_path = video_dir / safe_name

    content = await file.read()
    file_size_mb = len(content) / (1024 * 1024)

    if file_size_mb > MAX_VIDEO_SIZE_MB:
        raise HTTPException(
            status_code=400,
            detail=f"Video too large ({file_size_mb:.1f}MB). Max: {MAX_VIDEO_SIZE_MB}MB",
        )

    with open(file_path, "wb") as f:
        f.write(content)

    # Extract metadata
    cap = cv2.VideoCapture(str(file_path))
    if not cap.isOpened():
        raise HTTPException(status_code=400, detail="Cannot read video file")

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration = total_frames / fps if fps > 0 else 0
    cap.release()

    # Save meta with default scene tag
    _write_meta(video_dir, {"custom_name": "", "scene": "测试", "original_name": file.filename})

    # Register scene tag
    scenes = _load_scenes()
    if "测试" not in scenes:
        scenes.append("测试")
        _save_scenes(scenes)

    return {
        "id": video_id,
        "original_name": file.filename,
        "scene": "测试",
        "filename": safe_name,
        "size_bytes": len(content),
        "duration_seconds": round(duration, 2),
        "fps": round(fps, 2),
        "width": width,
        "height": height,
        "total_frames": total_frames,
        "url": f"/uploads/{video_id}/{safe_name}",
    }


@router.get("/videos")
async def list_videos():
    """List all uploaded videos."""
    videos = []

    if not UPLOADS_DIR.exists():
        return {"videos": [], "count": 0}

    for video_dir in sorted(UPLOADS_DIR.iterdir(), reverse=True):
        if not video_dir.is_dir():
            continue

        # Find the original video file
        video_files = list(video_dir.glob("original.*"))
        if not video_files:
            continue

        vf = video_files[0]
        stat = vf.stat()

        # Try to read metadata
        cap = cv2.VideoCapture(str(vf))
        fps = cap.get(cv2.CAP_PROP_FPS) if cap.isOpened() else 0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if cap.isOpened() else 0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) if cap.isOpened() else 0
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) if cap.isOpened() else 0
        duration = total_frames / fps if fps > 0 else 0
        if cap.isOpened():
            cap.release()

        meta = _read_meta(video_dir)

        videos.append({
            "id": video_dir.name,
            "original_name": meta.get("original_name", vf.name),
            "display_name": _get_display_name(meta),
            "scene": meta.get("scene", "测试"),
            "size_bytes": stat.st_size,
            "duration_seconds": round(duration, 2),
            "fps": round(fps, 2),
            "width": width,
            "height": height,
            "total_frames": total_frames,
            "url": f"/uploads/{video_dir.name}/{vf.name}",
            "created_at": stat.st_mtime,
        })

    return {"videos": videos, "count": len(videos)}


@router.get("/videos/{video_id}")
async def get_video(video_id: str):
    """Get metadata for a specific video."""
    video_dir = UPLOADS_DIR / video_id
    if not video_dir.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    video_files = list(video_dir.glob("original.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video file not found")

    vf = video_files[0]
    stat = vf.stat()

    cap = cv2.VideoCapture(str(vf))
    fps = cap.get(cv2.CAP_PROP_FPS) if cap.isOpened() else 0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) if cap.isOpened() else 0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) if cap.isOpened() else 0
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) if cap.isOpened() else 0
    duration = total_frames / fps if fps > 0 else 0
    if cap.isOpened():
        cap.release()

    return {
        "id": video_id,
        "filename": vf.name,
        "size_bytes": stat.st_size,
        "duration_seconds": round(duration, 2),
        "fps": round(fps, 2),
        "width": width,
        "height": height,
        "total_frames": total_frames,
        "url": f"/uploads/{video_id}/{vf.name}",
    }


@router.patch("/videos/{video_id}")
async def update_video_meta(video_id: str, req: dict):
    """Update video custom name and scene tag."""
    video_dir = UPLOADS_DIR / video_id
    if not video_dir.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    meta = _read_meta(video_dir)

    if "display_name" in req:
        meta["custom_name"] = req["display_name"]

    if "scene" in req:
        scene = req["scene"]
        meta["scene"] = scene
        # Register new scene tag
        scenes = _load_scenes()
        if scene not in scenes:
            scenes.append(scene)
            _save_scenes(scenes)

    _write_meta(video_dir, meta)
    return {"id": video_id, "display_name": _get_display_name(meta), "scene": meta.get("scene", "测试")}


@router.get("/videos/scenes/list")
async def list_scenes():
    """List all saved scene tags."""
    return {"scenes": _load_scenes()}


@router.delete("/videos/{video_id}")
async def delete_video(video_id: str):
    """Delete a video and its associated outputs."""
    import shutil

    video_dir = UPLOADS_DIR / video_id
    if video_dir.exists():
        shutil.rmtree(video_dir)

    # Also clean up any outputs for this video
    from config import OUTPUTS_DIR
    for out_dir in OUTPUTS_DIR.iterdir():
        if out_dir.is_dir() and video_id in str(out_dir):
            shutil.rmtree(out_dir)

    return {"status": "deleted", "id": video_id}
