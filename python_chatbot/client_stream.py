import asyncio
import time
import os
from statistics import median

from openai import AsyncOpenAI

# ------------------------------
# Config
# ------------------------------
API_KEY = os.getenv("OPENAI_API_KEY", "devkey")
BASE_URL = os.getenv("OPENAI_BASE", "http://localhost:3000/v1")
MODEL = "Qwen/Qwen3-4B-Instruct-2507"

# number of concurrent requests
NUM_REQUESTS = int(os.getenv("BENCH_N", "20"))   # e.g., 20 parallel
MAX_TOKENS = 256

client = AsyncOpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)

# ------------------------------
# Single streaming request
# ------------------------------
async def run_one_stream(i: int):
    """
    Run one streaming chat completion and return:
    - latency (end-to-end)
    - ttft (time to first token)
    - usage (prompt / completion / total tokens)
    """
    try:
        t0 = time.time()
        first_token_time = None
        last_chunk = None

        stream = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a concise, helpful assistant."},
                {"role": "user", "content": "Explain KV caching like I'm five."},
            ],
            max_tokens=MAX_TOKENS,
            temperature=0.7,
            stream=True,
            stream_options={"include_usage": True},  # gateway + vLLM will pass usage on last chunk
        )

        async for chunk in stream:
            # Record TTFT when we see the first non-empty delta
            if first_token_time is None:
                try:
                    choices = chunk.choices or []
                    if choices:
                        delta = choices[0].delta
                        has_content = bool(
                            (getattr(delta, "content", None) not in (None, "")) or
                            getattr(delta, "tool_calls", None)
                        )
                        if has_content:
                            first_token_time = time.time()
                except Exception:
                    # if anything weird, just ignore and keep streaming
                    pass

            last_chunk = chunk

        t1 = time.time()
        latency = t1 - t0
        ttft = (first_token_time - t0) if first_token_time is not None else None

        # usage should appear on the last chunk if include_usage=True
        usage = None
        if last_chunk is not None:
            usage = getattr(last_chunk, "usage", None)

        prompt_tokens = (usage.prompt_tokens if usage and usage.prompt_tokens else 0)
        completion_tokens = (usage.completion_tokens if usage and usage.completion_tokens else 0)
        total_tokens = (usage.total_tokens if usage and usage.total_tokens else
                        (prompt_tokens + completion_tokens))

        return {
            "ok": True,
            "latency": latency,
            "ttft": ttft,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


# ------------------------------
# Main benchmark
# ------------------------------
async def main():
    print(f"Running {NUM_REQUESTS} concurrent *streaming* requests...\n")

    tasks = [asyncio.create_task(run_one_stream(i)) for i in range(NUM_REQUESTS)]
    results = await asyncio.gather(*tasks)

    latencies = [r["latency"] for r in results if r["ok"]]
    ttfts = [r["ttft"] for r in results if r["ok"] and r["ttft"] is not None]
    total_tokens = sum(r["total_tokens"] for r in results if r["ok"])

    if not latencies:
        print("No successful responses.")
        return

    # Compute latency stats
    latencies_sorted = sorted(latencies)
    p50 = median(latencies)
    p90 = latencies_sorted[int(0.9 * len(latencies_sorted))]
    p95 = latencies_sorted[int(0.95 * len(latencies_sorted))]

    avg = sum(latencies) / len(latencies)
    total_time = max(latencies)  # wall time ≈ slowest request
    throughput_tps = total_tokens / total_time if total_time > 0 else 0.0

    # TTFT stats (if available)
    if ttfts:
        ttfts_sorted = sorted(ttfts)
        ttft_p50 = median(ttfts)
        ttft_p90 = ttfts_sorted[int(0.9 * len(ttfts_sorted))]
        ttft_p95 = ttfts_sorted[int(0.95 * len(ttfts_sorted))]
        ttft_avg = sum(ttfts) / len(ttfts)
    else:
        ttft_p50 = ttft_p90 = ttft_p95 = ttft_avg = None

    # ------------------------------
    # Print results
    # ------------------------------
    print("===== Streaming Benchmark Results =====")
    print(f"Successful requests: {len(latencies)}/{NUM_REQUESTS}")
    print(f"Avg latency:   {avg:.3f}s")
    print(f"p50 latency:   {p50:.3f}s")
    print(f"p90 latency:   {p90:.3f}s")
    print(f"p95 latency:   {p95:.3f}s")
    print()

    if ttfts:
        print(f"Avg TTFT:      {ttft_avg:.3f}s")
        print(f"p50 TTFT:      {ttft_p50:.3f}s")
        print(f"p90 TTFT:      {ttft_p90:.3f}s")
        print(f"p95 TTFT:      {ttft_p95:.3f}s")
        print()
    else:
        print("TTFT:          (no TTFT measurements captured)")
        print()

    print(f"Total tokens:  {total_tokens}")
    print(f"Throughput:    {throughput_tps:.2f} tokens/sec (aggregate)")
    print("=======================================")


if __name__ == "__main__":
    asyncio.run(main())
