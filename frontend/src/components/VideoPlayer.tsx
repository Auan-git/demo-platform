import { useRef, useEffect, useCallback } from 'react';
import { Empty, Typography } from 'antd';

const { Text } = Typography;

interface Props {
  src: string | null;
  title?: string;
  width?: number;
  height?: number;
}

export default function VideoPlayer({ src, title, width, height }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && src) {
      videoRef.current.load();
    }
  }, [src]);

  if (!src) {
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '16/9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#000',
          borderRadius: 8,
          minHeight: 300,
        }}
      >
        <Empty
          description={<span style={{ color: '#999' }}>Select a model and video, then run inference</span>}
        />
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {title && (
        <Text strong style={{ display: 'block', marginBottom: 4 }}>
          {title}
        </Text>
      )}
      <video
        ref={videoRef}
        controls
        style={{
          width: '100%',
          borderRadius: 8,
          backgroundColor: '#000',
          maxHeight: 500,
        }}
        src={src}
      >
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
