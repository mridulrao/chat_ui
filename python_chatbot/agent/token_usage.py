"""
conversation_token_test.py

Use your real chat transcript as sample input to /v1/tokens/count,
to approximate how many tokens this conversation used.
"""

import os
import json
from typing import Any, Dict, List

import requests

from agent.function_tools import TOOLS  # noqa: F401
from agent.primary_instructions import instructions


BASE_URL = os.getenv("GATEWAY_BASE_URL", "https://jtv5wqm28e3i4e-3000.proxy.runpod.net/v1")
API_KEY = os.getenv("GATEWAY_API_KEY", "devkey")
TOKEN_COUNT_URL = f"{BASE_URL.rstrip('/')}/tokens/count"


# ------------------------------
# 1. Build messages from your real chat
# ------------------------------
def build_system_content(include_tools: bool = True) -> str:
    """
    Build the system prompt. If include_tools=True, we also
    append the tools schema so its token cost is counted too.

    This should roughly match what you actually send to the model.
    """
    if not include_tools:
        return instructions

    tools_json = json.dumps(TOOLS, indent=2, ensure_ascii=False)
    return (
        instructions
        + "\n\nYou have access to the following tools. "
        + "Use them via function calls when appropriate:\n\n"
        + tools_json
    )


def build_conversation_messages(include_tools_in_system: bool = True) -> List[Dict[str, Any]]:
    """
    Reconstruct the conversation as OpenAI-style messages.

    This follows your transcript:

    You: hello
    Assistant: Hi there! ...
    You: Can you find me a good restaurant
    Assistant: Of course! Could you let me know...
    You: Italian
    Assistant: Great choice! ...
    You: I am looking in san jose
    Assistant: Perfect! I'll find you some great Italian restaurants...
    You: No specific budget
    Assistant: (tool call)
    Tool: (search_restaurants result)
    Assistant: Final restaurant list answer
    """
    system_content = build_system_content(include_tools=include_tools_in_system)

    # Assistant replies taken from your "Assistant (parsed)" lines
    a1 = (
        "Hi there! How can I assist you today? 😊 Whether it's finding a great restaurant, "
        "checking the weather, setting a reminder, or calculating a tip, I'm here to help!"
    )

    a2 = (
        "Of course! Could you let me know your preferred cuisine (like Italian, Japanese, "
        "Mexican, etc.), location (city or neighborhood), and if you have a budget preference "
        "(budget, moderate, or expensive)? That way, I can find something perfect for you! 🍽️"
    )

    a3 = (
        "Great choice! You'd love Italian food. Could you please tell me your location "
        "(like city or neighborhood) and if you'd prefer a budget, moderate, or expensive option? 😊"
    )

    a4 = (
        "Perfect! I'll find you some great Italian restaurants in San Jose. Do you have a "
        "preferred price range—budget, moderate, or expensive? That way, I can match you with "
        "the best options! 🍝🍕"
    )

    # Tool call content (as produced by the model)
    tool_call_text = (
        "<tool_call>\n"
        '{"name": "search_restaurants", "arguments": '
        '{"cuisine": "Italian", "location": "San Jose", "price_range": "moderate"}}\n'
        "</tool_call>"
    )

    # Tool result (what your code printed as [Result])
    tool_result = {
        "result": "success",
        "search_params": {
            "cuisine": "Italian",
            "location": "San Jose",
            "price_range": "moderate",
        },
        "count": 3,
        "restaurants": [
            {
                "name": "The Italian House",
                "rating": 4.5,
                "price_range": "moderate",
                "address": "123 Main St, San Jose",
                "cuisine": "Italian",
                "phone": "+1-555-0123",
                "popular_dishes": [
                    "Signature Special",
                    "Chef's Recommendation",
                    "House Favorite",
                ],
            },
            {
                "name": "Italian Delights",
                "rating": 4.2,
                "price_range": "moderate",
                "address": "456 Oak Ave, San Jose",
                "cuisine": "Italian",
                "phone": "+1-555-0456",
                "popular_dishes": [
                    "Traditional Platter",
                    "Fusion Special",
                    "Tasting Menu",
                ],
            },
            {
                "name": "Authentic Italian Kitchen",
                "rating": 4.7,
                "price_range": "moderate",
                "address": "789 Elm St, San Jose",
                "cuisine": "Italian",
                "phone": "+1-555-0789",
                "popular_dishes": [
                    "Classic Recipe",
                    "Modern Twist",
                    "Family Platter",
                ],
            },
        ],
    }

    tool_result_text = json.dumps(tool_result, indent=2, ensure_ascii=False)

    final_answer = (
        "Here are three highly-rated Italian restaurants in San Jose for you to enjoy:\n\n"
        "1. **The Italian House**  \n"
        "   🌟 Rating: 4.5/5  \n"
        "   📍 Address: 123 Main St, San Jose  \n"
        "   📞 Phone: +1-555-0123  \n"
        "   🍝 Popular Dishes: Signature Special, Chef's Recommendation, House Favorite  \n\n"
        "2. **Italian Delights**  \n"
        "   🌟 Rating: 4.2/5  \n"
        "   📍 Address: 456 Oak Ave, San Jose  \n"
        "   📞 Phone: +1-555-0456  \n"
        "   🍝 Popular Dishes: Traditional Platter, Fusion Special, Tasting Menu  \n\n"
        "3. **Authentic Italian Kitchen**  \n"
        "   🌟 Rating: 4.7/5  \n"
        "   📍 Address: 789 Elm St, San Jose  \n"
        "   📞 Phone: +1-555-0789  \n"
        "   🍝 Popular Dishes: Classic Recipe, Modern Twist, Family Platter  \n\n"
        "All are in the moderate price range—perfect for a delicious Italian meal! "
        "Let me know if you'd like help with reservations or more details! 😊🍝"
    )

    messages: List[Dict[str, Any]] = [
        # System prompt
        {"role": "system", "content": system_content},

        # Turn 1
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": a1},

        # Turn 2
        {"role": "user", "content": "Can you find me a good restaurant"},
        {"role": "assistant", "content": a2},

        # Turn 3
        {"role": "user", "content": "Italian"},
        {"role": "assistant", "content": a3},

        # Turn 4
        {"role": "user", "content": "I am looking in san jose"},
        {"role": "assistant", "content": a4},

        # Turn 5
        {"role": "user", "content": "No specific budget"},

        # Assistant tool call (how your model responded)
        {"role": "assistant", "content": tool_call_text},

        # Tool result message (what you passed back to the model)
        {
            "role": "tool",
            "name": "search_restaurants",
            "content": tool_result_text,
        },

        # Final assistant answer
        {"role": "assistant", "content": final_answer},
    ]

    return messages


