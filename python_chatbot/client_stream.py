import asyncio
import time
import os
from statistics import median

from openai import AsyncOpenAI

API_KEY = os.getenv("OPENAI_API_KEY", "devkey")
BASE_URL = os.getenv("OPENAI_BASE", "https://1yfztt1w2bp124-3000.proxy.runpod.net/v1")
MODEL = "Qwen/Qwen3-4B-Instruct-2507"

NUM_REQUESTS = int(os.getenv("BENCH_N", "2"))
MAX_TOKENS = int(os.getenv("BENCH_MAX_TOKENS", "256"))

client = AsyncOpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)


async def run_one_stream(i: int):
    """
    Run one streaming chat completion.
    Returns:
      {
        ok,
        latency,
        ttft,
        prompt_tokens,
        completion_tokens,
        total_tokens,
      }
    """
    try:
        t_start = time.time()
        ttft = None
        prompt_tokens = completion_tokens = total_tokens = 0

        stream = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": "You are a concise, helpful assistant."},
                {"role": "user", "content": "Explain KV caching like I'm five."},
            ],
            max_tokens=MAX_TOKENS,
            temperature=0.7,
            stream=True,
            stream_options={"include_usage": True},
        )

        async for event in stream:
            # event is a ChatCompletionChunk
            if ttft is None:
                # first real chunk that has any content
                for choice in event.choices:
                    delta = choice.delta
                    if (
                        delta.content
                        or delta.role
                        or (delta.tool_calls and len(delta.tool_calls) > 0)
                    ):
                        ttft = time.time() - t_start
                        break

            if hasattr(event, "usage") and event.usage is not None:
                u = event.usage
                prompt_tokens = u.prompt_tokens or 0
                completion_tokens = u.completion_tokens or 0
                total_tokens = u.total_tokens or 0

        t_end = time.time()

        return {
            "ok": True,
            "latency": t_end - t_start,
            "ttft": ttft,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


async def main():
    print(f"Running {NUM_REQUESTS} concurrent STREAMING requests...\n")

    tasks = [asyncio.create_task(run_one_stream(i)) for i in range(NUM_REQUESTS)]
    results = await asyncio.gather(*tasks)

    latencies = [r["latency"] for r in results if r["ok"]]
    ttfts = [r["ttft"] for r in results if r["ok"] and r["ttft"] is not None]
    total_tokens = sum(r["total_tokens"] for r in results if r["ok"])
    errors = [r for r in results if not r["ok"]]

    if not latencies:
        print("No successful responses.")
        if errors:
            print("Sample error:", errors[0])
        return

    lat_sorted = sorted(latencies)
    p50 = median(latencies)
    p90 = lat_sorted[int(0.9 * len(lat_sorted)) - 1]
    p95 = lat_sorted[int(0.95 * len(lat_sorted)) - 1]
    avg = sum(latencies) / len(latencies)

    total_time = max(latencies)
    throughput_tps = total_tokens / total_time if total_time > 0 else 0.0

    print("===== Streaming Benchmark Results =====")
    print(f"Successful requests: {len(latencies)}/{NUM_REQUESTS}")
    print(f"Avg latency:   {avg:.3f}s")
    print(f"p50 latency:   {p50:.3f}s")
    print(f"p90 latency:   {p90:.3f}s")
    print(f"p95 latency:   {p95:.3f}s")
    if ttfts:
        ttft_sorted = sorted(ttfts)
        ttft_p50 = median(ttfts)
        ttft_p90 = ttft_sorted[int(0.9 * len(ttft_sorted)) - 1]
        ttft_p95 = ttft_sorted[int(0.95 * len(ttft_sorted)) - 1]
        print()
        print(f"TTFT p50:      {ttft_p50:.3f}s")
        print(f"TTFT p90:      {ttft_p90:.3f}s")
        print(f"TTFT p95:      {ttft_p95:.3f}s")
    print()
    print(f"Total tokens:  {total_tokens}")
    print(f"Throughput:    {throughput_tps:.2f} tokens/sec (aggregate)")
    if errors:
        print(f"\nErrors: {len(errors)}")
        print("Sample error:", errors[0])
    print("=======================================")


if __name__ == "__main__":
    asyncio.run(main())
