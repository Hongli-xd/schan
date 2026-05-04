# StackChan Plugin for OpenClaw

用 OpenClaw 本地网关替代 xiaozhi 云服务端，让 ESP32 StackChan 机器人不依赖外部云平台即可实现语音对话。

## 功能

- **语音识别 (ASR)**：WAV → Opus → PCM → FunASR/DashScope
- **LLM 对话**：接入 OpenClaw AI pipeline，支持 MiniMax 等模型
- **语音合成 (TTS)**：Qwen3-TTS-Flash 流式音频，Opus 编码推送
- **机器人动作**：MCP 双向通信，AI 回复可附带动作指令（点头、摇头、LED 颜色）
- **多轮对话**：自动状态重置，支持连续语音交互
- **协议兼容**：xiaozhi-esp32 固件直连，替换云端

---

## 架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ESP32 StackChan 机器人                         │
│                                                                      │
│   MIC → Opus encoder (WAV→Opus) → WebSocket Client ────────────────┤
│                   ↑                                                    │
│   Speaker ← Opus decoder (Opus→PCM→WAV) ← Binary audio chunks ←───┤
│                   ↑                                                    │
│   LED/Head ← MCP tools/call responses ←───────────────────────────────┤
└─────────────────────────────────────────────────────────────────────┘
          WebSocket (xiaozhi protocol, port 8765)
          ↓ ↑ binary Opus frames + JSON control messages
┌─────────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                                  │
│                                                                      │
│  XiaozhiServer (WebSocket Server, port 8765)                        │
│       ↓                                                              │
│  XiaozhiSession (per-connection state machine)                       │
│       ├── OpusScript decoder  → PCM frames                           │
│       ├── AudioQueue (async ring buffer)                            │
│       └── McpManager (MCP JSON-RPC client)                          │
│              ↓                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  OpenClawReplyHandler                                         │    │
│  │     ├── dispatchReplyWithBufferedBlockDispatcher()             │    │
│  │     ├── parseActionJson() — 解析 {"act":"nod","emo":"happy"}  │    │
│  │     ├── streamTts() — 流式 TTS → Opus encode → WS binary      │    │
│  │     └── executeAction() — MCP callTool (LED/Head)            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│       ↓                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐     │
│  │  AsrProvider  │  │  TtsProvider  │  │   AI Reply Pipeline  │     │
│  │  (FunASR)    │  │ (Qwen3-TTS)  │  │    (OpenClaw LLM)   │     │
│  └──────────────┘  └──────────────┘  └──────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 数据流详解

### 语音输入 (Device → Gateway)

```
MIC (analog)
  → ADC (16-bit PCM, 16kHz)
    → Opus encoder (libopus)
      → WebSocket binary frame (Opus packet, ~40-80 bytes)
        → XiaozhiSession.handleMessage()
          → AudioQueue.push(opus_packet)
            → opusDecodeIterable() [OpusScript decode]
              → PCM frames (960 samples @ 16kHz = 60ms)
                → FunAsrProvider.transcribe()
                  → RIFF WAV header (44 bytes) + PCM data
                    → DashScope FunASR API
                      → Chinese text
```

### 语音回复 (Gateway → Device)

```
AI text response
  → streamTts()
    → Qwen3TtsProvider (SSE streaming)
      → DashScope qwen3-tts-flash API
        ← SSE events (Base64 PCM chunks)
      → PCM16 frames
        → Opus encoder (60ms frames)
          → WebSocket binary frame (Opus packet)
            → Robot Opus decoder
              → DAC → Speaker
```

---

## 格式转换

| 阶段 | 格式 | 采样率 | 编码 |
|------|------|--------|------|
| 机器人 MIC | PCM 16bit | 16kHz | Opus |
| WS 传输 | Binary Opus | - | - |
| ASR 输入 | WAV (RIFF) | 16kHz | PCM 16bit mono |
| TTS 输出 | PCM 16bit | 24kHz | Opus (60ms frames) |
| WS 回传 | Binary Opus | - | - |
| Robot Speaker | PCM 16bit | 16kHz | Opus |

**关键转换点**：

- **Opus 解码**：`session.ts` 的 `opusDecodeIterable()` 用 `OpusScript` 实时解码
- **WAV 构造**：`asr.ts` 手动拼 RIFF header（44字节）+ PCM 数据
- **Opus 编码**：`tts.ts` 用 `OpusScript` 将 PCM 帧编码为 Opus（60ms 帧）

---

## 模型配置

ASR 和 TTS 使用阿里云 DashScope API，在 `openclaw.json` 中配置：

```json
{
  "channels": {
    "xiaozhi": {
      "port": 8765,
      "asr": {
        "provider": "funasr",
        "api_key": "YOUR_DASHSCOPE_API_KEY",
        "model": "fun-asr-realtime-2026-02-28",
        "language_hints": ["zh", "en"]
      },
      "tts": {
        "provider": "qwen3-tts",
        "api_key": "YOUR_DASHSCOPE_API_KEY",
        "voice": "Cherry",
        "sample_rate": 16000
      }
    }
  }
}
```

**LLM** 由 OpenClaw gateway 配置，参考 OpenClaw 文档配置 `minimax` 或其他 provider。

