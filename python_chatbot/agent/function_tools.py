import json
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

# ==================== DEMO FUNCTION IMPLEMENTATIONS ====================

def get_weather(location: str, date: Optional[str] = None) -> Dict[str, Any]:
    """Get weather information for a location
    
    Args:
        location: City name or location (e.g., "New York", "Tokyo, Japan")
        date: Optional date in YYYY-MM-DD format. If not provided, returns current weather.
    
    Returns:
        A JSON object containing weather information
    """
    # Mock weather data
    weather_conditions = ["Sunny", "Cloudy", "Rainy", "Partly Cloudy", "Thunderstorms"]
    import random
    
    condition = random.choice(weather_conditions)
    temp = random.randint(15, 30)
    humidity = random.randint(40, 80)
    
    weather_info = {
        "location": location,
        "date": date or datetime.now().strftime("%Y-%m-%d"),
        "temperature": f"{temp}°C",
        "condition": condition,
        "humidity": f"{humidity}%",
        "forecast": f"High: {temp+3}°C, Low: {temp-5}°C"
    }
    
    response = {"result": "success", "data": weather_info}
    return response


def set_reminder(title: str, datetime_str: str, notes: Optional[str] = None) -> Dict[str, Any]:
    """Set a reminder for a specific date and time
    
    Args:
        title: Title or description of the reminder
        datetime_str: Date and time in format "YYYY-MM-DD HH:MM" (24-hour format)
        notes: Optional additional notes for the reminder
    
    Returns:
        A JSON object confirming reminder creation
    """
    # Mock reminder creation
    reminder_id = f"REM{hash(title + datetime_str) % 10000:04d}"
    
    reminder_info = {
        "reminder_id": reminder_id,
        "title": title,
        "scheduled_for": datetime_str,
        "notes": notes or "No additional notes",
        "status": "active",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    response = {"result": "success", "message": f"Reminder '{title}' set successfully", "data": reminder_info}
    return response


def search_restaurants(cuisine: str, location: str, price_range: Optional[str] = "moderate") -> Dict[str, Any]:
    """Search for restaurants based on cuisine type and location
    
    Args:
        cuisine: Type of cuisine (e.g., "Italian", "Japanese", "Mexican", "Indian")
        location: City or neighborhood to search in
        price_range: Optional price range - "budget", "moderate", or "expensive"
    
    Returns:
        A JSON object containing list of restaurant recommendations
    """
    # Mock restaurant data
    restaurants = [
        {
            "name": f"The {cuisine} House",
            "rating": 4.5,
            "price_range": price_range,
            "address": f"123 Main St, {location}",
            "cuisine": cuisine,
            "phone": "+1-555-0123",
            "popular_dishes": ["Signature Special", "Chef's Recommendation", "House Favorite"]
        },
        {
            "name": f"{cuisine} Delights",
            "rating": 4.2,
            "price_range": price_range,
            "address": f"456 Oak Ave, {location}",
            "cuisine": cuisine,
            "phone": "+1-555-0456",
            "popular_dishes": ["Traditional Platter", "Fusion Special", "Tasting Menu"]
        },
        {
            "name": f"Authentic {cuisine} Kitchen",
            "rating": 4.7,
            "price_range": price_range,
            "address": f"789 Elm St, {location}",
            "cuisine": cuisine,
            "phone": "+1-555-0789",
            "popular_dishes": ["Classic Recipe", "Modern Twist", "Family Platter"]
        }
    ]
    
    response = {
        "result": "success",
        "search_params": {"cuisine": cuisine, "location": location, "price_range": price_range},
        "count": len(restaurants),
        "restaurants": restaurants
    }
    return response


def calculate_tip(bill_amount: float, tip_percentage: float, split_between: Optional[int] = 1) -> Dict[str, Any]:
    """Calculate tip and split bill among people
    
    Args:
        bill_amount: Total bill amount in dollars
        tip_percentage: Tip percentage (e.g., 15, 18, 20)
        split_between: Optional number of people to split the bill (default: 1)
    
    Returns:
        A JSON object with tip calculation breakdown
    """
    tip_amount = bill_amount * (tip_percentage / 100)
    total_with_tip = bill_amount + tip_amount
    per_person = total_with_tip / split_between
    
    calculation = {
        "original_bill": f"${bill_amount:.2f}",
        "tip_percentage": f"{tip_percentage}%",
        "tip_amount": f"${tip_amount:.2f}",
        "total_amount": f"${total_with_tip:.2f}",
        "split_between": split_between,
        "per_person": f"${per_person:.2f}"
    }
    
    response = {"result": "success", "calculation": calculation}
    return response


def convert_currency(amount: float, from_currency: str, to_currency: str) -> Dict[str, Any]:
    """Convert currency from one type to another
    
    Args:
        amount: Amount to convert
        from_currency: Source currency code (e.g., "USD", "EUR", "GBP", "JPY")
        to_currency: Target currency code
    
    Returns:
        A JSON object with conversion details
    """
    # Mock exchange rates (USD as base)
    exchange_rates = {
        "USD": 1.0,
        "EUR": 0.92,
        "GBP": 0.79,
        "JPY": 149.50,
        "CAD": 1.36,
        "AUD": 1.52,
        "INR": 83.12
    }
    
    # Convert to USD first, then to target currency
    if from_currency not in exchange_rates or to_currency not in exchange_rates:
        return {"result": "error", "message": f"Currency code not supported"}
    
    amount_in_usd = amount / exchange_rates[from_currency]
    converted_amount = amount_in_usd * exchange_rates[to_currency]
    exchange_rate = exchange_rates[to_currency] / exchange_rates[from_currency]
    
    conversion_info = {
        "original_amount": f"{amount:.2f} {from_currency}",
        "converted_amount": f"{converted_amount:.2f} {to_currency}",
        "exchange_rate": f"1 {from_currency} = {exchange_rate:.4f} {to_currency}",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    response = {"result": "success", "conversion": conversion_info}
    return response


def get_travel_time(origin: str, destination: str, mode: Optional[str] = "driving") -> Dict[str, Any]:
    """Calculate estimated travel time between two locations
    
    Args:
        origin: Starting location (city or address)
        destination: Destination location (city or address)
        mode: Travel mode - "driving", "walking", "transit", or "cycling"
    
    Returns:
        A JSON object with travel time estimates
    """
    # Mock travel time calculation
    base_times = {
        "driving": 45,
        "walking": 120,
        "transit": 60,
        "cycling": 90
    }
    
    import random
    base_time = base_times.get(mode, 45)
    estimated_time = base_time + random.randint(-10, 20)
    distance = round(estimated_time * 0.8, 1)  # Mock distance calculation
    
    travel_info = {
        "origin": origin,
        "destination": destination,
        "mode": mode,
        "estimated_time": f"{estimated_time} minutes",
        "distance": f"{distance} km",
        "best_route": "Via Main Highway",
        "traffic_conditions": random.choice(["Light", "Moderate", "Heavy"]),
        "departure_time": datetime.now().strftime("%H:%M"),
        "estimated_arrival": (datetime.now() + timedelta(minutes=estimated_time)).strftime("%H:%M")
    }
    
    response = {"result": "success", "travel_details": travel_info}
    return response


# ==================== FUNCTION TOOLS SCHEMA ====================

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather or forecast for a specific location. Use this when user asks about weather conditions, temperature, or forecast.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City name or location (e.g., 'New York', 'Tokyo, Japan')",
                    },
                    "date": {
                        "type": "string",
                        "description": "Optional date in YYYY-MM-DD format for future weather. If not provided, returns current weather.",
                    },
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_reminder",
            "description": "Create a reminder for a specific date and time. Use this when user wants to remember something or schedule a task.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title or description of the reminder (e.g., 'Doctor appointment', 'Call mom')",
                    },
                    "datetime_str": {
                        "type": "string",
                        "description": "Date and time in format 'YYYY-MM-DD HH:MM' using 24-hour format (e.g., '2024-12-15 14:30')",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Optional additional notes or details for the reminder",
                    },
                },
                "required": ["title", "datetime_str"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_restaurants",
            "description": "Find restaurants based on cuisine type, location, and price range. Use when user is looking for dining recommendations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "cuisine": {
                        "type": "string",
                        "description": "Type of cuisine (e.g., 'Italian', 'Japanese', 'Mexican', 'Indian', 'Chinese')",
                    },
                    "location": {
                        "type": "string",
                        "description": "City or neighborhood to search in",
                    },
                    "price_range": {
                        "type": "string",
                        "enum": ["budget", "moderate", "expensive"],
                        "description": "Price range for the restaurant (default: 'moderate')",
                    },
                },
                "required": ["cuisine", "location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_tip",
            "description": "Calculate tip amount and split bill among multiple people. Use when user needs help with bill calculation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "bill_amount": {
                        "type": "number",
                        "description": "Total bill amount in dollars (e.g., 85.50)",
                    },
                    "tip_percentage": {
                        "type": "number",
                        "description": "Tip percentage to calculate (e.g., 15, 18, 20)",
                    },
                    "split_between": {
                        "type": "integer",
                        "description": "Number of people to split the bill among (default: 1)",
                    },
                },
                "required": ["bill_amount", "tip_percentage"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "convert_currency",
            "description": "Convert money from one currency to another using current exchange rates. Use when user asks about currency conversion.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "Amount of money to convert",
                    },
                    "from_currency": {
                        "type": "string",
                        "description": "Source currency code (USD, EUR, GBP, JPY, CAD, AUD, INR)",
                    },
                    "to_currency": {
                        "type": "string",
                        "description": "Target currency code (USD, EUR, GBP, JPY, CAD, AUD, INR)",
                    },
                },
                "required": ["amount", "from_currency", "to_currency"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_travel_time",
            "description": "Calculate estimated travel time and distance between two locations. Use when user asks about travel duration or directions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {
                        "type": "string",
                        "description": "Starting location (city or address)",
                    },
                    "destination": {
                        "type": "string",
                        "description": "Destination location (city or address)",
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["driving", "walking", "transit", "cycling"],
                        "description": "Mode of transportation (default: 'driving')",
                    },
                },
                "required": ["origin", "destination"],
            },
        },
    },
]


# ==================== FUNCTION MAPPING ====================

FUNCTION_MAP = {
    "get_weather": get_weather,
    "set_reminder": set_reminder,
    "search_restaurants": search_restaurants,
    "calculate_tip": calculate_tip,
    "convert_currency": convert_currency,
    "get_travel_time": get_travel_time,
}


def execute_function_call(function_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a function call based on model's response"""
    if function_name in FUNCTION_MAP:
        func = FUNCTION_MAP[function_name]
        return func(**arguments)
    else:
        return {"result": "error", "message": f"Function {function_name} not found"}
