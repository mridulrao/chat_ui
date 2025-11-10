from openai import OpenAI
import os, time, sys

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "devkey"),
    base_url=os.getenv("OPENAI_BASE", "https://p9b75sb8chl5si-3000.proxy.runpod.net/v1"),
)

t0 = time.time()
ttft = None

# Use the 'stream=True' style for broad compatibility
stream = client.chat.completions.create(
    model="Qwen/Qwen3-4B-Instruct-2507",
    messages=[
        {"role": "system", "content": "You are a concise, helpful assistant."},
        {"role": "user", "content": "Explain KV caching like I'm five."},
    ],
    max_tokens=256,
    temperature=0.7,
    stream=True,  # <-- important
    stream_options={"include_usage": True},  # vLLM will send usage in the final event
)

completion_text = []
for event in stream:
    # OpenAI SDK yields "events" which can be chunks or final usage
    if event.choices and event.choices[0].delta and event.choices[0].delta.content:
        if ttft is None:
            ttft = time.time() - t0
        piece = event.choices[0].delta.content
        completion_text.append(piece)
        sys.stdout.write(piece)
        sys.stdout.flush()

# Some client versions expose final usage via '.usage' on the 'stream' iterator itself
# If not present, you can re-run the same prompt non-stream to get usage or rely on gateway logs
usage = getattr(stream, "usage", None)
if usage is None:
    # Newer clients: the last yielded item may have 'usage' on it.
    try:
        usage = event.usage  # type: ignore[attr-defined]
    except Exception:
        usage = None

t_end = time.time()
print("\n--- stream metrics ---")
if ttft is not None:
    print(f"TTFT: {ttft:.3f}s")
if usage:
    pt = usage.prompt_tokens or 0
    ct = usage.completion_tokens or 0
    gen_time = (t_end - t0 - (ttft or 0))
    tps = (ct / gen_time) if gen_time > 0 else None
    print(f"usage: prompt={pt}, completion={ct}, total={(usage.total_tokens or pt + ct)}")
    if tps is not None:
        print(f"throughput: {tps:.2f} tok/s")
else:
    print("usage: (not provided by server)")
