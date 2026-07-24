"""Global configuration for the demo platform backend."""

import os
import torch
from pathlib import Path

# Base paths
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "model_registry" / "models"
UPLOADS_DIR = BASE_DIR / "uploads"
OUTPUTS_DIR = BASE_DIR / "outputs"

# Device detection
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Server
HOST = "0.0.0.0"
PORT = 8000

# Video constraints
MAX_VIDEO_SIZE_MB = 500
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}
OUTPUT_VIDEO_CODEC = "VP80"   # WebM VP8 — browser-compatible
OUTPUT_VIDEO_EXT = ".webm"
OUTPUT_VIDEO_FPS = 30

# History
HISTORY_FILE = BASE_DIR / "history.json"


def ensure_dirs():
    """Create required directories if they don't exist."""
    for d in [UPLOADS_DIR, OUTPUTS_DIR]:
        os.makedirs(d, exist_ok=True)
