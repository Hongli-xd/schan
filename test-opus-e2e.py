#!/usr/bin/env python3
"""
Xiaozhi Protocol End-to-End Test with Real Opus Encoding
Uses opuslib to encode WAV to Opus, sends over WebSocket to xiaozhi gateway.
"""
import sys
import os
import json
import struct
import socket
import asyncio
import opuslib
import wave

# WAV to Opus encoder
def encode_wav_to_opus(wav_path, sample_rate=16000, channels=1, frame_duration_ms=60):
    """Encode WAV file to Opus packets."""
    # Open WAV file
    with wave.open(wav_path, 'rb') as wav:
        assert wav.getnchannels() == channels, f"Expected {channels} channels, got {wav.getnchannels()}"
        assert wav.getframerate() == sample_rate, f"Expected {sample_rate} Hz, got {wav.getframerate()}"
        frames = wav.readframes(wav.getnframes())

    # Create Opus encoder
    opus_encoder = opuslib.Encoder(sample_rate, channels, opuslib.APPLICATION_VOIP)
    frame_size = int(sample_rate * frame_duration_ms / 1000)  # samples per frame

    # Split PCM data into frames and encode
    packets = []
    offset = 0
    while offset + frame_size * channels * 2 <= len(frames):
        pcm_frame = frames[offset:offset + frame_size * channels * 2]
        opus_packet = opus_encoder.encode(pcm_frame, frame_size)
        packets.append(opus_packet)
        offset += frame_size * channels * 2

    return packets


async def send_opus_packets(ws_url, headers, hello_msg, packets, close_after=5.0):
    """Send Opus packets over WebSocket."""
    import websockets

    print(f"[WS] Connecting to {ws_url}")
    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        # Send device hello
        await ws.send(json.dumps(hello_msg))
        print(f"[→] Sent: {json.dumps(hello_msg)[:100]}...")

        # Receive server hello
        resp = await asyncio.wait_for(ws.recv(), timeout=10.0)
        server_hello = json.loads(resp)
        print(f"[←] Received: {json.dumps(server_hello)[:200]}")
        session_id = server_hello.get('session_id', '')

        # Wait for session ready
        await asyncio.sleep(0.5)

        # Send listen start
        listen_start = {"type": "listen", "state": "detect", "text": "测试音频"}
        await ws.send(json.dumps(listen_start))
        print(f"[→] Sent listen start")

        await asyncio.sleep(0.3)

        # Send Opus packets one by one
        for i, pkt in enumerate(packets):
            await ws.send(pkt)
            print(f"[→] Sent opus packet {i+1}/{len(packets)} ({len(pkt)} bytes)")
            await asyncio.sleep(0.06)  # 60ms interval

        await asyncio.sleep(0.3)

        # Send listen stop
        listen_stop = {"type": "listen", "state": "stop"}
        await ws.send(json.dumps(listen_stop))
        print(f"[→] Sent listen stop")

        # Wait for full transcription + LLM + TTS chain (can take 30+ seconds)
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=40.0)
                if isinstance(msg, bytes):
                    print(f"[←] Binary: {len(msg)} bytes")
                else:
                    data = json.loads(msg)
                    print(f"[←] {json.dumps(data)[:300]}")
                    if data.get('type') in ('stt', 'tts', 'llm'):
                        print(f"[✓] Got {data['type']} response!")
                        break
        except asyncio.TimeoutError:
            print(f"[i] No more messages, closing...")

        await ws.close()


async def main():
    HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    PORT = sys.argv[2] if len(sys.argv) > 2 else "8766"
    WAV_FILE = sys.argv[3] if len(sys.argv) > 3 else "/root/.openclaw/schan/OSR_cn_000_0072_8k.wav"

    print("=" * 60)
    print("Xiaozhi Protocol E2E Test with Opus Encoding")
    print("=" * 60)
    print(f"Target: ws://{HOST}:{PORT}")
    print(f"Audio:  {WAV_FILE}")
    print()

    # Encode WAV to Opus
    print("[*] Encoding WAV to Opus...")
    try:
        packets = encode_wav_to_opus(WAV_FILE, sample_rate=8000, frame_duration_ms=60)
        print(f"[*] Encoded {len(packets)} Opus packets")
    except Exception as e:
        print(f"[!] Encoding failed: {e}")
        sys.exit(1)

    ws_url = f"ws://{HOST}:{PORT}"
    headers = {
        "device-id": "AA:BB:CC:DD:EE:FF",
        "client-id": "test-opus-001",
        "protocol-version": "1",
        "authorization": "Bearer test-token",
    }
    hello_msg = {
        "type": "hello",
        "version": 1,
        "transport": "websocket",
        "audio_params": {
            "format": "opus",
            "sample_rate": 8000,
            "channels": 1,
            "frame_duration": 60,
        },
    }

    await send_opus_packets(ws_url, headers, hello_msg, packets)


if __name__ == "__main__":
    asyncio.run(main())