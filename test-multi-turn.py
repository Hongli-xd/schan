#!/usr/bin/env python3
"""
Xiaozhi Protocol Multi-Turn Dialogue Test
Tests: continuous voice → STT → LLM reply → streaming TTS audio
Supports multiple rounds of back-and-forth conversation.
"""
import sys
import os
import json
import asyncio
import opuslib

WAV_FILE = "/root/.openclaw/schan/OSR_cn_000_0072_8k.wav"


def encode_wav_to_opus(wav_path, sample_rate=8000, channels=1, frame_duration_ms=60):
    with open(wav_path, 'rb') as f:
        assert f.read(4) == b'RIFF'
        f.read(4)  # chunk size
        assert f.read(4) == b'WAVE'
        assert f.read(4) == b'fmt '
        f.read(4)  # subchunk1 size
        f.read(2)  # audio format
        nch = int.from_bytes(f.read(2), 'little')
        assert nch == channels
        sr = int.from_bytes(f.read(4), 'little')
        assert sr == sample_rate
        f.read(6)  # byte rate + block align
        f.read(2)  # bits per sample
        assert f.read(4) == b'data'
        data_size = int.from_bytes(f.read(4), 'little')
        audio_data = f.read(data_size)

    opus_encoder = opuslib.Encoder(sample_rate, channels, opuslib.APPLICATION_VOIP)
    frame_size = int(sample_rate * frame_duration_ms / 1000)
    packets = []
    offset = 0
    while offset + frame_size * channels * 2 <= len(audio_data):
        pcm_frame = audio_data[offset:offset + frame_size * channels * 2]
        opus_packet = opus_encoder.encode(pcm_frame, frame_size)
        packets.append(opus_packet)
        offset += frame_size * channels * 2
    return packets


async def run_turn(ws, session_id, packets, turn_num):
    print(f"\n{'='*60}")
    print(f"TURN {turn_num}")
    print(f"{'='*60}")

    # Send listen start
    await ws.send(json.dumps({"type": "listen", "state": "detect", "text": f"第{turn_num}轮测试"}))
    print(f"[→] listen detect")

    # Send Opus packets
    for i, pkt in enumerate(packets):
        await ws.send(pkt)
        print(f"[→] opus {i+1}/{len(packets)} ({len(pkt)} bytes)")
        await asyncio.sleep(0.06)

    await asyncio.sleep(0.3)

    # Send listen stop
    await ws.send(json.dumps({"type": "listen", "state": "stop"}))
    print(f"[→] listen stop")

    # Wait for responses
    tts_audio_count = 0
    stt_text = None
    llm_emotion = None
    timeout_count = 0

    while True:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=40.0)
            timeout_count = 0
            if isinstance(msg, bytes):
                tts_audio_count += 1
                print(f"[←] TTS audio chunk #{tts_audio_count} ({len(msg)} bytes)")
            else:
                data = json.loads(msg)
                t = data.get('type', '')
                preview = json.dumps(data)[:200]
                print(f"[←] {t}: {preview}")
                if t == 'stt':
                    stt_text = data.get('text', '')
                if t == 'llm':
                    llm_emotion = data.get('emotion', '')
                if t in ('stt', 'tts') and t == 'tts' and data.get('state') == 'stop':
                    print(f"[✓] TTS stream ended")
                    break
                if t == 'stt':
                    # Also break after stt since reply may take long
                    pass
        except asyncio.TimeoutError:
            timeout_count += 1
            if timeout_count >= 2:
                print(f"[i] No more messages (timeout #{timeout_count}), ending turn")
                break

    return stt_text, llm_emotion, tts_audio_count


async def main():
    HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    PORT = sys.argv[2] if len(sys.argv) > 2 else "8766"
    TURNS = int(sys.argv[3]) if len(sys.argv) > 3 else 3

    import websockets

    print("=" * 60)
    print("Xiaozhi Multi-Turn Dialogue Test")
    print("=" * 60)
    print(f"Target: ws://{HOST}:{PORT}")
    print(f"Audio:  {WAV_FILE}")
    print(f"Turns:  {TURNS}")
    print()

    # Encode WAV once
    print("[*] Encoding WAV to Opus...")
    packets = encode_wav_to_opus(WAV_FILE, sample_rate=8000, frame_duration_ms=60)
    print(f"[*] {len(packets)} Opus packets ready")

    ws_url = f"ws://{HOST}:{PORT}"
    headers = {
        "device-id": "AA:BB:CC:DD:EE:FF",
        "client-id": "test-multi-turn",
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

    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        # Handshake
        await ws.send(json.dumps(hello_msg))
        print(f"[→] Sent hello")
        resp = await asyncio.wait_for(ws.recv(), timeout=10.0)
        server_hello = json.loads(resp)
        session_id = server_hello.get('session_id', '')
        print(f"[←] Server hello, session_id={session_id}")

        await asyncio.sleep(0.5)

        # Run multiple turns
        for turn in range(1, TURNS + 1):
            stt, emotion, audio_count = await run_turn(ws, session_id, packets, turn)
            print(f"\n[TURN {turn} RESULT] STT: {stt[:50]}...' | Emotion: {emotion} | TTS chunks: {audio_count}")
            await asyncio.sleep(1.0)  # Brief pause between turns

        print(f"\n{'='*60}")
        print(f"All {TURNS} turns completed!")
        print(f"{'='*60}")

        await ws.close()


if __name__ == "__main__":
    asyncio.run(main())
