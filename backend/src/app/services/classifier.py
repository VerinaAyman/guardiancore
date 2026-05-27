"""Intelligent Content Classification Service.

Implements a two-layer approach for content analysis:
- Layer 1 (Fast Path): URL tokenization and keyword matching
- Layer 2 (Slow Path): Groq LLM for content analysis
"""

import os
import json
import httpx
import re
import logging
from typing import Optional

# ✅ FIX 1: Use AsyncGroq instead of Groq (sync client blocks async event loop)
from groq import AsyncGroq

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Slang / grooming keyword fast-path
# ─────────────────────────────────────────────
GROOMING_SLANG = {
    "sneaky link": "secret romantic partner",
    "irl": "in real life",
    "dont tell": "don't tell anyone",
    "don't tell": "don't tell anyone",
    "meet up": "meet in person",
    "meetup": "meet in person",
    "slide into": "contact privately",
    "slide in": "contact privately",
    "hmu": "hit me up / contact me",
    "wb": "write back",
    "wyd": "what are you doing",
    "wya": "where are you",
    "lmk": "let me know",
    "ngl": "not gonna lie",
    "fr": "for real",
    "lowkey": "secretly / somewhat",
    "no cap": "honestly / truthfully",
    "ghost": "stop responding suddenly",
    "ghosted": "stopped responding suddenly",
    "hit different": "feels special / different",
    "sus": "suspicious",
    "keep it on the dl": "keep it secret",
    "dl": "down-low / secret",
    "keep it between us": "keep it secret",
    "just us": "only the two of us",
    "come thru": "come over",
    "pull up": "come over",
    "link up": "meet up",
    "link": "meet up",
    "finesse": "manipulate / trick",
    "cap": "lie",
    "no 🧢": "no lie / honestly",
    "fwb": "friends with benefits",
    "talking to": "romantically interested in",
    "talking": "romantically involved",
    "situationship": "undefined romantic relationship",
    "body count": "number of sexual partners",
    "smash": "have sex with",
    "dtf": "down to have sex",
    "nudes": "nude photographs",
    "send nudes": "send nude photographs",
    "pics": "pictures",
    "thirst trap": "provocative photo for attention",
    "slide": "send (photos/messages)",
    "spill": "share secrets",
    "ratio": "get more responses than original",
    "caught feelings": "developed romantic feelings",
    "simping": "obsessing over someone",
    "rizz": "romantic charisma / charm",
    "shoot your shot": "make a romantic move",
    "ghosting": "disappearing without explanation",
    "breadcrumbing": "giving minimal attention to keep interest",
    "love bombing": "overwhelming with affection to manipulate",
}

GROOMING_RISK_PATTERNS = [
    r'\bsneaky\s*link\b',
    r'\bmeet\s*(up\s*)?(irl|in\s*real\s*life)\b',
    r"\bdon'?t\s+tell\s+(your\s+)?(mom|dad|parents?|anyone)\b",
    r'\bkeep\s+it\s+(between\s+us|secret|on\s+the\s+dl)\b',
    r'\bjust\s+(between\s+)?(us|you\s+and\s+me)\b',
    r'\bcome\s+(over|thru|through)\b',
    r'\bsend\s+(me\s+)?(pics?|photos?|nudes?)\b',
    r'\byou\s+look\s+(so\s+)?(hot|sexy|cute|beautiful)\b',
    r'\bhow\s+old\s+are\s+you\b',
    r'\bare\s+you\s+(home\s+)?alone\b',
    r'\bwhere\s+do\s+you\s+live\b',
    r'\bwhat\s+school\b',
]

HIGH_RISK_SITES = {
    'omegle.com', 'chatroulette.com', 'chaturbate.com', 'onlyfans.com',
    'pornhub.com', 'xvideos.com', 'xnxx.com', 'redtube.com',
    'youporn.com', 'tube8.com', '4chan.org', 'reddit.com/r/gonewild',
}

MEDIUM_RISK_SITES = {
    'discord.com', 'roblox.com', 'fortnite.com', 'twitch.tv',
    'tiktok.com', 'instagram.com', 'snapchat.com',
}


def expand_slang(text: str) -> str:
    """Expand known slang terms for better LLM analysis."""
    expanded = text
    for slang, meaning in GROOMING_SLANG.items():
        pattern = re.compile(re.escape(slang), re.IGNORECASE)
        expanded = pattern.sub(f"{slang} ({meaning})", expanded)
    return expanded


