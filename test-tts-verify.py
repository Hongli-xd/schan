#!/usr/bin/env python3
"""
Verify TTS direction: does robot receive Opus or raw PCM?
Tests by checking what binary data the gateway sends back.
"""
import sys
import json
import asyncio
import opuslib


WAV_FILE = "/root/.openclaw/schan/OSR_cn_000_0072_8k.wav"


def encode_wav_to_opus(wav_path, sample_rate=8000, channels=1, frame_duration_ms=60):
    with open(wav_path, 'rb') as f:
        assert f.read(4) == b'RIFF'
        f.read(4)
        assert f.read(4) == b'WAVE'
        assert f.read(4) == b'fmt '
        f.read(4)
        f.read(2)
        nch = int.from_bytes(f.read(2), 'little')
        assert nch == channels
        sr = int.from_bytes(f.read(4), 'little')
        assert sr == sample_rate
        f.read(6)
        f.read(2)
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


async def main():
    HOST = sys.argv[1] if len(sys.argv) > 1 else "localhost"
    PORT = sys.argv[2] if len(sys.argv) > 2 else "8766"

    import websockets

    print("=" * 60)
    print("TTS Direction Verification")
    print("=" * 60)

    packets = encode_wav_to_opus(WAV_FILE, sample_rate=8000, frame_duration_ms=60)

    ws_url = f"ws://{HOST}:{PORT}"
    headers = {
        "device-id": "AA:BB:CC:DD:EE:FF",
        "client-id": "test-tts-verify",
        "protocol-version": "1",
        "authorization": "Bearer test-token",
    }
    hello_msg = {
        "type": "hello", "version": 1, "transport": "websocket",
        "audio_params": {"format": "opus", "sample_rate": 8000, "channels": 1, "frame_duration": 60},
    }

    async with websockets.connect(ws_url, additional_headers=headers) as ws:
        await ws.send(json.dumps(hello_msg))
        resp = await asyncio.wait_for(ws.recv(), timeout=10.0)
        server_hello = json.loads(resp)
        print(f"[←] Server hello: format={server_hello.get('audio_params',{}).get('format')}")
        await asyncio.sleep(0.5)

        # Trigger STT → TTS chain
        await ws.send(json.dumps({"type": "listen", "state": "detect", "text": "测试"}))
        for pkt in packets:
            await ws.send(pkt)
            await asyncio.sleep(0.06)
        await ws.send(json.dumps({"type": "listen", "state": "stop"}))
        print("[→] Sent audio")

        # Collect all incoming binary messages and analyze
        binary_sizes = []
        binary_samples = []
        json_count = 0

        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=30.0)
                if isinstance(msg, bytes):
                    binary_sizes.append(len(msg))
                    binary_samples.append(bytes(msg[:20]))  # first 20 bytes
                    print(f"[←] Binary: {len(msg)} bytes  sample={msg[:40].hex()}")
                else:
                    data = json.loads(msg)
                    json_count += 1
                    t = data.get('type', '')
                    if t == 'tts' and data.get('state') == 'sentence_start':
                        print(f"[←] TTS sentence: {data.get('text','')[:50]}")
                    elif t == 'tts' and data.get('state') == 'stop':
                        print(f"[←] TTS stop")
                        break
        except asyncio.TimeoutError:
            pass

        print(f"\n--- Analysis ---")
        print(f"JSON messages: {json_count}")
        print(f"Binary messages: {len(binary_sizes)}")
        if binary_sizes:
            print(f"Binary sizes: {binary_sizes}")
            print(f"First binary sample hex: {binary_samples[0].hex()}")
            # PCM would be very different from Opus
            # Opus packets typically start with magic 0x4F or similar, small packets
            # PCM 16kHz 16-bit mono would be large (320 bytes per 20ms)
            avg_size = sum(binary_sizes) / len(binary_sizes)
            print(f"Average binary size: {avg_size:.0f} bytes")
            if avg_size > 1000:
                print("→ Likely RAW PCM (large chunks)")
            else:
                print("→ Likely Opus encoded (smaller packets)")
        await ws.close()


if __name__ == "__main__":
    asyncio.run(main())
