# rsclaw-canvas

AI Workflow Canvas - 基于 Vue 3 + Deep Agents 的无限画布，支持多节点工作流编排

## 特性

- 🎨 **无限画布** - 基于 Vue Flow 的可视化节点编排
- 🤖 **Deep Agents** - 智能技能路由和 AI 决策
- 📦 **多节点支持** - 图像、视频、音频、LLM 等节点
- 🔧 **可扩展** - 支持自定义 Provider (OpenAI 兼容、MiniMax、Ollama 等)
- 💾 **本地优先** - 所有数据存储在本地
- 🖥️ **跨平台** - Windows / macOS / Linux

## 技术栈

- Vue 3 + Composition API
- Vue Flow (@vue-flow/core)
- Pinia 状态管理
- Electron 43
- Vite 6

## 支持的 Provider

| Provider | 说明 |
|----------|------|
| OpenAI 兼容 | 通用 OpenAI API 格式 |
| MiniMax | MiniMax M2.7 及更多模型 |
| Ollama / llama.cpp | 本地大模型 |
| RunningHub | 云端工作流 |
| ComfyUI | 本地工作流 |

## 开始使用

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# Electron 开发模式
npm run electron:dev

# 构建
npm run build
```

## License

MIT
