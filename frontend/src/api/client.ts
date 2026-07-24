/* ── Axios client + WebSocket helper ── */

import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

/* ── API functions ── */

export async function fetchModels(): Promise<{ models: import('../types').ModelInfo[]; count: number }> {
  const { data } = await api.get('/models');
  return data;
}

export async function uploadModel(formData: FormData): Promise<{ model_id: string; name: string; message: string }> {
  const { data } = await api.post('/models/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

export async function deleteModel(modelId: string): Promise<void> {
  await api.delete(`/models/${modelId}`);
}

export async function fetchModel(modelId: string): Promise<import('../types').ModelInfo> {
  const { data } = await api.get(`/models/${modelId}`);
  return data;
}

export async function fetchVideos(): Promise<{ videos: import('../types').VideoInfo[]; count: number }> {
  const { data } = await api.get('/videos');
  return data;
}

export async function uploadVideo(file: File): Promise<import('../types').VideoInfo> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post('/videos/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

export async function deleteVideo(videoId: string): Promise<void> {
  await api.delete(`/videos/${videoId}`);
}

export async function updateVideoMeta(videoId: string, data: { display_name?: string; scene?: string }): Promise<any> {
  const { data: result } = await api.patch(`/videos/${videoId}`, data);
  return result;
}

export async function fetchScenes(): Promise<{ scenes: string[] }> {
  const { data } = await api.get('/videos/scenes/list');
  return data;
}

export async function startInference(params: {
  model_id: string;
  video_id: string;
  conf?: number;
  iou?: number;
  frame_skip?: number;
  max_frames?: number;
}): Promise<{ task_id: string; status: string }> {
  const { data } = await api.post('/inference', params);
  return data;
}

export async function getTaskStatus(taskId: string): Promise<import('../types').InferenceTask> {
  const { data } = await api.get(`/inference/${taskId}`);
  return data;
}

export async function cancelInference(taskId: string): Promise<void> {
  await api.post(`/inference/${taskId}/cancel`);
}

/* ── WebSocket helper ── */

export function connectInferenceWS(
  taskId: string,
  onMessage: (msg: import('../types').WSMessage) => void,
  onError?: (err: Event) => void,
  onClose?: () => void
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/api/ws/inference/${taskId}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      onMessage(msg);
    } catch {
      console.warn('Failed to parse WS message:', event.data);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    onError?.(err);
  };

  ws.onclose = () => {
    onClose?.();
  };

  return ws;
}
