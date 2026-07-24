import { useState, useRef } from 'react';
import {
  Card, Button, Table, Tag, Progress, Typography,
  message, Row, Col, Statistic, Empty, Badge, Popconfirm,
  Slider, InputNumber,
} from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  SwapOutlined,
  LockOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  ExperimentOutlined,
  EyeOutlined,
  ScanOutlined,
  ClearOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import type { ModelInfo, VideoInfo } from '../types';
import { startInference, getTaskStatus } from '../api/client';
import ModelUploader from './ModelUploader';
import VideoUploader from './VideoUploader';

const { Text } = Typography;

interface VideoResult {
  videoId: string;
  videoName: string;
  status: 'pending' | 'running' | 'done' | 'error';
  progress: number;
  totalFrames: number;
  taskId: string | null;
  outputVideoUrl: string | null;
  classCounts: Record<string, number>;
  totalDetections: number;
  avgConf: number;
  framesWithDetections: number;
  error?: string;
}

interface Props {
  models: ModelInfo[];
  videos: VideoInfo[];
  onDataChange: () => void;
}

const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  detection: { icon: <EyeOutlined />, color: '#1677ff', label: '检测' },
  classification: { icon: <ScanOutlined />, color: '#52c41a', label: '分类' },
  segmentation: { icon: <ExperimentOutlined />, color: '#722ed1', label: '分割' },
};

