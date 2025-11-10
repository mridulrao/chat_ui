import os
from openai import OpenAI

# 1. Set the API Base URL to your RunPod Gateway URL + /v1
# Note: The 'v1' is part of the base_url, not the endpoint (though the proxy URL already has /v1)
# Using the full proxy URL (https://r9ucweto8md526-3000.proxy.runpod.net/v1) as the base should work
client = OpenAI(
    api_key="devkey",  # Uses the API_KEYS value from your env
    base_url="https://r9ucweto8md526-3000.proxy.runpod.net/v1",
)

# 2. Make the Chat Completion request
try:
    response = client.chat.completions.create(
        model="Qwen/Qwen3-4B-Instruct-2507",
        messages=[
            {"role": "user", "content": "Explain KV caching like you are explaining to a 5 year old"}
        ],
        max_tokens=1024,
        temperature=0.7
    )
    # 3. Print the result
    print("--- LLM Response ---")
    print(response.choices[0].message.content)

except Exception as e:
    print(f"An error occurred: {e}")