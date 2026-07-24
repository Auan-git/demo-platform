import { Button, Progress, Space, Slider, Typography, InputNumber } from 'antd';
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';

const { Text } = Typography;

interface Props {
  canRun: boolean;
  isRunning: boolean;
  progress: number;
  conf: number;
  iou: number;
  frameSkip: number;
  maxFrames: number | null;
  onConfChange: (v: number) => void;
  onIouChange: (v: number) => void;
  onFrameSkipChange: (v: number) => void;
  onMaxFramesChange: (v: number | null) => void;
  onRun: () => void;
  onCancel: () => void;
}

export default function InferenceControls({
  canRun,
  isRunning,
  progress,
  conf,
  iou,
  frameSkip,
  maxFrames,
  onConfChange,
  onIouChange,
  onFrameSkipChange,
  onMaxFramesChange,
  onRun,
  onCancel,
}: Props) {
  const progressPct = Math.round(progress * 100);

  return (
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>
        Inference Controls
      </Text>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12 }}>Confidence Threshold</Text>
          <Text style={{ fontSize: 12 }}>{conf.toFixed(2)}</Text>
        </div>
        <Slider
          min={0.01}
          max={1}
          step={0.01}
          value={conf}
          onChange={onConfChange}
          disabled={isRunning}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12 }}>IoU Threshold</Text>
          <Text style={{ fontSize: 12 }}>{iou.toFixed(2)}</Text>
        </div>
        <Slider
          min={0.01}
          max={1}
          step={0.01}
          value={iou}
          onChange={onIouChange}
          disabled={isRunning}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 12 }}>Frame Skip</Text>
          <Text style={{ fontSize: 12 }}>每 {frameSkip} 帧处理一次</Text>
        </div>
        <Slider
          min={1}
          max={30}
          step={1}
          value={frameSkip}
          onChange={onFrameSkipChange}
          disabled={isRunning}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 12 }}>Max Frames (空=全部)</Text>
          <InputNumber
            size="small"
            min={1}
            max={99999}
            value={maxFrames}
            onChange={(v) => onMaxFramesChange(v)}
            disabled={isRunning}
            placeholder="全部"
            style={{ width: 80 }}
          />
        </div>
      </div>

      <Space direction="vertical" style={{ width: '100%' }}>
        {isRunning ? (
          <>
            <Progress percent={progressPct} status="active" size="small" />
            <Button
              danger
              block
              icon={<StopOutlined />}
              onClick={onCancel}
            >
              Cancel Inference
            </Button>
          </>
        ) : (
          <Button
            type="primary"
            block
            icon={<PlayCircleOutlined />}
            onClick={onRun}
            disabled={!canRun}
          >
            Run Inference
          </Button>
        )}

        {!canRun && !isRunning && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            Select a model and video to start
          </Text>
        )}
      </Space>
    </div>
  );
}
