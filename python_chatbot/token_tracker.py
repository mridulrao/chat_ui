# token_tracker.py

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Optional, List, Dict, Any


@dataclass
class TokenRecord:
    """Single call token + latency record."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    latency_seconds: Optional[float] = None
    ttft_seconds: Optional[float] = None  # time-to-first-token (for streaming)
    meta: Optional[Dict[str, Any]] = None  # e.g. {"endpoint": "stream", "id": 1}


class TokenUsageTracker:
    """
    Simple tracker for token usage and latency across many calls.
    - Can be used in agents, streaming and non-streaming clients.
    - You can feed it either OpenAI `usage` objects or raw integers.
    """

    def __init__(self) -> None:
        self._records: List[TokenRecord] = []

    # ------------------------
    # Core API
    # ------------------------
    def add(
        self,
        prompt_tokens: int,
        completion_tokens: int,
        *,
        latency_seconds: Optional[float] = None,
        ttft_seconds: Optional[float] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Add a record with explicit token counts."""
        total = int(prompt_tokens) + int(completion_tokens)
        rec = TokenRecord(
            prompt_tokens=int(prompt_tokens),
            completion_tokens=int(completion_tokens),
            total_tokens=total,
            latency_seconds=latency_seconds,
            ttft_seconds=ttft_seconds,
            meta=meta or {},
        )
        self._records.append(rec)

    def add_from_openai_usage(
        self,
        usage: Any,
        *,
        latency_seconds: Optional[float] = None,
        ttft_seconds: Optional[float] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Convenience: add a record from an OpenAI `usage` object or dict.

        Usage can be:
         - resp.usage (object with .prompt_tokens, .completion_tokens, .total_tokens)
         - a dict: {"prompt_tokens": ..., "completion_tokens": ..., "total_tokens": ...}
        """
        if usage is None:
            # nothing to record
            return

        # Handle both object and dict styles
        if isinstance(usage, dict):
            prompt_tokens = int(usage.get("prompt_tokens") or 0)
            completion_tokens = int(usage.get("completion_tokens") or 0)
            total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
        else:
            # OpenAI python client usage object
            prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
            completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            total_tokens = int(
                getattr(usage, "total_tokens", 0) or (prompt_tokens + completion_tokens)
            )

        rec = TokenRecord(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_seconds=latency_seconds,
            ttft_seconds=ttft_seconds,
            meta=meta or {},
        )
        self._records.append(rec)

    # ------------------------
    # Aggregates
    # ------------------------
    @property
    def records(self) -> List[TokenRecord]:
        """Raw list of per-call records."""
        return self._records

    @property
    def total_calls(self) -> int:
        return len(self._records)

    @property
    def total_prompt_tokens(self) -> int:
        return sum(r.prompt_tokens for r in self._records)

    @property
    def total_completion_tokens(self) -> int:
        return sum(r.completion_tokens for r in self._records)

    @property
    def total_tokens(self) -> int:
        return sum(r.total_tokens for r in self._records)

    @property
    def avg_latency(self) -> Optional[float]:
        vals = [r.latency_seconds for r in self._records if r.latency_seconds is not None]
        if not vals:
            return None
        return sum(vals) / len(vals)

    @property
    def avg_ttft(self) -> Optional[float]:
        vals = [r.ttft_seconds for r in self._records if r.ttft_seconds is not None]
        if not vals:
            return None
        return sum(vals) / len(vals)

    def summary(self) -> Dict[str, Any]:
        """Return a summary dict (easy to log/print)."""
        return {
            "calls": self.total_calls,
            "total_prompt_tokens": self.total_prompt_tokens,
            "total_completion_tokens": self.total_completion_tokens,
            "total_tokens": self.total_tokens,
            "avg_latency_seconds": self.avg_latency,
            "avg_ttft_seconds": self.avg_ttft,
        }

    def as_list(self) -> List[Dict[str, Any]]:
        """Return all records as list of dicts (e.g. for JSON logging)."""
        return [asdict(r) for r in self._records]

    def reset(self) -> None:
        """Clear all stored records."""
        self._records.clear()
