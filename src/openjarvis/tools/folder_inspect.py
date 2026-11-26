"""Read-only folder inspection tool — inspect directory contents with file metadata and categories."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec

_EXT_GROUPS = {
    "images": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".psd", ".ai", ".bmp", ".ico"},
    "videos": {".mp4", ".mkv", ".mov", ".avi", ".webm", ".wmv"},
    "audio": {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aac"},
    "documents": {".pdf", ".doc", ".docx", ".txt", ".md", ".rtf", ".xls", ".xlsx", ".csv", ".ppt", ".pptx"},
    "code": {".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css", ".json", ".toml", ".yaml", ".yml", ".rs", ".c", ".cpp", ".go", ".sh", ".ps1"},
    "archives": {".zip", ".rar", ".7z", ".tar", ".gz"},
    "installers_apps": {".exe", ".msi", ".lnk", ".url", ".bat", ".cmd"},
}


def _classify(path: Path) -> str:
    if path.is_dir():
        return "folders"
    ext = path.suffix.lower()
    for group, exts in _EXT_GROUPS.items():
        if ext in exts:
            return group
    return "other"


@ToolRegistry.register("folder_inspect")
class FolderInspectTool(BaseTool):
    """Read-only directory inspection with category breakdown and file metadata."""

    tool_id = "folder_inspect"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="folder_inspect",
            description=(
                "Safely inspect a local folder (read-only): returns a categorized summary "
                "(folders, images, videos, documents, code, installers, etc.) plus item "
                "names, sizes, and modified dates. Use this instead of shell_exec when "
                "inspecting Desktop, Downloads, Documents, or project folders."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to inspect (e.g. 'C:\\Users\\Bi shop\\Desktop').",
                    },
                    "max_items": {
                        "type": "integer",
                        "description": "Maximum number of items to return (default 150).",
                    },
                },
                "required": ["path"],
            },
            category="filesystem",
        )

    def execute(self, **params: Any) -> ToolResult:
        raw_path = str(params.get("path", "")).strip()
        if not raw_path:
            return ToolResult(tool_name=self.tool_id, content="No path provided.", success=False)

        target = Path(raw_path).expanduser()
        if not target.exists():
            return ToolResult(tool_name=self.tool_id, content=f"Path not found: {target}", success=False)
        if not target.is_dir():
            return ToolResult(tool_name=self.tool_id, content=f"Not a directory: {target}", success=False)

        max_items = max(1, min(500, int(params.get("max_items", 150))))
        summary: Dict[str, int] = {}
        items: List[Dict[str, Any]] = []

        try:
            entries = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
            for entry in entries[:max_items]:
                cat = _classify(entry)
                summary[cat] = summary.get(cat, 0) + 1
                try:
                    st = entry.stat()
                    size_kb = round(st.st_size / 1024, 1) if entry.is_file() else None
                    modified = datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d")
                except OSError:
                    size_kb = None
                    modified = ""
                items.append(
                    {
                        "name": entry.name,
                        "type": "dir" if entry.is_dir() else "file",
                        "category": cat,
                        "ext": entry.suffix.lower() if entry.is_file() else "",
                        "size_kb": size_kb,
                        "modified": modified,
                    }
                )
            return ToolResult(
                tool_name=self.tool_id,
                content=json.dumps(
                    {
                        "path": str(target),
                        "total_shown": len(items),
                        "total_in_dir": len(entries),
                        "category_counts": summary,
                        "items": items,
                    },
                    indent=2,
                ),
                success=True,
            )
        except Exception as exc:
            return ToolResult(tool_name=self.tool_id, content=f"Inspect error: {exc}", success=False)
