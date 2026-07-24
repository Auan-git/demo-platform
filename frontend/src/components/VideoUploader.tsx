import { useState, useEffect, useMemo } from 'react';
import { Upload, Button, Typography, Popconfirm, message, Tag, Input, Modal, AutoComplete } from 'antd';
import { InboxOutlined, DeleteOutlined, PlayCircleOutlined, EditOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import type { VideoInfo } from '../types';
import { uploadVideo, deleteVideo, updateVideoMeta, fetchScenes } from '../api/client';

const { Dragger } = Upload;
const { Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  videos: VideoInfo[];
  selectedId: string | null;
  selectedIds?: string[];
  onSelect: (video: VideoInfo) => void;
  onVideosChange: () => void;
}

export default function VideoUploader({ videos, selectedId, selectedIds, onSelect, onVideosChange }: Props) {
  const [uploading, setUploading] = useState(false);
  const [scenes, setScenes] = useState<string[]>(['测试', '训练', '验证']);
  const [editVideo, setEditVideo] = useState<VideoInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editScene, setEditScene] = useState('测试');
  const [filterScene, setFilterScene] = useState('');

  useEffect(() => { fetchScenes().then(d => setScenes(d.scenes)).catch(() => {}); }, []);

  const filteredVideos = useMemo(() =>
    videos.filter(v => !filterScene || v.scene === filterScene),
    [videos, filterScene]
  );

  const handleSaveMeta = async () => {
    if (!editVideo) return;
    try {
      await updateVideoMeta(editVideo.id, { display_name: editName, scene: editScene });
      message.success('已更新');
      setEditVideo(null);
      onVideosChange();
      fetchScenes().then(d => setScenes(d.scenes)).catch(() => {});
    } catch {
      message.error('更新失败');
    }
  };

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: 'video/*',
    showUploadList: false,
    beforeUpload: async (file) => {
      setUploading(true);
      try {
        await uploadVideo(file);
        message.success(`Uploaded: ${file.name}`);
        onVideosChange();
      } catch (err: any) {
        message.error(`Upload failed: ${err?.response?.data?.detail || err.message}`);
      } finally {
        setUploading(false);
      }
      return false; // prevent default upload
    },
  };

  const handleDelete = async (videoId: string) => {
    try {
      await deleteVideo(videoId);
      message.success('Video deleted');
      if (selectedId === videoId) {
        onSelect({} as VideoInfo); // clear selection via parent
      }
      onVideosChange();
    } catch {
      message.error('Failed to delete video');
    }
  };

  return (
    <div>
      <Dragger {...uploadProps} disabled={uploading} style={{ padding: '8px 0' }}>
        <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
          <InboxOutlined style={{ fontSize: 24 }} />
        </p>
        <p className="ant-upload-text" style={{ fontSize: 12, marginBottom: 2 }}>
          {uploading ? 'Uploading...' : '点击或拖拽上传视频'}
        </p>
        <p className="ant-upload-hint" style={{ fontSize: 10 }}>
          支持 MP4, AVI, MOV, MKV, WebM (≤500MB)
        </p>
      </Dragger>

      {videos.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ marginBottom: 4, display: 'block' }}>
            已上传视频 ({filteredVideos.length})
          </Text>
          {scenes.length > 1 && (
            <AutoComplete
              size="small"
              value={filterScene || undefined}
              onChange={setFilterScene}
              options={scenes.map(s => ({ value: s }))}
              placeholder="按场景标签筛选"
              allowClear
              style={{ width: '100%', marginBottom: 8 }}
            />
          )}
          <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 4, scrollbarWidth: 'thin' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredVideos.map((v) => {
                const isSel = selectedId === v.id || (selectedIds && selectedIds.includes(v.id));
                return (
                <div
                  key={v.id}
                  onClick={() => onSelect(v)}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: isSel ? '#e6f4ff' : '#fafafa',
                    border: `1px solid ${isSel ? '#1677ff' : '#f0f0f0'}`,
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PlayCircleOutlined style={{ color: '#1677ff', fontSize: 14, flexShrink: 0 }} />
                        <Text ellipsis style={{ fontSize: 13, fontWeight: isSel ? 600 : 400 }}>
                          {v.display_name || v.original_name}
                        </Text>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                        {v.scene && <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{v.scene}</Tag>}
                        <Tag style={{ margin: 0, fontSize: 10 }}>{v.width}×{v.height}</Tag>
                        <Text type="secondary" style={{ fontSize: 10 }}>
                          {formatDuration(v.duration_seconds)} · {formatSize(v.size_bytes)}
                        </Text>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0, marginLeft: 4 }}>
                      <Button
                        type="text" size="small"
                        icon={<EditOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditVideo(v);
                          setEditName(v.display_name || v.original_name || '');
                          setEditScene(v.scene || '测试');
                        }}
                      />
                      <Popconfirm
                        title="删除此视频？"
                        onConfirm={(e) => { e?.stopPropagation(); handleDelete(v.id); }}
                        onCancel={(e) => e?.stopPropagation()}
                      >
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()} />
                      </Popconfirm>
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      <Modal
        title="编辑视频信息"
        open={!!editVideo}
        onOk={handleSaveMeta}
        onCancel={() => setEditVideo(null)}
        okText="保存"
        cancelText="取消"
        width={400}
      >
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>自定义名称</Text>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="输入名称" />
        </div>
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>场景标签</Text>
          <AutoComplete
            value={editScene}
            onChange={(val) => setEditScene(val)}
            style={{ width: '100%' }}
            options={scenes.map((s) => ({ value: s }))}
            placeholder="选择或输入场景标签"
            filterOption={(inputValue, option) =>
              option?.value?.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
            }
          />
        </div>
      </Modal>
    </div>
  );
}
