"""Shared Gemini client singleton for the production (DEMO_MODE=false) path."""
from google import genai

import config

_client: genai.Client | None = None


def get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client
