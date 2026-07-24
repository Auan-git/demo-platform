# 无人机灾情识别多模型基准评测与可视化平台

基于 Web 的深度学习模型评测与可视化平台。支持在线管理模型和视频，运行目标检测推理，实时对比多个模型的性能。

---

## 功能特性

### 推理模式
- **单模型推理** — 选择一个模型处理一个视频，实时查看检测进度和结果
- **多模型对比** — 同一视频使用多个模型依次推理，横向对比检测数、置信度、类别分布
- **多视频对比** — 同一模型处理多个视频，对比不同场景下的表现

### 模型管理
- 在线上传 `.pt` 模型文件，支持 Ultralytics YOLO、TorchScript、Custom PyTorch 三种框架
- 模型标签：数据集名称 + 基础模型名称，支持按标签筛选
- 一键删除模型

### 视频管理
- 拖拽上传视频（支持 MP4、AVI、MOV、MKV、WebM，最大 500MB）
- 自定义视频名称
- 场景标签（如"测试""训练""灾情"）支持已保存标签复用和筛选

### 推理引擎
- GPU 批量推理（batch_size 可配），相比逐帧推理提速 3-5 倍
- WebSocket 实时推送进度
- 输出 WebM 标注视频，浏览器直接播放
- 逐帧检测结果表格 + 类别统计

### 历史记录
- 自动保存所有推理记录
- 支持按模式筛选（全部/单模型/多模型/多视频）
- 多模型/多视频记录自动合并分组，可展开查看详情
- 支持单条删除和批量清空
- 每 5 秒自动刷新

---

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+
- CUDA GPU（可选，CPU 也可运行）

### 1. 启动后端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

后端运行在 `http://localhost:8000`，API 文档：`http://localhost:8000/docs`

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端运行在 `http://localhost:5173`

### 3. 添加模型

通过 Web 界面上传，或手动放置模型文件到 `backend/model_registry/models/`：

```
backend/model_registry/models/
└── my_model/
    ├── best.pt          # 模型权重文件
    └── config.json      # 模型配置
```

**config.json 示例：**

```json
{
  "name": "灾情目标检测模型",
  "type": "detection",
  "framework": "ultralytics",
  "model_file": "best.pt",
  "input_size": [640, 640],
  "classes": ["人员", "建筑", "车辆", "废墟"],
  "default_conf": 0.25,
  "default_iou": 0.45,
  "device": "cuda",
  "dataset": "UAV-Dataset",
  "base_model": "yolov11"
}
```

### 4. 运行推理

1. 打开 `http://localhost:5173`
2. 选择选项卡（单模型/多模型对比/多视频对比）
3. 选择或上传模型和视频
4. 调整置信度/IoU/跳帧数
5. 点击「开始推理」
6. 实时观看进度，推理完成后自动播放标注视频

---

## 配置说明

### 模型配置字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✓ | 模型显示名称 |
| `type` | string | ✓ | 任务类型：`detection` / `classification` / `segmentation` |
| `framework` | string | ✓ | 框架：`ultralytics` / `torchscript` / `custom` |
| `model_file` | string | ✓ | 模型文件名（如 `best.pt`） |
| `input_size` | [int, int] | - | 输入尺寸，默认 `[640, 640]` |
| `classes` | string[] | ✓ | 类别名称列表 |
| `default_conf` | float | - | 默认置信度阈值，默认 `0.25` |
| `default_iou` | float | - | 默认 IoU 阈值，默认 `0.45` |
| `device` | string | - | 运行设备：`cuda` / `cpu` |
| `dataset` | string | - | 训练数据集名称 |
| `base_model` | string | - | 基础模型名称 |

### 推理参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 置信度 | 0.25 | 低于此值的检测结果被过滤 |
| IoU 阈值 | 0.45 | NMS 去重阈值 |
| 跳帧间隔 | 3 | 每 N 帧处理 1 帧 |
| 最大帧数 | 不限 | 限制处理帧数 |
| 批量大小 | 8 | GPU 批量推理帧数 |

---

## 项目结构

```
demo-platform/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── config.py            # 全局配置
│   ├── requirements.txt     # Python 依赖
│   ├── api/
│   │   ├── models.py        # 模型管理 API
│   │   ├── videos.py        # 视频管理 API
│   │   ├── inference.py     # 推理 API + WebSocket
│   │   └── history.py       # 历史记录 API
│   ├── inference/
│   │   └── engine.py        # 推理引擎（批量推理 + 视频标注）
│   ├── model_registry/
│   │   ├── registry.py      # 模型注册
│   │   ├── loader.py        # 模型加载
│   │   ├── history.py       # 历史记录存储
│   │   └── models/          # 模型文件目录
│   ├── uploads/             # 上传视频目录
│   └── outputs/             # 推理输出目录
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   └── DemoPage.tsx         # 主页面 + 选项卡
│   │   ├── components/
│   │   │   ├── ModelUploader.tsx    # 模型选择/上传
│   │   │   ├── VideoUploader.tsx    # 视频选择/上传
│   │   │   ├── VideoPlayer.tsx      # 视频播放器
│   │   │   ├── InferenceControls.tsx # 推理参数面板
│   │   │   ├── ResultPanel.tsx      # 检测结果面板
│   │   │   ├── ComparePage.tsx      # 多模型对比页
│   │   │   ├── MultiVideoCompare.tsx # 多视频对比页
│   │   │   └── HistoryPage.tsx      # 历史记录页
│   │   ├── api/
│   │   │   └── client.ts           # API 客户端
│   │   └── types/
│   │       └── index.ts            # TypeScript 类型
│   ├── index.html
│   └── package.json
└── README.md
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | FastAPI + Uvicorn |
| 推理引擎 | Ultralytics YOLO / PyTorch |
| 视频处理 | OpenCV |
| 前端框架 | React 19 + TypeScript |
| UI 组件 | Ant Design 5 |
| 构建工具 | Vite 8 |
| 实时通信 | WebSocket |
| GPU 加速 | CUDA + 批量推理 |
