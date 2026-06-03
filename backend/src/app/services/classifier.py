"""Intelligent Content Classification Service.

Implements a two-layer approach for content analysis:
- Layer 1 (Fast Path): URL tokenization and keyword matching
- Layer 2 (Slow Path): Gemini LLM for content analysis
"""

import os
import json
import re
import logging
from typing import Optional

import google.generativeai as genai

logger = logging.getLogger(__name__)

GROOMING_SLANG = {
    "sneaky link": "secret romantic partner",
    "dont tell": "don't tell anyone",
    "don't tell": "don't tell anyone",
    "keep it on the dl": "keep it secret",
    "keep it between us": "keep it secret",
    "fwb": "friends with benefits",
    "body count": "number of sexual partners",
    "smash": "have sex with",
    "dtf": "down to have sex",
    "nudes": "nude photographs",
    "send nudes": "send nude photographs",
    "thirst trap": "provocative photo for attention",
    "love bombing": "overwhelming with affection to manipulate",
    "finesse": "manipulate / trick",
    "situationship": "undefined romantic relationship",
}

GROOMING_RISK_PATTERNS = [
    r'\bsneaky\s*link\b',
    r"\bdon'?t\s+tell\s+(your\s+)?(mom|dad|parents?|anyone)\b",
    r'\bkeep\s+it\s+(between\s+us|secret|on\s+the\s+dl)\b',
    r'\bjust\s+(between\s+)?(us|you\s+and\s+me)\b',
    r'\bsend\s+(me\s+)?(pics?|photos?|nudes?)\b',
    r'\bare\s+you\s+(home\s+)?alone\b',
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
    expanded = text
    for slang, meaning in GROOMING_SLANG.items():
        pattern = re.compile(re.escape(slang), re.IGNORECASE)
        expanded = pattern.sub(f"{slang} ({meaning})", expanded)
    return expanded


def fast_path_check(url: str, text: str) -> Optional[dict]:
    domain = ""
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        pass

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

    return None


class ContentClassifier:

    def __init__(self):
        self.gemini_api_key = os.environ.get("GEMINI_API_KEY")
        if not self.gemini_api_key:
            logger.warning("[Classifier] No GEMINI_API_KEY configured — LLM layer disabled")
        else:
            genai.configure(api_key=self.gemini_api_key)

    async def classify(
        self,
        url: str,
        text_content: str,
        child_age: int = 13,
        is_chat: bool = False,
    ) -> dict:
        fast = fast_path_check(url, text_content)
        if fast:
            logger.info(f"[Classifier] Fast-path hit: {fast['category']}")
            return fast

        if not self.gemini_api_key:
            return self._safe_result()

        return await self._classify_with_groq(url, text_content, child_age, is_chat)

    async def _classify_with_groq(
        self,
        url: str,
        text_content: str,
        child_age: int = 13,
        is_chat: bool = False,
    ) -> dict:
        expanded_text = expand_slang(text_content)
        context_type = "chat messages" if is_chat else "web page content"

        system_prompt = f"""You are a child safety AI assistant analyzing {context_type}.
The user is a child aged {child_age}.

Your job is to detect:
- grooming: adults trying to build inappropriate relationships, secrecy requests, sexual language
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
- child_age {child_age}: apply age-appropriate sensitivity
- A SINGLE ambiguous phrase (e.g. "meet up", "come over", "where do you live", "let's hang") is NEVER enough to warn or block on its own. Grooming requires a PATTERN of at least 2-3 concerning signals together in the same conversation.
- Concerning signal combinations that justify warn/block: (secrecy + meet-up), (age/location questions + sexual language), (isolation + flattery + gift offers), (explicit sexual language + minor).
- Casual everyday phrases with no other red flags → action: none, risk_score: 1-2. Examples: "let's meet up", "come over", "wyd", "where do you live", "how old are you", "are you home".
- Only flag grooming if the conversation shows a clear PATTERN of intent to isolate, sexualize, or physically meet a child deceptively.
- When in doubt, return action: none. False positives harm children more than false negatives for mild cases.
"""

        user_prompt = f"""Analyze this {context_type} from {url}:

{expanded_text[:3000]}

Return JSON only."""

        try:
            model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                system_instruction=system_prompt
            )
            response = await model.generate_content_async(user_prompt)
            raw = response.text.strip()
            logger.debug(f"[Classifier] Gemini raw: {raw[:200]}")

            cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
            cleaned = re.sub(r"\s*```$", "", cleaned).strip()

            gemini_result = json.loads(cleaned)

            raw_score = gemini_result.get("risk_score", 0)
            confidence = raw_score / 10.0 if raw_score > 1.0 else float(raw_score)

            action = gemini_result.get("action", "none")
            category = gemini_result.get("category", "safe")

            return {
                "category": category,
                "confidence": round(confidence, 3),
                "action": action,
                "safe": action == "none",
                "reason": gemini_result.get("reason", ""),
                "detected_patterns": gemini_result.get("detected_patterns", []),
                "trigger_words": gemini_result.get("trigger_words", []),
                "parent_report": gemini_result.get("parent_report", ""),
                "child_message": gemini_result.get("child_message", None),
            }

        except json.JSONDecodeError as e:
            logger.error(f"[Classifier] JSON parse failed: {e} | raw: {raw[:300]}")
            return self._safe_result()
        except Exception as e:
            logger.error(f"[Classifier] Gemini call failed: {e}")
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


classifier = ContentClassifier()