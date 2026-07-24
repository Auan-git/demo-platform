"""Video inference pipeline with real-time progress reporting."""

import asyncio
import json
import threading
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

import cv2
import torch
import numpy as np

from config import OUTPUTS_DIR, OUTPUT_VIDEO_CODEC, OUTPUT_VIDEO_EXT, OUTPUT_VIDEO_FPS, DEVICE

# In-memory task store
_tasks: dict[str, dict] = {}
# Cancel events (thread-safe)
_cancel_events: dict[str, threading.Event] = {}


class VideoInferenceTask:
    """Runs model inference on a video, frame by frame, and reports progress.

    Supports both detection (YOLO-style) and classification models.
    The entire frame loop runs in a background thread so the asyncio event loop
    stays responsive for WebSocket messages and cancel requests.
    """

    def __init__(
        self,
        model: Any,
        model_info: dict,
        video_path: str,
        output_dir: Path = OUTPUTS_DIR,
        conf: float = 0.25,
        iou: float = 0.45,
        frame_skip: int = 1,
        max_frames: Optional[int] = None,
        batch_size: int = 8,
    ):
        self.model = model
        self.model_info = model_info
        self.video_path = video_path
        self.conf = conf
        self.iou = iou
        self.frame_skip = max(1, frame_skip)
        self.max_frames = max_frames
        self.batch_size = max(1, batch_size)

        self.task_id = uuid.uuid4().hex[:12]
        self.output_dir = output_dir / self.task_id
        self.output_video_path = self.output_dir / f"output{OUTPUT_VIDEO_EXT}"
        self.output_json_path = self.output_dir / "results.json"

        self._cancel_event = threading.Event()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def cancel(self):
        """Signal cancellation (thread-safe)."""
        self._cancel_event.set()
        _tasks[self.task_id] = {"status": "cancelled", "progress": _tasks.get(self.task_id, {}).get("progress", 0)}

    async def run(self, progress_callback: Optional[Callable] = None):
        """Execute the inference pipeline entirely in a background thread."""
        self._loop = asyncio.get_running_loop()
        _cancel_events[self.task_id] = self._cancel_event
        _tasks[self.task_id] = {"status": "running", "progress": 0}
        self._cancel_event.clear()

        self.output_dir.mkdir(parents=True, exist_ok=True)

        # Run the entire blocking pipeline in a thread
        await asyncio.to_thread(self._run_sync, progress_callback)

        # Clean up cancel event
        _cancel_events.pop(self.task_id, None)

    def _run_sync(self, progress_callback: Optional[Callable] = None):
        """Synchronous batch frame loop — runs in a worker thread.

        Frames are collected into batches and fed to the model at once,
        dramatically reducing per-call overhead for Ultralytics models.
        """
        cap = None
        writer = None
        framework = self.model_info.get("framework", "ultralytics")

        try:
            cap = cv2.VideoCapture(self.video_path)
            if not cap.isOpened():
                raise ValueError(f"Cannot open video: {self.video_path}")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            effective_frames = total_frames
            if self.max_frames:
                effective_frames = min(total_frames, self.max_frames * self.frame_skip)

            output_fps = (fps if fps > 0 else OUTPUT_VIDEO_FPS) / self.frame_skip
            fourcc = cv2.VideoWriter_fourcc(*OUTPUT_VIDEO_CODEC)
            writer = cv2.VideoWriter(
                str(self.output_video_path), fourcc, output_fps, (width, height)
            )

            all_results = []
            frame_idx = 0
            processed = 0

            # Batch accumulation buffers
            batch_frames: list[np.ndarray] = []
            batch_indices: list[int] = []

            # Determine batch size: only batch for ultralytics detection models
            use_batch = (framework == "ultralytics" and self.model_info.get("type") == "detection")
            effective_batch = self.batch_size if use_batch else 1

            while frame_idx < total_frames:
                if self._cancel_event.is_set():
                    _tasks[self.task_id] = {"status": "cancelled", "progress": processed / max(effective_frames, 1)}
                    break

                ret, frame = cap.read()
                if not ret:
                    break

                # Skip frames
                if frame_idx % self.frame_skip != 0:
                    frame_idx += 1
                    continue

                batch_frames.append(frame)
                batch_indices.append(frame_idx)

                # Run inference when batch is full (or last frame)
                if len(batch_frames) >= effective_batch or frame_idx >= total_frames - self.frame_skip:
                    batch_results_list = self._infer_batch(batch_frames)

                    # Process each frame's results
                    for i, frame_results in enumerate(batch_results_list):
                        frm = batch_frames[i]
                        fidx = batch_indices[i]

                        annotated = annotate_frame(frm, frame_results, self.model_info)
                        writer.write(annotated)

                        all_results.append({
                            "frame": fidx,
                            "time_sec": round(fidx / fps, 2) if fps > 0 else fidx,
                            "detections": frame_results,
                        })

                        processed += 1
                        progress_pct = processed / max(effective_frames, 1) if effective_frames > 0 else 0
                        _tasks[self.task_id] = {"status": "running", "progress": min(progress_pct, 1.0)}

                        # Report progress every few frames
                        if progress_callback and self._loop and processed % 5 == 0:
                            asyncio.run_coroutine_threadsafe(
                                progress_callback({
                                    "frame": fidx,
                                    "total_frames": effective_frames,
                                    "progress": min(progress_pct, 1.0),
                                    "detections": frame_results,
                                }),
                                self._loop,
                            )

                        if self.max_frames and processed >= self.max_frames:
                            break

                    batch_frames.clear()
                    batch_indices.clear()

                frame_idx += 1

                if self.max_frames and processed >= self.max_frames:
                    break

            # Cleanup
            cap.release()
            cap = None
            writer.release()
            writer = None

            # Save results
            with open(self.output_json_path, "w") as f:
                json.dump({
                    "task_id": self.task_id,
                    "model_id": self.model_info["id"],
                    "video_path": self.video_path,
                    "total_frames_processed": processed,
                    "output_video": str(self.output_video_path),
                    "results": all_results,
                }, f, ensure_ascii=False, indent=2)

            if not self._cancel_event.is_set():
                _tasks[self.task_id] = {
                    "status": "done",
                    "progress": 1.0,
                    "output_video_url": f"/outputs/{self.task_id}/output{OUTPUT_VIDEO_EXT}",
                    "output_json_url": f"/outputs/{self.task_id}/results.json",
                    "total_frames": processed,
                    "results": all_results,
                }

        except Exception as e:
            _tasks[self.task_id] = {"status": "error", "progress": 0, "error": str(e)}
            raise
        finally:
            if cap is not None:
                cap.release()
            if writer is not None:
                writer.release()

    # ── Device resolution ────────────────────────────────────────────────

    def _resolve_device(self) -> str:
        """Convert model config device string to Ultralytics-compatible format.

        'auto' → 'cuda' or 'cpu' based on availability.
        """
        raw = self.model_info.get("device", "auto")
        if raw == "auto":
            return DEVICE  # "cuda" or "cpu"
        return raw

    # ── Batch inference entry point ──────────────────────────────────────

    def _infer_batch(self, frames: list[np.ndarray]) -> list[list[dict]]:
        """Run inference on a batch of frames. Returns per-frame detection lists.

        For Ultralytics models, runs a single batched predict() call.
        For other frameworks, falls back to per-frame inference.
        """
        if len(frames) == 0:
            return []

        framework = self.model_info.get("framework", "ultralytics")
        model_type = self.model_info.get("type", "detection")

        if framework == "ultralytics" and model_type == "detection":
            return self._infer_batch_ultralytics(frames)
        else:
            # Fallback: one-at-a-time for classification / generic / other
            return [self._infer_frame(f) for f in frames]

    def _infer_batch_ultralytics(self, frames: list[np.ndarray]) -> list[list[dict]]:
        """Batch inference using Ultralytics YOLO — much faster than per-frame."""
        results = self.model.predict(
            frames,
            conf=self.conf,
            iou=self.iou,
            verbose=False,
            device=self._resolve_device(),
            stream=False,
        )
        classes = self.model_info.get("classes", [])
        all_detections: list[list[dict]] = []

        for r in results:
            detections = []
            if r.boxes is not None:
                for box in r.boxes:
                    cls_id = int(box.cls.item()) if hasattr(box.cls, 'item') else int(box.cls)
                    conf_val = float(box.conf.item()) if hasattr(box.conf, 'item') else float(box.conf)
                    xyxy = box.xyxy[0].tolist() if len(box.xyxy.shape) > 1 else box.xyxy.tolist()

                    detections.append({
                        "class_id": cls_id,
                        "class_name": classes[cls_id] if cls_id < len(classes) else f"class_{cls_id}",
                        "confidence": round(conf_val, 4),
                        "bbox": [round(x, 1) for x in xyxy],
                    })
            all_detections.append(detections)

        return all_detections

    # ── Single-frame fallback methods ────────────────────────────────────

    def _infer_frame(self, frame: np.ndarray) -> list[dict]:
        """Run inference on a single frame (fallback for non-batch models)."""
        model_type = self.model_info.get("type", "detection")
        framework = self.model_info.get("framework", "ultralytics")

        if framework == "ultralytics":
            return self._infer_ultralytics(frame)
        elif model_type == "classification":
            return self._infer_classification(frame)
        else:
            return self._infer_generic(frame)

    def _infer_ultralytics(self, frame: np.ndarray) -> list[dict]:
        """Single-frame Ultralytics inference (used when batching is off)."""
        results = self.model.predict(
            frame,
            conf=self.conf,
            iou=self.iou,
            verbose=False,
            device=self._resolve_device(),
        )
        if not results or len(results) == 0:
            return []

        r = results[0]
        classes = self.model_info.get("classes", [])
        detections = []

        if r.boxes is not None:
            for box in r.boxes:
                cls_id = int(box.cls.item()) if hasattr(box.cls, 'item') else int(box.cls)
                conf_val = float(box.conf.item()) if hasattr(box.conf, 'item') else float(box.conf)
                xyxy = box.xyxy[0].tolist() if len(box.xyxy.shape) > 1 else box.xyxy.tolist()

                detections.append({
                    "class_id": cls_id,
                    "class_name": classes[cls_id] if cls_id < len(classes) else f"class_{cls_id}",
                    "confidence": round(conf_val, 4),
                    "bbox": [round(x, 1) for x in xyxy],
                })

        return detections

    def _infer_classification(self, frame: np.ndarray) -> list[dict]:
        """Inference for classification models."""
        import torchvision.transforms as T

        input_size = self.model_info.get("input_size", [240, 240])
        h, w = input_size[0], input_size[1]

        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, (w, h))
        tensor = T.ToTensor()(img_resized).unsqueeze(0)
        tensor = tensor.to(DEVICE)

        with torch.no_grad():
            output = self.model(tensor)

        probs = torch.softmax(output, dim=1)[0]
        top_idx = int(torch.argmax(probs).item())
        top_score = float(probs[top_idx].item())

        classes = self.model_info.get("classes", [])
        class_name = classes[top_idx] if top_idx < len(classes) else f"class_{top_idx}"

        return [{
            "class_id": top_idx,
            "class_name": class_name,
            "confidence": round(top_score, 4),
            "bbox": None,
        }]

    def _infer_generic(self, frame: np.ndarray) -> list[dict]:
        """Generic inference fallback."""
        input_size = self.model_info.get("input_size", [640, 640])
        h, w = input_size[0], input_size[1]

        img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img_resized = cv2.resize(img_rgb, (w, h))
        import torchvision.transforms as T
        tensor = T.ToTensor()(img_resized).unsqueeze(0).to(DEVICE)

        with torch.no_grad():
            output = self.model(tensor)

        return _parse_generic_output(output, self.model_info.get("classes", []))


