import { useState, useEffect, useCallback, useRef } from 'react';
import { message, Spin, Tabs, Empty, Button } from 'antd';
import { ExperimentOutlined, SwapOutlined, VideoCameraOutlined, HistoryOutlined } from '@ant-design/icons';
import type { ModelInfo, VideoInfo, WSMessage, FrameResult } from '../types';
import { fetchModels, fetchVideos, startInference, cancelInference, connectInferenceWS } from '../api/client';
import ModelUploader from '../components/ModelUploader';
import VideoUploader from '../components/VideoUploader';
import VideoPlayer from '../components/VideoPlayer';
import InferenceControls from '../components/InferenceControls';
import ResultPanel from '../components/ResultPanel';
import ComparePage from '../components/ComparePage';
import MultiVideoCompare from '../components/MultiVideoCompare';
import HistoryPage from '../components/HistoryPage';

export default function DemoPage() {
  // Model state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);

  // Video state
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<VideoInfo | null>(null);

  // Inference state
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [outputVideoUrl, setOutputVideoUrl] = useState<string | null>(null);
  const [results, setResults] = useState<FrameResult[]>([]);
  const [totalFrames, setTotalFrames] = useState(0);

  // Controls
  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [frameSkip, setFrameSkip] = useState(3);
  const [maxFrames, setMaxFrames] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  // Load data on mount
  useEffect(() => {
    loadModels();
    loadVideos();
  }, []);

  const loadModels = async () => {
    setModelsLoading(true);
    try {
      const data = await fetchModels();
      setModels(data.models);
    } catch {
      message.error('Failed to load models');
    } finally {
      setModelsLoading(false);
    }
  };

  const loadVideos = async () => {
    try {
      const data = await fetchVideos();
      setVideos(data.videos);
    } catch {
      message.error('Failed to load videos');
    }
  };

  // WebSocket message handler
  const handleWSMessage = useCallback((msg: WSMessage) => {
    switch (msg.type) {
      case 'progress':
        setProgress(msg.progress);
        // Optionally update live results from progress messages
        if (msg.detections && msg.detections.length > 0) {
          setResults((prev) => {
            const newResults = [...prev];
            const idx = newResults.findIndex((r) => r.frame === msg.frame);
            const fr: FrameResult = {
              frame: msg.frame,
              time_sec: 0, // approximate
              detections: msg.detections,
            };
            if (idx >= 0) {
              newResults[idx] = fr;
            } else {
              newResults.push(fr);
            }
            return newResults;
          });
          setTotalFrames(msg.total_frames);
        }
        break;
      case 'complete':
        setIsRunning(false);
        setProgress(1);
        setOutputVideoUrl(msg.output_video_url);
        if (msg.results) {
          setResults(msg.results);
          setTotalFrames(msg.total_frames);
        }
        message.success('Inference complete!');
        break;
      case 'error':
        setIsRunning(false);
        message.error(`Inference failed: ${msg.error}`);
        break;
      case 'cancelled':
        setIsRunning(false);
        setProgress(0);
        message.info('Inference cancelled');
        break;
    }
  }, []);

  // Run inference
  const handleRun = async () => {
    if (!selectedModel || !selectedVideo) return;

    setResults([]);
    setProgress(0);
    setOutputVideoUrl(null);

    try {
      const { task_id } = await startInference({
        model_id: selectedModel.id,
        video_id: selectedVideo.id,
        conf,
        iou,
        frame_skip: frameSkip,
        max_frames: maxFrames || undefined,
      });
      setTaskId(task_id);
      setIsRunning(true);

      // Connect WebSocket
      const ws = connectInferenceWS(
        task_id,
        handleWSMessage,
        () => message.error('WebSocket error'),
        () => {
          if (isRunning) setIsRunning(false);
        }
      );
      wsRef.current = ws;
    } catch (err: any) {
      message.error(`Failed to start inference: ${err?.response?.data?.detail || err.message}`);
    }
  };

  // Cancel inference
  const handleCancel = async () => {
    if (taskId) {
      try {
        await cancelInference(taskId);
        if (wsRef.current) {
          wsRef.current.send(JSON.stringify({ type: 'cancel' }));
        }
      } catch {
        message.error('Failed to cancel');
      }
    }
  };

  // Cleanup WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // Current tab
  const [activeTab, setActiveTab] = useState('single');
  const [showHistory, setShowHistory] = useState(false);

  const canRun = !!(selectedModel && selectedVideo) && !isRunning;

  if (showHistory) {
    return (
      <div>
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#001529', color: '#fff', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 18, fontWeight: 600 }}>
          <span>无人机灾情识别多模型基准评测与可视化平台</span>
          <Button type="primary" size="small" icon={<HistoryOutlined />} onClick={() => setShowHistory(false)}>
            返回推理
          </Button>
        </div>
        <HistoryPage />
      </div>
    );
  }

  return (
    <div>
      {/* Header — sticky */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, background: '#001529', color: '#fff', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600 }}>
        无人机灾情识别多模型基准评测与可视化平台
      </div>

      {/* Tabs bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ margin: 0 }}
        tabBarStyle={{ padding: '0 24px', margin: 0, background: '#fff' }}
        tabBarExtraContent={
          <Button type="text" icon={<HistoryOutlined />} onClick={() => setShowHistory(true)} style={{ marginRight: 8 }}>
            历史记录
          </Button>
        }
        items={[
          {
            key: 'single',
            label: <span><ExperimentOutlined /> 单模型推理</span>,
            children: (
              <div style={{ display: 'flex', background: '#f5f5f5' }}>
                <div
                  style={{
                    width: 320,
                    flexShrink: 0,
                    background: '#fff',
                    padding: '16px',
                    overflow: 'auto',
                    borderRight: '1px solid #f0f0f0',
                    position: 'sticky',
                    top: 102,
                    height: 'calc(100vh - 102px)',
                  }}
                >
                  <div style={{ marginBottom: 20 }}>
                    <VideoUploader
                      videos={videos}
                      selectedId={selectedVideo?.id || null}
                      onSelect={setSelectedVideo}
                      onVideosChange={loadVideos}
                    />
                  </div>

                  <div style={{ marginBottom: 20 }}>
                    <ModelUploader
                      models={models}
                      selectedId={selectedModel?.id || null}
                      onSelect={(m) => {
                        setSelectedModel(m);
                        setConf(m.default_conf);
                        setIou(m.default_iou);
                      }}
                      onModelsChange={loadModels}
                    />
                  </div>

                  <InferenceControls
                    canRun={canRun}
                    isRunning={isRunning}
                    progress={progress}
                    conf={conf}
                    iou={iou}
                    frameSkip={frameSkip}
                    maxFrames={maxFrames}
                    onConfChange={setConf}
                    onIouChange={setIou}
                    onFrameSkipChange={setFrameSkip}
                    onMaxFramesChange={setMaxFrames}
                    onRun={handleRun}
                    onCancel={handleCancel}
                  />
                </div>

                <div style={{ padding: 24, flex: 1 }}>
                  {!selectedModel && !selectedVideo && !outputVideoUrl && results.length === 0 ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      minHeight: 'calc(100vh - 180px)',
                    }}>
                      <Empty
                        description={
                          <span style={{ color: '#999', fontSize: 14 }}>
                            请先在左侧选择模型和视频，然后点击「开始推理」
                          </span>
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                      />
                    </div>
                  ) : (
                    <>
                  <div style={{ marginBottom: 20 }}>
                    <VideoPlayer
                      src={outputVideoUrl || selectedVideo?.url || null}
                      title={
                        outputVideoUrl
                          ? '带标注输出视频'
                          : selectedVideo
                              ? `视频: ${selectedVideo.display_name || selectedVideo.original_name}`
                            : undefined
                      }
                    />
                  </div>

                  {isRunning && (
                    <div style={{ textAlign: 'center', padding: 16 }}>
                      <Spin tip={`处理中... ${Math.round(progress * 100)}%`} />
                    </div>
                  )}

                  <ResultPanel
                    results={results}
                    classes={selectedModel?.classes || []}
                    totalFrames={totalFrames}
                    isRunning={isRunning}
                    onClear={() => {
                      setResults([]);
                      setOutputVideoUrl(null);
                      setProgress(0);
                      setTotalFrames(0);
                      setSelectedModel(null);
                      setSelectedVideo(null);
                    }}
                  />
                    </>
                  )}
                </div>
              </div>
            ),
          },
          {
            key: 'compare',
            label: <span><SwapOutlined /> 多模型对比</span>,
            children: <ComparePage models={models} videos={videos} onDataChange={() => { loadModels(); loadVideos(); }} />,
          },
          {
            key: 'multivideo',
            label: <span><VideoCameraOutlined /> 多视频对比</span>,
            children: <MultiVideoCompare models={models} videos={videos} onDataChange={() => { loadModels(); loadVideos(); }} />,
          },
        ]}
      />
      </div>
    </div>
  );
}
