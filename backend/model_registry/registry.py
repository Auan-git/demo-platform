"""Model registry: discover and list available models from the filesystem."""

import json
import uuid
from pathlib import Path
from typing import Optional

from config import MODELS_DIR

# In-memory cache: model_id → ModelInfo
_models: dict[str, dict] = {}


def scan_models() -> list[dict]:
    """Scan the models directory and register all valid model configurations.

    Each subdirectory under MODELS_DIR that contains a config.json is
    considered a registered model. Returns the list of model info dicts.
    """
    global _models
    _models.clear()

    if not MODELS_DIR.exists():
        return []

    for model_dir in sorted(MODELS_DIR.iterdir()):
        if not model_dir.is_dir():
            continue
        if model_dir.name.startswith("_") or model_dir.name.startswith("."):
            continue

        config_path = model_dir / "config.json"
        if not config_path.exists():
            continue

        try:
            with open(config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"Warning: failed to read config for {model_dir.name}: {e}")
            continue

        model_id = model_dir.name
        pt_file = cfg.get("model_file", "best.pt")
        pt_path = model_dir / pt_file

        if not pt_path.exists():
            print(f"Warning: PT file not found: {pt_path}")

        model_info = {
            "id": model_id,
            "name": cfg.get("name", model_id),
            "description": cfg.get("description", ""),
            "type": cfg.get("type", "detection"),
            "framework": cfg.get("framework", "ultralytics"),
            "model_file": pt_file,
            "pt_path": str(pt_path),
            "model_dir": str(model_dir),
            "input_size": cfg.get("input_size", [640, 640]),
            "classes": cfg.get("classes", []),
            "default_conf": cfg.get("default_conf", 0.25),
            "default_iou": cfg.get("default_iou", 0.45),
            "device": cfg.get("device", "auto"),
            "dataset": cfg.get("dataset", ""),
            "base_model": cfg.get("base_model", ""),
            "has_custom_arch": (model_dir / "model.py").exists(),
        }
        _models[model_id] = model_info

    return list(_models.values())


def list_models() -> list[dict]:
    """Return all registered models (without internal paths)."""
    return [
        {
            "id": m["id"],
            "name": m["name"],
            "description": m["description"],
            "type": m["type"],
            "framework": m["framework"],
            "input_size": m["input_size"],
            "classes": m["classes"],
            "default_conf": m["default_conf"],
            "default_iou": m["default_iou"],
            "dataset": m.get("dataset", ""),
            "base_model": m.get("base_model", ""),
        }
        for m in _models.values()
    ]


def get_model(model_id: str) -> Optional[dict]:
    """Get full model info by ID (includes internal paths for inference)."""
    return _models.get(model_id)


def get_model_public(model_id: str) -> Optional[dict]:
    """Get model info without internal paths (safe for API response)."""
    m = _models.get(model_id)
    if m is None:
        return None
    return {
        "id": m["id"],
        "name": m["name"],
        "description": m["description"],
        "type": m["type"],
        "framework": m["framework"],
        "input_size": m["input_size"],
        "classes": m["classes"],
        "default_conf": m["default_conf"],
        "default_iou": m["default_iou"],
    }
