from __future__ import annotations

import os
import time
import uuid
import json
import traceback
import asyncio
from typing import Any, Dict, List, Optional, Tuple

import httpx
import orjson
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import ORJSONResponse, StreamingResponse
from pydantic import BaseModel
from transformers import AutoTokenizer

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

# Token limits at gateway
MAX_TOKENS_DEFAULT = int(os.getenv("MAX_TOKENS_DEFAULT", "256"))
MAX_TOKENS_HARD_CAP = int(os.getenv("MAX_TOKENS_HARD_CAP", "1024"))

HTTP_TIMEOUT = httpx.Timeout(600, read=600)

# Global HTTP client
_http_client: Optional[httpx.AsyncClient] = None

# Global tokenizer
_tokenizer = None
TOKENIZER_MODEL_NAME = os.getenv("TOKENIZER_MODEL_NAME", MODEL_NAME)


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
        self._mem: Dict[str, Tuple[float, str]] = {}

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
        if time.time() > exp:
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
def _auth(header: str) -> str:
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, "Missing/invalid Authorization header")
    key = header.split(" ", 1)[1].strip()
    if key not in API_KEYS:
        raise HTTPException(401, "Invalid API key")
    return key


def _sid(x_session_id: Optional[str]) -> str:
    return x_session_id or str(uuid.uuid4())


def _session_key(sid: str) -> str:
    return f"sess:{sid}:hist"


