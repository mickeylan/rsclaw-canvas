# rsclaw-canvas 迁移计划

> 创建时间: 2026-08-26
> 基于: T8-penguin-canvas + LumxAI
> 目标: 构建以 LumxAI 为底座，集成 T8 节点系统，剥离贞贞工坊的 AI 工作流画布

---

## 📊 迁移统计

| 类别 | 总数 | 已完成 | 进行中 | 待迁移 |
|------|------|--------|--------|--------|
| 阶段一：基础架构 | 6 | 6 | 0 | 0 |
| 阶段二：Provider 系统 | 10 | 3 | 0 | 7 |
| 阶段三：后端路由 | 21 | 0 | 0 | 21 |
| 阶段四：前端节点 | 77 | 0 | 0 | 77 |
| 阶段五：UI 组件 | 10 | 0 | 0 | 10 |
| 阶段六：状态管理 | 9 | 0 | 0 | 9 |
| 阶段七：配置文件 | 5 | 0 | 0 | 5 |
| 阶段八：主题系统 | 14 | 0 | 0 | 14 |
| 阶段九：集成功能 | 6 | 0 | 0 | 6 |
| 阶段十：游戏化 | 5 | 0 | 0 | 5 |
| **总计** | **163** | **9** | **0** | **154** |

---

## ✅ 阶段一：项目基础架构

| # | 模块 | 文件/目录 | 说明 | 状态 | 完成日期 |
|---|------|-----------|------|------|----------|
| 1.1 | 项目配置 | package.json | 名称、描述、构建配置 | ✅ 完成 | 2026-08-26 |
| 1.2 | Electron 主进程 | main.mjs | 主进程入口 | ✅ 完成 | 2026-08-26 |
| 1.3 | Preload 脚本 | preload.cjs | 上下文桥接 | ✅ 完成 | 2026-08-26 |
| 1.4 | 开发启动 | dev.mjs | Vite + Electron 启动 | ✅ 完成 | 2026-08-26 |
| 1.5 | IPC 通信 | rpc.mjs | 进程间通信 | ✅ 完成 | 2026-08-26 |
| 1.6 | Provider 注册 | builtin-providers.mjs | 内置 Provider | ✅ 完成 | 2026-08-26 |

---

## ✅ 阶段二：Provider 系统（AI 服务）

| # | Provider | 文件 | 说明 | 状态 | 完成日期 |
|---|----------|------|------|------|----------|
| 2.1 | MiniMax | backend/src/providers/minimax.js | MiniMax M2.7 | ✅ 完成 | 2026-08-26 |
| 2.2 | Ollama/llama.cpp | backend/src/providers/ollama.js | 本地大模型 | ✅ 完成 | 2026-08-26 |
| 2.3 | OpenAI | backend/src/providers/openai.js | OpenAI 兼容 | ✅ 完成 | 2026-08-26 |
| 2.4 | RunningHub | backend/src/providers/runninghubSite.js | 云端工作流 | 🔲 待迁移 | - |
| 2.5 | ComfyUI | backend/src/providers/comfyui.js | 本地工作流 | 🔲 待迁移 | - |
| 2.6 | Agnes AI | backend/src/providers/agnes.js | 免费模型 API | 🔲 待迁移 | - |
| 2.7 | ModelScope | backend/src/providers/modelscope.js | 阿里云模型 | 🔲 待迁移 | - |
| 2.8 | 火山引擎 | backend/src/providers/volcengine.js | 字节方舟 | 🔲 待迁移 | - |
| 2.9 | 即梦 CLI | backend/src/providers/jimengCli.js | 本地生成 | 🔲 待迁移 | - |
| 2.10 | Provider 注册中心 | backend/src/providers/registry.js | 统一注册 | 🔲 待迁移 | - |

---

## 🔲 阶段三：后端路由

