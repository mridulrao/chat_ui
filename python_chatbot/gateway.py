# gateway/main.py
import os, time, uuid, json, asyncio
from typing import Dict, Any, List, Optional, Tuple
from fastapi import FastAPI, Request, Header, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
import httpx
import orjson

try:
    import redis  # optional
except Exception:  # pragma: no cover
    redis = None

# -----------------------------
# Config
# -----------------------------
OPENAI_BASE = os.getenv("UPSTREAM_OPENAI", "http://127.0.0.1:8000/v1")
API_KEYS = {k.strip() for k in os.getenv("API_KEYS", "devkey").split(",") if k.strip()}
MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen3-4B-Instruct-2507")
MAX_TURNS = int(os.getenv("MAX_TURNS", "24"))
SESSION_TTL = int(os.getenv("SESSION_TTL_SECONDS", "3600"))
REDIS_URL = os.getenv("REDIS_URL", "").strip()

# -----------------------------
# Storage (Redis or in-memory)
# -----------------------------
class Store:
    """Minimal key-value with TTL + JSON helpers."""
    def __init__(self):
        self._use_redis = bool(REDIS_URL and redis is not None)
        if self._use_redis:
            self._r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        else:
            self._r = None
            self._mem: Dict[str, Tuple[float, str]] = {}
            asyncio.get_event_loop().create_task(self._sweeper())

    async def _sweeper(self):
        while True:
            now = time.time()
            for k in list(self._mem.keys()):
                exp, _ = self._mem.get(k, (0, ""))
                if exp and now > exp:
                    self._mem.pop(k, None)
            await asyncio.sleep(5)

    def setex(self, key: str, ttl: int, val: str):
        if self._use_redis:
            self._r.setex(key, ttl, val)
        else:
            self._mem[key] = (time.time() + ttl, val)

    def get(self, key: str) -> Optional[str]:
        if self._use_redis:
            return self._r.get(key)
        item = self._mem.get(key)
        if not item:
            return None
        exp, val = item
        if exp and time.time() > exp:
            self._mem.pop(key, None)
            return None
        return val

    # simple counters for rate limits/metrics
    def incr(self, key: str, ttl: int) -> int:
        if self._use_redis:
            pipe = self._r.pipeline()
            pipe.incr(key)
            pipe.expire(key, ttl)
            c, _ = pipe.execute()
            return int(c)
        else:
            c_raw = self.get(key)
            c = int(c_raw) if c_raw else 0
            c += 1
            self.setex(key, ttl, str(c))
            return c

store = Store()

# -----------------------------
# Helpers
# -----------------------------
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

def _continuation_key(sid: str) -> str:
    return f"sess:{sid}:cont"

def _to_json_bytes(obj: Any) -> bytes:
    return orjson.dumps(obj)

async def _call_vllm_chat(payload: Dict[str, Any], stream: bool):
    async with httpx.AsyncClient(timeout=httpx.Timeout(60, read=60)) as client:
        url = f"{OPENAI_BASE}/chat/completions"
        if stream:
            req = client.build_request("POST", url, json=payload)
            resp = await client.send(req, stream=True)
            if resp.status_code != 200:
                text = await resp.aread()
                raise HTTPException(resp.status_code, text.decode("utf-8", "ignore"))

            async def gen():
                async for chunk in resp.aiter_raw():
                    # passthrough SSE
                    yield chunk
            return StreamingResponse(gen(), media_type="text/event-stream")
        else:
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                raise HTTPException(resp.status_code, resp.text)
            return JSONResponse(resp.json())

# -----------------------------
# FastAPI
# -----------------------------
app = FastAPI(title="Qwen Gateway", version="0.1.0")

@app.get("/v1/health")
async def health():
    return {"ok": True, "upstream": OPENAI_BASE, "model": MODEL_NAME}

@app.get("/v1/models")
async def models():
    # Minimal models list for SDKs that probe this endpoint
    return {"data": [{"id": MODEL_NAME, "object": "model"}]}

@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    authorization: str = Header(None),
    x_session_id: Optional[str] = Header(None),
    x_continuation: Optional[str] = Header(None),
):
    _auth(authorization)

    # Basic per-key rate-limiting (60 req/min)
    key_hash = authorization[-8:]
    count = store.incr(f"ratelimit:{key_hash}", ttl=60)
    if count > 60:
        raise HTTPException(429, "Rate limit exceeded")

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    stream = bool(body.get("stream", False))
    sid = _sid(x_session_id)

    # Load prior history
    skey = _session_key(sid)
    prev_raw = store.get(skey)
    hist: List[Dict[str, str]] = json.loads(prev_raw) if prev_raw else []

    # Merge messages with clamp
    incoming = body.get("messages", [])
    merged = (hist + incoming)[-MAX_TURNS:]
    body["messages"] = merged

    # Attach continuation token as a system hint (optional semantic aid)
    if x_continuation:
        body["messages"].insert(0, {
            "role": "system",
            "content": f"[CONTINUATION TOKEN] {x_continuation}"
        })

    # Ensure model is set
    body.setdefault("model", MODEL_NAME)

    # Safe default sampling (override per-request as needed)
    body.setdefault("temperature", 0.2)
    body.setdefault("top_p", 0.9)

    # Call upstream vLLM server
    result = await _call_vllm_chat(body, stream=stream)

    # Update session only when not streaming (simple path)
    if not stream and isinstance(result, JSONResponse):
        # Save merged history with TTL
        store.setex(skey, SESSION_TTL, json.dumps(merged))
        cont = f"{sid}:{int(time.time())}"
        store.setex(_continuation_key(sid), SESSION_TTL, cont)

        # inject gateway metadata before returning
        payload = orjson.loads(result.body)
        payload["qwen_gateway"] = {"session_id": sid, "continuation": cont}
        return JSONResponse(payload, headers={"X-Session-ID": sid})

    # For streaming, we can’t rewrite chunks easily; client keeps X-Session-ID.
    return result
