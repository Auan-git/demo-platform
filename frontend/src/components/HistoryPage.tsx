import { useState, useEffect } from 'react';
import { Table, Tag, Typography, Select, Empty, Card, Button, Statistic, Row, Col, Popconfirm, message } from 'antd';
import { HistoryOutlined, PlayCircleOutlined, ReloadOutlined, FilterOutlined, DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import { api } from '../api/client';

const { Text } = Typography;

interface HistoryEntry {
  task_id: string;
  mode: string;
  batch_id: string | null;
  model_name: string;
  video_name: string;
  status: string;
  output_video_url: string | null;
  total_frames: number;
  total_detections: number;
  created_at: string;
}

const modeLabels: Record<string, string> = {
  all: '全部记录',
  single: '单模型推理',
  multi_model: '多模型对比',
  multi_video: '多视频对比',
};

const modeColors: Record<string, string> = {
  single: 'blue',
  multi_model: 'purple',
  multi_video: 'green',
};

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [mode, setMode] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 5000);
    return () => clearInterval(interval);
  }, [mode]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/history', { params: { mode: 'all', limit: 200 } });
      const grouped = groupEntries(data.entries, mode);
      setEntries(grouped);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await api.delete(`/history/${taskId}`);
      message.success('已删除');
      loadHistory();
    } catch {
      message.error('删除失败');
    }
  };

  const handleDeleteBatch = async (subEntries: any[]) => {
    try {
      await Promise.all(subEntries.map((e: any) => api.delete(`/history/${e.task_id}`)));
      message.success(`已删除 ${subEntries.length} 条`);
      loadHistory();
    } catch {
      message.error('删除失败');
    }
  };

  const handleClearAll = async () => {
    try {
      await api.delete('/history', { params: { mode } });
      message.success('已清空');
      loadHistory();
    } catch {
      message.error('清空失败');
    }
  };

  // Group multi entries together, pass through singles
  const groupEntries = (all: HistoryEntry[], filterMode: string): HistoryEntry[] => {
    const result: HistoryEntry[] = [];
    const batchMap: Record<string, HistoryEntry[]> = {};
    const singles: HistoryEntry[] = [];
    const processed = new Set<string>();

    all.forEach((e) => {
      if (filterMode !== 'all' && e.mode !== filterMode) return;
      if (e.mode === 'single') {
        singles.push(e);
        return;
      }

      // Group multi entries by batch_id
      const key = e.batch_id || `time_${Math.round(new Date(e.created_at).getTime() / 5000)}_${e.mode}`;
      if (!batchMap[key]) batchMap[key] = [];
      batchMap[key].push(e);
    });

    Object.values(batchMap).forEach((group) => {
      if (group.length === 0) return;
      const first = group[0];
      const allModels = [...new Set(group.map((g) => g.model_name))].join(', ');
      const allVideos = [...new Set(group.map((g) => g.video_name))].join(', ');
      const totalDet = group.reduce((s, g) => s + g.total_detections, 0);
      const totalFrm = group.reduce((s, g) => s + g.total_frames, 0);
      const doneCount = group.filter((g) => g.status === 'done').length;
      result.push({
        ...first,
        model_name: allModels,
        video_name: allVideos,
        total_detections: totalDet,
        total_frames: totalFrm,
        status: doneCount === group.length ? 'done' : 'partial',
        _subEntries: group,
      } as any);
    });

    result.push(...singles);
    result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return result;
  };

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      width: 150,
      render: (v: string) => {
        const d = new Date(v);
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      },
    },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 100,
      render: (v: string, record: any) => {
        const count = record._subEntries?.length;
        return (
          <span>
            <Tag color={modeColors[v] || 'default'}>{modeLabels[v] || v}</Tag>
            {count && count > 1 && <Tag style={{ marginLeft: 2 }}>×{count}</Tag>}
          </span>
        );
      },
    },
    {
      title: '模型',
      dataIndex: 'model_name',
      ellipsis: true,
      render: (v: string) => <Text ellipsis style={{ maxWidth: 200 }}>{v}</Text>,
    },
    {
      title: '视频',
      dataIndex: 'video_name',
      ellipsis: true,
      render: (v: string) => <Text ellipsis style={{ maxWidth: 160 }}>{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 60,
      render: (v: string) => <Tag color={v === 'done' ? 'success' : 'error'}>{v}</Tag>,
    },
    {
      title: '帧数',
      dataIndex: 'total_frames',
      width: 60,
    },
    {
      title: '检测',
      dataIndex: 'total_detections',
      width: 60,
    },
    {
      title: '输出',
      dataIndex: 'output_video_url',
      width: 70,
      render: (_: any, record: any) =>
        record._subEntries ? (
          <Text type="secondary" style={{ fontSize: 12 }}>{record._subEntries.length} 个视频</Text>
        ) : record.output_video_url ? (
          <a href={record.output_video_url} target="_blank" rel="noreferrer"><PlayCircleOutlined /></a>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '',
      width: 40,
      render: (_: any, record: any) =>
        record._subEntries ? (
          <Popconfirm title={`删除这一批共 ${record._subEntries.length} 条记录？`} onConfirm={() => handleDeleteBatch(record._subEntries)} okText="删除" cancelText="取消">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : (
          <Popconfirm title="删除这条记录？" onConfirm={() => handleDelete(record.task_id)} okText="删除" cancelText="取消">
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        ),
    },
  ];

  const doneCount = entries.filter((e) => e.status === 'done').length;
  const totalDetections = entries.reduce((s, e) => s + e.total_detections, 0);

  return (
    <div style={{ display: 'flex', background: '#f5f5f5' }}>
      <div style={{ width: 280, flexShrink: 0, background: '#fff', padding: '16px', overflow: 'auto', borderRight: '1px solid #f0f0f0', position: 'sticky', top: 56, height: 'calc(100vh - 56px)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #f0f0f0',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            <HistoryOutlined style={{ marginRight: 6 }} />历史记录
          </span>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadHistory} />
          <Popconfirm title="清空当前筛选的所有记录？" onConfirm={handleClearAll} okText="清空" cancelText="取消">
            <Button size="small" danger icon={<ClearOutlined />} style={{ marginLeft: 4 }} />
          </Popconfirm>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
            <FilterOutlined style={{ marginRight: 4 }} />筛选模式
          </Text>
          <Select
            value={mode}
            onChange={setMode}
            style={{ width: '100%' }}
            options={Object.entries(modeLabels).map(([k, v]) => ({ value: k, label: v }))}
          />
        </div>

        <Row gutter={[8, 8]}>
          <Col span={12}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Statistic title="总记录" value={entries.length} valueStyle={{ fontSize: 22, color: '#1677ff' }} />
            </Card>
          </Col>
          <Col span={12}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Statistic title="成功" value={doneCount} valueStyle={{ fontSize: 22, color: '#52c41a' }} />
            </Card>
          </Col>
          <Col span={24}>
            <Card size="small" style={{ textAlign: 'center' }}>
              <Statistic title="总检测数" value={totalDetections} valueStyle={{ fontSize: 20 }} />
            </Card>
          </Col>
        </Row>
      </div>

      <div style={{ padding: 24, flex: 1 }}>
        <Table
          size="small"
          columns={columns}
          dataSource={entries}
          rowKey="task_id"
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: false, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无历史记录，请先运行推理" /> }}
          scroll={{ x: 750 }}
          expandable={{
            rowExpandable: (r: any) => !!r._subEntries,
            expandedRowRender: (r: any) =>
              r._subEntries ? (
                <Table
                  size="small"
                  rowKey="task_id"
                  dataSource={r._subEntries}
                  pagination={false}
                  columns={[
                    { title: '模型', dataIndex: 'model_name', width: 180 },
                    { title: '视频', dataIndex: 'video_name', width: 140 },
                    { title: '帧数', dataIndex: 'total_frames', width: 60 },
                    { title: '检测', dataIndex: 'total_detections', width: 60 },
                    { title: '状态', dataIndex: 'status', width: 60, render: (v: string) => <Tag color={v === 'done' ? 'success' : 'error'}>{v}</Tag> },
                    {
                      title: '视频',
                      dataIndex: 'output_video_url',
                      width: 60,
                      render: (url: string | null) =>
                        url ? <a href={url} target="_blank" rel="noreferrer"><PlayCircleOutlined /></a> : '—',
                    },
                  ]}
                />
              ) : null,
          }}
        />
      </div>
    </div>
  );
}
