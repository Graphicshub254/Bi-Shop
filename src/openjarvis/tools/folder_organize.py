"""Safe batch folder organization tool — create subfolders and move files without deletion or overwrites."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Dict, List

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.tools._stubs import BaseTool, ToolSpec


def _unique_dest(dest: Path) -> Path:
    """Return a non-colliding destination path if *dest* already exists."""
    if not dest.exists():
        return dest
    stem = dest.stem
    suffix = dest.suffix
    parent = dest.parent
    counter = 1
    while True:
        candidate = parent / f"{stem} ({counter}){suffix}"
        if not candidate.exists():
            return candidate
        counter += 1


@ToolRegistry.register("folder_organize")
class FolderOrganizeTool(BaseTool):
    """Organize a directory in one batch by creating subfolders and moving items safely."""

    tool_id = "folder_organize"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="folder_organize",
            description=(
                "Organize a directory in a single batch operation after Sir approves the plan: "
                "creates all requested subfolders and safely moves specified files/folders into them "
                "without deleting or overwriting anything (collisions are auto-renamed). "
                "Use this instead of shell_exec when organizing Desktop, Downloads, or Documents."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "base_dir": {
                        "type": "string",
                        "description": "Root directory being organized (e.g. 'C:\\Users\\Bi shop\\Desktop').",
                    },
                    "moves": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "folder": {
                                    "type": "string",
                                    "description": "Subfolder name inside base_dir to create/move into.",
                                },
                                "items": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "Filenames or subfolder names inside base_dir to move.",
                                },
                            },
                            "required": ["folder", "items"],
                        },
                        "description": "List of destination subfolders and the item names to move into each.",
                    },
                },
                "required": ["base_dir", "moves"],
            },
            category="filesystem",
        )

    def execute(self, **params: Any) -> ToolResult:
        raw_base = str(params.get("base_dir", "")).strip()
        moves = params.get("moves") or []
        if not raw_base:
            return ToolResult(tool_name=self.tool_id, content="No base_dir provided.", success=False)
        if not isinstance(moves, list) or not moves:
            return ToolResult(tool_name=self.tool_id, content="No moves provided.", success=False)

        base = Path(raw_base).expanduser().resolve()
        if not base.exists() or not base.is_dir():
            return ToolResult(tool_name=self.tool_id, content=f"Directory not found: {base}", success=False)

        created_folders: List[str] = []
        moved: List[Dict[str, str]] = []
        skipped: List[Dict[str, str]] = []

        for group in moves:
            if not isinstance(group, dict):
                continue
            folder_name = str(group.get("folder", "")).strip()
            item_names = group.get("items") or []
            if not folder_name:
                continue

            dest_dir = (base / folder_name).resolve()
            if not dest_dir.is_relative_to(base) or dest_dir == base:
                skipped.append({"item": folder_name, "reason": "Invalid target subfolder"})
                continue

            if not dest_dir.exists():
                dest_dir.mkdir(parents=True, exist_ok=True)
                created_folders.append(folder_name)

            for raw_item in item_names:
                name = str(raw_item).strip()
                if not name or name == folder_name:
                    continue
                src = (base / name).resolve()
                if not src.is_relative_to(base) or src.parent != base:
                    skipped.append({"item": name, "reason": "Must be a direct child of base_dir"})
                    continue
                if not src.exists():
                    skipped.append({"item": name, "reason": "Not found"})
                    continue
                target = _unique_dest(dest_dir / src.name)
                try:
                    shutil.move(str(src), str(target))
                    moved.append({"item": name, "to": f"{folder_name}/{target.name}"})
                except Exception as exc:
                    skipped.append({"item": name, "reason": str(exc)})

        return ToolResult(
            tool_name=self.tool_id,
            content=json.dumps(
                {
                    "base_dir": str(base),
                    "created_folders": created_folders,
                    "moved_count": len(moved),
                    "skipped_count": len(skipped),
                    "moved": moved[:60],
                    "skipped": skipped[:25],
                },
                indent=2,
            ),
            success=True,
        )
