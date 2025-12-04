import asyncio
import time
import os
from statistics import median

from openai import AsyncOpenAI
from token_tracker import TokenUsageTracker

tracker = TokenUsageTracker()

# ------------------------------
# Config
# ------------------------------
API_KEY = os.getenv("OPENAI_API_KEY", "devkey")
BASE_URL = os.getenv("OPENAI_BASE", "https://8m6w52rqlqso7s-3000.proxy.runpod.net/v1")
MODEL = "Qwen/Qwen3-4B-Instruct-2507"

NUM_REQUESTS = int(os.getenv("BENCH_N", "20"))   # concurrent requests
MAX_TOKENS = int(os.getenv("BENCH_MAX_TOKENS", "256"))

client = AsyncOpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)


async def run_one(i: int):
    t0 = time.time()
    resp = await client.chat.completions.create(
        model=MODEL,
        messages=[...],
        max_tokens=MAX_TOKENS,
        temperature=0.7,
    )
    t1 = time.time()
    tracker.add_from_openai_usage(
        resp.usage,
        latency_seconds=t1 - t0,
        meta={"index": i, "endpoint": "non_stream"},
    )
    return {"ok": True, "latency": t1 - t0}


async def batch_main():
    print(f"Running {NUM_REQUESTS} concurrent non-streaming requests...\n")

    tasks = [asyncio.create_task(run_one(i)) for i in range(NUM_REQUESTS)]
    results = await asyncio.gather(*tasks)

    latencies = [r["latency"] for r in results if r["ok"]]
    total_tokens = sum(r["total_tokens"] for r in results if r["ok"])
    errors = [r for r in results if not r["ok"]]

    if not latencies:
        print("No successful responses.")
        if errors:
            print("Sample error:", errors[0])
        return

    latencies_sorted = sorted(latencies)
    p50 = median(latencies)
    p90 = latencies_sorted[int(0.9 * len(latencies_sorted)) - 1]
    p95 = latencies_sorted[int(0.95 * len(latencies_sorted)) - 1]

    avg = sum(latencies) / len(latencies)
    total_time = max(latencies)  # approx wall time with concurrent start
    throughput_tps = total_tokens / total_time if total_time > 0 else 0.0

    print("===== Non-Streaming Benchmark Results =====")
    print(f"Successful requests: {len(latencies)}/{NUM_REQUESTS}")
    print(f"Avg latency:   {avg:.3f}s")
    print(f"p50 latency:   {p50:.3f}s")
    print(f"p90 latency:   {p90:.3f}s")
    print(f"p95 latency:   {p95:.3f}s")
    print()
    print(f"Total tokens:  {total_tokens}")
    print(f"Throughput:    {throughput_tps:.2f} tokens/sec (aggregate)")
    print("Token summary:", tracker.summary())
    if errors:
        print(f"\nErrors: {len(errors)}")
        print("Sample error:", errors[0])
    print("===========================================")

async def single_main():
    output = await run_one(1)
    print(output)


if __name__ == "__main__":
    #asyncio.run(batch_main())
    asyncio.run(single_main())



