"""Self-evolving tiered context engine for Bi-Shop (inspired by OpenViking).

Organizes durable agent knowledge into a lightweight filesystem hierarchy under
``~/.openjarvis/context/`` with zero external database overhead:

- **L0** (``L0_summary.md``): Compact always-fresh executive index of all known
  preferences, active projects, and learned lessons.
- **L1** (``L1_preferences.md``, ``L1_projects.md``, ``L1_lessons.md``,
  ``L1_workflows.md``): Categorized structured notes loaded on demand.
- **L2** (``L2_episodes.jsonl``): Append-only chronological audit trail of every
  learned insight with timestamps and tags.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List

from openjarvis.core.config import get_config_dir

CATEGORIES = ("preferences", "projects", "lessons", "workflows")


def _context_dir() -> Path:
    d = get_config_dir() / "context"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _l1_path(category: str) -> Path:
    cat = category if category in CATEGORIES else "lessons"
    return _context_dir() / f"L1_{cat}.md"


def _l0_path() -> Path:
    return _context_dir() / "L0_summary.md"


def _l2_path() -> Path:
    return _context_dir() / "L2_episodes.jsonl"


def _read_lines(path: Path) -> List[str]:
    if not path.exists():
        return []
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("- ")
    ]


def rebuild_l0_summary() -> str:
    """Regenerate L0_summary.md from all L1 category files."""
    sections = ["# Bi-Shop L0 Context Index\n"]
    for cat in CATEGORIES:
        items = _read_lines(_l1_path(cat))
        sections.append(f"## {cat.title()} ({len(items)})")
        if items:
            # Keep L0 compact: latest 8 entries per category
            for item in items[-8:]:
                sections.append(item)
        else:
            sections.append("- (none yet)")
        sections.append("")
    summary = "\n".join(sections).strip() + "\n"
    _l0_path().write_text(summary, encoding="utf-8")
    return summary


def record_learning(
    category: str,
    insight: str,
    *,
    tags: List[str] | None = None,
    sync_memory_md: bool = True,
) -> Dict[str, Any]:
    """Persist a new durable insight across L1, L2, L0, and MEMORY.md."""
    cat = category.strip().lower()
    if cat not in CATEGORIES:
        cat = "lessons"
    clean = " ".join(insight.strip().split())
    if not clean:
        return {"stored": False, "reason": "Empty insight"}

    bullet = f"- {clean}"
    l1 = _l1_path(cat)
    existing = _read_lines(l1)
    if any(clean.lower() == e[2:].strip().lower() for e in existing):
        return {"stored": False, "reason": "Already known", "category": cat}

    header = f"# Bi-Shop L1 — {cat.title()}\n\n"
    if not l1.exists():
        l1.write_text(header + bullet + "\n", encoding="utf-8")
    else:
        with l1.open("a", encoding="utf-8") as fh:
            fh.write(bullet + "\n")

    # Append to L2 episode log
    episode = {
        "ts": int(time.time()),
        "category": cat,
        "insight": clean,
        "tags": tags or [],
    }
    with _l2_path().open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(episode, ensure_ascii=False) + "\n")

    # Refresh L0 summary index
    rebuild_l0_summary()

    # Sync concise bullet into ~/.openjarvis/MEMORY.md so core prompts see it
    if sync_memory_md:
        mem_path = get_config_dir() / "MEMORY.md"
        mem_text = mem_path.read_text(encoding="utf-8") if mem_path.exists() else "# Memory\n"
        if clean.lower() not in mem_text.lower():
            prefix = "\n" if mem_text and not mem_text.endswith("\n") else ""
            mem_path.write_text(
                f"{mem_text}{prefix}- [{cat}] {clean}\n", encoding="utf-8"
            )

    return {"stored": True, "category": cat, "insight": clean}


def recall_context(tier: str = "L0", category: str = "", query: str = "") -> str:
    """Retrieve tiered context (L0 summary, L1 category, or L2 filtered episodes)."""
    t = (tier or "L0").strip().upper()
    if t == "L0":
        if not _l0_path().exists():
            return rebuild_l0_summary()
        return _l0_path().read_text(encoding="utf-8")

    if t == "L1":
        if category and category.lower() in CATEGORIES:
            p = _l1_path(category.lower())
            return p.read_text(encoding="utf-8") if p.exists() else f"No L1 entries in {category}."
        chunks = []
        for cat in CATEGORIES:
            p = _l1_path(cat)
            if p.exists():
                chunks.append(p.read_text(encoding="utf-8").strip())
        return "\n\n".join(chunks) if chunks else "No L1 context recorded yet."

    # L2 search
    l2 = _l2_path()
    if not l2.exists():
        return "No L2 episodes recorded yet."
    q = query.strip().lower()
    matches: List[Dict[str, Any]] = []
    for raw in l2.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if category and row.get("category") != category.lower():
            continue
        if q and q not in str(row.get("insight", "")).lower() and not any(
            q in str(tg).lower() for tg in row.get("tags", [])
        ):
            continue
        matches.append(row)
    return json.dumps(matches[-20:], indent=2, ensure_ascii=False)


def context_status() -> Dict[str, Any]:
    """Return counts of learned items per category."""
    counts = {cat: len(_read_lines(_l1_path(cat))) for cat in CATEGORIES}
    return {
        "context_dir": str(_context_dir()),
        "counts": counts,
        "total_insights": sum(counts.values()),
    }