| # | 路由 | 文件 | 说明 | 状态 | 完成日期 |
|---|------|------|------|------|----------|
| 3.1 | 代理路由 | backend/src/routes/proxy.js | API 转发 | 🔲 待迁移 | - |
| 3.2 | 文件处理 | backend/src/routes/files.js | 上传下载 | 🔲 待迁移 | - |
| 3.3 | 图像处理 | backend/src/routes/imageOps.js | 图像操作 | 🔲 待迁移 | - |
| 3.4 | 视频处理 | backend/src/routes/videoOps.js | 视频操作 | 🔲 待迁移 | - |
| 3.5 | RunningHub | backend/src/routes/parseHub.js | RH 集成 | 🔲 待迁移 | - |
| 3.6 | 主题管理 | backend/src/routes/themes.js | 主题系统 | 🔲 待迁移 | - |
| 3.7 | 设置管理 | backend/src/routes/settings.js | 配置存储 | 🔲 待迁移 | - |
| 3.8 | 协作功能 | backend/src/routes/collaboration.js | F1-F10 协作 | 🔲 待迁移 | - |
| 3.9 | 项目管理 | backend/src/routes/projectAssets.js | 项目存储 | 🔲 待迁移 | - |
| 3.10 | 子工作流 | backend/src/routes/subflows.js | 子流程 | 🔲 待迁移 | - |
| 3.11 | 素材管理 | backend/src/routes/resources.js | 素材库 | 🔲 待迁移 | - |
| 3.12 | 云上传 | backend/src/routes/cloudUploads.js | 云存储 | 🔲 待迁移 | - |
| 3.13 | Eagle 图库 | backend/src/routes/eagle.js | 图库集成 | 🔲 待迁移 | - |
| 3.14 | Figma 集成 | backend/src/routes/figma.js | Figma Bridge | 🔲 待迁移 | - |
| 3.15 | Photoshop 集成 | backend/src/routes/photoshopBridge.js | PS 集成 | 🔲 待迁移 | - |
| 3.16 | VibeX 桥接 | backend/src/routes/vibexBridge.js | VibeX 集成 | 🔲 待迁移 | - |
| 3.17 | AI 水印 | backend/src/routes/aiWatermark.js | 去水印 | 🔲 待迁移 | - |
| 3.18 | Topaz 处理 | backend/src/routes/topaz.js | 图像增强 | 🔲 待迁移 | - |
| 3.19 | Agent 控制 | backend/src/routes/agentControl.js | Agent 路由 | 🔲 待迁移 | - |
| 3.20 | 成就系统 | backend/src/routes/achievements.js | 游戏化 | 🔲 待迁移 | - |
| 3.21 | 飞书表格 | backend/src/routes/feishuBitable.js | 飞书集成 | 🔲 待迁移 | - |

---

## 🔲 阶段四：前端节点系统（77 个节点）

### 4.1 核心生成节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.1.1 | LLMNode | nodes/LLMNode.tsx | 大语言模型 | 🔲 待迁移 | - |
| 4.1.2 | ImageNode | nodes/ImageNode.tsx | 图像生成 | 🔲 待迁移 | - |
| 4.1.3 | VideoNode | nodes/VideoNode.tsx | 视频生成 | 🔲 待迁移 | - |
| 4.1.4 | AudioNode | nodes/AudioNode.tsx | 音频生成 | 🔲 待迁移 | - |
| 4.1.5 | SeedanceNode | nodes/SeedanceNode.tsx | Seedance 生成 | 🔲 待迁移 | - |

### 4.2 素材节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.2.1 | UploadNode | nodes/UploadNode.tsx | 上传文件 | 🔲 待迁移 | - |
| 4.2.2 | OutputNode | nodes/OutputNode.tsx | 输出节点 | 🔲 待迁移 | - |
| 4.2.3 | MaterialSetNode | nodes/MaterialSetNode.tsx | 素材集 | 🔲 待迁移 | - |
| 4.2.4 | LocalResourceNode | nodes/LocalResourceNode.tsx | 本地资源 | 🔲 待迁移 | - |
| 4.2.5 | WebAssetsNode | nodes/WebAssetsNode.tsx | 网络素材 | 🔲 待迁移 | - |

