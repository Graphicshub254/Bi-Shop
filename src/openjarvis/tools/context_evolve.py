"""Tool interface for Bi-Shop's self-evolving tiered context engine."""

from __future__ import annotations

import json
from typing import Any, List

from openjarvis.core.registry import ToolRegistry
from openjarvis.core.types import ToolResult
from openjarvis.memory.self_evolve import (
    CATEGORIES,
    context_status,
    recall_context,
    record_learning,
)
from openjarvis.tools._stubs import BaseTool, ToolSpec


@ToolRegistry.register("context_evolve")
class ContextEvolveTool(BaseTool):
    """Store and retrieve tiered self-evolving memory (L0/L1/L2)."""

    tool_id = "context_evolve"

    @property
    def spec(self) -> ToolSpec:
        return ToolSpec(
            name="context_evolve",
            description=(
                "Bi-Shop's self-evolving tiered context database (L0 summary, "
                "L1 categorized memory, L2 episode history). Use 'learn' to save "
                "new preferences, project facts, lessons, or reusable workflows; "
                "use 'recall' to retrieve compact context; use 'status' for stats."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["learn", "recall", "status"],
                        "description": "Operation to perform.",
                    },
                    "category": {
                        "type": "string",
                        "enum": list(CATEGORIES),
                        "description": "Memory category (preferences, projects, lessons, workflows).",
                    },
                    "insight": {
                        "type": "string",
                        "description": "Concise durable fact, lesson, or workflow to remember (for 'learn').",
                    },
                    "tier": {
                        "type": "string",
                        "enum": ["L0", "L1", "L2"],
                        "description": "Context depth to recall (default L0).",
                    },
                    "query": {
                        "type": "string",
                        "description": "Optional keyword filter when recalling L2 episodes.",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags for categorizing a learned insight.",
                    },
                },
                "required": ["action"],
            },
            category="memory",
        )

    def execute(self, **params: Any) -> ToolResult:
        action = str(params.get("action", "")).strip().lower()
        if action == "learn":
            insight = str(params.get("insight", "")).strip()
            category = str(params.get("category", "lessons")).strip().lower()
            tags: List[str] = [str(t) for t in (params.get("tags") or [])]
            res = record_learning(category, insight, tags=tags)
            return ToolResult(
                tool_name=self.tool_id,
                content=json.dumps(res, ensure_ascii=False),
                success=bool(res.get("stored", False) or res.get("reason") == "Already known"),
            )

        if action == "recall":
            tier = str(params.get("tier", "L0")).strip().upper()
            category = str(params.get("category", "")).strip().lower()
            query = str(params.get("query", "")).strip()
            text = recall_context(tier=tier, category=category, query=query)
            return ToolResult(tool_name=self.tool_id, content=text, success=True)

        if action == "status":
            return ToolResult(
                tool_name=self.tool_id,
                content=json.dumps(context_status(), indent=2),
                success=True,
            )

        return ToolResult(
            tool_name=self.tool_id,
            content=f"Unknown context_evolve action: {action}",
            success=False,
        )
