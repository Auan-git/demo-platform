"""API endpoints for inference history."""

from fastapi import APIRouter, Query

from model_registry.history import list_history, load_history, save_history

router = APIRouter()


@router.get("/history")
async def get_history(
    mode: str = Query("all", description="Filter: all, single, multi_model, multi_video"),
    limit: int = Query(50, ge=1, le=200),
):
    """List inference history, optionally filtered by mode."""
    entries = list_history(mode=mode, limit=limit)
    return {"entries": entries, "count": len(entries), "mode": mode}


@router.delete("/history/{task_id}")
async def delete_history_entry(task_id: str):
    """Delete a single history entry."""
    entries = load_history()
    entries = [e for e in entries if e.get("task_id") != task_id]
    save_history(entries)
    return {"message": f"Entry {task_id} deleted", "count": len(entries)}


@router.delete("/history")
async def clear_history(
    mode: str = Query("all", description="Clear all or filter by mode"),
):
    """Clear history — all or by mode."""
    if mode == "all":
        save_history([])
        return {"message": "All history cleared", "count": 0}
    entries = load_history()
    entries = [e for e in entries if e.get("mode") != mode]
    save_history(entries)
    return {"message": f"History for mode '{mode}' cleared", "count": len(entries)}
