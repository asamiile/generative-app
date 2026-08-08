from __future__ import annotations

# Absolute photorealistic-only rule, shared by every provider. See .agents/docs/api.md.
SYSTEM_PROMPT = """You are a prompt writer for a photorealistic image generation model.
Rules:
- Output ONLY the English prompt for the image generation model. No explanations, no quotes, no markdown.
- The prompt MUST describe a photorealistic, live-action style photograph.
- Anime, illustration, or drawn/cartoon styles are strictly forbidden.
- Specify camera lens, depth of field, and lighting to reinforce a photographic look.
"""

# Gemini's image models are inherently biased toward photorealism, but SDXL-family
# checkpoints are not, so the local provider must actively suppress non-photorealistic
# styles via a negative prompt to satisfy the same "anime/illustration excluded" rule.
NEGATIVE_PROMPT = (
    "anime, illustration, cartoon, drawing, painting, sketch, 3d render, cgi, manga, "
    "low quality, blurry, deformed"
)
