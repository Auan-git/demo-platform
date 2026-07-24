import { useState, useRef, useMemo } from 'react';
import {
  Card, Button, Table, Tag, Progress, Typography,
  message, Row, Col, Statistic, Empty, Badge, Popconfirm,
  Modal, Form, Input, Select, Upload, Slider, InputNumber, AutoComplete,
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
  PlusOutlined,
  DeleteOutlined,
  UploadOutlined,
  ClearOutlined,
  DatabaseOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { ModelInfo, VideoInfo } from '../types';
import { startInference, getTaskStatus, uploadModel, deleteModel } from '../api/client';
import VideoUploader from './VideoUploader';

const { Text, Title } = Typography;

interface CompareResult {
  modelId: string;
  modelName: string;
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

export default function ComparePage({ models, videos, onDataChange }: Props) {
  const [selectedVideo, setSelectedVideo] = useState<VideoInfo | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadForm] = Form.useForm();

  // Inference params
  const [conf, setConf] = useState(0.25);
  const [iou, setIou] = useState(0.45);
  const [frameSkip, setFrameSkip] = useState(5);
  const [maxFrames, setMaxFrames] = useState<number | null>(200);
  const [compareResults, setCompareResults] = useState<Record<string, CompareResult>>({});
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Model filters
  const [filterDataset, setFilterDataset] = useState('');
  const [filterBaseModel, setFilterBaseModel] = useState('');
  const datasets = useMemo(() => [...new Set(models.map(m => m.dataset).filter(Boolean))], [models]);
  const baseModels = useMemo(() => [...new Set(models.map(m => m.base_model).filter(Boolean))], [models]);
  const filteredModels = useMemo(() =>
    models.filter(m => {
      if (filterDataset && m.dataset !== filterDataset) return false;
      if (filterBaseModel && m.base_model !== filterBaseModel) return false;
      return true;
    }), [models, filterDataset, filterBaseModel]);

  const handleRun = async () => {
    if (!selectedVideo || selectedModels.length === 0) return;

    setIsRunning(true);
    const init: Record<string, CompareResult> = {};
    selectedModels.forEach((mid) => {
      const m = models.find((x) => x.id === mid);
      init[mid] = {
        modelId: mid,
        modelName: m?.name || mid,
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
    setCompareResults(init);

    // Run sequentially to avoid GPU overload
    const batchId = `batch_${Date.now()}`;
    for (const modelId of selectedModels) {
      setCompareResults((prev) => ({ ...prev, [modelId]: { ...prev[modelId], status: 'running' } }));

      try {
        const { task_id } = await startInference({
          model_id: modelId,
          video_id: selectedVideo.id,
          conf,
          iou,
          frame_skip: frameSkip,
          max_frames: maxFrames || undefined,
          batch_size: 8,
          mode: 'multi_model',
          batch_id: batchId,
        });

        setCompareResults((prev) => ({
          ...prev,
          [modelId]: { ...prev[modelId], taskId: task_id },
        }));

        // Poll until done
        await pollTask(modelId, task_id);
      } catch (err: any) {
        setCompareResults((prev) => ({
          ...prev,
          [modelId]: {
            ...prev[modelId],
            status: 'error',
            error: err?.response?.data?.detail || err.message,
          },
        }));
      }
    }

    setIsRunning(false);
  };

  const pollTask = (modelId: string, taskId: string): Promise<void> => {
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

            setCompareResults((prev) => ({
              ...prev,
              [modelId]: {
                ...prev[modelId],
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
            setCompareResults((prev) => ({
              ...prev,
              [modelId]: { ...prev[modelId], status: 'error', error: data.error },
            }));
            resolve();
          } else {
            setCompareResults((prev) => ({
              ...prev,
              [modelId]: { ...prev[modelId], progress: data.progress || 0 },
            }));
          }
        } catch {
          // keep polling
        }
      }, 1000);

      pollingRef.current = interval;
    });
  };

  const handleCancel = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setIsRunning(false);
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await deleteModel(modelId);
      setSelectedModels((prev) => prev.filter((id) => id !== modelId));
      message.success('模型已删除');
      onDataChange();
    } catch {
      message.error('删除失败');
    }
  };

  const handleUploadModel = async () => {
    try {
      const values = await uploadForm.validateFields();
      setUploading(true);
      const formData = new FormData();
      formData.append('file', values.file.file.originFileObj || values.file.file);
      formData.append('name', values.name);
      formData.append('type', values.type || 'detection');
      formData.append('framework', values.framework || 'ultralytics');
      formData.append('description', values.description || '');
      formData.append('classes', values.classes || '');
      formData.append('input_width', String(values.input_width || 640));
      formData.append('input_height', String(values.input_height || 640));
      formData.append('default_conf', String(values.default_conf || 0.25));
      formData.append('default_iou', String(values.default_iou || 0.45));
      formData.append('device', values.device || 'cuda');
      const result = await uploadModel(formData);
      message.success(result.message);
      setUploadOpen(false);
      uploadForm.resetFields();
      onDataChange();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || err.message || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  // Build comparison table data
  const tableData = Object.values(compareResults).filter((r) => r.status === 'done');

  const allClasses = [...new Set(tableData.flatMap((r) => Object.keys(r.classCounts)))];

  const columns = [
    { title: '指标', dataIndex: 'metric', key: 'metric', width: 120, fixed: 'left' as const },
    ...tableData.map((r) => ({
      title: r.modelName,
      dataIndex: r.modelId,
      key: r.modelId,
      width: 140,
    })),
  ];

  const comparisonRows = [
    {
      metric: '总检测数',
      ...Object.fromEntries(tableData.map((r) => [r.modelId, r.totalDetections])),
    },
    {
      metric: '含检测帧数',
      ...Object.fromEntries(tableData.map((r) => [r.modelId, r.framesWithDetections])),
    },
    {
      metric: '平均置信度',
      ...Object.fromEntries(tableData.map((r) => [r.modelId, `${(r.avgConf * 100).toFixed(1)}%`])),
    },
    ...allClasses.map((cls) => ({
      metric: `📦 ${cls}`,
      ...Object.fromEntries(tableData.map((r) => [r.modelId, r.classCounts[cls] || 0])),
    })),
  ];

  const canRun = selectedVideo && selectedModels.length >= 2 && !isRunning;

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

  return (
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
        {/* Video section */}
        <div style={{ marginBottom: 20, minHeight: 100 }}>
          <VideoUploader
            videos={videos}
            selectedId={selectedVideo?.id || null}
            onSelect={setSelectedVideo}
            onVideosChange={() => onDataChange()}
          />
        </div>

        {/* Unified model selection + upload area */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
              paddingBottom: 12,
              borderBottom: '1px solid #f0f0f0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>选择模型</span>
              <Badge
                count={selectedModels.length}
                style={{ backgroundColor: '#1677ff', boxShadow: '0 0 0 2px #fff' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>≥2 个</Text>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setUploadOpen(true)}
                style={{
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                  border: 'none',
                  boxShadow: '0 2px 6px rgba(22,119,255,0.3)',
                }}
              >
                上传模型
              </Button>
            </div>
          </div>

          {(datasets.length > 1 || baseModels.length > 1) && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {datasets.length > 1 && (
                <AutoComplete size="small" value={filterDataset || undefined} onChange={setFilterDataset}
                  options={datasets.map(s => ({ value: s }))} placeholder="数据集" style={{ flex: 1 }} allowClear />
              )}
              {baseModels.length > 1 && (
                <AutoComplete size="small" value={filterBaseModel || undefined} onChange={setFilterBaseModel}
                  options={baseModels.map(s => ({ value: s }))} placeholder="基础模型" style={{ flex: 1 }} allowClear />
              )}
            </div>
          )}

          {models.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '32px 16px',
                color: '#bbb',
                borderRadius: 12,
                background: 'linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%)',
                border: '1px dashed #d9d9d9',
              }}
            >
              <ExperimentOutlined style={{ fontSize: 36, marginBottom: 8, color: '#d9d9d9' }} />
              <div style={{ fontSize: 13, color: '#999' }}>暂无模型</div>
              <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>点击右上角按钮上传 .pt 模型</div>
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto', paddingRight: 4, scrollbarWidth: 'thin' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredModels.map((model) => {
                  const isSelected = selectedModels.includes(model.id);
                  const tConf = typeConfig[model.type] || typeConfig.detection;
                  const fwIcon = frameworkIcons[model.framework];

                  return (
                    <div
                      key={model.id}
                      onClick={() => {
                        setSelectedModels((prev) =>
                          prev.includes(model.id)
                            ? prev.filter((id) => id !== model.id)
                            : [...prev, model.id]
                        );
                      }}
                      style={{
                        position: 'relative',
                        padding: '12px 14px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #1677ff' : '1px solid #f0f0f0',
                        background: isSelected
                          ? 'linear-gradient(135deg, #e6f4ff 0%, #f0f9ff 100%)'
                          : '#fff',
                        boxShadow: isSelected
                          ? '0 2px 12px rgba(22,119,255,0.12)'
                          : '0 1px 3px rgba(0,0,0,0.04)',
                        transition: 'all 0.2s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = '#bae0ff';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          e.currentTarget.style.borderColor = '#f0f0f0';
                          e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                        }
                      }}
                    >
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 0, left: 0,
                            width: 4, height: '100%',
                            background: 'linear-gradient(180deg, #1677ff 0%, #4096ff 100%)',
                            borderRadius: '10px 0 0 10px',
                          }}
                        />
                      )}
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                        <span
                          style={{
                            fontWeight: isSelected ? 700 : 500,
                            fontSize: 14,
                            color: isSelected ? '#1677ff' : '#1a1a2e',
                            marginRight: 8,
                          }}
                        >
                          {model.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {isSelected && (
                            <Tag color="blue" style={{ margin: 0 }}>已选 ✓</Tag>
                          )}
                          <Popconfirm
                            title="确认删除此模型？"
                            onConfirm={(e) => {
                              e?.stopPropagation();
                              handleDeleteModel(model.id);
                            }}
                            onCancel={(e) => e?.stopPropagation()}
                            okText="删除"
                            cancelText="取消"
                          >
                            <Button
                              type="text"
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={(e) => e.stopPropagation()}
                              style={{ opacity: 0.4 }}
                            />
                          </Popconfirm>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        <Tag color={tConf.color} icon={tConf.icon} style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                          {tConf.label}
                        </Tag>
                        <Tag color="default" icon={fwIcon} style={{ margin: 0, fontSize: 11, borderRadius: 4 }}>
                          {model.framework}
                        </Tag>
                        {model.classes?.length > 0 && (
                          <Tag style={{ margin: 0, fontSize: 11, borderRadius: 4, color: '#666' }}>
                            {model.classes.length} 类
                          </Tag>
                        )}
                        {model.device === 'cuda' && (
                          <Tag color="success" style={{ margin: 0, fontSize: 10, borderRadius: 4 }}>🚀 GPU</Tag>
                        )}
                        {model.dataset && (
                          <Tag icon={<DatabaseOutlined />} style={{ margin: 0, fontSize: 10, borderRadius: 4 }} color="geekblue">{model.dataset}</Tag>
                        )}
                        {model.base_model && (
                          <Tag icon={<CodeOutlined />} style={{ margin: 0, fontSize: 10, borderRadius: 4 }} color="gold">{model.base_model}</Tag>
                        )}
                      </div>
                      {model.description && (
                        <div style={{ fontSize: 11, color: '#999', marginTop: 6, lineHeight: 1.4 }}>
                          {model.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Inference Controls */}
        <div style={{
          marginBottom: 16,
          padding: '12px 14px',
          borderRadius: 10,
          background: '#fafafa',
          border: '1px solid #f0f0f0',
        }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>推理参数</Text>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>置信度 (Confidence)</Text>
              <Text style={{ fontSize: 12, color: '#1677ff' }}>{conf.toFixed(2)}</Text>
            </div>
            <Slider min={0.05} max={1} step={0.05} value={conf} onChange={setConf}
              styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>IoU 阈值</Text>
              <Text style={{ fontSize: 12, color: '#1677ff' }}>{iou.toFixed(2)}</Text>
            </div>
            <Slider min={0.05} max={1} step={0.05} value={iou} onChange={setIou}
              styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12 }}>跳帧间隔</Text>
              <Text style={{ fontSize: 12, color: '#999' }}>每 {frameSkip} 帧处理一次</Text>
            </div>
            <Slider min={1} max={20} step={1} value={frameSkip} onChange={setFrameSkip}
              styles={{ track: { background: '#1677ff' } }} />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12 }}>最大帧数</Text>
              <InputNumber
                size="small"
                min={1} max={9999}
                value={maxFrames}
                onChange={(v) => setMaxFrames(v)}
                placeholder="不限"
                style={{ width: 80 }}
              />
            </div>
          </div>
        </div>

        {/* Run button */}
        <Button
          type="primary"
          icon={canRun ? <PlayCircleOutlined /> : <LockOutlined />}
          onClick={handleRun}
          disabled={!canRun}
          loading={isRunning}
          block
          size="large"
          style={{
            borderRadius: 10,
            background: canRun
              ? 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)'
              : undefined,
            border: canRun ? 'none' : undefined,
            height: 44,
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {selectedModels.length < 2 ? `请至少选 2 个模型 (已选 ${selectedModels.length})` : canRun ? '开始对比推理' : ''}
        </Button>
        {isRunning && (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={handleCancel}
            block
            style={{ marginTop: 8, borderRadius: 10 }}
          >
            停止
          </Button>
        )}
      </div>

      {/* Upload Model Modal */}
      <Modal
        title={<span><UploadOutlined style={{ color: '#1677ff', marginRight: 8 }} />上传新模型</span>}
        open={uploadOpen}
        onOk={handleUploadModel}
        onCancel={() => { setUploadOpen(false); uploadForm.resetFields(); }}
        confirmLoading={uploading}
        okText="上传"
        cancelText="取消"
        width={520}
      >
        <Form form={uploadForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="模型名称" rules={[{ required: true, message: '请输入模型名称' }]}>
            <Input placeholder="例如: 灾情目标检测模型" />
          </Form.Item>
          <Form.Item name="file" label="模型文件 (.pt)" rules={[{ required: true }]} valuePropName="file">
            <Upload maxCount={1} accept=".pt" beforeUpload={() => false}>
              <Button icon={<UploadOutlined />}>选择 .pt 文件</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="简要描述模型用途" />
          </Form.Item>
          <Form.Item name="classes" label="检测类别（逗号分隔）">
            <Input placeholder="例如: 人员,建筑物,车辆,废墟" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="type" label="任务类型" initialValue="detection" style={{ flex: 1 }}>
              <Select options={[
                { value: 'detection', label: '检测' },
                { value: 'classification', label: '分类' },
                { value: 'segmentation', label: '分割' },
              ]} />
            </Form.Item>
            <Form.Item name="framework" label="框架" initialValue="ultralytics" style={{ flex: 1 }}>
              <Select options={[
                { value: 'ultralytics', label: 'Ultralytics' },
                { value: 'torchscript', label: 'TorchScript' },
                { value: 'custom', label: 'Custom PyTorch' },
              ]} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="input_width" label="输入宽度" initialValue={640} style={{ flex: 1 }}>
              <Input type="number" />
            </Form.Item>
            <Form.Item name="input_height" label="输入高度" initialValue={640} style={{ flex: 1 }}>
              <Input type="number" />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="default_conf" label="默认置信度" initialValue={0.25} style={{ flex: 1 }}>
              <Input type="number" step={0.05} min={0} max={1} />
            </Form.Item>
            <Form.Item name="default_iou" label="默认 IoU" initialValue={0.45} style={{ flex: 1 }}>
              <Input type="number" step={0.05} min={0} max={1} />
            </Form.Item>
          </div>
          <Form.Item name="device" label="运行设备" initialValue="cuda">
            <Select options={[
              { value: 'cuda', label: '🚀 GPU (CUDA)' },
              { value: 'cpu', label: '💻 CPU' },
            ]} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Right: Results */}
      <div style={{ padding: 24, flex: 1 }}>
        {/* Clear results bar — shown when results exist */}
        {tableData.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <Button
              icon={<ClearOutlined />}
              onClick={() => {
                setCompareResults({});
                setSelectedModels([]);
                setIsRunning(false);
              }}
            >
              清空结果
            </Button>
          </div>
        )}

        {/* Progress */}
        {Object.values(compareResults).some((r) => r.status === 'running') && (
          <Card size="small" style={{ marginBottom: 16 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>推理进度</Text>
            {Object.values(compareResults).map((r) => (
              <div key={r.modelId} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <Text>{r.modelName}</Text>
                  <Text type="secondary">
                    {r.status === 'running' ? `${Math.round(r.progress * 100)}%` : r.status}
                  </Text>
                </div>
                <Progress percent={Math.round(r.progress * 100)} size="small" />
              </div>
            ))}
          </Card>
        )}

        {/* Summary stats */}
        {tableData.length > 0 && (
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            {tableData.map((r) => (
              <Col span={tableData.length <= 2 ? 12 : 8} key={r.modelId}>
                <Card
                  size="small"
                  title={
                    <span>
                      <Tag color="success" style={{ marginRight: 4 }}>✓</Tag>
                      {r.modelName}
                    </span>
                  }
                >
                  <Row gutter={8}>
                    <Col span={8}>
                      <Statistic title="检测数" value={r.totalDetections} valueStyle={{ fontSize: 20 }} />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="含检测帧"
                        value={r.framesWithDetections}
                        suffix={`/ ${r.totalFrames}`}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
                    <Col span={8}>
                      <Statistic
                        title="平均置信度"
                        value={`${(r.avgConf * 100).toFixed(1)}%`}
                        valueStyle={{ fontSize: 20 }}
                      />
                    </Col>
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
        )}

        {/* Comparison table */}
        {tableData.length >= 2 && (
          <Card size="small" title={<span><SwapOutlined /> 模型对比表</span>} style={{ marginBottom: 16 }}>
            <Table
              size="small"
              columns={columns}
              dataSource={comparisonRows.map((r, i) => ({ ...r, key: i }))}
              pagination={false}
              scroll={{ x: 400 }}
            />
          </Card>
        )}

        {/* Output videos */}
        {tableData.length > 0 && (
          <Card size="small" title="输出视频对比">
            <Row gutter={12}>
              {tableData.map((r) => (
                <Col span={tableData.length <= 2 ? 12 : 8} key={r.modelId}>
                  <Text strong style={{ fontSize: 12 }}>{r.modelName}</Text>
                  {r.outputVideoUrl ? (
                    <video
                      controls
                      src={r.outputVideoUrl}
                      style={{ width: '100%', borderRadius: 6, marginTop: 4, maxHeight: 300 }}
                    />
                  ) : (
                    <div style={{
                      height: 200, background: '#f5f5f5', borderRadius: 6, marginTop: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb',
                    }}>
                      无输出视频
                    </div>
                  )}
                </Col>
              ))}
            </Row>
          </Card>
        )}

        {tableData.length === 0 && !isRunning && (
          <Empty
            description={
              <span>
                选择视频和至少 <Text strong>2 个模型</Text>，点击「开始对比推理」
              </span>
            }
            style={{ marginTop: 60 }}
          />
        )}
      </div>
    </div>
  );
}