---

## 依赖的云服务

| 服务 | 用途 | API 端点 |
|------|------|---------|
| DashScope FunASR | 语音识别（中文/英文） | `https://dashscope.aliyuncs.com/api/v1` |
| DashScope Qwen3-TTS | 流式语音合成 | `/services/aigc/multimodal-generation/generation` |
| OpenClaw LLM | 对话生成（MiniMax 等） | gateway 内置 |

> API Key 均从环境变量或 `openclaw.json` 读取，不硬编码。

---

## AI 回复格式 (Action JSON)

AI 回复可以以 `{...}` JSON 前缀开头，控制机器人动作：

```json
{"act":"nod",  "emo":"happy", "spd":180}
{"act":"shake","emo":"thinking"}
{"act":"look_left","emo":"neutral"}
```

**支持的 act**：`nod` `shake` `look_left` `look_right` `look_up` `look_down` `idle`

**支持的 emo**：`joy` `happy` `sad` `angry` `surprised` `thinking` `neutral` `speaking`

---

## MCP 工具 (机器人暴露给 AI)

| 工具 | 参数 | 说明 |
|------|------|------|
| `self.robot.set_head_angles` | `pitch`, `yaw`, `speed` | 设置头部角度 (±45°, speed 100-1000) |
| `self.robot.set_led_color` | `red`, `green`, `blue` (0-168) | 设置 LED 颜色 |
| `self.robot.get_head_angles` | — | 获取当前头部角度 |

---

## 安装与编译

### 前置依赖

- [ESP-IDF v5.5.4](https://docs.espressif.com/projects/esp-idf/en/v5.5.4/esp32s3/index.html) （编译固件用）
- Node.js ≥ 22
- OpenClaw gateway

### 1. 编译 ESP32 固件

```bash
cd firmware
python3 ./fetch_repos.py    # 下载依赖
idf.py set-target esp32s3    # 设置目标芯片
idf.py build                # 编译
idf.py flash                # 烧录
```

### 2. 安装 OpenClaw 插件

```bash
# 克隆本仓库
cd schan

# 安装依赖
npm install

# 编译 TypeScript
npm run build

# 在 OpenClaw 配置中添加插件路径
# 或将 schan 目录软链接到 OpenClaw 的插件目录
```

### 3. 配置 OpenClaw

在 `openclaw.json` 的 `channels.xiaozhi` 中填入 API Key：

```json
{
  "channels": {
    "xiaozhi": {
      "enabled": true,
      "port": 8765,
      "asr": {
        "provider": "funasr",
        "api_key": "YOUR_DASHSCOPE_API_KEY"
      },
      "tts": {
        "provider": "qwen3-tts",
        "api_key": "YOUR_DASHSCOPE_API_KEY",
        "voice": "Cherry"
      }
    }
  },
  "plugins": {
    "entries": {
      "xiaozhi": { "enabled": true }
    },
    "load": {
      "paths": ["/path/to/schan"]
    }
  }
}
```

### 4. 启动

```bash
openclaw gateway run
```

机器人连接 `ws://<gateway-ip>:8765`，携带 headers：
- `Device-Id`: MAC 地址
- `Client-Id`: UUID
- `Authorization`: Bearer token

---

## 目录结构

```
stackchan/
├── index.ts                    # OpenClaw 插件入口
├── package.json
├── tsconfig.json
├── src/
│   ├── channel.ts             # OpenClawReplyHandler + 插件定义
│   ├── server.ts              # WebSocket Server (xiaozhi)
│   ├── session.ts             # 会话状态机 + Opus 编解码
│   ├── mcp-manager.ts        # MCP JSON-RPC 客户端
│   ├── protocol.ts            # xiaozhi 协议类型定义
│   ├── providers/
│   │   ├── asr.ts            # FunASR ASR provider
│   │   └── tts.ts            # Qwen3-TTS provider
│   └── types/
│       └── shim.d.ts         # openclaw/plugin-sdk 类型补全
├── firmware/                  # ESP32 固件 (idf.py 项目)
│   ├── main/                  # 应用代码
│   ├── hal/                   # 硬件抽象层
│   └── CMakeLists.txt
└── docs/
    └── simulation-data-flow.md # 完整协议数据流图解
```

---

## 协议要点

**xiaozhi WebSocket 消息类型**：

| type | 方向 | 说明 |
|------|------|------|
| `hello` | 双向 | 握手，协商 audio_params |
| `listen` (detect/stop) | → | 设备开始/结束录音 |
| `stt` | ← | 识别结果文字 |
| `tts` (start/sentence_start/sentence_end/stop) | ← | TTS 状态控制 |
| `tts` (binary) | ← | Opus 音频帧 |
| `llm` (emotion) | ← | 情感标签 |
| `mcp` | 双向 | JSON-RPC wrapper |
| `abort` | → | 中断当前操作 |

**二进制协议版本**：
- v1: 原始 Opus 帧
- v2: 2字节版本 + 2字节类型 + 4字节时间戳 + 4字节长度 + payload
- v3: 1字节类型 + 1字节保留 + 2字节长度 + payload

---

## License

MIT
