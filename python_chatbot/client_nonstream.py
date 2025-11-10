from openai import OpenAI
import os, time

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "devkey"),
    base_url=os.getenv("OPENAI_BASE", "https://p9b75sb8chl5si-3000.proxy.runpod.net/v1"),
)

t0 = time.time()
resp = client.chat.completions.create(
    model="Qwen/Qwen3-4B-Instruct-2507",
    messages=[
        {"role": "system", "content": "You are a concise, helpful assistant."},
        {"role": "user", "content": "Explain KV caching like I'm five."},
    ],
    max_tokens=256,
    temperature=0.7,
)
t1 = time.time()

print(resp.choices[0].message.content)
usage = resp.usage or {}
print("usage:", dict(prompt=usage.prompt_tokens, completion=usage.completion_tokens, total=usage.total_tokens))
print(f"latency: {t1 - t0:.3f}s")
