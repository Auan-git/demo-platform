/* ── Shared TypeScript interfaces matching backend schemas ── */

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  type: 'detection' | 'classification' | 'segmentation';
  framework: 'ultralytics' | 'torchscript' | 'custom';
  input_size: [number, number];
  classes: string[];
  default_conf: number;
  default_iou: number;
  dataset?: string;
  base_model?: string;
}

export interface VideoInfo {
  id: string;
  original_name: string;
  display_name?: string;
  scene?: string;
  size_bytes: number;
  duration_seconds: number;
  fps: number;
  width: number;
  height: number;
  total_frames: number;
  url: string;
  created_at?: number;
}

export interface Detection {
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: [number, number, number, number] | null;
}

export interface FrameResult {
  frame: number;
  time_sec: number;
  detections: Detection[];
}

export interface InferenceTask {
  task_id: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  output_video_url?: string;
  output_json_url?: string;
  total_frames?: number;
  results?: FrameResult[];
  error?: string;
}

/* WebSocket message types */
export type WSMessage =
  | { type: 'status'; status: string; progress: number }
  | { type: 'progress'; frame: number; total_frames: number; progress: number; detections: Detection[] }
  | { type: 'complete'; status: string; output_video_url: string; total_frames: number; results: FrameResult[] }
  | { type: 'error'; error: string; task_id: string }
  | { type: 'cancelled'; task_id: string }
  | { type: 'pong' };
