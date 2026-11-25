"""Desktop & VS Code live control tool — real-time mouse, keyboard, and screen capture.

Safety: PyAutoGUI FAILSAFE is always enabled (moving the mouse to the top-left
corner (0, 0) immediately aborts execution).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, List

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec


@ToolRegistry.register("desktop_control")
class DesktopControlTool(BaseTool):
    """Control mouse, keyboard, and screen capture for live IDE/desktop automation."""

    tool_id = "desktop_control"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="desktop_control",
            description=(
                "Control the local desktop in real time: inspect screen size/cursor, "
                "take a screenshot, move/click the mouse, scroll, type code or text "
                "into VS Code or any active window, and press keyboard shortcuts. "
                "Safety fail-safe: moving the mouse to (0, 0) aborts immediately."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "screen_info",
                            "screenshot",
                            "move",
                            "click",
                            "type_text",
                            "hotkey",
                            "scroll",
                        ],
                        "description": "Desktop action to perform.",
                    },
                    "x": {"type": "integer", "description": "Target X screen coordinate."},
                    "y": {"type": "integer", "description": "Target Y screen coordinate."},
                    "duration": {
                        "type": "number",
                        "description": "Smooth cursor movement duration in seconds (default 0.35).",
                    },
                    "button": {
                        "type": "string",
                        "enum": ["left", "right", "middle"],
                        "description": "Mouse button for click (default left).",
                    },
                    "clicks": {
                        "type": "integer",
                        "description": "Click count (for click) or scroll amount (for scroll).",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text or code to type in real time (for type_text).",
                    },
                    "interval": {
                        "type": "number",
                        "description": "Seconds between keystrokes for type_text (default 0.015).",
                    },
                    "keys": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Shortcut keys for hotkey, e.g. ['ctrl', 's'].",
                    },
                },
                "required": ["action"],
            },
            category="desktop",
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action", "")).strip().lower()
        try:
            import pyautogui
        except ImportError:
            return ToolResult(
                tool_name=self.tool_id,
                content="pyautogui is not installed. Run `uv pip install pyautogui mss`.",
                success=False,
            )

        pyautogui.FAILSAFE = True
        pyautogui.PAUSE = 0.05

        try:
            if action == "screen_info":
                w, h = pyautogui.size()
                pos = pyautogui.position()
                return ToolResult(
                    tool_name=self.tool_id,
                    content=json.dumps(
                        {"width": w, "height": h, "mouse_x": pos.x, "mouse_y": pos.y}
                    ),
                    success=True,
                )

            if action == "screenshot":
                out_dir = Path.home() / ".openjarvis" / "tmp"
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / f"screen_{int(time.time())}.png"
                try:
                    import mss
                    import mss.tools

                    with mss.mss() as sct:
                        monitor = sct.monitors[1]
                        shot = sct.grab(monitor)
                        mss.tools.to_png(shot.rgb, shot.size, output=str(out_path))
                except ImportError:
                    img = pyautogui.screenshot()
                    img.save(str(out_path))
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Screenshot saved to {out_path}",
                    success=True,
                )

            if action == "move":
                x, y = int(params["x"]), int(params["y"])
                dur = max(0.0, min(3.0, float(params.get("duration", 0.35))))
                pyautogui.moveTo(x, y, duration=dur)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Moved mouse to ({x}, {y}).",
                    success=True,
                )

            if action == "click":
                button = str(params.get("button", "left"))
                clicks = max(1, min(3, int(params.get("clicks", 1))))
                if "x" in params and "y" in params:
                    x, y = int(params["x"]), int(params["y"])
                    dur = max(0.0, min(2.0, float(params.get("duration", 0.25))))
                    pyautogui.moveTo(x, y, duration=dur)
                pyautogui.click(button=button, clicks=clicks)
                pos = pyautogui.position()
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Clicked {button} ({clicks}x) at ({pos.x}, {pos.y}).",
                    success=True,
                )

            if action == "type_text":
                text = str(params.get("text", ""))
                interval = max(0.0, min(0.2, float(params.get("interval", 0.015))))
                pyautogui.write(text, interval=interval)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Typed {len(text)} characters into the active window.",
                    success=True,
                )

            if action == "hotkey":
                keys: List[str] = [str(k) for k in (params.get("keys") or []) if str(k).strip()]
                if not keys:
                    return ToolResult(
                        tool_name=self.tool_id,
                        content="No keys provided for hotkey.",
                        success=False,
                    )
                pyautogui.hotkey(*keys)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Pressed hotkey: {'+'.join(keys)}.",
                    success=True,
                )

            if action == "scroll":
                amount = int(params.get("clicks", -300))
                pyautogui.scroll(amount)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Scrolled {amount}.",
                    success=True,
                )

            return ToolResult(
                tool_name=self.tool_id,
                content=f"Unknown desktop_control action: {action}",
                success=False,
            )
        except Exception as exc:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"Desktop control error: {exc}",
                success=False,
            )