def _parse_generic_output(output, classes: list[str]) -> list[dict]:
    """Best-effort parsing of model output into detection format."""
    if isinstance(output, (list, tuple)):
        output = output[0]

    if hasattr(output, 'boxes'):
        detections = []
        boxes = output.boxes
        if boxes is not None and hasattr(boxes, 'xyxy'):
            for i, box in enumerate(boxes.xyxy):
                cls_id = int(boxes.cls[i]) if hasattr(boxes, 'cls') else 0
                conf = float(boxes.conf[i]) if hasattr(boxes, 'conf') else 1.0
                detections.append({
                    "class_id": cls_id,
                    "class_name": classes[cls_id] if cls_id < len(classes) else f"class_{cls_id}",
                    "confidence": round(conf, 4),
                    "bbox": box.tolist() if hasattr(box, 'tolist') else list(box),
                })
        return detections

    return []


def annotate_frame(frame: np.ndarray, detections: list[dict], model_info: dict) -> np.ndarray:
    """Draw detection results directly on the frame (in-place for speed)."""
    model_type = model_info.get("type", "detection")

    if model_type == "classification":
        if detections:
            d = detections[0]
            text = f"{d['class_name']}: {d['confidence']:.2f}"
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, 0), (frame.shape[1], th + 20), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.5, frame, 0.5, 0, frame)
            cv2.putText(frame, text, (10, th + 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
        return frame

    colors = _generate_colors(len(model_info.get("classes", [])) or 80)

    for det in detections:
        bbox = det.get("bbox")
        if bbox is None:
            continue

        x1, y1, x2, y2 = [int(v) for v in bbox]
        cls_id = det.get("class_id", 0)
        color = colors[cls_id % len(colors)]
        label = f"{det['class_name']} {det['confidence']:.2f}"

        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
        cv2.rectangle(frame, (x1, y1 - lh - 8), (x1 + lw + 4, y1), color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

    return frame


def _generate_colors(n: int) -> list[tuple[int, int, int]]:
    """Generate visually distinct BGR colors."""
    import colorsys
    colors = []
    for i in range(n):
        hue = i / n
        r, g, b = colorsys.hsv_to_rgb(hue, 0.9, 0.9)
        colors.append((int(b * 255), int(g * 255), int(r * 255)))
    return colors


def get_task(task_id: str) -> Optional[dict]:
    return _tasks.get(task_id)


def cancel_task(task_id: str):
    """Signal cancellation — thread-safe via threading.Event."""
    event = _cancel_events.get(task_id)
    if event:
        event.set()
    if task_id in _tasks:
        _tasks[task_id]["status"] = "cancelled"
