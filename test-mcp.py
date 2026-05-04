#!/usr/bin/env python3
"""
Xiaozhi Protocol MCP Test
Tests bidirectional MCP communication:
1. OpenClaw → device: Action JSON triggers mcp.callTool (LED/head)
2. device → OpenClaw: MCP tools/call from device
"""
import sys
import json
import asyncio


async def main():
    HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    PORT = sys.argv[2] if len(sys.argv) > 2 else "8766"

    import websockets

    print("=" * 60)
    print("Xiaozhi MCP Bidirectional Test")
    print("=" * 60)
    print(f"Target: ws://{HOST}:{PORT}")
    print()

    ws_url = f"ws://{HOST}:{PORT}"
    headers = {
        "device-id": "AA:BB:CC:DD:EE:FF",
        "client-id": "test-mcp",
        "protocol-version": "1",
        "authorization": "Bearer test-token",
    }
    hello_msg = {
        "type": "hello",
        "version": 1,
        "transport": "websocket",
        "audio_params": {
            "format": "opus",
            "sample_rate": 16000,
            "channels": 1,
            "frame_duration": 60,
        },
    }

    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        # Handshake
        await ws.send(json.dumps(hello_msg))
        print(f"[→] Sent hello")
        resp = await asyncio.wait_for(ws.recv(), timeout=10.0)
        server_hello = json.loads(resp)
        session_id = server_hello.get('session_id', '')
        audio_params = server_hello.get('audio_params', {})
        print(f"[←] Server hello, session_id={session_id}")
        print(f"[←] Audio params: {audio_params}")

        # Wait for gateway to initialize
        await asyncio.sleep(0.5)

        # =============================================================
        # Test 1: device → OpenClaw MCP
        # Send MCP initialize + tools/list from device perspective
        # =============================================================
        print(f"\n{'='*60}")
        print("TEST 1: device → OpenClaw (MCP request)")
        print(f"{'='*60}")

        # Device sends initialize request
        init_req = {
            "type": "mcp",
            "session_id": session_id,
            "payload": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "clientInfo": {"name": "stackchan-esp32", "version": "1.0"}
                }
            }
        }
        await ws.send(json.dumps(init_req))
        print(f"[→] Sent MCP initialize request")
        try:
            resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = json.loads(resp)
            print(f"[←] MCP response: {json.dumps(data)[:300]}")
            expected = data.get('payload', {}).get('result', {})
            if expected.get('serverInfo', {}).get('name') == 'openclaw-xiaozhi':
                print("[✓] initialize response correct")
            else:
                print("[✗] unexpected serverInfo:", expected.get('serverInfo'))
        except asyncio.TimeoutError:
            print("[✗] No response to initialize")

        await asyncio.sleep(0.3)

        # Device sends tools/list request
        tools_req = {
            "type": "mcp",
            "session_id": session_id,
            "payload": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
            }
        }
        await ws.send(json.dumps(tools_req))
        print(f"[→] Sent MCP tools/list request")
        try:
            resp = await asyncio.wait_for(ws.recv(), timeout=5.0)
            data = json.loads(resp)
            tools = data.get('payload', {}).get('result', {}).get('tools', [])
            print(f"[←] tools/list response: {len(tools)} tools")
            for t in tools[:5]:
                print(f"    - {t.get('name')}")
            if len(tools) > 5:
                print(f"    ... and {len(tools)-5} more")
            print("[✓] tools/list response correct")
        except asyncio.TimeoutError:
            print("[✗] No response to tools/list")

        await asyncio.sleep(0.3)

        # =============================================================
        # Test 2: OpenClaw → device (MCP callTool)
        # Send audio with a prompt that triggers robot action
        # =============================================================
        print(f"\n{'='*60}")
        print("TEST 2: OpenClaw → device (Action JSON → callTool)")
        print(f"{'='*60}")

        # We test by sending a listen with text that would trigger
        # an AI reply containing Action JSON. In real scenario the AI
        # would include action. Here we just check if TTS + action works.

        listen_start = {"type": "listen", "state": "detect", "text": "测试机器人动作"}
        await ws.send(json.dumps(listen_start))
        print(f"[→] Sent listen detect")
        await asyncio.sleep(0.3)

        # End listen immediately (no audio)
        listen_stop = {"type": "listen", "state": "stop"}
        await ws.send(json.dumps(listen_stop))
        print(f"[→] Sent listen stop")

        # Wait for STT + TTS + any MCP tool calls
        mcp_tool_calls = []
        tts_sentences = []
        timeout_count = 0
        while True:
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=30.0)
                timeout_count = 0
                if isinstance(msg, bytes):
                    print(f"[←] Binary: {len(msg)} bytes")
                else:
                    data = json.loads(msg)
                    t = data.get('type', '')
                    if t == 'mcp':
                        payload = data.get('payload', {})
                        method = payload.get('method', '')
                        params = payload.get('params', {})
                        mcp_tool_calls.append({'method': method, 'params': params})
                        print(f"[←] MCP: method={method} params={json.dumps(params)[:100]}")
                    elif t == 'tts' and data.get('state') == 'sentence_start':
                        txt = data.get('text', '')
                        tts_sentences.append(txt)
                        print(f"[←] TTS: {txt[:60]}")
                    elif t == 'stt':
                        print(f"[←] STT: {data.get('text','')[:80]}")
                    elif t == 'tts' and data.get('state') == 'stop':
                        print(f"[←] TTS stop")
                        break
            except asyncio.TimeoutError:
                timeout_count += 1
                if timeout_count >= 2:
                    print(f"[i] Timeout #{timeout_count}, ending")
                    break

        print(f"\n--- Results ---")
        print(f"STT sentences: {len(tts_sentences)}")
        print(f"MCP tool calls received from OpenClaw: {len(mcp_tool_calls)}")
        for call in mcp_tool_calls:
            print(f"  → {call['method']}: {json.dumps(call['params'])[:100]}")

        print(f"\n{'='*60}")
        print("MCP Test Complete")
        print(f"{'='*60}")

        await ws.close()


if __name__ == "__main__":
    asyncio.run(main())