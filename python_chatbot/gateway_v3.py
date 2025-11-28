from __future__ import annotations

import os
import time
import uuid
import json
import traceback
from typing import Any, Dict, List, Optional, Tuple

import httpx
import orjson
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse

# -------- Redis (async) or in-memory fallback --------
try:
    import redis.asyncio as aioredis  # redis>=4.2
except Exception:
    aioredis = None


# =========================
# Config
# =========================
OPENAI_BASE = os.getenv("UPSTREAM_OPENAI", "http://127.0.0.1:8000/v1")
API_KEYS = {k.strip() for k in os.getenv("API_KEYS", "devkey").split(",") if k.strip()}
MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen3-4B-Instruct-2507")
MAX_TURNS = int(os.getenv("MAX_TURNS", "24"))
SESSION_TTL = int(os.getenv("SESSION_TTL_SECONDS", "3600"))
REDIS_URL = os.getenv("REDIS_URL", "").strip()

# Optional pricing (for cost metrics if you want)
PROMPT_PRICE_PER_1K = float(os.getenv("PROMPT_PRICE_PER_1K", "0.0"))
COMPLETION_PRICE_PER_1K = float(os.getenv("COMPLETION_PRICE_PER_1K", "0.0"))

HTTP_TIMEOUT = httpx.Timeout(600, read=600)


# =========================
# Session Store
# =========================
class SessionStore:
    """
    Minimal async key-value store with JSON helpers.
    Uses Redis if REDIS_URL is set and redis.asyncio is available,
    otherwise falls back to in-memory dict.
    """

    def __init__(self):
        self._use_redis = bool(REDIS_URL and aioredis is not None)
        self._redis = None
        self._mem: Dict[str, Tuple[float, str]] = {}  # key -> (exp_ts, value_json)

    async def init(self):
        if self._use_redis:
            self._redis = aioredis.from_url(REDIS_URL, decode_responses=True)

    async def setex(self, key: str, ttl: int, val: str):
        if self._use_redis and self._redis:
            await self._redis.set(key, val, ex=ttl)
        else:
            self._mem[key] = (time.time() + ttl, val)

    async def get(self, key: str) -> Optional[str]:
        if self._use_redis and self._redis:
            return await self._redis.get(key)
        item = self._mem.get(key)
        if not item:
            return None
        exp, val = item
        if exp and time.time() > exp:
            self._mem.pop(key, None)
            return None
        return val

    async def get_json(self, key: str) -> Any:
        raw = await self.get(key)
        return json.loads(raw) if raw else None

    async def set_json(self, key: str, obj: Any, ttl: int):
        await self.setex(key, ttl, json.dumps(obj))


store = SessionStore()


# =========================
# Helpers
# =========================
def _auth(header: str):
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, "Missing/invalid Authorization header")
    key = header.split(" ", 1)[1].strip()
    if key not in API_KEYS:
        raise HTTPException(401, "Invalid API key")


def _sid(x_session_id: Optional[str]) -> str:
    return x_session_id or str(uuid.uuid4())


def _session_key(sid: str) -> str:
    return f"sess:{sid}:hist"


def _metrics_key(sid: str) -> str:
    return f"sess:{sid}:metrics"


def _to_json_bytes(obj: Any) -> bytes:
    return orjson.dumps(obj)


def _calc_cost(prompt_tokens: int, completion_tokens: int) -> Dict[str, float]:
    prompt_cost = (prompt_tokens / 1000.0) * PROMPT_PRICE_PER_1K
    completion_cost = (completion_tokens / 1000.0) * COMPLETION_PRICE_PER_1K
    return {
        "prompt_cost_usd": prompt_cost,
        "completion_cost_usd": completion_cost,
        "total_cost_usd": prompt_cost + completion_cost,
    }


async def _update_session_metrics(
    sid: str,
    prompt_tokens: int,
    completion_tokens: int,
    latency: float,
):
    """
    Aggregate metrics per session:
    - total tokens
    - total/avg latency
    - approximate cost
    """
    key = _metrics_key(sid)
    existing = await store.get_json(key) or {
        "requests": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "total_latency_seconds": 0.0,
        "avg_latency_seconds": None,
        "prompt_cost_usd": 0.0,
        "completion_cost_usd": 0.0,
        "total_cost_usd": 0.0,
    }

    existing["requests"] += 1
    existing["prompt_tokens"] += int(prompt_tokens) or 0
    existing["completion_tokens"] += int(completion_tokens) or 0
    existing["total_tokens"] = existing["prompt_tokens"] + existing["completion_tokens"]
    existing["total_latency_seconds"] += float(latency) if latency else 0.0

    if existing["requests"] > 0:
        existing["avg_latency_seconds"] = (
            existing["total_latency_seconds"] / existing["requests"]
        )

    costs = _calc_cost(existing["prompt_tokens"], existing["completion_tokens"])
    existing.update(costs)

    await store.set_json(key, existing, ttl=SESSION_TTL)
    return existing


