"""Edge TTS backend — free, lightweight Microsoft Edge neural voice synthesis."""

from __future__ import annotations

import asyncio
import importlib.util
from typing import List

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

_DEFAULT_VOICE = "en-GB-RyanNeural"

_CURATED_VOICES: List[str] = [
    "en-GB-RyanNeural",      # British male (default Bi-Shop voice)
    "en-GB-SoniaNeural",     # British female
    "en-US-GuyNeural",       # US male
    "en-US-AriaNeural",      # US female
    "en-US-JennyNeural",     # US conversational female
    "ja-JP-NanamiNeural",    # Japanese female (anime/dubbing)
    "ja-JP-KeitaNeural",     # Japanese male (anime/dubbing)
]


def _speed_to_rate(speed: float) -> str:
    """Convert a numeric multiplier (e.g. 1.15) to Edge TTS rate ('+15%')."""
    clamped = max(0.5, min(2.0, float(speed or 1.0)))
    pct = round((clamped - 1.0) * 100)
    return f"+{pct}%" if pct >= 0 else f"{pct}%"


async def _synthesize_async(text: str, voice: str, rate: str) -> bytes:
    import edge_tts

    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate)
    chunks: List[bytes] = []
    async for chunk in communicate.stream():
        if chunk.get("type") == "audio":
            data = chunk.get("data")
            if isinstance(data, (bytes, bytearray)):
                chunks.append(bytes(data))
    return b"".join(chunks)


@TTSRegistry.register("edge_tts")
class EdgeTTSBackend(TTSBackend):
    """Free neural TTS backend powered by Microsoft Edge Read Aloud voices."""

    backend_id = "edge_tts"

    def __init__(self, *, default_voice: str = _DEFAULT_VOICE) -> None:
        self._default_voice = default_voice or _DEFAULT_VOICE

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "",
        speed: float = 1.0,
        output_format: str = "mp3",
    ) -> TTSResult:
        if not self.health():
            raise RuntimeError("edge-tts package is not installed")

        chosen_voice = voice_id or self._default_voice
        rate = _speed_to_rate(speed)

        try:
            asyncio.get_running_loop()
            # If already inside an active event loop, run in a dedicated thread loop.
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                audio = pool.submit(
                    asyncio.run, _synthesize_async(text, chosen_voice, rate)
                ).result(timeout=60.0)
        except RuntimeError:
            audio = asyncio.run(_synthesize_async(text, chosen_voice, rate))

        if not audio:
            raise RuntimeError("Edge TTS returned empty audio")

        return TTSResult(
            audio=audio,
            format="mp3",
            voice_id=chosen_voice,
            metadata={"backend": "edge_tts", "rate": rate},
        )

    def available_voices(self) -> List[str]:
        return list(_CURATED_VOICES)

    def health(self) -> bool:
        return importlib.util.find_spec("edge_tts") is not None
