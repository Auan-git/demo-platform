"""Unified model loader for different frameworks."""

import importlib.util
import sys
from pathlib import Path
from typing import Any

import torch

# Cache loaded models: model_id → model object
_model_cache: dict[str, Any] = {}


def load_model(model_info: dict) -> Any:
    """Load a model based on its config. Uses cache to avoid redundant loads.

    Args:
        model_info: Full model info dict from registry (includes pt_path, framework, etc.)

    Returns:
        Loaded model object ready for inference.
    """
    model_id = model_info["id"]

    if model_id in _model_cache:
        return _model_cache[model_id]

    framework = model_info["framework"]
    pt_path = model_info["pt_path"]
    device = model_info.get("device", "auto")

    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"

    print(f"Loading model '{model_id}' (framework={framework}, device={device})...")

    if framework == "ultralytics":
        model = _load_ultralytics(pt_path, device)
    elif framework == "torchscript":
        model = _load_torchscript(pt_path, device)
    elif framework == "custom":
        model = _load_custom(model_info, device)
    else:
        raise ValueError(f"Unknown framework: {framework}")

    _model_cache[model_id] = model
    print(f"Model '{model_id}' loaded successfully.")
    return model


def _load_ultralytics(pt_path: str, device: str) -> Any:
    """Load an Ultralytics YOLO model (self-contained PT file)."""
    from ultralytics import YOLO

    model = YOLO(pt_path)
    if device != "cpu":
        model.to(device)
    return model


def _load_torchscript(pt_path: str, device: str) -> Any:
    """Load a TorchScript JIT model."""
    model = torch.jit.load(pt_path, map_location=device)
    model.eval()
    return model


def _load_custom(model_info: dict, device: str) -> Any:
    """Load a custom model: import model.py, instantiate the class, load state_dict.

    The model folder must contain model.py with:
      - A nn.Module class (the first one found, or one named 'Model')
      - The class should support instantiation with kwargs from config
    """
    model_dir = Path(model_info["model_dir"])
    model_py = model_dir / "model.py"

    if not model_py.exists():
        raise FileNotFoundError(
            f"Custom model requires model.py in {model_dir}. "
            f"Create it with your nn.Module class definition."
        )

    # Dynamically import model.py
    module_name = f"_custom_model_{model_info['id']}"
    spec = importlib.util.spec_from_file_location(module_name, model_py)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    # Find the model class (first nn.Module subclass, or one named 'Model')
    model_class = None
    for name in dir(module):
        obj = getattr(module, name)
        if (
            isinstance(obj, type)
            and issubclass(obj, torch.nn.Module)
            and obj is not torch.nn.Module
        ):
            if name == "Model" or name.endswith("Model"):
                model_class = obj
                break
            if model_class is None:
                model_class = obj

    if model_class is None:
        raise ValueError(
            f"No nn.Module subclass found in {model_py}. "
            f"Define a class that inherits from torch.nn.Module."
        )

    # Load config for constructor args
    import json

    config_path = model_dir / "config.json"
    with open(config_path, "r") as f:
        cfg = json.load(f)

    # Try to instantiate with config kwargs, fall back to no-arg
    try:
        model_kwargs = cfg.get("model_kwargs", {})
        model = model_class(**model_kwargs)
    except TypeError:
        model = model_class()

    # Load state dict
    pt_path = model_info["pt_path"]
    checkpoint = torch.load(pt_path, map_location=device, weights_only=False)

    # Handle various checkpoint formats
    if isinstance(checkpoint, dict):
        state_dict = checkpoint.get("model") or checkpoint.get("state_dict") or checkpoint
    else:
        state_dict = checkpoint

    # Clean state_dict keys (remove "module." prefix from DataParallel)
    if isinstance(state_dict, dict) and any(k.startswith("module.") for k in state_dict):
        state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}

    model.load_state_dict(state_dict, strict=False)
    model.to(device)
    model.eval()
    return model


def unload_model(model_id: str):
    """Remove a model from cache to free memory."""
    _model_cache.pop(model_id, None)
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
