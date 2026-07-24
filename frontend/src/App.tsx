import { ConfigProvider, App as AntApp } from 'antd';
import DemoPage from './pages/DemoPage';

export default function App() {
  return (
    <ConfigProvider>
      <AntApp>
        <DemoPage />
      </AntApp>
    </ConfigProvider>
  );
}
