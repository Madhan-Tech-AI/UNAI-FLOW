import os
import json
import asyncio
import google.generativeai as genai
from lib.supabase_client import supabase

_genai_configured = False
_genai_model = None

def _get_model():
    global _genai_configured, _genai_model
    if not _genai_configured:
        api_key = os.getenv("GEMINI_API_KEY", "")
        if api_key:
            genai.configure(api_key=api_key)
        _genai_configured = True
    if _genai_model is None:
        _genai_model = genai.GenerativeModel('gemini-2.0-flash')
    return _genai_model

with open(os.path.join(os.path.dirname(__file__), '../config/platform_rules.json'), 'r') as f:
    RULES = json.load(f)

async def _generate_single_variant(automation_id: str, platform: str, raw_content: str, tone: str):
    rule = RULES.get(platform)
    if not rule:
        return None

    prompt = f"{rule['instructions']}\n\nTone: {tone}\n\nContent:\n{raw_content}"
    try:
        response = await _get_model().generate_content_async(prompt)
        generated_text = response.text.strip()

        char_count = len(generated_text)
        hashtags = [word for word in generated_text.split() if word.startswith('#')]

        if char_count > rule["max_length"]:
            generated_text = generated_text[:rule["max_length"]-3] + "..."
            char_count = len(generated_text)

        variant_data = {
            "automation_id": automation_id,
            "platform": platform,
            "generated_text": generated_text,
            "char_count": char_count,
            "hashtags": hashtags
        }

        variant_res = supabase.table("content_variants").insert(variant_data).execute()
        if variant_res.data:
            return variant_res.data[0]

    except Exception as e:
        print(f"Error generating for {platform}: {e}. Falling back to clean formatted template.")
        mock_text = f"{raw_content}\n\n#{platform.capitalize()} #UNAI"
        char_count = len(mock_text)
        hashtags = [f"#{platform.capitalize()}", "#UNAI"]

        variant_data = {
            "automation_id": automation_id,
            "platform": platform,
            "generated_text": mock_text,
            "char_count": char_count,
            "hashtags": hashtags
        }

        variant_res = supabase.table("content_variants").insert(variant_data).execute()
        if variant_res.data:
            return variant_res.data[0]

    return None

async def generate_variants(automation_id: str, user_id: str):
    # 1. Fetch automation details
    res = supabase.table("automations").select("*").eq("id", automation_id).eq("user_id", user_id).single().execute()
    if not res.data:
        raise ValueError("Automation not found")

    automation = res.data
    raw_content = automation["raw_content"]
    tone = automation.get("tone", "professional")
    platforms = automation["target_platforms"]

    # 2. Run all platform generations in parallel for fast response
    tasks = [
        _generate_single_variant(automation_id, platform, raw_content, tone)
        for platform in platforms
        if platform in RULES
    ]

    results = await asyncio.gather(*tasks, return_exceptions=True)
    generated_variants = [r for r in results if r and not isinstance(r, Exception)]

    return generated_variants
