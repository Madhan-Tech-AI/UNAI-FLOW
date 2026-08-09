import os
import json
import google.generativeai as genai
from lib.supabase_client import supabase

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
genai_model = genai.GenerativeModel('gemini-1.5-flash')

with open(os.path.join(os.path.dirname(__file__), '../config/platform_rules.json'), 'r') as f:
    RULES = json.load(f)

async def generate_variants(automation_id: str, user_id: str):
    # 1. Fetch automation details
    res = supabase.table("automations").select("*").eq("id", automation_id).eq("user_id", user_id).single().execute()
    if not res.data:
        raise ValueError("Automation not found")
        
    automation = res.data
    raw_content = automation["raw_content"]
    tone = automation.get("tone", "professional")
    platforms = automation["target_platforms"]
    
    generated_variants = []

    for platform in platforms:
        if platform not in RULES:
            continue
            
        rule = RULES[platform]
        prompt = f"{rule['instructions']}\n\nTone: {tone}\n\nContent:\n{raw_content}"
        
        # Call Gemini API
        try:
            response = await genai_model.generate_content_async(prompt)
            generated_text = response.text.strip()
            
            # Simple validation logic
            char_count = len(generated_text)
            hashtags = [word for word in generated_text.split() if word.startswith('#')]
            
            if char_count > rule["max_length"]:
                # Corrective action: truncate or retry (simplifying to truncate for now)
                generated_text = generated_text[:rule["max_length"]-3] + "..."
                char_count = len(generated_text)
            
            if len(hashtags) > rule["max_hashtags"]:
                # Simply keep the text but in a real scenario we might re-prompt
                pass
                
            # Store in Supabase
            variant_data = {
                "automation_id": automation_id,
                "platform": platform,
                "generated_text": generated_text,
                "char_count": char_count,
                "hashtags": hashtags
            }
            
            variant_res = supabase.table("content_variants").insert(variant_data).execute()
            if variant_res.data:
                generated_variants.append(variant_res.data[0])
                
        except Exception as e:
            print(f"Error generating for {platform}: {e}")
            
    return generated_variants
