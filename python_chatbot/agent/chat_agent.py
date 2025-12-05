# agent_gateway_loop.py

import os
import json
import re

from openai import OpenAI

from agent.function_tools import FUNCTION_MAP, TOOLS, execute_function_call
from agent.primary_instructions import instructions

from token_tracker import TokenUsageTracker

tracker = TokenUsageTracker() 

# ------------------------------
# OpenAI client (your gateway)
# ------------------------------
API_KEY = os.getenv("OPENAI_API_KEY", "devkey")   # same as API_KEYS in gateway
BASE_URL = os.getenv("OPENAI_BASE", "https://1yfztt1w2bp124-3000.proxy.runpod.net/v1")
MODEL = os.getenv("MODEL_NAME", "Qwen/Qwen3-4B-Instruct-2507")

client = OpenAI(
    api_key=API_KEY,
    base_url=BASE_URL,
)


def extract_tool_calls(output_text: str):
    """Extract tool calls from model output using <tool_call>{...}</tool_call> blocks."""
    tool_calls = []
    pattern = r'<tool_call>\s*(\{.*?\})\s*</tool_call>'
    matches = re.findall(pattern, output_text, re.DOTALL)

    for match in matches:
        try:
            tool_call = json.loads(match)
            tool_calls.append(tool_call)
        except json.JSONDecodeError as e:
            print(f"Error parsing tool call: {e}")
            continue

    return tool_calls


def extract_assistant_response(output_text: str):
    """Extract assistant text, removing tool call blocks and special tokens."""
    cleaned_text = re.sub(r'<tool_call>.*?</tool_call>', '', output_text, flags=re.DOTALL)
    cleaned_text = re.sub(r'<\|im_end\|>|<\|im_start\|>', '', cleaned_text)
    return cleaned_text.strip()


def _chunk_to_text(delta) -> str:
    """
    Handle OpenAI ChatCompletionChunk delta.content, which can be:
    - a plain string, or
    - a list of content parts with type "text"
    """
    if delta is None:
        return ""

    content = getattr(delta, "content", None)
    if isinstance(content, str):
        return content

    # Newer clients: content is a list of parts
    text_parts = []
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                txt = part.get("text", {}).get("value", "")
                if txt:
                    text_parts.append(txt)
    return "".join(text_parts)


def call_model_with_tools_stream(messages, max_tokens: int = 512, temperature: float = 0.2) -> str:
    """
    Call your Qwen model via the OpenAI-compatible gateway in STREAMING mode.
    - Uses tools, but disables OpenAI-style auto tool_choice (we parse <tool_call> blocks ourselves).
    - Streams chunks to stdout as they arrive.
    - Returns the full concatenated text for tool-call parsing.
    """
    stream = client.chat.completions.create(
        model=MODEL,
        messages=messages,
        tools=TOOLS,           # still pass tools so Qwen sees schema
        tool_choice="none",    # we handle tool-calls manually via <tool_call>...</tool_call>
        max_tokens=max_tokens,
        temperature=temperature,
        stream=True,
    )

    full_text_chunks = []

    print("[Streaming from gateway...]\n", end="", flush=True)

    for event in stream:
        # Each event is a ChatCompletionChunk
        if not event.choices:
            continue

        delta = event.choices[0].delta
        piece = _chunk_to_text(delta)

        if piece:
            # print incremental piece for interactive feel
            print(piece, end="", flush=True)
            full_text_chunks.append(piece)

    print()  # newline after full streamed response

    return "".join(full_text_chunks)


def run_conversation_loop_http(initial_message: str | None = None):
    """
    Conversation loop using your vLLM + gateway endpoint.
    - Sends messages + tools to the model
    - Parses <tool_call> blocks
    - Executes tools and feeds results back
    - Interactively talks to the user via stdin/stdout
    """

    # Initial system + optional initial user message
    base_messages = [
        {"role": "system", "content": instructions},
    ]
    if initial_message:
        base_messages.append({"role": "user", "content": initial_message})

    messages = base_messages[:]

    while True:
        # If last message is not from user or tool, we need new user input
        last_role = messages[-1]["role"] if messages else None
        if last_role not in ("user", "tool"):
            user_input = input("\nYou: ").strip()
            if user_input.lower() in ("exit", "quit", "bye"):
                print("Ending conversation...")
                break

            messages.append({"role": "user", "content": user_input})

        print("\n[Generating response via gateway (streaming)...]")

        # ---- Call model through gateway (STREAMING) ----
        output_text = call_model_with_tools_stream(messages)

        print(f"\n[Raw Model Output Collected]: {output_text!r}")

        # ---- Parse tool calls + assistant text ----
        tool_calls = extract_tool_calls(output_text)
        assistant_text = extract_assistant_response(output_text)

        # Add assistant text message if present
        if assistant_text:
            messages.append({"role": "assistant", "content": assistant_text})
            print(f"\nAssistant (parsed): {assistant_text}")

        # If there are tool calls, execute them and append tool messages,
        # then continue loop WITHOUT asking user again.
        if tool_calls:
            print(f"\n[Found {len(tool_calls)} tool call(s)]")

            for tool_call in tool_calls:
                function_name = tool_call.get("name")
                arguments = tool_call.get("arguments", {})

                print(f"\n[Executing]: {function_name}")
                print(f"[Arguments]: {json.dumps(arguments, indent=2)}")

                try:
                    result = execute_function_call(function_name, arguments)
                    print(f"[Result]: {json.dumps(result, indent=2)}")

                    messages.append(
                        {
                            "role": "tool",
                            "name": function_name,
                            "content": json.dumps(result),
                        }
                    )
                except Exception as e:
                    error_result = {"error": str(e)}
                    print(f"[Error]: {error_result}")

                    messages.append(
                        {
                            "role": "tool",
                            "name": function_name,
                            "content": json.dumps(error_result),
                        }
                    )

            # After tools, go to next loop iteration; model needs to
            # process tool results and respond (no new user input yet).
            continue

        # No tool calls → now we wait for user input next iteration
        # (loop will prompt because last_role is 'assistant')


if __name__ == "__main__":
    run_conversation_loop_http()
