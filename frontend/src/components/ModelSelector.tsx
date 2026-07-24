import { Card, Tag, Typography, Empty, Spin } from 'antd';
import { ExperimentOutlined, EyeOutlined, ScanOutlined } from '@ant-design/icons';
import type { ModelInfo } from '../types';

const { Text, Paragraph } = Typography;

const typeIcons: Record<string, React.ReactNode> = {
  detection: <EyeOutlined />,
  classification: <ScanOutlined />,
  segmentation: <ExperimentOutlined />,
};

const typeColors: Record<string, string> = {
  detection: 'blue',
  classification: 'green',
  segmentation: 'purple',
};

interface Props {
  models: ModelInfo[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (model: ModelInfo) => void;
}

export default function ModelSelector({ models, loading, selectedId, onSelect }: Props) {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 24 }}>
        <Spin tip="Loading models..." />
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <Empty
        description={
          <span>
            No models configured.<br />
            Place PT files in <Text code>model_registry/models/</Text>
          </span>
        }
      />
    );
  }

  return (
    <div>
      <Text strong style={{ marginBottom: 8, display: 'block' }}>
        Available Models ({models.length})
      </Text>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {models.map((model) => {
          const isSelected = selectedId === model.id;
          return (
            <Card
              key={model.id}
              size="small"
              hoverable
              onClick={() => onSelect(model)}
              style={{
                cursor: 'pointer',
                borderColor: isSelected ? '#1677ff' : undefined,
                backgroundColor: isSelected ? '#e6f4ff' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color={typeColors[model.type] || 'default'} icon={typeIcons[model.type]}>
                  {model.type}
                </Tag>
                <Text strong>{model.name}</Text>
              </div>
              {model.description && (
                <Paragraph
                  type="secondary"
                  style={{ marginBottom: 4, marginTop: 4, fontSize: 12 }}
                  ellipsis={{ rows: 2 }}
                >
                  {model.description}
                </Paragraph>
              )}
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {model.classes.length} classes · imgsz {model.input_size.join('×')}
                </Text>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