def _metrics_key(sid: str) -> str:
    return f"sess:{sid}:metrics"


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
    """
    key = _metrics_key(sid)
    existing = await store.get_json(key) or {
        "requests": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "total_latency_seconds": 0.0,
        "avg_latency_seconds": None,
    }

    existing["requests"] += 1
    existing["prompt_tokens"] += prompt_tokens
    existing["completion_tokens"] += completion_tokens
    existing["total_tokens"] = existing["prompt_tokens"] + existing["completion_tokens"]
    existing["total_latency_seconds"] += latency

    existing["avg_latency_seconds"] = (
        existing["total_latency_seconds"] / existing["requests"]
    )

    await store.set_json(key, existing, ttl=SESSION_TTL)
    return existing


def _ensure_client() -> httpx.AsyncClient:
    if _http_client is None:
        raise HTTPException(500, "HTTP client not initialized")
    return _http_client


def _get_tokenizer():
    if _tokenizer is None:
        raise HTTPException(500, "Tokenizer not initialized")
    return _tokenizer


def _flatten_message_content(content: Any) -> str:
    """
    Convert OpenAI-style message `content` into a plain string for token counting.
    Handles:
      - string
      - list[{"type": "text", "text": "..."}]
      - other blocks or tool calls (fallback to JSON)
    """
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, dict):
                # text blocks
                if c.get("type") == "text" and "text" in c:
                    parts.append(str(c["text"]))
                else:
                    parts.append(json.dumps(c, ensure_ascii=False))
            else:
                parts.append(str(c))
        return "\n".join(parts)

    # Fallback: dump as JSON
    return json.dumps(content, ensure_ascii=False)


def count_tokens_text(text: str) -> int:
    tok = _get_tokenizer()
    # We don't add special tokens here; this gives you raw text cost.
    return len(tok.encode(text, add_special_tokens=False))


def count_tokens_messages(
    messages: List[Dict[str, Any]]
) -> Tuple[int, List[Dict[str, Any]]]:
    """
    Approximate token count for a chat conversation.
    We:
      - count tokens per message based on content only
      - sum them for messages_tokens
    NOTE: this does not include special chat template tokens, but is very close.
    """
    per_message = []
    total = 0

    for idx, m in enumerate(messages):
        role = m.get("role", "user")
        content = _flatten_message_content(m.get("content", ""))

        # You can include role in the counted text if you want:
        # text_for_count = f"{role}: {content}"
        text_for_count = content

        tokens = count_tokens_text(text_for_count)
        total += tokens
        per_message.append(
            {
                "index": idx,
                "role": role,
                "tokens": tokens,
                "chars": len(content),
            }
        )

    return total, per_message


# =========================
# Upstream calls (vLLM)
# =========================
async def _call_vllm_nonstream(payload: Dict[str, Any]):
    client = _ensure_client()
    url = f"{OPENAI_BASE}/chat/completions"

    t0 = time.time()
    resp = await client.post(url, json=payload)
    latency = time.time() - t0

    if resp.status_code != 200:
        raise HTTPException(resp.status_code, resp.text)

    data = resp.json()
    usage = data.get("usage") or {}
    return data, {
        "latency_seconds": latency,
        "prompt_tokens": usage.get("prompt_tokens", 0),
        "completion_tokens": usage.get("completion_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
    }


async def _stream_vllm(
    payload: Dict[str, Any],
    sid: str,
    merged_messages: List[Dict[str, Any]],
):
    client = _ensure_client()
    url = f"{OPENAI_BASE}/chat/completions"

    so = dict(payload.get("stream_options") or {})
    so.setdefault("include_usage", True)
    payload["stream_options"] = so
    payload["stream"] = True

    req = client.build_request("POST", url, json=payload)

    call_start = time.time()
    resp = await client.send(req, stream=True)
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, await resp.aread())

    async def event_generator():
        prompt_tokens = 0
        completion_tokens = 0
        first_token_time = None

        async for raw_line in resp.aiter_lines():
            if not raw_line:
                yield b"\n"
                continue

            line = raw_line.rstrip("\n")

            if not line.startswith("data:"):
                yield (line + "\n\n").encode()
                continue

            data_str = line[5:].strip()
            if data_str == "" or data_str == "[DONE]":
                yield (f"data: {data_str}\n\n").encode()
                break

            try:
                chunk = orjson.loads(data_str)
            except Exception:
                yield (line + "\n\n").encode()
                continue

            # TTFT
            if first_token_time is None:
                choices = chunk.get("choices") or []
                if choices:
                    delta = choices[0].get("delta") or {}
                    if any(k in delta for k in ("content", "role", "tool_calls")):
                        first_token_time = time.time()
                        print(
                            f"[STREAM] session={sid} TTFT={first_token_time - call_start:.3f}"
                        )

            # Usage
            usage = chunk.get("usage") or {}
            if usage:
                prompt_tokens = usage.get("prompt_tokens", 0)
                completion_tokens = usage.get("completion_tokens", 0)

            yield (f"data: {orjson.dumps(chunk).decode()}\n\n").encode()

        # Post-stream metrics
        latency = time.time() - call_start

        # Save conversation history
        await store.set_json(_session_key(sid), merged_messages, ttl=SESSION_TTL)

        session_metrics = await _update_session_metrics(
            sid, prompt_tokens, completion_tokens, latency
        )

        # Custom event
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
        yield (
            "event: gateway_metrics\n"
            f"data: {orjson.dumps(metrics_payload).decode()}\n\n"
        ).encode()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


# =========================
# FastAPI app
# =========================
app = FastAPI(
    title="Qwen Gateway",
    version="0.5.0",
    default_response_class=ORJSONResponse,
)


@app.on_event("startup")
async def startup():
    global _http_client, _tokenizer
    await store.init()
    _http_client = httpx.AsyncClient(timeout=HTTP_TIMEOUT)

    # Initialize tokenizer once at startup
    # Uses TOKENIZER_MODEL_NAME, defaulting to MODEL_NAME
    _tokenizer = AutoTokenizer.from_pretrained(TOKENIZER_MODEL_NAME)


@app.on_event("shutdown")
async def shutdown():
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None


@app.exception_handler(Exception)
async def unhandled_exc(_req: Request, exc: Exception):
    return ORJSONResponse(
        status_code=500,
        content={
            "error": {
                "message": str(exc),
                "trace": traceback.format_exc()[:2000],
            }
        },
    )


@app.get("/v1/health")
async def health():
    return {"ok": True, "upstream": OPENAI_BASE, "model": MODEL_NAME}


@app.get("/v1/session/{session_id}/metrics")
async def get_session_metrics(session_id: str):
    metrics = await store.get_json(_metrics_key(session_id)) or {}
    return {"session_id": session_id, "metrics": metrics}


# =========================
# Token counting endpoint
# =========================
class TokenCountRequest(BaseModel):
    model: Optional[str] = None  # reserved if you later support multiple tokenizers
    text: Optional[str] = None
    messages: Optional[List[Dict[str, Any]]] = None

    def validate_payload(self):
        if self.text is None and self.messages is None:
            raise HTTPException(
                status_code=400,
                detail="At least one of `text` or `messages` must be provided",
            )


class TokenCountResponse(BaseModel):
    model: str
    total_tokens: int
    text_tokens: Optional[int] = None
    messages_tokens: Optional[int] = None
    per_message: Optional[List[Dict[str, Any]]] = None


@app.post("/v1/tokens/count", response_model=TokenCountResponse)
async def tokens_count(
    request: TokenCountRequest,
    authorization: str = Header(None),
):
    """
    Calculate approximate token usage for:
      - plain text (system prompt, instructions, etc.)
      - chat conversation (OpenAI-style `messages`)
    """
    _auth(authorization)

    request.validate_payload()

    # For now we ignore request.model and always use TOKENIZER_MODEL_NAME
    model_name = TOKENIZER_MODEL_NAME

    text_tokens: Optional[int] = None
    messages_tokens: Optional[int] = None
    per_message: Optional[List[Dict[str, Any]]] = None

    # Count text if provided
    if request.text is not None:
        text_tokens = count_tokens_text(request.text)

    # Count messages if provided
    if request.messages is not None:
        messages_tokens, per_message = count_tokens_messages(request.messages)

    total_tokens = 0
    if text_tokens is not None:
        total_tokens += text_tokens
    if messages_tokens is not None:
        total_tokens += messages_tokens

    return TokenCountResponse(
        model=model_name,
        total_tokens=total_tokens,
        text_tokens=text_tokens,
        messages_tokens=messages_tokens,
        per_message=per_message,
    )


# =========================
# Chat Completion (stream + non-stream)
# =========================
@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str = Header(None),
    x_session_id: Optional[str] = Header(None),
):
    _auth(authorization)

    body = await request.json()
    stream = bool(body.get("stream", False))
    sid = _sid(x_session_id)

    # Token handling
    max_tokens = body.get("max_tokens")
    if max_tokens is None:
        body["max_tokens"] = MAX_TOKENS_DEFAULT
    else:
        body["max_tokens"] = min(int(max_tokens), MAX_TOKENS_HARD_CAP)

    # Load session history
    hist = await store.get_json(_session_key(sid)) or []
    incoming = body.get("messages") or []

    if not isinstance(incoming, list):
        raise HTTPException(400, "`messages` must be a list")

    merged = (hist + incoming)[-MAX_TURNS:]
    body["messages"] = merged
    body.setdefault("model", MODEL_NAME)

    # Defaults
    body.setdefault("temperature", 0.2)
    body.setdefault("top_p", 0.9)

    # Non-stream
    if not stream:
        data, metrics = await _call_vllm_nonstream(body)

        await store.set_json(_session_key(sid), merged, ttl=SESSION_TTL)

        session_metrics = await _update_session_metrics(
            sid,
            metrics["prompt_tokens"],
            metrics["completion_tokens"],
            metrics["latency_seconds"],
        )

        data.setdefault("gateway", {})
        data["gateway"].update(
            {
                "session_id": sid,
                "latency_seconds": metrics["latency_seconds"],
                "prompt_tokens": metrics["prompt_tokens"],
                "completion_tokens": metrics["completion_tokens"],
                "total_tokens": metrics["total_tokens"],
                "session_metrics": session_metrics,
            }
        )

        return ORJSONResponse(data, headers={"X-Session-ID": sid})

    # Stream
    resp = await _stream_vllm(body, sid=sid, merged_messages=merged)
    resp.headers["X-Session-ID"] = sid
    return resp


# =========================
# Batch inference
# =========================
@app.post("/v1/chat/batch")
async def chat_batch(
    request: Request,
    authorization: str = Header(None),
):
    _auth(authorization)

    body = await request.json()
    items = body.get("requests") or []

    if not isinstance(items, list) or not items:
        raise HTTPException(400, "`requests` must be a list")

    # Standardize items
    for item in items:
        item.setdefault("stream", False)
        item.setdefault("model", MODEL_NAME)
        item.setdefault("temperature", 0.2)
        item.setdefault("top_p", 0.9)

        max_tokens = item.get("max_tokens")
        if max_tokens is None:
            item["max_tokens"] = MAX_TOKENS_DEFAULT
        else:
            item["max_tokens"] = min(int(max_tokens), MAX_TOKENS_HARD_CAP)

    async def handle_one(i, payload):
        try:
            data, metrics = await _call_vllm_nonstream(payload)
            return {"index": i, "ok": True, "response": data, "metrics": metrics}
        except HTTPException as e:
            return {
                "index": i,
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
    wall = time.time() - start

    total_prompt = sum(
        r.get("metrics", {}).get("prompt_tokens", 0) for r in results if r["ok"]
    )
    total_completion = sum(
        r.get("metrics", {}).get("completion_tokens", 0) for r in results if r["ok"]
    )
    total_tokens = total_prompt + total_completion
    tps = total_tokens / wall if wall > 0 else None

    return {
        "data": [
            r["response"] if r["ok"] else {"error": r["error"]}
            for r in results
        ],
        "throughput": {
            "wall_time_seconds": wall,
            "total_prompt_tokens": total_prompt,
            "total_completion_tokens": total_completion,
            "total_tokens": total_tokens,
            "tokens_per_second": tps,
        },
    }