const frameworkIcons: Record<string, React.ReactNode> = {
  ultralytics: <ThunderboltOutlined />,
  torchscript: <ApiOutlined />,
  custom: <ExperimentOutlined />,
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MultiVideoCompare({ models, videos, onDataChange }: Props) {
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedVideos, setSelectedVideos] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [videoResults, setVideoResults] = useState<Record<string, VideoResult>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [frameSkip, setFrameSkip] = useState(5);
  const [maxFrames, setMaxFrames] = useState<number | null>(200);

  const handleRun = async () => {
    if (!selectedModel || selectedVideos.length < 2) return;

    setIsRunning(true);
    const batchId = `batch_${Date.now()}`;
    const init: Record<string, VideoResult> = {};
    selectedVideos.forEach((vid) => {
      const v = videos.find((x) => x.id === vid);
      init[vid] = {
        videoId: vid,
        videoName: (v?.display_name || v?.original_name) || vid,
        status: 'pending',
        progress: 0,
        totalFrames: 0,
        taskId: null,
        outputVideoUrl: null,
        classCounts: {},
        totalDetections: 0,
        avgConf: 0,
        framesWithDetections: 0,
      };
    });
    setVideoResults(init);

    for (const videoId of selectedVideos) {
      setVideoResults((prev) => ({ ...prev, [videoId]: { ...prev[videoId], status: 'running' } }));
      try {
        const { task_id } = await startInference({
          model_id: selectedModel.id,
          video_id: videoId,
          conf,
          iou,
          frame_skip: frameSkip,
          max_frames: maxFrames || undefined,
          batch_size: 8,
          mode: 'multi_video',
          batch_id: batchId,
        });
        setVideoResults((prev) => ({ ...prev, [videoId]: { ...prev[videoId], taskId: task_id } }));
        await pollTask(videoId, task_id);
      } catch (err: any) {
        setVideoResults((prev) => ({
          ...prev,
          [videoId]: { ...prev[videoId], status: 'error', error: err?.response?.data?.detail || err.message },
        }));
      }
    }
    setIsRunning(false);
  };

  const pollTask = (videoId: string, taskId: string): Promise<void> => {
    return new Promise((resolve) => {
      const interval = setInterval(async () => {
        try {
          const data = await getTaskStatus(taskId);
          if (data.status === 'done') {
            clearInterval(interval);
            const results = data.results || [];
            const classCounts: Record<string, number> = {};
            let totalDetections = 0;
            let sumConf = 0;
            const framesWithDet = new Set<number>();
            results.forEach((fr: any) => {
              fr.detections.forEach((d: any) => {
                classCounts[d.class_name] = (classCounts[d.class_name] || 0) + 1;
                totalDetections++;
                sumConf += d.confidence;
                framesWithDet.add(fr.frame);
              });
            });
            setVideoResults((prev) => ({
              ...prev,
              [videoId]: {
                ...prev[videoId],
                status: 'done',
                progress: 1,
                totalFrames: data.total_frames || 0,
                outputVideoUrl: data.output_video_url || null,
                classCounts,
                totalDetections,
                avgConf: totalDetections > 0 ? sumConf / totalDetections : 0,
                framesWithDetections: framesWithDet.size,
              },
            }));
            resolve();
          } else if (data.status === 'error') {
            clearInterval(interval);
            setVideoResults((prev) => ({
              ...prev,
              [videoId]: { ...prev[videoId], status: 'error', error: data.error },
            }));
            resolve();
          } else {
            setVideoResults((prev) => ({
              ...prev,
              [videoId]: { ...prev[videoId], progress: data.progress || 0 },
            }));
          }
        } catch { /* keep polling */ }
      }, 1000);
      pollingRef.current = interval;
    });
  };

  const handleCancel = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setIsRunning(false);
  };

  const tableData = Object.values(videoResults).filter((r) => r.status === 'done');
  const allClasses = [...new Set(tableData.flatMap((r) => Object.keys(r.classCounts)))];
  const canRun = selectedModel && selectedVideos.length >= 2 && !isRunning;

  return (
    <div style={{ display: 'flex', background: '#f5f5f5' }}>
      <div style={{ width: 320, flexShrink: 0, background: '#fff', padding: '16px', overflow: 'auto', borderRight: '1px solid #f0f0f0', position: 'sticky', top: 102, height: 'calc(100vh - 102px)' }}>
        {/* Video upload */}
        <div style={{ marginBottom: 16, minHeight: 100 }}>
          <VideoUploader
            videos={videos}
            selectedId={null}
            selectedIds={selectedVideos}
            onSelect={(v) => v.id && setSelectedVideos((prev) => prev.includes(v.id) ? prev.filter(id => id !== v.id) : [...prev, v.id])}
            onVideosChange={() => onDataChange()}
          />
          {selectedVideos.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>已选 {selectedVideos.length} 个视频 · ≥2 个可开始对比</Text>
            </div>
          )}
        </div>

        {/* Model selection */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text strong style={{ fontSize: 15 }}>选择模型</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>单选</Text>
          </div>
          <ModelUploader
            models={models}
            selectedId={selectedModel?.id || null}
            onSelect={(m) => setSelectedModel(m)}
            onModelsChange={onDataChange}
          />
        </div>

        {/* Inference Controls */}
        <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 10, background: '#fafafa', border: '1px solid #f0f0f0' }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>推理参数</Text>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>置信度</Text><Text style={{ fontSize: 12, color: '#1677ff' }}>{conf.toFixed(2)}</Text>
            </div>
            <Slider min={0.05} max={1} step={0.05} value={conf} onChange={setConf} styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>IoU 阈值</Text><Text style={{ fontSize: 12, color: '#1677ff' }}>{iou.toFixed(2)}</Text>
            </div>
            <Slider min={0.05} max={1} step={0.05} value={iou} onChange={setIou} styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>跳帧间隔</Text><Text style={{ fontSize: 12, color: '#999' }}>每 {frameSkip} 帧</Text>
            </div>
            <Slider min={1} max={20} step={1} value={frameSkip} onChange={setFrameSkip} styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 12 }}>最大帧数</Text>
            <InputNumber size="small" min={1} max={9999} value={maxFrames} onChange={(v) => setMaxFrames(v)} placeholder="不限" style={{ width: 80 }} />
          </div>
        </div>

        <Button
          type="primary"
          icon={canRun ? <PlayCircleOutlined /> : <LockOutlined />}
          onClick={handleRun}
          disabled={!canRun}
          loading={isRunning}
          block size="large"
          style={{ borderRadius: 10, background: canRun ? 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)' : undefined, border: canRun ? 'none' : undefined, height: 44, fontSize: 15, fontWeight: 600 }}
        >
          {selectedVideos.length < 2 ? `请至少选 2 个视频 (已选 ${selectedVideos.length})` : canRun ? '开始对比推理' : ''}
        </Button>
        {isRunning && <Button danger icon={<StopOutlined />} onClick={handleCancel} block style={{ marginTop: 8, borderRadius: 10 }}>停止</Button>}
      </div>

      <div style={{ padding: 24, flex: 1 }}>
        {tableData.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button icon={<ClearOutlined />} onClick={() => { setVideoResults({}); setSelectedVideos([]); setIsRunning(false); }}>清空结果</Button>
          </div>
        )}

        {Object.values(videoResults).some((r) => r.status === 'running') && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>推理进度</Text>
            {selectedModel && <Tag color="blue" style={{ marginBottom: 8 }}>模型: {selectedModel.name}</Tag>}
            {Object.values(videoResults).map((r) => (
              <div key={r.videoId} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12 }}>{r.videoName}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{r.status === 'running' ? `${Math.round(r.progress * 100)}%` : r.status}</Text>
                </div>
                <Progress percent={Math.round(r.progress * 100)} size="small" />
              </div>
            ))}
          </Card>
        )}

        {tableData.length > 0 && (
          <>
            <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
              {tableData.map((r) => (
                <Col span={tableData.length <= 2 ? 12 : 8} key={r.videoId}>
                  <Card size="small" title={<span><VideoCameraOutlined style={{ marginRight: 6 }} />{r.videoName}</span>}>
                    <Row gutter={8}>
                      <Col span={8}><Statistic title="检测数" value={r.totalDetections} valueStyle={{ fontSize: 20 }} /></Col>
                      <Col span={8}><Statistic title="含检测帧" value={r.framesWithDetections} suffix={`/ ${r.totalFrames}`} valueStyle={{ fontSize: 20 }} /></Col>
                      <Col span={8}><Statistic title="平均置信度" value={`${(r.avgConf * 100).toFixed(1)}%`} valueStyle={{ fontSize: 20 }} /></Col>
                    </Row>
                    {Object.keys(r.classCounts).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {Object.entries(r.classCounts).map(([cls, count]) => (
                          <Tag key={cls} style={{ marginBottom: 4 }}>{cls}: {count}</Tag>
                        ))}
                      </div>
                    )}
                  </Card>
                </Col>
              ))}
            </Row>

            <Card size="small" title={<span><SwapOutlined /> 视频对比表</span>} style={{ marginBottom: 16 }}>
              <Table
                size="small"
                pagination={false}
                scroll={{ x: 400 }}
                columns={[
                  { title: '指标', dataIndex: 'metric', key: 'metric', width: 120, fixed: 'left' as const },
                  ...tableData.map((r) => ({ title: r.videoName, dataIndex: r.videoId, key: r.videoId, width: 130 })),
                ]}
                dataSource={[
                  { metric: '总检测数', key: 'det', ...Object.fromEntries(tableData.map((r) => [r.videoId, r.totalDetections])) },
                  { metric: '含检测帧数', key: 'frm', ...Object.fromEntries(tableData.map((r) => [r.videoId, r.framesWithDetections])) },
                  { metric: '平均置信度', key: 'conf', ...Object.fromEntries(tableData.map((r) => [r.videoId, `${(r.avgConf * 100).toFixed(1)}%`])) },
                  ...allClasses.map((cls) => ({
                    metric: `📦 ${cls}`,
                    key: cls,
                    ...Object.fromEntries(tableData.map((r) => [r.videoId, r.classCounts[cls] || 0])),
                  })),
                ]}
              />
            </Card>

            <Card size="small" title="输出视频对比">
              <Row gutter={12}>
                {tableData.map((r) => (
                  <Col span={tableData.length <= 2 ? 12 : 8} key={r.videoId}>
                    <Text strong style={{ fontSize: 12 }}>{r.videoName}</Text>
                    {r.outputVideoUrl ? (
                      <video controls src={r.outputVideoUrl} style={{ width: '100%', borderRadius: 6, marginTop: 4, maxHeight: 280 }} />
                    ) : (
                      <div style={{ height: 180, background: '#f5f5f5', borderRadius: 6, marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>无输出视频</div>
                    )}
                  </Col>
                ))}
              </Row>
            </Card>
          </>
        )}

        {tableData.length === 0 && !isRunning && (
          <Empty description={<span>选择 1 个模型和至少 <Text strong>2 个视频</Text>，点击「开始对比推理」</span>} style={{ marginTop: 60 }} />
        )}
      </div>
    </div>
  );
}
