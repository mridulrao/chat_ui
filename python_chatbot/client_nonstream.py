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
# Single request wrapper
# ------------------------------
async def run_one(i: int):
    """Run one chat completion and return (latency, usage_stats)"""
    try:
        t0 = time.time()
        resp = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a concise, helpful assistant."},
                {"role": "user", "content": "Explain KV caching like I'm five."},
            ],
            max_tokens=MAX_TOKENS,
            temperature=0.7,
        )
        t1 = time.time()

        usage = resp.usage or {}
        return {
            "ok": True,
            "latency": t1 - t0,
            "prompt_tokens": usage.prompt_tokens or 0,
            "completion_tokens": usage.completion_tokens or 0,
            "total_tokens": usage.total_tokens or 0,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ------------------------------
# Main benchmark
# ------------------------------
async def main():
    print(f"Running {NUM_REQUESTS} concurrent requests...\n")

    tasks = [asyncio.create_task(run_one(i)) for i in range(NUM_REQUESTS)]
    results = await asyncio.gather(*tasks)

    latencies = [r["latency"] for r in results if r["ok"]]
    total_tokens = sum(r["total_tokens"] for r in results if r["ok"])

    if not latencies:
        print("No successful responses.")
        return

    # Compute stats
    latencies_sorted = sorted(latencies)
    p50 = median(latencies)
    p90 = latencies_sorted[int(0.9 * len(latencies_sorted))]
    p95 = latencies_sorted[int(0.95 * len(latencies_sorted))]

    avg = sum(latencies) / len(latencies)
    total_time = max(latencies)  # wall time ≈ slowest request
    throughput_tps = total_tokens / total_time

    # ------------------------------
    # Print results
    # ------------------------------
    print("===== Benchmark Results =====")
    print(f"Successful requests: {len(latencies)}/{NUM_REQUESTS}")
    print(f"Avg latency:   {avg:.3f}s")
    print(f"p50 latency:   {p50:.3f}s")
    print(f"p90 latency:   {p90:.3f}s")
    print(f"p95 latency:   {p95:.3f}s")
    print()
    print(f"Total tokens:  {total_tokens}")
    print(f"Throughput:    {throughput_tps:.2f} tokens/sec (aggregate)")
    print("=============================")


if __name__ == "__main__":
    asyncio.run(main())