### 4.3 工具节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.3.1 | ResizeNode | nodes/ResizeNode.tsx | 调整尺寸 | 🔲 待迁移 | - |
| 4.3.2 | CombineNode | nodes/CombineNode.tsx | 合成图像 | 🔲 待迁移 | - |
| 4.3.3 | GridCropNode | nodes/GridCropNode.tsx | 网格裁剪 | 🔲 待迁移 | - |
| 4.3.4 | RemoveBgNode | nodes/RemoveBgNode.tsx | 抠图 | 🔲 待迁移 | - |
| 4.3.5 | UpscaleNode | nodes/UpscaleNode.tsx | 放大 | 🔲 待迁移 | - |
| 4.3.6 | FaceSwapNode | nodes/FaceSwapNode.tsx | 换脸 | 🔲 待迁移 | - |
| 4.3.7 | ImageToVideoNode | nodes/ImageToVideoNode.tsx | 图生视频 | 🔲 待迁移 | - |
| 4.3.8 | VideoToImageNode | nodes/VideoToImageNode.tsx | 视频抽帧 | 🔲 待迁移 | - |
| 4.3.9 | MergeAudioNode | nodes/MergeAudioNode.tsx | 合并音频 | 🔲 待迁移 | - |
| 4.3.10 | SubtitleNode | nodes/SubtitleNode.tsx | 字幕 | 🔲 待迁移 | - |

### 4.4 RunningHub 节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.4.1 | RunningHubNode | nodes/RunningHubNode.tsx | RH 节点 | 🔲 待迁移 | - |
| 4.4.2 | RHToolboxNode | nodes/RHToolboxNode.tsx | RH 工具箱 | 🔲 待迁移 | - |
| 4.4.3 | ComfyUIStoreNode | nodes/ComfyUIStoreNode.tsx | ComfyUI 市场 | 🔲 待迁移 | - |
| 4.4.4 | RHModelManageNode | nodes/RHModelManageNode.tsx | 模型管理 | 🔲 待迁移 | - |

### 4.5 创意工具节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.5.1 | DrawingBoardNode | nodes/DrawingBoardNode.tsx | 画板 | 🔲 待迁移 | - |
| 4.5.2 | DirectorStoryboardNode | nodes/DirectorStoryboardNode.tsx | 分镜台 | 🔲 待迁移 | - |
| 4.5.3 | StoryNode | nodes/StoryNode.tsx | 剧本大师 | 🔲 待迁移 | - |
| 4.5.4 | MVMasterNode | nodes/MVMasterNode.tsx | MV 大师 | 🔲 待迁移 | - |
| 4.5.5 | WhiteModelPreviewNode | nodes/WhiteModelPreviewNode.tsx | 白模预演 | 🔲 待迁移 | - |

### 4.6 外部集成节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.6.1 | VibeXNode | nodes/VibeXNode.tsx | VibeX 集成 | 🔲 待迁移 | - |
| 4.6.2 | AggregateParserNode | nodes/AggregateParserNode.tsx | 聚合解析 | 🔲 待迁移 | - |
| 4.6.3 | CodexCliAgentNode | nodes/CodexCliAgentNode.tsx | CLI Agent | 🔲 待迁移 | - |
| 4.6.4 | ParseHubNode | nodes/ParseHubNode.tsx | ParseHub | 🔲 待迁移 | - |

### 4.7 其他节点

| # | 节点名 | 文件 | 说明 | 状态 | 完成日期 |
|---|--------|------|------|------|----------|
| 4.7.1 | CanvasAgentNode | nodes/CanvasAgentNode.tsx | 画布 Agent | 🔲 待迁移 | - |
| 4.7.2 | CreatorAgentPanel | nodes/CreatorAgentPanel.tsx | 创作 Agent | 🔲 待迁移 | - |
| 4.7.3 | ConditionalBranchNode | nodes/ConditionalBranchNode.tsx | 条件分支 | 🔲 待迁移 | - |
| 4.7.4 | LoopNode | nodes/LoopNode.tsx | 循环节点 | 🔲 待迁移 | - |
| 4.7.5 | DelayNode | nodes/DelayNode.tsx | 延迟节点 | 🔲 待迁移 | - |
| 4.7.6 | TextNode | nodes/TextNode.tsx | 文本节点 | 🔲 待迁移 | - |
| 4.7.7 | NumberNode | nodes/NumberNode.tsx | 数字节点 | 🔲 待迁移 | - |
| 4.7.8 | BooleanNode | nodes/BooleanNode.tsx | 布尔节点 | 🔲 待迁移 | - |
| 4.7.9 | DateTimeNode | nodes/DateTimeNode.tsx | 日期节点 | 🔲 待迁移 | - |
| 4.7.10 | VariableNode | nodes/VariableNode.tsx | 变量节点 | 🔲 待迁移 | - |

