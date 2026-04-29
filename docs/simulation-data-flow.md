# Xiaozhi Plugin 模拟实验数据流详解

## 架构组件

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              OpenClaw Gateway                               │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────────┐  │
│  │   xiaozhi       │    │   xiaozhi       │    │     AI Reply           │  │
│  │   Server        │    │   Session       │    │     Pipeline           │  │
│  │   (WebSocket)   │◄──►│   (状态机)       │◄──►│     (dispatchReply)    │  │
│  │   port:8765     │    │                 │    │                         │  │
│  └────────┬────────┘    └────────┬────────┘    └─────────────────────────┘  │
│           │                      │                                             │
│           │         ┌────────────┼────────────┐                               │
│           │         │            │            │                               │
│           │         ▼            ▼            ▼                               │
│           │   ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
│           │   │   MCP    │ │   ASR    │ │   TTS    │                         │
│           └──►│  Manager │ │ Provider │ │ Provider │                         │
│               └──────────┘ └──────────┘ └──────────┘                         │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ▲
                                    │ WebSocket
                                    │ (xiaozhi protocol)
┌────────────────────────────────────┼─────────────────────────────────────────┐
│         Firmware Simulation        │                                         │
│                                    │                                         │
│  ┌─────────────────┐    ┌──────────┴──────────┐                            │
│  │  xiaozhi        │    │                      │                            │
│  │  Client         │◄──►│   Binary Protocol    │                            │
│  │  (WebSocket)    │    │   Handler            │                            │
│  └─────────────────┘    └──────────────────────┘                            │
│                                                                              │
│  模拟设备: Device-Id=AABBCCDDEEFF, Protocol-Version=1                         │
└───────────────────────────────────────────────────────────────────────────────┘
```

## 完整数据流

### 第一阶段：连接握手

```
Firmware Sim                          xiaozhi Server (OpenClaw)
    │                                        │
    │  1. WebSocket 连接 (带 headers)          │
    │  ─────────────────────────────────────► │
    │  Headers:                               │
    │    Authorization: Bearer test-token     │
    │    Protocol-Version: 1                  │
    │    Device-Id: AABBCCDDEEFF              │
    │    Client-Id: 550e8400-...             │
    │                                        │
    │  2. 发送 hello (JSON)                  │
    │  ─────────────────────────────────────► │
    │  {                                      │
    │    "type": "hello",                     │
    │    "version": 1,                        │
    │    "features": { "mcp": true },         │
    │    "transport": "websocket",            │
    │    "audio_params": {                    │
    │      "format": "opus",                  │
    │      "sample_rate": 16000,              │
    │      "channels": 1,                      │
    │      "frame_duration": 60               │
    │    }                                    │
    │  }                                      │
    │                                        │
    │                                        │
    │  ◄───────────────────────────────────── │
    │  3. 接收 server hello (JSON)             │
    │                                        │
    │  {                                      │
    │    "type": "hello",                     │
    │    "transport": "websocket",             │
    │    "session_id": "abc123xyz",          │
    │    "audio_params": {                    │
    │      "format": "opus",                  │
    │      "sample_rate": 16000,              │
    │      "channels": 1,                     │
    │      "frame_duration": 60               │
    │    }                                    │
    │  }                                      │
    │                                        │
    │  ✓ 握手完成                              │
```

### 第二阶段：MCP 初始化

```
Firmware Sim                          xiaozhi Server
    │                                        │
    │  4. 发送 MCP initialize (request)       │
    │  ─────────────────────────────────────► │
    │  {                                      │
    │    "type": "mcp",                       │
    │    "session_id": "abc123xyz",          │
    │    "payload": {                         │
    │      "jsonrpc": "2.0",                  │
    │      "method": "initialize",            │
    │      "params": {                        │
    │        "protocolVersion": "2024-11-05",│
    │        "clientInfo": {                  │
    │          "name": "xiaozhi-firmware-sim",│
    │          "version": "1.0"               │
    │        }                                │
    │      },                                 │
    │      "id": 1                            │
    │    }                                    │
    │  }                                      │
    │                                        │
    │  ◄───────────────────────────────────── │
    │  5. 接收 MCP initialize (response)       │
    │                                        │
    │  {                                      │
    │    "type": "mcp",                       │
    │    "payload": {                         │
    │      "jsonrpc": "2.0",                  │
    │      "id": 1,                           │
    │      "result": {                        │
    │        "protocolVersion": "2024-11-05", │
    │        "serverInfo": {                  │
    │          "name": "openclaw-xiaozhi",   │
    │          "version": "1.0"               │
    │        },                               │
    │        "capabilities": {                │
    │          "tools": { "listChanged": false }│
    │        }                                │
    │      }                                  │
    │    }                                    │
    │  }                                      │
    │                                        │
    │  6. 发送 MCP tools/list (request)        │
    │  ─────────────────────────────────────► │
    │  {                                      │
    │    "type": "mcp",                       │
    │    "payload": {                         │
    │      "jsonrpc": "2.0",                  │
    │      "method": "tools/list",            │
    │      "id": 2                            │
    │    }                                    │
    │  }                                      │
    │                                        │
    │  ◄───────────────────────────────────── │
    │  7. 接收 MCP tools/list (response)       │
    │                                        │
    │  {                                      │
    │    "type": "mcp",                       │
    │    "payload": {                         │
    │      "jsonrpc": "2.0",                  │
    │      "id": 2,                           │
    │      "result": {                        │
    │        "tools": [                       │
    │          {                              │
    │            "name": "self.robot.set_head_angles",│
    │            "description": "Set head position",  │
    │            "inputSchema": { ... }       │
    │          },                             │
    │          {                              │
    │            "name": "self.robot.set_led_color", │
    │            "description": "Set LED color",    │
    │            "inputSchema": { ... }       │
    │          }                              │
    │        ]                                │
    │      }                                  │
    │    }                                    │
    │  }                                      │
