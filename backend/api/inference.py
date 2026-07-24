"""API endpoints for inference execution and WebSocket progress streaming."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from model_registry.registry import get_model
from model_registry.loader import load_model
from model_registry.history import add_entry
from inference.engine import VideoInferenceTask, get_task, cancel_task
from config import UPLOADS_DIR

router = APIRouter()

# Active WebSocket connections: task_id → list of WebSocket
_ws_connections: dict[str, list[WebSocket]] = {}
# Running inference tasks
_running_tasks: dict[str, VideoInferenceTask] = {}


async def _broadcast(task_id: str, data: dict):
    """Send a message to all WebSocket clients listening for this task."""
    disconnected = []
    for ws in _ws_connections.get(task_id, []):
        try:
            await ws.send_json(data)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        _ws_connections.get(task_id, []).remove(ws)


@router.post("/inference")
async def start_inference(req: dict):
    """Start a new inference task.

    Request body:
        { "model_id": "...", "video_id": "...", "conf": 0.25, "iou": 0.45,
          "frame_skip": 1, "max_frames": null, "batch_size": 8 }
    """
    model_id = req.get("model_id")
    video_id = req.get("video_id")
    conf = req.get("conf")
    iou = req.get("iou")
    frame_skip = req.get("frame_skip", 1)
    max_frames = req.get("max_frames")
    batch_size = req.get("batch_size", 8)
    mode = req.get("mode", "single")  # "single", "multi_model", "multi_video"
    batch_id = req.get("batch_id")

    if not model_id or not video_id:
        raise HTTPException(status_code=400, detail="model_id and video_id are required")

    # Validate model
    model_info = get_model(model_id)
    if model_info is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    # Validate video
    video_dir = UPLOADS_DIR / video_id
    if not video_dir.exists():
        raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found")

    video_files = list(video_dir.glob("original.*"))
    if not video_files:
        raise HTTPException(status_code=404, detail="Video file not found")

    video_path = str(video_files[0])

    # Use model defaults if not specified
    if conf is None:
        conf = model_info.get("default_conf", 0.25)
    if iou is None:
        iou = model_info.get("default_iou", 0.45)

    # Load model
    try:
        model = load_model(model_info)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load model: {str(e)}")

    # Create and launch task
    task = VideoInferenceTask(
        model=model,
        model_info=model_info,
        video_path=video_path,
        conf=conf,
        iou=iou,
        frame_skip=frame_skip,
        max_frames=max_frames,
        batch_size=batch_size,
    )

    _running_tasks[task.task_id] = task

    # Define progress callback
    async def on_progress(data: dict):
        await _broadcast(task.task_id, {"type": "progress", **data})

    # Start inference in background
    asyncio.create_task(_run_task(task, on_progress, model_info, video_dir.name, mode, batch_id))

    return {
        "task_id": task.task_id,
        "status": "running",
        "model_id": model_id,
        "video_id": video_id,
    }


async def _run_task(task: VideoInferenceTask, on_progress, model_info: dict, video_name: str, mode: str, batch_id: str = None):
    """Run the inference task and broadcast completion/error."""
    try:
        await task.run(progress_callback=on_progress)
        # Send final result
        task_data = get_task(task.task_id)
        if task_data:
            await _broadcast(task.task_id, {"type": "complete", **task_data})
            # Save to history
            results = task_data.get("results", [])
            total_detections = sum(len(r.get("detections", [])) for r in results)
            add_entry(
                task_id=task.task_id,
                mode=mode,
                batch_id=batch_id,
                model_name=model_info.get("name", "unknown"),
                video_name=video_name,
                status="done",
                output_video_url=task_data.get("output_video_url"),
                total_frames=task_data.get("total_frames", 0),
                total_detections=total_detections,
            )
    except Exception as e:
        await _broadcast(task.task_id, {
            "type": "error",
            "error": str(e),
            "task_id": task.task_id,
        })


@router.get("/inference/{task_id}")
async def get_inference_status(task_id: str):
    """Get the current status of an inference task."""
    task_data = get_task(task_id)
    if task_data is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task_id": task_id, **task_data}


@router.post("/inference/{task_id}/cancel")
async def cancel_inference(task_id: str):
    """Cancel a running inference task."""
    cancel_task(task_id)
    if task_id in _running_tasks:
        _running_tasks[task_id].cancel()
    return {"task_id": task_id, "status": "cancelled"}


@router.websocket("/ws/inference/{task_id}")
async def ws_inference(websocket: WebSocket, task_id: str):
    """WebSocket endpoint for real-time inference progress."""
    await websocket.accept()

    # Register connection
    if task_id not in _ws_connections:
        _ws_connections[task_id] = []
    _ws_connections[task_id].append(websocket)

    # Send current status immediately
    task_data = get_task(task_id)
    if task_data:
        await websocket.send_json({"type": "status", **task_data})
    else:
        await websocket.send_json({"type": "error", "error": "Task not found"})

    try:
        # Keep connection alive, handle client messages
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "cancel":
                cancel_task(task_id)
                if task_id in _running_tasks:
                    _running_tasks[task_id].cancel()
                await websocket.send_json({"type": "cancelled", "task_id": task_id})
                break

            if msg.get("type") == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _ws_connections.get(task_id, []):
            _ws_connections[task_id].remove(websocket)
        if not _ws_connections.get(task_id):
            _ws_connections.pop(task_id, None)
