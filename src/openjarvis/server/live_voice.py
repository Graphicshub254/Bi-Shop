"""Real-time bidirectional speech-to-speech bridge via Gemini Multimodal Live API.

Exposes ``WS /v1/live-voice``:
  - Client -> Server: binary 16 kHz mono Int16 PCM microphone frames.
  - Server -> Client: binary 24 kHz mono Int16 PCM synthesized audio frames,
    plus lightweight JSON control messages (``ready``, ``interrupted``,
    ``turn_complete``, ``transcript``, ``error``).
"""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from openjarvis.core.config import get_config_dir

logger = logging.getLogger(__name__)

live_voice_router = APIRouter()

_DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-latest"
_DEFAULT_LIVE_VOICE = "Charon"


def _load_gemini_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""
    if key:
        return key
    env_file = get_config_dir() / "cloud-keys.env"
    if env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                if k in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
                    val = v.strip().strip('"').strip("'")
                    if val:
                        return val
    return ""


def _load_system_instruction() -> str:
    cfg_dir: Path = get_config_dir()
    parts = []
    for name in ("SOUL.md", "USER.md"):
        p = cfg_dir / name
        if p.exists():
            text = p.read_text(encoding="utf-8").strip()
            if text:
                parts.append(text)
    if not parts:
        parts.append(
            "You are Bi-Shop, a concise, calm, J.A.R.V.I.S.-style personal AI assistant. "
            "Address the user as Sir. Keep spoken replies natural, crisp, and direct."
        )
    parts.append(
        "Voice mode: keep responses concise and conversational (1-3 sentences unless asked "
        "for detail) so back-and-forth dialogue feels immediate."
    )
    return "\n\n".join(parts)


@live_voice_router.websocket("/v1/live-voice")
async def live_voice_ws(websocket: WebSocket) -> None:
    """Bidirectional sub-second audio WebSocket backed by Gemini Live API."""
    await websocket.accept()

    api_key = _load_gemini_key()
    if not api_key:
        await websocket.send_json(
            {"type": "error", "message": "GEMINI_API_KEY not configured"}
        )
        await websocket.close(code=1008)
        return

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        await websocket.send_json(
            {"type": "error", "message": "google-genai package is not installed"}
        )
        await websocket.close(code=1011)
        return

    model = websocket.query_params.get("model") or _DEFAULT_LIVE_MODEL
    voice_name = websocket.query_params.get("voice") or _DEFAULT_LIVE_VOICE
    mode = (websocket.query_params.get("mode") or "assistant").strip().lower()
    target_lang = (websocket.query_params.get("target_lang") or "English").strip()

    if mode == "dub":
        system_instruction = (
            f"You are Bi-Shop's real-time movie, show, and anime dubbing engine. "
            f"Listen to the incoming dialogue and immediately speak the natural "
            f"{target_lang} translation matching the speaker's emotion, energy, and pacing. "
            f"Output ONLY the dubbed {target_lang} dialogue — never add commentary, "
            f"introductions, or explanations. If there is only music or silence, stay silent."
        )
    else:
        system_instruction = _load_system_instruction()

    client = genai.Client(api_key=api_key)
    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                    voice_name=voice_name
                )
            )
        ),
        system_instruction=types.Content(
            parts=[types.Part.from_text(text=system_instruction)]
        ),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    try:
        async with client.aio.live.connect(model=model, config=config) as session:
            await websocket.send_json(
                {"type": "ready", "model": model, "voice": voice_name}
            )

            async def client_to_gemini() -> None:
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            break
                        raw_bytes: Optional[bytes] = msg.get("bytes")
                        if raw_bytes:
                            await session.send_realtime_input(
                                audio=types.Blob(
                                    data=raw_bytes,
                                    mime_type="audio/pcm;rate=16000",
                                )
                            )
                        elif msg.get("text"):
                            # Optional text nudge over the live voice socket
                            await session.send_realtime_input(text=msg["text"])
                except WebSocketDisconnect:
                    pass
                except asyncio.CancelledError:
                    pass
                except Exception as exc:
                    logger.debug("client_to_gemini ended: %s", exc)

            async def gemini_to_client() -> None:
                try:
                    while True:
                        async for response in session.receive():
                            sc = getattr(response, "server_content", None)
                            if sc is None:
                                continue

                            if getattr(sc, "interrupted", False):
                                await websocket.send_json({"type": "interrupted"})

                            in_tx = getattr(sc, "input_transcription", None)
                            if in_tx and getattr(in_tx, "text", None):
                                await websocket.send_json(
                                    {
                                        "type": "transcript",
                                        "role": "user",
                                        "text": in_tx.text,
                                    }
                                )

                            out_tx = getattr(sc, "output_transcription", None)
                            if out_tx and getattr(out_tx, "text", None):
                                await websocket.send_json(
                                    {
                                        "type": "transcript",
                                        "role": "assistant",
                                        "text": out_tx.text,
                                    }
                                )

                            model_turn = getattr(sc, "model_turn", None)
                            if model_turn and getattr(model_turn, "parts", None):
                                for part in model_turn.parts:
                                    inline = getattr(part, "inline_data", None)
                                    if inline and getattr(inline, "data", None):
                                        await websocket.send_bytes(inline.data)

                            if getattr(sc, "turn_complete", False):
                                await websocket.send_json({"type": "turn_complete"})
                except WebSocketDisconnect:
                    pass
                except asyncio.CancelledError:
                    pass
                except Exception as exc:
                    logger.debug("gemini_to_client ended: %s", exc)

            t1 = asyncio.create_task(client_to_gemini())
            t2 = asyncio.create_task(gemini_to_client())
            done, pending = await asyncio.wait(
                {t1, t2}, return_when=asyncio.FIRST_COMPLETED
            )
            for p in pending:
                p.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for d in done:
                d.exception() if not d.cancelled() else None
    except Exception as exc:
        logger.warning("Gemini Live Voice session error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