```

### 第三阶段：语音交互 (Listen → ASR → AI Reply → TTS)

```
Firmware Sim                          xiaozhi Server                      AI Pipeline
    │                                        │                                   │
    │  8. 发送 listen(detect)                │                                   │
    │  ─────────────────────────────────────►│                                   │
    │  {                                      │                                   │
    │    "type": "listen",                    │                                   │
    │    "state": "detect",                   │                                   │
    │    "text": "小智"                       │  ←── 唤醒词                        │
    │  }                                      │                                   │
    │                                        │                                   │
    │  状态: LISTENING                        │                                   │
    │                                        │                                   │
    │  9. 发送音频帧 (Binary)                 │                                   │
    │  ─────────────────────────────────────►│                                   │
    │  [0x01][payload_size:4 bytes][Opus音频数据]                                 │
    │     │                                   │                                   │
    │     │  (Protocol v1: 原始Opus帧)         │                                   │
    │     │                                   │                                   │
    │     │  ─── 或 Protocol v2 ───           │                                   │
    │     │  [version:2][type:2][reserved][timestamp:4][payload_size:4][payload] │
    │     │                                   │                                   │
    │  10. 发送 listen(stop)                  │                                   │
    │  ─────────────────────────────────────►│                                   │
    │  {                                      │                                   │
    │    "type": "listen",                    │                                   │
    │    "state": "stop"                      │  ←── 结束录音                      │
    │  }                                      │                                   │
    │                                        │                                   │
    │  状态: PROCESSING                       │                                   │
    │                                        │ 11. ASR 转文字                     │
    │                                        │ ─────────────────────────────────►│
    │                                        │    输入: 音频流                    │
    │                                        │    输出: "今天天气怎么样？"          │
    │                                        │                                   │
    │                                        │ 12. 发送 stt 给设备                 │
    │  ◄─────────────────────────────────────│                                   │
    │  {                                      │                                   │
    │    "type": "stt",                       │                                   │
    │    "text": "今天天气怎么样？"            │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │                                        │ 13. AI Reply Pipeline              │
    │                                        │ ─────────────────────────────────►│
    │                                        │    输入: "今天天气怎么样？"         │
    │                                        │    AI模型处理...                   │
    │                                        │    输出:                           │
    │                                        │    '{"act":"nod","emo":"happy"}   │
    │                                        │     你好！今天天气很不错，          │
    │                                        │     适合出去玩。'                  │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 14. TTS 开始                      │
    │  {                                      │                                   │
    │    "type": "tts",                       │                                   │
    │    "state": "start"                     │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 15. TTS 句子开始                  │
    │  {                                      │                                   │
    │    "type": "tts",                       │                                   │
    │    "state": "sentence_start",           │                                   │
    │    "text": "你好！"                      │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  播放音频...                            │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 16. TTS 音频流 (Binary)            │
    │  [Opus音频帧 1]                         │                                   │
    │  ◄─────────────────────────────────────│ 17. TTS 音频帧 (Binary)            │
    │  [Opus音频帧 2]                         │                                   │
    │  ...                                    │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 18. TTS 句子结束                  │
    │  {                                      │                                   │
    │    "type": "tts",                       │                                   │
    │    "state": "sentence_end"              │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 19. TTS 句子开始                  │
    │  {                                      │                                   │
    │    "type": "tts",                       │                                   │
    │    "state": "sentence_start",           │                                   │
    │    "text": "今天天气很不错，适合出去玩。" │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  播放音频...                            │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 20. TTS 停止                      │
    │  {                                      │                                   │
    │    "type": "tts",                       │                                   │
    │    "state": "stop"                      │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  状态: IDLE                             │                                   │
```

### 第四阶段：MCP 工具调用 (Action 执行)

```
Firmware Sim                          xiaozhi Server                      Robot
    │                                        │                                   │
    │  (在 TTS 播放期间，AI 可能触发 MCP 调用)  │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 21. MCP tools/call (request)       │
    │  {                                      │                                   │
    │    "type": "mcp",                       │                                   │
    │    "payload": {                         │                                   │
    │      "jsonrpc": "2.0",                  │                                   │
    │      "method": "tools/call",            │                                   │
    │      "params": {                        │                                   │
    │        "name": "self.robot.set_led_color",│                                 │
    │        "arguments": {                   │                                   │
    │          "red": 80,                     │                                   │
    │          "green": 80,                   │                                   │
    │          "blue": 0                      │                                   │
    │        }                                │                                   │
    │      },                                 │                                   │
    │      "id": 3                            │                                   │
    │    }                                    │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  执行: 设置 LED 为黄色                   │                                   │
    │  ─────────────────────────────────────►│ 22. MCP tools/call (response)      │
    │  {                                      │                                   │
    │    "type": "mcp",                       │                                   │
    │    "payload": {                         │                                   │
    │      "jsonrpc": "2.0",                  │                                   │
    │      "id": 3,                           │                                   │
    │      "result": {                        │                                   │
    │        "content": [                     │                                   │
    │          { "type": "text", "text": "ok" }│                                  │
    │        ],                               │                                   │
    │        "isError": false                 │                                   │
    │      }                                  │                                   │
    │    }                                    │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  ◄─────────────────────────────────────│ 23. MCP tools/call (request)       │
    │  {                                      │                                   │
    │    "type": "mcp",                       │                                   │
    │    "payload": {                         │                                   │
    │      "jsonrpc": "2.0",                  │                                   │
    │      "method": "tools/call",            │                                   │
    │      "params": {                        │                                   │
    │        "name": "self.robot.set_head_angles",│                              │
    │        "arguments": {                   │                                   │
    │          "pitch": 20,                   │                                   │
    │          "speed": 180                   │                                   │
    │        }                                │                                   │
    │      },                                 │                                   │
    │      "id": 4                            │                                   │
    │    }                                    │                                   │
    │  }                                      │                                   │
    │                                        │                                   │
    │  执行: 点头动作                         │                                   │
    │  ─────────────────────────────────────►│ 24. MCP tools/call (response)      │
    │  {                                      │                                   │
    │    "type": "mcp",                       │                                   │
    │    "payload": {                         │
    │      "jsonrpc": "2.0",                  │
    │      "id": 4,                           │
    │      "result": { "content": [...] }     │
    │    }                                    │
    │  }                                      │
```

## 关键数据结构

### Action JSON 格式 (AI 回复前缀)

```json
{
  "act": "nod",     // 动作: nod, shake, look_left, look_right, look_up, look_down, idle
  "emo": "happy",   // 情绪: joy, happy, sad, angry, surprised, thinking, neutral, speaking
  "spd": 180        // 速度 (可选)
}
```

### MCP 工具列表

| 工具名 | 参数 | 描述 |
|--------|------|------|
| `self.robot.set_head_angles` | pitch, yaw, speed | 设置头部角度 |
| `self.robot.set_led_color` | red, green, blue | 设置LED颜色 |
| `self.robot.get_head_angles` | - | 获取当前头部角度 |
| `self.robot.create_reminder` | duration_seconds, message, repeat | 创建提醒 |
| `self.robot.get_reminders` | - | 获取提醒列表 |
| `self.robot.stop_reminder` | id | 停止提醒 |

### 二进制协议格式

**Protocol v1 (原始 Opus):**
```
[Opus frame data...]
```

**Protocol v2 (带时间戳):**
```
[version: 2 bytes][type: 2 bytes][reserved: 2 bytes]
[timestamp: 4 bytes][payload_size: 4 bytes]
[payload...]
```

**Protocol v3 (轻量级):**
```
[type: 1 byte][reserved: 1 byte][payload_size: 2 bytes]
[payload...]
```

## 运行模拟实验

### 1. 启动 OpenClaw Gateway (需要 xiaozhi 插件)

```bash
# 配置 xiaozhi 插件 (config.yaml)
channels:
  xiaozhi:
    port: 8765
    asr:
      provider: "dummy"  # 或 "funasr"
    tts:
      provider: "dummy"  # 或 "cosyvoice"
```

### 2. 运行固件模拟

```bash
# 在 extensions/xiaozhi 目录
node --import tsx src/sim/firmware-sim.ts

# 或带参数
XIAOZHI_SERVER_URL=ws://localhost:8765 \
DEVICE_ID=AABBCCDDEEFF \
DEBUG=true \
node --import tsx src/sim/firmware-sim.ts
```

### 3. 预期输出

```
=== Xiaozhi ESP32 Firmware Simulation ===

[FirmwareSim] Connecting to ws://localhost:8765...
[FirmwareSim] WebSocket connected!
[FirmwareSim] Sending hello...

=== Starting Interaction Demo ===

[FirmwareSim] Simulating wake word detection...
[FirmwareSim] Sending simulated audio frames...
[FirmwareSim] Ending speech...

[FirmwareSim] Received stt: "今天天气怎么样？"
[FirmwareSim] TTS: started
[FirmwareSim] TTS: "你好！"
[FirmwareSim] TTS: sentence ended
[FirmwareSim] TTS: "今天天气很不错，适合出去玩。"
[FirmwareSim] TTS: stopped

[FirmwareSim] Robot LED: rgb(80, 80, 0)
[FirmwareSim] Robot head: pitch=20, yaw=0, speed=180

=== Demo Complete ===
[FirmwareSim] Closing connection...
```
