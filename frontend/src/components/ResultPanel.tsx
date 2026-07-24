import { Table, Tag, Typography, Card, Statistic, Row, Col, Button } from 'antd';
import { ClearOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FrameResult, Detection } from '../types';

const { Text, Title } = Typography;

interface DetectionRow extends Detection {
  key: string;
  frame: number;
  time_sec: number;
}

interface Props {
  results: FrameResult[];
  classes: string[];
  totalFrames: number;
  onClear?: () => void;
  isRunning?: boolean;
}

export default function ResultPanel({ results, classes, totalFrames, onClear, isRunning }: Props) {
  if (!results || results.length === 0) {
    return (
      <Card size="small">
        <Text type="secondary">No results yet. Run inference to see results here.</Text>
      </Card>
    );
  }

  // Flatten for table
  const rows: DetectionRow[] = [];
  results.forEach((fr) => {
    fr.detections.forEach((det, i) => {
      rows.push({
        ...det,
        key: `${fr.frame}-${i}`,
        frame: fr.frame,
        time_sec: fr.time_sec,
      });
    });
  });

  // Summary stats
  const totalDetections = rows.length;
  const classCounts: Record<string, number> = {};
  rows.forEach((r) => {
    classCounts[r.class_name] = (classCounts[r.class_name] || 0) + 1;
  });

  // Frames with at least one detection
  const framesWithDetections = new Set(results.filter((f) => f.detections.length > 0).map((f) => f.frame)).size;

  const columns: ColumnsType<DetectionRow> = [
    {
      title: 'Frame',
      dataIndex: 'frame',
      width: 70,
      sorter: (a, b) => a.frame - b.frame,
    },
    {
      title: 'Time',
      dataIndex: 'time_sec',
      width: 70,
      render: (v: number) => `${v.toFixed(1)}s`,
    },
    {
      title: 'Class',
      dataIndex: 'class_name',
      render: (v: string, record: DetectionRow) => {
        const colorIdx = classes.indexOf(v);
        const colors = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'magenta', 'gold'];
        return <Tag color={colors[colorIdx % colors.length]}>{v}</Tag>;
      },
    },
    {
      title: 'Confidence',
      dataIndex: 'confidence',
      width: 100,
      sorter: (a, b) => a.confidence - b.confidence,
      render: (v: number) => `${(v * 100).toFixed(1)}%`,
    },
    {
      title: 'BBox',
      dataIndex: 'bbox',
      width: 160,
      render: (bbox: number[] | null) =>
        bbox ? `[${bbox.map((v) => Math.round(v)).join(', ')}]` : '—',
    },
  ];

  return (
    <div>
      {/* Header with clear button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text strong style={{ fontSize: 14 }}>推理结果</Text>
        {onClear && (
          <Button size="small" icon={<ClearOutlined />} onClick={onClear} disabled={isRunning}>
            清除结果
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Total Detections" value={totalDetections} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="Frames w/ Detections"
              value={framesWithDetections}
              suffix={`/ ${totalFrames}`}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic title="Avg Conf" value={totalDetections > 0
              ? `${((rows.reduce((s, r) => s + r.confidence, 0) / totalDetections) * 100).toFixed(1)}%`
              : '—'} />
          </Card>
        </Col>
      </Row>

      {/* Per-class breakdown */}
      {Object.keys(classCounts).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ fontSize: 12 }}>Per-Class:</Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {Object.entries(classCounts).map(([name, count]) => {
              const colorIdx = classes.indexOf(name);
              const colors = ['blue', 'green', 'orange', 'red', 'purple', 'cyan', 'magenta', 'gold'];
              return (
                <Tag key={name} color={colors[colorIdx % colors.length]}>
                  {name}: {count}
                </Tag>
              );
            })}
          </div>
        </div>
      )}

      {/* Detection table */}
      <Table
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={{ pageSize: 20, size: 'small', showSizeChanger: false }}
        scroll={{ x: 500 }}
        locale={{ emptyText: 'No detections found' }}
      />
    </div>
  );
}
