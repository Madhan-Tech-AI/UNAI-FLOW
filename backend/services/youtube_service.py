import os
import re
import httpx
import google.generativeai as genai
from typing import Dict, Any, Optional, List
from lib.supabase_client import supabase

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

class YouTubeService:
    """
    YouTube Ingestion and WhatsApp Content Generation Engine.
    Extracts rich video/channel metadata and uses Gemini AI to craft high-conversion WhatsApp broadcasts.
    """

    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        """Extracts 11-character YouTube video ID from various URL formats."""
        patterns = [
            r'(?:v=|\/)([0-9A-Za-z_-]{11}).*',
            r'(?:youtu\.be\/)([0-9A-Za-z_-]{11})',
            r'(?:shorts\/)([0-9A-Za-z_-]{11})',
            r'(?:embed\/)([0-9A-Za-z_-]{11})'
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    @staticmethod
    async def fetch_video_metadata(url: str) -> Dict[str, Any]:
        """Fetches metadata for a YouTube video using YouTube oEmbed and public endpoints."""
        video_id = YouTubeService.extract_video_id(url)
        clean_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else url

        async with httpx.AsyncClient(timeout=10.0) as client:
            # 1. Fetch oEmbed metadata
            oembed_url = f"https://www.youtube.com/oembed?url={clean_url}&format=json"
            resp = await client.get(oembed_url)
            
            title = "New YouTube Video"
            author = "YouTube Creator"
            thumbnail = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg" if video_id else ""

            if resp.status_code == 200:
                data = resp.json()
                title = data.get("title", title)
                author = data.get("author_name", author)
                thumbnail = data.get("thumbnail_url", thumbnail)

            # Fallback thumbnail if maxres doesn't exist
            if video_id and not thumbnail:
                thumbnail = f"https://img.youtube.com/vi/{video_id}/hqdefault.jpg"

            return {
                "video_id": video_id,
                "url": clean_url,
                "title": title,
                "author": author,
                "thumbnail_url": thumbnail,
                "extracted_at": httpx.__name__
            }

    @staticmethod
    async def generate_whatsapp_content(metadata: Dict[str, Any], custom_instructions: Optional[str] = None) -> str:
        """
        Uses Gemini AI to generate a WhatsApp-optimized broadcast post:
        - Hook first
        - Short paragraphs (under 400 chars recommended)
        - Bullet highlights
        - Strong CTA + Emojis
        - Link inclusion
        """
        title = metadata.get("title", "")
        author = metadata.get("author", "")
        url = metadata.get("url", "")

        prompt = f"""
You are an expert social media manager writing a high-engagement WhatsApp Channel broadcast post for a newly published YouTube video.

Video Details:
- Title: {title}
- Channel: {author}
- URL: {url}
{f"Additional user instructions: {custom_instructions}" if custom_instructions else ""}

Strict Rules for WhatsApp Channel Posts:
1. Start with an exciting hook and relevant emoji (e.g. 🚀, 💡, 🔥).
2. Keep sentences punchy, conversational, and split into 2-3 very short paragraphs.
3. Use WhatsApp markdown formatting like *bold* for key takeaways and _italic_ for emphasis. Do NOT use markdown links like [text](url). Put raw URLs.
4. No hashtags (WhatsApp community posts should feel clean, not spammy).
5. End with a clear Call to Action (CTA) pointing to the link (e.g., "Watch the full breakdown now 👇\\n{url}").
6. Output ONLY the ready-to-publish WhatsApp message text.
"""
        try:
            model = genai.GenerativeModel('gemini-flash-latest')
            response = await model.generate_content_async(prompt)
            return response.text.strip()
        except Exception as e:
            print(f"Gemini generation fallback: {e}")
            return f"🚀 *New Video Released!*\n\n*{title}*\n\nWe just published a deep dive on {author}. Watch the full episode now 👇\n{url}"
