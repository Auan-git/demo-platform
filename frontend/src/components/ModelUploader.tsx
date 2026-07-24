import { useState, useMemo } from 'react';
import { Button, Modal, Form, Input, Select, Upload, message, Popconfirm, Tag, Tooltip, Badge, AutoComplete } from 'antd';
import {
  UploadOutlined,
  PlusOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  EyeOutlined,
  ScanOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  FilterOutlined,
  DatabaseOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { ModelInfo } from '../types';
import { uploadModel, deleteModel } from '../api/client';

interface Props {
  models: ModelInfo[];
  selectedId: string | null;
  onSelect: (model: ModelInfo) => void;
  onModelsChange: () => void;
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

const frameworkColors: Record<string, string> = {
  ultralytics: 'orange',
  torchscript: 'cyan',
  custom: 'purple',
};

export default function ModelUploader({ models, selectedId, onSelect, onModelsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filterDataset, setFilterDataset] = useState<string>('');
  const [filterBaseModel, setFilterBaseModel] = useState<string>('');
  const [form] = Form.useForm();

  // Collect unique datasets and base models for filter options
  const datasets = useMemo(() => [...new Set(models.map(m => m.dataset).filter(Boolean))], [models]);
  const baseModels = useMemo(() => [...new Set(models.map(m => m.base_model).filter(Boolean))], [models]);

  // Filtered models
  const filteredModels = useMemo(() =>
    models.filter(m => {
      if (filterDataset && m.dataset !== filterDataset) return false;
      if (filterBaseModel && m.base_model !== filterBaseModel) return false;
      return true;
    }), [models, filterDataset, filterBaseModel]);

  const handleUpload = async () => {
    try {
      const values = await form.validateFields();
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
      formData.append('dataset', values.dataset || '');
      formData.append('base_model', values.base_model || '');

      const result = await uploadModel(formData);
      message.success(result.message);
      setOpen(false);
      form.resetFields();
      onModelsChange();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      await deleteModel(modelId);
      message.success('模型已删除');
      onModelsChange();
    } catch {
      message.error('删除失败');
    }
  };

  const selectedModel = models.find((m) => m.id === selectedId);

  return (
    <div style={{ marginBottom: 8 }}>
      {/* ── Section header ── */}
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
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>
            模型选择
          </span>
          <Badge
                count={filteredModels.length}
                style={{ backgroundColor: '#1677ff', boxShadow: '0 0 0 2px #fff' }}
              />
            </div>
            <Tooltip title="上传新的模型文件">
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setOpen(true)}
                style={{
                  borderRadius: 6,
                  background: 'linear-gradient(135deg, #1677ff 0%, #4096ff 100%)',
                  border: 'none',
                  boxShadow: '0 2px 6px rgba(22,119,255,0.3)',
                }}
              >
                上传模型
              </Button>
            </Tooltip>
          </div>
          {/* Filters */}
          {(datasets.length > 1 || baseModels.length > 1) && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {datasets.length > 1 && (
                <AutoComplete
                  size="small"
                  value={filterDataset || undefined}
                  onChange={(v) => setFilterDataset(v)}
                  options={datasets.map(s => ({ value: s }))}
                  placeholder="数据集"
                  style={{ flex: 1 }}
                  allowClear
                />
              )}
              {baseModels.length > 1 && (
                <AutoComplete
                  size="small"
                  value={filterBaseModel || undefined}
                  onChange={(v) => setFilterBaseModel(v)}
                  options={baseModels.map(s => ({ value: s }))}
                  placeholder="基础模型"
                  style={{ flex: 1 }}
                  allowClear
                />
              )}
            </div>
          )}
      {/* ── Model cards ── */}
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
          <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
            点击上方按钮上传 .pt 模型文件
          </div>
        </div>
      ) : (
        <div
          style={{
            maxHeight: 320,
            overflowY: 'auto',
            paddingRight: 4,
            scrollbarWidth: 'thin',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredModels.map((model) => {
            const isSelected = selectedId === model.id;
            const tConf = typeConfig[model.type] || typeConfig.detection;
            const fwColor = frameworkColors[model.framework] || 'default';

            return (
              <div
                key={model.id}
                onClick={() => onSelect(model)}
                style={{
                  position: 'relative',
                  padding: '12px 14px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  border: isSelected
                    ? '2px solid #1677ff'
                    : '1px solid #f0f0f0',
                  background: isSelected
                    ? 'linear-gradient(135deg, #e6f4ff 0%, #f0f9ff 100%)'
                    : '#fff',
                  boxShadow: isSelected
                    ? '0 2px 12px rgba(22,119,255,0.12)'
                    : '0 1px 3px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s ease',
                  overflow: 'hidden',
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
                {/* Selection indicator dot */}
                {isSelected && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: 4,
                      height: '100%',
                      background: 'linear-gradient(180deg, #1677ff 0%, #4096ff 100%)',
                      borderRadius: '10px 0 0 10px',
                    }}
                  />
                )}

                {/* Row 1: Name + delete */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? '#1677ff' : '#1a1a2e',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      marginRight: 8,
                    }}
                  >
                    {model.name}
                  </span>
                  <Popconfirm
                    title="确认删除此模型？"
                    onConfirm={(e) => {
                      e?.stopPropagation();
                      handleDelete(model.id);
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
                      style={{ flexShrink: 0, opacity: 0.5 }}
                    />
                  </Popconfirm>
                </div>

                {/* Row 2: Tags */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag
                    color={tConf.color}
                    icon={tConf.icon}
                    style={{ margin: 0, fontSize: 11, borderRadius: 4 }}
                  >
                    {tConf.label}
                  </Tag>
                  <Tag
                    color={fwColor}
                    icon={frameworkIcons[model.framework]}
                    style={{ margin: 0, fontSize: 11, borderRadius: 4 }}
                  >
                    {model.framework}
                  </Tag>
                  {model.classes && model.classes.length > 0 && (
                    <Tag
                      style={{ margin: 0, fontSize: 11, borderRadius: 4, color: '#666' }}
                    >
                      {model.classes.length} 类
                    </Tag>
                  )}
                {model.dataset && (
                  <Tag icon={<DatabaseOutlined />} style={{ margin: 0, fontSize: 10, borderRadius: 4 }} color="geekblue">
                    {model.dataset}
                  </Tag>
                )}
                {model.base_model && (
                  <Tag icon={<CodeOutlined />} style={{ margin: 0, fontSize: 10, borderRadius: 4 }} color="gold">
                    {model.base_model}
                  </Tag>
                )}
              </div>

              {/* Row 3: Description */}
              {model.description && (
                <div
                  style={{
                    fontSize: 11,
                    color: '#999',
                    marginTop: 6,
                    lineHeight: '1.4',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {model.description}
                </div>
              )}

                {/* GPU badge */}
                {model.device === 'cuda' && (
                  <div style={{ marginTop: 6 }}>
                    <Tag
                      color="success"
                      style={{ margin: 0, fontSize: 10, borderRadius: 4, lineHeight: '16px' }}
                    >
                      🚀 GPU
                    </Tag>
                  </div>
                )}
              </div>
            );
          })}

          {/* Bottom upload hint */}
          <Button
            type="dashed"
            block
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
            style={{
              borderRadius: 10,
              height: 40,
              color: '#999',
              borderColor: '#e8e8e8',
              flexShrink: 0,
            }}
          >
            添加更多模型
          </Button>
          </div>
        </div>
      )}

      {/* ── Upload Modal (unchanged logic, minor style tweaks) ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <UploadOutlined style={{ color: '#1677ff', fontSize: 18 }} />
            <span>上传新模型</span>
          </div>
        }
        open={open}
        onOk={handleUpload}
        onCancel={() => {
          setOpen(false);
          form.resetFields();
        }}
        confirmLoading={uploading}
        okText="上传"
        cancelText="取消"
        width={560}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="例如: 灾情目标检测模型" size="middle" />
          </Form.Item>

          <Form.Item
            name="file"
            label="模型文件 (.pt)"
            rules={[{ required: true, message: '请选择模型文件' }]}
            valuePropName="file"
          >
            <Upload maxCount={1} accept=".pt" beforeUpload={() => false}>
              <Button icon={<UploadOutlined />} size="middle">
                选择 .pt 文件
              </Button>
            </Upload>
          </Form.Item>

          <Form.Item name="description" label="模型描述">
            <Input.TextArea rows={2} placeholder="简要描述模型用途" />
          </Form.Item>

          <Form.Item name="classes" label="检测类别（逗号分隔）">
            <Input placeholder="例如: 人员,建筑物,车辆,废墟" />
          </Form.Item>

          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="dataset" label="数据集" style={{ flex: 1 }}>
              <Input placeholder="例如: BUU-SARD" />
            </Form.Item>
            <Form.Item name="base_model" label="基础模型" style={{ flex: 1 }}>
              <Input placeholder="例如: yolov11" />
            </Form.Item>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="type" label="任务类型" initialValue="detection" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'detection', label: '检测' },
                  { value: 'classification', label: '分类' },
                  { value: 'segmentation', label: '分割' },
                ]}
              />
            </Form.Item>
            <Form.Item name="framework" label="框架" initialValue="ultralytics" style={{ flex: 1 }}>
              <Select
                options={[
                  { value: 'ultralytics', label: 'Ultralytics' },
                  { value: 'torchscript', label: 'TorchScript' },
                  { value: 'custom', label: 'Custom PyTorch' },
                ]}
              />
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
            <Select
              options={[
                { value: 'cuda', label: '🚀 GPU (CUDA)' },
                { value: 'cpu', label: '💻 CPU' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
