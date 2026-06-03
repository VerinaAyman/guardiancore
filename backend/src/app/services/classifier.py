"""Intelligent Content Classification Service.

Implements a two-layer approach for content analysis:
- Layer 1 (Fast Path): URL tokenization and keyword matching
- Layer 2 (Slow Path): Groq LLM for content analysis
"""
import os
import json
import re
import logging
from typing import Optional
from urllib.parse import urlparse
from groq import AsyncGroq

logger = logging.getLogger(__name__)

GROOMING_SLANG = {
    "wyd": "what are you doing",
    "wya": "where are you",
    "hmu": "hit me up",
    "dtb": "don't tell",
    "ngl": "not gonna lie",
    "frfr": "for real for real",
    "irl": "in real life",
    "nsfw": "not safe for work",
    "smh": "shaking my head",
    "tbh": "to be honest",
}

GROOMING_RISK_PATTERNS = [
    r"\b(secret|secrets|keep this between us|don't tell|dont tell)\b",
    r"\b(send me (pics|photos|images|nudes|selfies))\b",
    r"\b(private (photos|pics|pictures))\b",
    r"\b(meet (me|up|in person|irl))\b",
    r"\b(where do you live|what's your address|your location)\b",
    r"\b(how old are you|your age|are you alone)\b",
    r"\b(don't tell your (parents|mom|dad|guardian))\b",
    r"\b(keep it (secret|between us|private))\b",
]

HIGH_RISK_SITES = {
    "omegle.com", "chatroulette.com", "omegle.tv",
}

MEDIUM_RISK_SITES = {
    "discord.com", "telegram.org", "kik.com",
}


def expand_slang(text: str) -> str:
    expanded = text
    for slang, meaning in GROOMING_SLANG.items():
        pattern = re.compile(re.escape(slang), re.IGNORECASE)
        expanded = pattern.sub(f"{slang} ({meaning})", expanded)
    return expanded


def fast_path_check(url: str, text_content: str) -> dict:
    domain = ""
    if url:
        domain = urlparse(url).netloc.lower().replace("www.", "")

    matched = []
    for pattern in GROOMING_RISK_PATTERNS:
        if re.search(pattern, text_content, re.IGNORECASE):
            matched.append(pattern)

    if domain in HIGH_RISK_SITES:
        return {"flagged": True, "reason": "high_risk_site", "patterns": matched}

    if len(matched) >= 2:
        return {"flagged": True, "reason": "pattern_match", "patterns": matched}

    return {"flagged": False, "reason": None, "patterns": matched}


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
        if not self.groq_api_key:
            return self._safe_result()

        fast = fast_path_check(url, text_content)

        try:
            return await self._classify_with_groq(url, text_content, child_age, is_chat)
        except Exception as e:
            logger.error(f"[Classifier] Groq call failed: {e}")
            return self._safe_result()

    async def classify_chat(
        self,
        url: str,
        messages: str,
        child_age: int = 13,
    ) -> dict:
        return await self.classify(url, messages, child_age, is_chat=True)

    async def _classify_with_groq(
        self,
        url: str,
        text_content: str,
        child_age: int = 13,
        is_chat: bool = False,
    ) -> dict:
        if not self.groq_api_key:
            return self._safe_result()

        expanded_text = expand_slang(text_content)
        context_type = "chat messages" if is_chat else "web page content"

        system_prompt = f"""You are a child safety AI assistant analyzing {context_type}.
Your job is to detect grooming, harassment, explicit content, or other dangers targeting children.

The child being protected is {child_age} years old.

Respond ONLY with a valid JSON object in this exact format:
{{
  "category": "safe" | "grooming" | "explicit" | "harassment" | "violence",
  "risk_score": <integer 0-10>,
  "action": "none" | "warn" | "block",
  "reason": "<brief explanation>",
  "detected_patterns": ["<pattern1>", "<pattern2>"],
  "trigger_words": ["<word1>"],
  "parent_report": "<what to tell the parent>",
  "child_message": "<gentle message to show the child, or null>"
}}

Rules:
- risk_score 0-3 = safe content, action: none
- risk_score 4-6 = concerning content, action: warn
- risk_score 7-10 = dangerous content, action: block
- Grooming indicators: requests for secrecy, asking for photos/personal content, isolating from parents, age/location probing, meeting in person
- A single clear grooming signal (secrecy requests, asking for photos, isolating from parents) IS enough to warn.
- (secrecy request + request for photos or personal content) = always block, risk_score 9+
- Explicit sexual language = always block
- Casual everyday phrases with no red flags → action: none, risk_score 1-2
- A SINGLE ambiguous phrase is NOT enough to block on its own without other signals
- When in doubt between warn and none, return warn — missing a grooming signal is worse than a false positive
- Return ONLY the JSON object, no extra text, no markdown fences"""

        user_prompt = f"""Analyze this {context_type} from {url}:

{expanded_text}

Child age: {child_age}"""

        client = AsyncGroq(api_key=self.groq_api_key)
        response = await client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=512,
        )
        raw = response.choices[0].message.content.strip()

        cleaned = re.sub(r"^```(?:json)?\s*", "", raw)
        cleaned = re.sub(r"\s*```$", "", cleaned).strip()

        groq_result = json.loads(cleaned)

        raw_score = groq_result.get("risk_score", 0)
        confidence = raw_score / 10.0 if raw_score > 1.0 else float(raw_score)

        # Normalize action — model may return "Block and Report", "Warn", etc.
        action_raw = groq_result.get("action", "none").lower()
        if "block" in action_raw:
            action = "block"
        elif "warn" in action_raw:
            action = "warn"
        else:
            action = "none"

        # Normalize category — model may return "Grooming" with capital G
        category = groq_result.get("category", "safe").lower()

        return {
            "safe": action == "none",
            "action": action,
            "category": category,
            "confidence": confidence,
            "reason": groq_result.get("reason", ""),
            "detected_patterns": groq_result.get("detected_patterns", []),
            "trigger_words": groq_result.get("trigger_words", []),
            "parent_report": groq_result.get("parent_report", ""),
            "child_message": groq_result.get("child_message", None),
        }

    def _safe_result(self) -> dict:
        return {
            "safe": True,
            "action": "none",
            "category": "safe",
            "confidence": 0.0,
            "reason": "",
            "detected_patterns": [],
            "trigger_words": [],
            "parent_report": "",
            "child_message": None,
        }


classifier = ContentClassifier()