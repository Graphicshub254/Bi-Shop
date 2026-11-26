"""Native Android automation & mobile QA tool for Bi-Shop (inspired by Google Artemis).

Drives USB-connected physical Android devices or emulators via ``adb`` using
UI accessibility hierarchy inspection (``uiautomator dump``), tap/swipe/text
actions, screenshot capture, and ``logcat`` error collection.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_BOUNDS_RE = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")


def _find_adb() -> Optional[str]:
    found = shutil.which("adb")
    if found:
        return found
    candidates = [
        Path.home() / "AppData" / "Local" / "Android" / "Sdk" / "platform-tools" / "adb.exe",
        Path("C:/Android/platform-tools/adb.exe"),
        Path(os.environ.get("ANDROID_HOME", "")) / "platform-tools" / "adb.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def _run_adb(args: List[str], serial: str = "", timeout: float = 20.0) -> subprocess.CompletedProcess[str]:
    adb = _find_adb()
    if not adb:
        raise FileNotFoundError(
            "adb not found. Install Android Platform-Tools and enable USB Debugging on your phone."
        )
    cmd = [adb]
    if serial:
        cmd.extend(["-s", serial])
    cmd.extend(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)


def _parse_ui_tree(xml_text: str, limit: int = 80) -> List[Dict[str, Any]]:
    """Extract compact interactive/labeled UI elements with center coordinates."""
    elements: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return elements

    for node in root.iter("node"):
        text = (node.attrib.get("text") or "").strip()
        desc = (node.attrib.get("content-desc") or "").strip()
        res_id = (node.attrib.get("resource-id") or "").split("/")[-1]
        clickable = node.attrib.get("clickable") == "true"
        bounds = node.attrib.get("bounds", "")

        if not (text or desc or clickable):
            continue
        m = _BOUNDS_RE.match(bounds)
        if not m:
            continue
        x1, y1, x2, y2 = map(int, m.groups())
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        elements.append(
            {
                "text": text,
                "desc": desc,
                "id": res_id,
                "clickable": clickable,
                "center": [cx, cy],
                "bounds": [x1, y1, x2, y2],
            }
        )
        if len(elements) >= limit:
            break
    return elements


@ToolRegistry.register("android_pilot")
class AndroidPilotTool(BaseTool):
    """Control and QA-test Android devices over ADB (inspired by Artemis)."""

    tool_id = "android_pilot"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="android_pilot",
            description=(
                "Automate and QA-test a connected Android phone or emulator via ADB: "
                "list devices, dump interactive UI accessibility tree with tap coordinates, "
                "tap, swipe, type text, press Android keys, launch apps, take screenshots, "
                "and inspect logcat errors."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "devices",
                            "ui_tree",
                            "screenshot",
                            "tap",
                            "swipe",
                            "type_text",
                            "keyevent",
                            "launch_app",
                            "logcat",
                        ],
                        "description": "Android automation action.",
                    },
                    "serial": {"type": "string", "description": "Optional ADB device serial."},
                    "x": {"type": "integer", "description": "Tap X coordinate."},
                    "y": {"type": "integer", "description": "Tap Y coordinate."},
                    "x2": {"type": "integer", "description": "Swipe end X coordinate."},
                    "y2": {"type": "integer", "description": "Swipe end Y coordinate."},
                    "text": {"type": "string", "description": "Text to input (for type_text)."},
                    "key": {
                        "type": "string",
                        "description": "Android key name/code, e.g. KEYCODE_HOME, KEYCODE_BACK, KEYCODE_ENTER.",
                    },
                    "package": {
                        "type": "string",
                        "description": "Android package name to launch (for launch_app).",
                    },
                },
                "required": ["action"],
            },
            category="mobile",
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action", "")).strip().lower()
        serial = str(params.get("serial", "")).strip()

        try:
            if action == "devices":
                proc = _run_adb(["devices", "-l"])
                return ToolResult(
                    tool_name=self.tool_id,
                    content=proc.stdout.strip() or proc.stderr.strip(),
                    success=proc.returncode == 0,
                )

            if action == "ui_tree":
                _run_adb(["shell", "uiautomator", "dump", "/sdcard/bishop_ui.xml"], serial)
                proc = _run_adb(["shell", "cat", "/sdcard/bishop_ui.xml"], serial)
                if proc.returncode != 0:
                    return ToolResult(
                        tool_name=self.tool_id,
                        content=f"Failed to read UI hierarchy: {proc.stderr.strip()}",
                        success=False,
                    )
                elements = _parse_ui_tree(proc.stdout)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=json.dumps({"element_count": len(elements), "elements": elements}, indent=2),
                    success=True,
                )

            if action == "screenshot":
                out_dir = Path.home() / ".openjarvis" / "tmp"
                out_dir.mkdir(parents=True, exist_ok=True)
                out_path = out_dir / f"android_{int(time.time())}.png"
                adb = _find_adb()
                if not adb:
                    raise FileNotFoundError("adb not found")
                cmd = [adb] + (["-s", serial] if serial else []) + ["exec-out", "screencap", "-p"]
                raw = subprocess.run(cmd, capture_output=True, timeout=20.0, check=False)
                if raw.returncode != 0 or not raw.stdout:
                    return ToolResult(
                        tool_name=self.tool_id,
                        content=f"Screenshot failed: {raw.stderr.decode(errors='ignore')}",
                        success=False,
                    )
                out_path.write_bytes(raw.stdout)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Android screenshot saved to {out_path}",
                    success=True,
                )

            if action == "tap":
                x, y = int(params["x"]), int(params["y"])
                proc = _run_adb(["shell", "input", "tap", str(x), str(y)], serial)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Tapped ({x}, {y})",
                    success=proc.returncode == 0,
                )

            if action == "swipe":
                x1, y1 = int(params["x"]), int(params["y"])
                x2, y2 = int(params["x2"]), int(params["y2"])
                proc = _run_adb(
                    ["shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), "300"],
                    serial,
                )
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Swiped ({x1},{y1}) -> ({x2},{y2})",
                    success=proc.returncode == 0,
                )

            if action == "type_text":
                text = str(params.get("text", "")).replace(" ", "%s")
                proc = _run_adb(["shell", "input", "text", text], serial)
                return ToolResult(
                    tool_name=self.tool_id,
                    content="Entered text on Android device.",
                    success=proc.returncode == 0,
                )

            if action == "keyevent":
                key = str(params.get("key", "KEYCODE_HOME")).strip()
                proc = _run_adb(["shell", "input", "keyevent", key], serial)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Sent keyevent {key}",
                    success=proc.returncode == 0,
                )

            if action == "launch_app":
                pkg = str(params.get("package", "")).strip()
                proc = _run_adb(
                    ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"],
                    serial,
                )
                return ToolResult(
                    tool_name=self.tool_id,
                    content=f"Launched {pkg}: {proc.stdout.strip()}",
                    success=proc.returncode == 0,
                )

            if action == "logcat":
                proc = _run_adb(["logcat", "-d", "-t", "60", "*:E"], serial)
                return ToolResult(
                    tool_name=self.tool_id,
                    content=proc.stdout.strip() or "No recent error logs.",
                    success=proc.returncode == 0,
                )

            return ToolResult(
                tool_name=self.tool_id,
                content=f"Unknown android_pilot action: {action}",
                success=False,
            )
        except Exception as exc:
            return ToolResult(
                tool_name=self.tool_id,
                content=f"Android pilot error: {exc}",
                success=False,
            )