---

## 🔲 阶段五：前端 UI 组件

| # | 组件 | 文件 | 说明 | 状态 | 完成日期 |
|---|------|------|------|------|----------|
| 5.1 | Canvas 主组件 | components/Canvas.vue | 画布主体 | 🔲 待迁移 | - |
| 5.2 | Sidebar 侧边栏 | components/Sidebar.vue | 节点面板 | 🔲 待迁移 | - |
| 5.3 | TerminalPanel 终端 | components/TerminalPanel.vue | 日志面板 | 🔲 待迁移 | - |
| 5.4 | NodeConfigPanel 配置 | components/NodeConfigPanel.vue | 节点配置 | 🔲 待迁移 | - |
| 5.5 | MiniMap 小地图 | components/MiniMap.vue | 画布导航 | 🔲 待迁移 | - |
| 5.6 | ApiSettings API设置 | components/ApiSettings.vue | API 配置 | 🔲 待迁移 | - |
| 5.7 | ThemeSelector 主题 | components/ThemeSelector.vue | 主题选择 | 🔲 待迁移 | - |
| 5.8 | RunControl 运行控制 | components/RunControl.vue | 执行控制 | 🔲 待迁移 | - |
| 5.9 | BatchRun 批量运行 | components/BatchRun.vue | 批量执行 | 🔲 待迁移 | - |
| 5.10 | AlignmentHelper 对齐 | components/AlignmentHelper.vue | 对齐辅助 | 🔲 待迁移 | - |

---

## 🔲 阶段六：状态管理（Stores）

| # | Store | 文件 | 说明 | 状态 | 完成日期 |
|---|-------|------|------|------|----------|
| 6.1 | Canvas Store | stores/canvas.js | 画布状态 | 🔲 待迁移 | - |
| 6.2 | API Keys Store | stores/apiKeys.js | API Key 管理 | 🔲 待迁移 | - |
| 6.3 | Theme Store | stores/theme.js | 主题状态 | 🔲 待迁移 | - |
| 6.4 | Logs Store | stores/logs.js | 日志管理 | 🔲 待迁移 | - |
| 6.5 | Run Bus | stores/runBus.js | 运行总线 | 🔲 待迁移 | - |
| 6.6 | Shortcuts | stores/shortcuts.js | 快捷键 | 🔲 待迁移 | - |
| 6.7 | Locale | stores/locale.js | 国际化 | 🔲 待迁移 | - |
| 6.8 | Achievement | stores/achievements.js | 成就系统 | 🔲 待迁移 | - |
| 6.9 | Drag Material | stores/dragMaterial.js | 拖拽素材 | 🔲 待迁移 | - |

---

## 🔲 阶段七：配置文件

| # | 配置 | 文件 | 说明 | 状态 | 完成日期 |
|---|------|------|------|------|----------|
| 7.1 | 节点注册表 | config/nodeRegistry.ts | 节点定义 | 🔲 待迁移 | - |
| 7.2 | 端口类型 | config/portTypes.ts | 连线类型 | 🔲 待迁移 | - |
| 7.3 | 可执行节点 | config/executableNodeTypes.ts | 执行节点 | 🔲 待迁移 | - |
| 7.4 | 画布模板 | config/canvasTemplates.ts | 预设模板 | 🔲 待迁移 | - |
| 7.5 | LLM 配置 | config/llm.ts | LLM 参数 | 🔲 待迁移 | - |

---

## 🔲 阶段八：主题系统

