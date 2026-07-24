"""FastAPI application entry point for 无人机灾情识别多模型评测平台."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import ensure_dirs, OUTPUTS_DIR, UPLOADS_DIR
from model_registry.registry import scan_models
from api.models import router as models_router
from api.videos import router as videos_router
from api.inference import router as inference_router
from api.history import router as history_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    # Startup
    ensure_dirs()
    scan_models()
    print(f"Device: {__import__('config').DEVICE}")
    print(f"Models registered: {len(__import__('model_registry.registry', fromlist=['']).list_models())}")
    yield
    # Shutdown
    pass


app = FastAPI(
    title="无人机灾情识别的多模型基准评测与可视化平台",
    description="Upload videos, select models, and run inference",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving for outputs and uploads
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# API routes
app.include_router(models_router, prefix="/api", tags=["models"])
app.include_router(videos_router, prefix="/api", tags=["videos"])
app.include_router(inference_router, prefix="/api", tags=["inference"])
app.include_router(history_router, prefix="/api", tags=["history"])


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "device": __import__('config').DEVICE}
