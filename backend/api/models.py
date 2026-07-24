"""API endpoints for model listing, details, and online upload."""

import json
import os
import shutil
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from config import MODELS_DIR
from model_registry.registry import list_models, get_model_public, scan_models

router = APIRouter()


@router.get("/models")
async def get_models():
    """List all available models."""
    models = list_models()
    return {"models": models, "count": len(models)}


@router.get("/models/{model_id}")
async def get_model_detail(model_id: str):
    """Get detailed info for a specific model."""
    model = get_model_public(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")
    return model


@router.post("/models/reload")
async def reload_models():
    """Rescan the models directory and reload registry."""
    models = scan_models()
    return {"models": [m["id"] for m in models], "count": len(models)}


@router.post("/models/upload")
async def upload_model(
    file: UploadFile = File(...),
    name: str = Form(...),
    type: str = Form("detection"),
    framework: str = Form("ultralytics"),
    description: str = Form(""),
    classes: str = Form(""),
    input_width: int = Form(640),
    input_height: int = Form(640),
    default_conf: float = Form(0.25),
    default_iou: float = Form(0.45),
    device: str = Form("cuda"),
    dataset: str = Form(""),
    base_model: str = Form(""),
):
    """Upload a new model checkpoint (.pt) with configuration.

    - **file**: Model checkpoint file (.pt)
    - **name**: Display name for the model
    - **classes**: Comma-separated class names (e.g. "person,car,dog")
    """
    # Validate file extension
    filename = file.filename or "model.pt"
    if not filename.endswith(".pt"):
        raise HTTPException(status_code=400, detail="Only .pt files are supported")

    # Generate a safe model ID
    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in name)
    model_id = f"{safe_name}_{uuid.uuid4().hex[:6]}"

    model_dir = MODELS_DIR / model_id
    os.makedirs(model_dir, exist_ok=True)

    # Save the model file
    pt_path = model_dir / filename
    try:
        with open(pt_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        # Clean up on failure
        shutil.rmtree(model_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Failed to save model file: {e}")

    # Parse classes
    class_list = [c.strip() for c in classes.split(",") if c.strip()] if classes else []

    # Write config
    config = {
        "name": name,
        "description": description,
        "type": type,
        "framework": framework,
        "model_file": filename,
        "input_size": [input_width, input_height],
        "classes": class_list,
        "default_conf": default_conf,
        "default_iou": default_iou,
        "device": device,
        "dataset": dataset,
        "base_model": base_model,
    }

    config_path = model_dir / "config.json"
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    # Re-scan to register the new model
    scan_models()

    return {
        "model_id": model_id,
        "name": name,
        "message": f"Model '{name}' uploaded successfully",
    }


@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    """Delete a model and its directory."""
    model_dir = MODELS_DIR / model_id
    if not model_dir.exists():
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    shutil.rmtree(model_dir)
    scan_models()
    return {"message": f"Model '{model_id}' deleted"}