# =========================
# Upstream calls (vLLM)
# =========================

async def _call_vllm_nonstream(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """
    Non-streaming call to vLLM /v1/chat/completions.
    Returns (response_json, metrics_dict).
    metrics_dict contains latency + token usage.
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        url = f"{OPENAI_BASE}/chat/completions"

        t0 = time.time()
        resp = await client.post(url, json=payload)
        t1 = time.time()
        latency = t1 - t0

        if resp.status_code != 200:
            raise HTTPException(resp.status_code, resp.text)

        data = resp.json()
        usage = data.get("usage") or {}
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))

        metrics = {
            "latency_seconds": latency,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }
        metrics.update(_calc_cost(prompt_tokens, completion_tokens))

        return data, metrics


async def _stream_vllm(
    payload: Dict[str, Any],
    sid: str,
    merged_messages: List[Dict[str, Any]],
):
    """
    Streaming call to vLLM.
    - TTFT measured and logged.
    - Token usage parsed from final chunk.
    - Session metrics updated when stream ends.
    - SSE is passed through to the client.
    """
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        url = f"{OPENAI_BASE}/chat/completions"

        # Ensure vLLM includes usage in the final streamed chunk
        so = dict(payload.get("stream_options") or {})
        so.setdefault("include_usage", True)
        payload["stream_options"] = so
        payload["stream"] = True

        req = client.build_request("POST", url, json=payload)

        call_start = time.time()
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            text = await resp.aread()
            raise HTTPException(resp.status_code, text.decode("utf-8", "ignore"))

        async def event_generator():
            nonlocal sid, merged_messages

            first_token_time: Optional[float] = None
            prompt_tokens = 0
            completion_tokens = 0

            async for raw_line in resp.aiter_lines():
                if not raw_line:
                    # keep-alive / empty line
                    yield b"\n"
                    continue

                line = raw_line.rstrip("\n")

                if not line.startswith("data:"):
                    # Pass through any non-data lines (e.g. "event:" etc.)
                    yield (line + "\n").encode("utf-8")
                    continue

                data_str = line[5:].strip()  # after "data:"
                if data_str == "" or data_str == "[DONE]":
                    # [DONE] marker from vLLM/OpenAI
                    # We let it pass through as-is, then stop.
                    yield (f"data: {data_str}\n\n").encode("utf-8")
                    break

                # Parse JSON chunk
                try:
                    chunk = orjson.loads(data_str)
                except Exception:
                    # If can't parse, just pass through
                    yield (line + "\n\n").encode("utf-8")
                    continue

                # Detect TTFT: first time we see a real delta content
                if first_token_time is None:
                    choices = chunk.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta") or {}
                        has_content = any(
                            key in delta for key in ("content", "role", "tool_calls")
                        )
                        if has_content:
                            first_token_time = time.time()
                            ttft = first_token_time - call_start
                            # Log TTFT (you can replace with structured logging)
                            print(f"[STREAM] session={sid} TTFT={ttft:.3f}s")

                # Capture usage if present (usually only in the last chunk)
                usage = chunk.get("usage") or {}
                if usage:
                    prompt_tokens = int(usage.get("prompt_tokens") or 0)
                    completion_tokens = int(usage.get("completion_tokens") or 0)

                # Pass chunk through
                yield (f"data: {orjson.dumps(chunk).decode('utf-8')}\n\n").encode("utf-8")

            # Stream finished: compute total latency and update metrics/history
            call_end = time.time()
            latency = call_end - call_start

            # Save conversation history (merged messages) in store
            skey = _session_key(sid)
            await store.set_json(skey, merged_messages, ttl=SESSION_TTL)

            # Update per-session metrics
            session_metrics = await _update_session_metrics(
                sid,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency=latency,
            )

            # Optionally send a final custom metrics event AFTER [DONE]
            metrics_payload = {
                "session_id": sid,
                "latency_seconds": latency,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "ttft_seconds": (
                    (first_token_time - call_start) if first_token_time else None
                ),
                "session_aggregate": session_metrics,
            }
            # Some OpenAI clients may ignore custom events, which is fine.
            yield (
                "event: gateway_metrics\n"
                f"data: {orjson.dumps(metrics_payload).decode('utf-8')}\n\n"
            ).encode("utf-8")

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                # NOTE: X-Session-ID header will be attached by the endpoint, not here
            },
        )


# =========================
# FastAPI App
# =========================
app = FastAPI(title="Qwen Gateway", version="0.3.0")


@app.on_event("startup")
async def _startup():
    await store.init()


@app.exception_handler(Exception)
async def unhandled_exc(_req: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "message": f"{type(exc).__name__}: {str(exc)}",
                "trace": traceback.format_exc()[:4000],
            }
        },
    )


@app.get("/v1/health")
async def health():
    return {
        "ok": True,
        "upstream": OPENAI_BASE,
        "model": MODEL_NAME,
    }


@app.get("/v1/session/{session_id}/metrics")
async def get_session_metrics(session_id: str):
    """Optional helper to inspect aggregate metrics for a session."""
    metrics = await store.get_json(_metrics_key(session_id)) or {}
    return {"session_id": session_id, "metrics": metrics}


# ==============================================
# 3) Non-streaming endpoint (token usage + latency)
# 4) Streaming endpoint (TTFT + token usage)
# ==============================================
@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str = Header(None),
    x_session_id: Optional[str] = Header(None),
):
    _auth(authorization)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    stream = bool(body.get("stream", False))
    sid = _sid(x_session_id)

    # Load existing history
    skey = _session_key(sid)
    hist: List[Dict[str, Any]] = await store.get_json(skey) or []

    incoming = body.get("messages") or []
    if not isinstance(incoming, list):
        raise HTTPException(400, "`messages` must be a list")

    # Merge history + new messages, clamp to MAX_TURNS
    merged = (hist + incoming)[-MAX_TURNS:]
    body["messages"] = merged
    body.setdefault("model", MODEL_NAME)

    # Default sampling
    body.setdefault("temperature", 0.2)
    body.setdefault("top_p", 0.9)

    # Non-streaming branch
    if not stream:
        # 5) request completion time (latency) measured inside _call_vllm_nonstream
        data, metrics = await _call_vllm_nonstream(body)

        # Save history
        await store.set_json(skey, merged, ttl=SESSION_TTL)

        # Update aggregate session metrics
        session_metrics = await _update_session_metrics(
            sid,
            prompt_tokens=metrics["prompt_tokens"],
            completion_tokens=metrics["completion_tokens"],
            latency=metrics["latency_seconds"],
        )

        # Attach gateway metadata
        gw = data.setdefault("qwen_gateway", {})
        gw.update(
            {
                "session_id": sid,
                "latency_seconds": metrics["latency_seconds"],
                "prompt_tokens": metrics["prompt_tokens"],
                "completion_tokens": metrics["completion_tokens"],
                "total_tokens": metrics["total_tokens"],
                "cost": {
                    "prompt_cost_usd": metrics["prompt_cost_usd"],
                    "completion_cost_usd": metrics["completion_cost_usd"],
                    "total_cost_usd": metrics["total_cost_usd"],
                },
                "session_metrics": session_metrics,
            }
        )

        return JSONResponse(data, headers={"X-Session-ID": sid})

    # Streaming branch
    resp = await _stream_vllm(body, sid=sid, merged_messages=merged)
    # We can still tag the session ID on the headers here
    resp.headers["X-Session-ID"] = sid
    return resp


# ====================================
# 6) Batch inference endpoint
# ====================================
@app.post("/v1/chat/batch")
async def chat_batch(
    request: Request,
    authorization: str = Header(None),
):
    """
    Batch inference endpoint.

    Input:
      {
        "requests": [
          {
            "messages": [...],
            "stream": false,
            "temperature": 0.2,
            ...
          },
          ...
        ]
      }

    Output:
      {
        "data": [ <openai-style response>, ... ],
        "throughput": {
          "wall_time_seconds": ...,
          "total_prompt_tokens": ...,
          "total_completion_tokens": ...,
          "total_tokens": ...,
          "tokens_per_second": ...
        }
      }
    """
    _auth(authorization)

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    items = body.get("requests") or []
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "`requests` must be a non-empty list")

    # Force non-stream for batch to keep it simple
    for item in items:
        item.setdefault("stream", False)
        item.setdefault("model", MODEL_NAME)
        item.setdefault("temperature", 0.2)
        item.setdefault("top_p", 0.9)

    async def handle_one(idx: int, payload: Dict[str, Any]):
        try:
            data, metrics = await _call_vllm_nonstream(payload)
            return {
                "index": idx,
                "ok": True,
                "response": data,
                "metrics": metrics,
            }
        except HTTPException as e:
            return {
                "index": idx,
                "ok": False,
                "error": {
                    "status": e.status_code,
                    "message": str(e.detail),
                },
            }

    start = time.time()
    results = await asyncio.gather(
        *[handle_one(i, p) for i, p in enumerate(items)]
    )
    end = time.time()
    wall = end - start if end > start else 1e-9

    total_prompt_tokens = sum(
        r.get("metrics", {}).get("prompt_tokens", 0) for r in results if r.get("ok")
    )
    total_completion_tokens = sum(
        r.get("metrics", {}).get("completion_tokens", 0)
        for r in results
        if r.get("ok")
    )
    total_tokens = total_prompt_tokens + total_completion_tokens
    tps = total_tokens / wall if wall > 0 else None

    # Extract plain OpenAI-style response bodies for "data"
    data_list = [
        r["response"] if r.get("ok") else {"error": r.get("error")}
        for r in results
    ]

    throughput = {
        "wall_time_seconds": wall,
        "total_prompt_tokens": total_prompt_tokens,
        "total_completion_tokens": total_completion_tokens,
        "total_tokens": total_tokens,
        "tokens_per_second": tps,
    }

    return JSONResponse({"data": data_list, "throughput": throughput})