# ------------------------------
# 2. Call /v1/tokens/count
# ------------------------------
def call_token_count(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"messages": messages}

    resp = requests.post(TOKEN_COUNT_URL, headers=headers, json=payload, timeout=60)
    resp.raise_for_status()
    return resp.json()


# ------------------------------
# 3. Run test
# ------------------------------
def main():
    print(f"Using BASE_URL={BASE_URL}")
    print(f"Using API_KEY={API_KEY}")
    print(f"Endpoint={TOKEN_COUNT_URL}\n")

    messages = build_conversation_messages(include_tools_in_system=True)
    result = call_token_count(messages)

    print("=== Token usage for this conversation ===")
    print(f"Model:           {result['model']}")
    print(f"Total tokens:    {result['total_tokens']}")
    print(f"Text tokens:     {result.get('text_tokens')}")
    print(f"Messages tokens: {result.get('messages_tokens')}\n")

    print("Per-message breakdown:")
    for m in result.get("per_message", []) or []:
        idx = m["index"]
        role = m["role"]
        tokens = m["tokens"]
        chars = m["chars"]
        print(f"  [{idx:2}] role={role:10} tokens={tokens:5} chars={chars}")

    print("\nNote:")
    print("- This is an approximation of *context* tokens for the final state of the conversation.")
    print("- The gateway counts tokens over `messages` only; actual runtime usage also includes "
          "internal formatting and possibly the tools schema if you pass it via `tools=`.")


if __name__ == "__main__":
    main()