| # | 主题 | 说明 | 状态 | 完成日期 |
|---|------|------|------|----------|
| 8.1 | 默认主题 | 默认深色主题 | 🔲 待迁移 | - |
| 8.2 | 科技风格 | 科技感主题 | 🔲 待迁移 | - |
| 8.3 | 火影风格 | 动漫主题 | 🔲 待迁移 | - |
| 8.4 | EVA 风格 | 绫波丽主题 | 🔲 待迁移 | - |
| 8.5 | 牧场物语 | 田园主题 | 🔲 待迁移 | - |
| 8.6 | 庭院守卫 | 塔防主题 | 🔲 待迁移 | - |
| 8.7 | 碧蓝档案 | 学院主题 | 🔲 待迁移 | - |
| 8.8 | 赛马娘 | 赛马主题 | 🔲 待迁移 | - |
| 8.9 | 公主焊接 | 科幻主题 | 🔲 待迁移 | - |
| 8.10 | 夜之城 | 赛博朋克 | 🔲 待迁移 | - |
| 8.11 | 原神风格 | 原神主题 | 🔲 待迁移 | - |
| 8.12 | 绝区零 | 街机主题 | 🔲 待迁移 | - |
| 8.13 | 芙莲娜 | 精灵主题 | 🔲 待迁移 | - |
| 8.14 | 自定义主题 | 用户自定义 | 🔲 待迁移 | - |

---

## 🔲 阶段九：集成功能

| # | 集成 | 说明 | 状态 | 完成日期 |
|---|------|------|------|----------|
| 9.1 | Figma Bridge | Figma 同步 | 🔲 待迁移 | - |
| 9.2 | Photoshop Bridge | PS 插件 | 🔲 待迁移 | - |
| 9.3 | ComfyUI 集成 | 本地工作流 | 🔲 待迁移 | - |
| 9.4 | RunningHub 集成 | 云工作流 | 🔲 待迁移 | - |
| 9.5 | 即梦 CLI | 本地生成 | 🔲 待迁移 | - |
| 9.6 | Eagle 图库 | 素材管理 | 🔲 待迁移 | - |

---

## 🔲 阶段十：游戏化元素

| # | 功能 | 说明 | 状态 | 完成日期 |
|---|------|------|------|----------|
| 10.1 | 成就系统 | 任务成就 | 🔲 待迁移 | - |
| 10.2 | 雷达图 | 七龙珠雷达 | 🔲 待迁移 | - |
| 10.3 | 圣域守护 | 塔防游戏 | 🔲 待迁移 | - |
| 10.4 | 农场故事 | 牧场物语 | 🔲 待迁移 | - |
| 10.5 | 完成音效 | 音效反馈 | 🔲 待迁移 | - |

---

## 📝 迁移日志

### 2026-08-26

| 时间 | 操作 | 状态 |
|------|------|------|
| 11:06 | **阶段一全部完成** - 6/6 项目基础架构 | ✅ 完成 |
| - | 创建 MIGRATION_PLAN.md | ✅ 完成 |
| - | 配置 package.json (名称、描述、构建) | ✅ 完成 |
| - | 修改 index.html 标题 | ✅ 完成 |
| - | 配置 builtin-providers.mjs (MiniMax/Ollama/OpenAI) | ✅ 完成 |
| - | 修改 preload.cjs (lumx → rsclaw) | ✅ 完成 |
| - | 修改 dev.mjs (LUMX → RSCLAW) | ✅ 完成 |
| - | 推送到 GitHub | ✅ 完成 |
| - | 清理 main.mjs 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 localBridge.js 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 appearance.js 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 assistantPreferences.js 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 WorkspaceView.vue 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 SettingsView.vue 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 deep-agent-skills.mjs 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 agent-worker.mjs 中的 Lumx 引用 | ✅ 完成 |
| - | 清理 core-worker.mjs 中的 Lumx 引用 | ✅ 完成 |
| - | 修改 index.html CSP (lumx-asset → rsclaw-asset) | ✅ 完成 |
| - | **阶段一：项目基础架构 - 全部完成** | ✅ 完成 |

---

## 🎯 迁移原则

1. **保留 LumxAI 基础架构** - Vue 3、Electron、Pinia、Vue Flow
2. **剥离贞贞工坊** - 移除 ai.t8star.org、api.seedance.nz 硬编码
3. **通用 Provider** - 所有 API 通过可配置的 Base URL + API Key
4. **迁移不复制** - 理解 T8 逻辑后重写，而非直接复制
5. **每项必核** - 完成一项更新本表格

---

## 🔗 相关链接

- T8-penguin-canvas: `https://github.com/T8mars/T8-penguin-canvas`
- LumxAI (原始): `J:\mickeylan\ai\LumxAI`
- rsclaw-canvas: `git@github.com:mickeylan/rsclaw-canvas.git`