def fast_path_check(url: str, text: str) -> Optional[dict]:
    """Layer 1: fast keyword/pattern check before hitting Groq."""
    domain = ""
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        pass

    # High-risk site
    if any(h in domain for h in HIGH_RISK_SITES):
        return {
            "category": "adult_content",
            "confidence": 0.95,
            "action": "block",
            "safe": False,
            "reason": f"High-risk site: {domain}",
            "detected_patterns": [domain],
            "trigger_words": [domain],
            "parent_report": f"Attempted to access {domain}",
            "child_message": None,
        }

    # Grooming pattern match
    matched = []
    for pattern in GROOMING_RISK_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            matched.append(pattern)

    if len(matched) >= 2:
        return {
            "category": "grooming",
            "confidence": 0.80,
            "action": "warn",
            "safe": False,
            "reason": "Multiple grooming-related patterns detected",
            "detected_patterns": matched,
            "trigger_words": matched,
            "parent_report": "Possible grooming language detected in chat",
            "child_message": None,
        }

    return None  # proceed to slow path


class ContentClassifier:

    def __init__(self):
        self.groq_api_key = os.environ.get("GROQ_API_KEY")
        if not self.groq_api_key:
            logger.warning("[Classifier] No GROQ_API_KEY configured — LLM layer disabled")

    async def classify(
        self,
        url: str,
        text_content: str,
        child_age: int = 13,
        is_chat: bool = False,
    ) -> dict:
        """Full classification pipeline: fast path → Groq slow path."""

        # Layer 1
        fast = fast_path_check(url, text_content)
        if fast:
            logger.info(f"[Classifier] Fast-path hit: {fast['category']}")
            return fast

        # Layer 2
        if not self.groq_api_key:
            return self._safe_result()

        return await self._classify_with_groq(url, text_content, child_age, is_chat)

    async def _classify_with_groq(
        self,
        url: str,
        text_content: str,
        child_age: int = 13,
        is_chat: bool = False,
    ) -> dict:
        """Layer 2: Groq LLM classification."""

        expanded_text = expand_slang(text_content)

        context_type = "chat messages" if is_chat else "web page content"

        system_prompt = f"""You are a child safety AI assistant analyzing {context_type}.
The user is a child aged {child_age}.

Your job is to detect:
- grooming: adults trying to build inappropriate relationships, secrecy requests, meet-up requests, sexual language
- adult_content: pornographic or sexually explicit material
- violence: graphic violence or self-harm content
- bullying: cyberbullying or harassment
- drugs: drug use or sales

Respond ONLY with a valid JSON object — no markdown, no explanation, no preamble.

Required JSON keys:
{{
  "category": "grooming" | "adult_content" | "violence" | "bullying" | "drugs" | "safe",
  "risk_score": 0-10,
  "action": "none" | "warn" | "block",
  "reason": "one sentence explanation",
  "detected_patterns": ["list", "of", "specific", "phrases"],
  "trigger_words": ["exact", "words", "that", "triggered"],
  "parent_report": "summary for parent notification",
  "child_message": "optional supportive message to show the child, or null"
}}

Rules:
- risk_score 0-3 → action: none
- risk_score 4-6 → action: warn  
- risk_score 7-10 → action: block
- Be especially sensitive to: secret-keeping, meet-up requests, age/location questions, sexual language
- child_age {child_age}: apply age-appropriate sensitivity
"""

        user_prompt = f"""Analyze this {context_type} from {url}:

{expanded_text[:3000]}

Return JSON only."""

        try:
            # ✅ FIX 1: AsyncGroq client with await
            client = AsyncGroq(api_key=self.groq_api_key)
            response = await client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=512,
            )

            raw = response.choices[0].message.content.strip()
            logger.debug(f"[Classifier] Groq raw: {raw[:200]}")

            # Strip markdown fences if present
            cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
            cleaned = re.sub(r"\s*```$", "", cleaned).strip()

            groq_result = json.loads(cleaned)

            # ✅ FIX 2: Normalize risk_score from 0-10 to 0.0-1.0
            raw_score = groq_result.get("risk_score", 0)
            confidence = raw_score / 10.0 if raw_score > 1.0 else float(raw_score)

            action = groq_result.get("action", "none")
            category = groq_result.get("category", "safe")

            return {
                "category": category,
                "confidence": round(confidence, 3),
                "action": action,
                "safe": action == "none",
                "reason": groq_result.get("reason", ""),
                # ✅ FIX 3: Expose all fields background.js needs
                "detected_patterns": groq_result.get("detected_patterns", []),
                "trigger_words": groq_result.get("trigger_words", []),
                "parent_report": groq_result.get("parent_report", ""),
                "child_message": groq_result.get("child_message", None),
            }

        except json.JSONDecodeError as e:
            logger.error(f"[Classifier] JSON parse failed: {e} | raw: {raw[:300]}")
            return self._safe_result()
        except Exception as e:
            logger.error(f"[Classifier] Groq call failed: {e}")
            return self._safe_result()

    def _safe_result(self) -> dict:
        return {
            "category": "safe",
            "confidence": 0.0,
            "action": "none",
            "safe": True,
            "reason": "",
            "detected_patterns": [],
            "trigger_words": [],
            "parent_report": "",
            "child_message": None,
        }


# Singleton
classifier = ContentClassifier()