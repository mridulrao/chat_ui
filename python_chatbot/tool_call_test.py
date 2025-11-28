from openai import OpenAI
import os, json, time, random

client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY", "devkey"),
    base_url=os.getenv("OPENAI_BASE", "https://p9b75sb8chl5si-3000.proxy.runpod.net/v1"),
)

# ------------------------------------------------------------------
# Define Tool Specs
# ------------------------------------------------------------------

tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather information for a location.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string"}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_exchange_rate",
            "description": "Get exchange rate from one currency to another.",
            "parameters": {
                "type": "object",
                "properties": {
                    "base": {"type": "string"},
                    "target": {"type": "string"},
                },
                "required": ["base", "target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_books",
            "description": "Search books by topic.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "generate_password",
            "description": "Generate a random secure password.",
            "parameters": {
                "type": "object",
                "properties": {
                    "length": {"type": "integer"},
                    "symbols": {"type": "boolean"},
                    "numbers": {"type": "boolean"},
                },
                "required": ["length"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_distance",
            "description": "Calculate rough distance between two cities.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city1": {"type": "string"},
                    "city2": {"type": "string"},
                },
                "required": ["city1", "city2"],
            },
        },
    },
]


# ------------------------------------------------------------------
# Mock Tool Implementations
# ------------------------------------------------------------------

def run_tool(name, args):
    if name == "get_weather":
        return {"forecast": f"Sunny in {args['location']} with 24°C"}

    if name == "get_exchange_rate":
        return {"rate": 0.92, "converted": 100 * 0.92}  # mock conversion

    if name == "search_books":
        return {
            "books": [
                "Deep Work – Cal Newport",
                "Atomic Habits – James Clear",
                "The Pomodoro Technique – Cirillo",
            ]
        }

    if name == "generate_password":
        chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        if args.get("numbers"):
            chars += "0123456789"
        if args.get("symbols"):
            chars += "!@#$%^&*()_-+=<>?"
        pwd = "".join(random.choice(chars) for _ in range(args["length"]))
        return {"password": pwd}

    if name == "calculate_distance":
        return {"distance_km": 878}  # just mock value

    return {"error": "unknown tool"}


# ------------------------------------------------------------------
# Run Multi-turn Chat with Tool Invocation
# ------------------------------------------------------------------

messages = [
    {"role": "system", "content": "You are a concise, helpful assistant."},
    {"role": "user", "content": "I'm travelling to Paris next week. How's the weather there?"}
]

for turn in range(5):
    # Send request to model
    print(f"\n=== Turn {turn+1} ===")

    resp = client.chat.completions.create(
        model="Qwen/Qwen3-4B-Instruct-2507",
        messages=messages,
        tools=tools,
        tool_choice="auto",
        temperature=0.3,
    )

    msg = resp.choices[0].message
    print("Assistant:", msg)

    # Case 1: model calls a tool
    if msg.tool_calls:
        for tool_call in msg.tool_calls:
            name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)

            print(f"--> Model requested tool: {name}({args})")

            # Run the tool
            tool_result = run_tool(name, args)

            # Add tool result to messages
            messages.append(msg)
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": json.dumps(tool_result),
            })
    else:
        # Final response
        print("\nFinal Assistant:", msg.content)
        break

