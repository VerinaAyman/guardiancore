"""Intelligent Content Classification Service.

Implements a two-layer approach for content analysis:
- Layer 1 (Fast Path): URL tokenization and keyword matching
- Layer 2 (Slow Path): Hugging Face Inference API for content analysis
"""

import os
import json
import httpx
import re
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse
from groq import Groq
from ..config import settings

logger = logging.getLogger(__name__)

# High-risk keywords for URL tokenization (fast path)
# Inspired by "Design of Kids-specific URL Classifier" paper
HIGH_RISK_KEYWORDS = {
    # Adult/NSFW content
    "xxx", "porn", "porno", "pornography", "adult", "nsfw", "sex", "sexy",
    "nude", "nudes", "naked", "erotic", "erotica", "hentai", "xvideos",
    "pornhub", "xnxx", "redtube", "youporn", "brazzers", "onlyfans",

    # Gambling - keywords
    "bet", "betting", "gamble", "gambling", "casino", "poker", "slots",
    "blackjack", "roulette", "baccarat", "sportsbook", "wager", "bookie",

    # Gambling - known sites/patterns
    "1xbet", "xbet", "bet365", "betway", "betfair", "pinnacle", "bovada",
    "draftkings", "fanduel", "pokerstars", "partypoker", "888poker",
    "unibet", "ladbrokes", "williamhill", "paddy", "paddypower", "betfred",
    "skybet", "coral", "betvictor", "sportingbet", "bwin", "parimatch",

    # Drugs/Substance abuse
    "drugs", "marijuana", "cannabis", "cocaine", "heroin", "meth",
    "weed", "420", "drugstore", "pharma",

    # Violence/Gore
    "gore", "violence", "brutal", "death", "murder", "torture", "kill",
    "bloody", "corpse", "beheading",

    # Hate/Extremism
    "hate", "racist", "nazi", "supremacist", "extremist", "terrorism",

    # Self-harm
    "suicide", "selfharm", "cutting", "anorexia", "bulimia",

    # Scams/Phishing
    "phishing", "scam", "fraud",
}


class ContentClassifier:
    """Two-layer content classification system."""

    # Model URLs for zero-shot classification (in order of preference)
    PRIMARY_MODEL = "https://api-inference.huggingface.co/models/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
    FALLBACK_MODEL = "https://api-inference.huggingface.co/models/cross-encoder/nli-distilroberta-base"

    def __init__(self):
        self.api_key = getattr(settings, 'HUGGINGFACE_API_KEY', None)
        self.timeout = 30.0

    def _tokenize_url(self, url: str) -> set:
        try:
            parsed = urlparse(url)
            url_string = f"{parsed.netloc}{parsed.path}".lower()
            tokens = re.split(r'[/.\-_?&=]', url_string)
            expanded_tokens = set()
            for token in tokens:
                if not token.strip():
                    continue
                expanded_tokens.add(token.strip())
                parts = re.split(r'(\d+)', token)
                for part in parts:
                    if part.strip():
                        expanded_tokens.add(part.strip())
                for keyword in HIGH_RISK_KEYWORDS:
                    if keyword in token and len(keyword) >= 3:
                        expanded_tokens.add(keyword)
            return expanded_tokens
        except Exception as e:
            logger.warning(f"[Classifier] URL tokenization failed: {e}")
            return set()

    def _check_url_keywords(self, url: str) -> Tuple[bool, Optional[str]]:
        tokens = self._tokenize_url(url)
        for token in tokens:
            if token in HIGH_RISK_KEYWORDS:
                logger.info(f"[Classifier] Fast path: URL blocked due to keyword '{token}'")
                return True, token
        return False, None

    async def _call_hf_model(self, model_url: str, text: str, headers: dict) -> Tuple[Optional[dict], int]:
        candidate_labels = ["safe", "unsafe", "adult", "toxic", "gambling", "violence"]
        payload = {
            "inputs": text,
            "parameters": {"candidate_labels": candidate_labels}
        }
        model_name = model_url.split("/")[-1]
        logger.info(f"[Classifier] Calling model: {model_name}")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(model_url, json=payload, headers=headers)
            logger.info(f"[Classifier] Model {model_name} responded with status: {response.status_code}")
            if response.status_code == 200:
                return response.json(), 200
            else:
                logger.warning(f"[Classifier] Model {model_name} error: {response.status_code} - {response.text[:200]}")
                return None, response.status_code

    async def _analyze_content_with_api(self, text: str) -> Tuple[bool, float, str]:
        if not self.api_key:
            logger.warning("[Classifier] No Hugging Face API key configured, skipping content analysis")
            return False, 0.0, ""

        truncated_text = text[:1000] if len(text) > 1000 else text
        if not truncated_text.strip():
            return False, 0.0, ""

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        models_to_try = [
            (self.PRIMARY_MODEL, "DeBERTa-v3-base-mnli"),
            (self.FALLBACK_MODEL, "nli-distilroberta-base")
        ]

        result = None
        used_model = None

        for model_url, model_name in models_to_try:
            try:
                logger.info(f"[Classifier] Attempting classification with {model_name}...")
                api_result, status_code = await self._call_hf_model(model_url, truncated_text, headers)
                if status_code == 200 and api_result:
                    result = api_result
                    used_model = model_name
                    logger.info(f"[Classifier] ✅ Successfully used model: {model_name}")
                    break
                elif status_code in (410, 503):
                    logger.warning(f"[Classifier] Model {model_name} unavailable (status {status_code}), trying fallback...")
                    continue
                else:
                    logger.warning(f"[Classifier] Model {model_name} failed (status {status_code}), trying fallback...")
                    continue
            except httpx.TimeoutException:
                logger.warning(f"[Classifier] Model {model_name} timed out, trying fallback...")
                continue
            except Exception as e:
                logger.error(f"[Classifier] Model {model_name} error: {e}, trying fallback...")
                continue

        if not result:
            logger.warning("[Classifier] All models failed, allowing content (fail-open)")
            return False, 0.0, ""

        try:
            if "labels" in result and "scores" in result:
                labels = result["labels"]
                scores = result["scores"]
                logger.info(f"[Classifier] Classification results from {used_model}:")
                for label, score in zip(labels[:5], scores[:5]):
                    logger.info(f"[Classifier]   - {label}: {score:.2%}")
                threshold = 0.6
                unsafe_labels = {"unsafe", "adult", "toxic", "gambling", "violence"}
                for label, score in zip(labels, scores):
                    if label.lower() in unsafe_labels and score >= threshold:
                        logger.info(f"[Classifier] ⚠️ Content flagged as '{label}' with confidence {score:.2%}")
                        return True, score, label
                for label, score in zip(labels, scores):
                    if label.lower() == "safe" and score < 0.3:
                        logger.info(f"[Classifier] ⚠️ Low 'safe' score ({score:.2%}) - content may be unsafe")
                        for l, s in zip(labels, scores):
                            if l.lower() != "safe" and s > 0.4:
                                return True, s, l
            return False, 0.0, ""
        except Exception as e:
            logger.error(f"[Classifier] Failed to parse API response: {e}")
            return False, 0.0, ""

    # ── FIX: correct indentation (was broken before) + added is_chat param ──
    async def _classify_with_groq(self, url: str, text_content: str, child_age: int = 13, is_chat: bool = False) -> dict:
        try:
            groq_api_key = os.environ.get('GROQ_API_KEY')
            if not groq_api_key:
                logger.warning("[Classifier] No Groq API key configured, skipping Groq analysis")
                return {}

            client = Groq(api_key=groq_api_key)

            if is_chat:
                system_prompt = """You are a child safety AI protecting children from online grooming and exploitation.

Your job is to analyze chat messages for grooming tactics, predatory behavior, and harmful intent — including when expressed in teen slang or casual language.

Grooming patterns to detect:
- Requesting images or videos ("send pics", "send me a fit check", "show me", "drop ur snap")
- Isolation tactics ("don't tell your mom", "keep it between us", "our secret", "don't snitch")
- Inappropriate intimacy ("you're so mature", "you're different from other kids", "I get you")
- Soliciting meetings ("wanna link", "meet up irl", "come through", "pull up")
- Coercion or bribery ("I'll pay you", "I'll give you", "if you do this for me")
- Age-inappropriate sexual content or innuendo
- Excessive flattery combined with secrecy
- Requests for personal information (address, school, location)

Slang awareness:
- "fit" or "fit check" = appearance/outfit (context matters)
- "link up" / "pull up" / "come through" = meet in person
- "snap" / "gram" / "tt" = social media handles
- "lowkey" / "no cap" = honestly/seriously
- "send it" / "drop it" = send content
- "fr fr" = for real (emphasis)
- "sus" = suspicious
- "ghost" = stop talking to someone
- "slide into DMs" = private message someone

Return a JSON object only:
{
  "category": "safe" | "grooming" | "explicit" | "coercion" | "isolation" | "solicitation",
  "risk_score": 0.0 to 1.0,
  "action": "none" | "warn" | "block",
  "reason": "one sentence explanation",
  "detected_patterns": ["list", "of", "patterns", "found"]
}

Rules:
- Single innocent messages = lower risk
- Combinations of patterns = higher risk
- Context matters: "send pics of your dog" is NOT the same as "send pics"
- When in doubt about child safety, lean toward warn rather than none"""

                user_prompt = f"""Analyze these chat messages for grooming or harmful intent.
Child age: {child_age}
URL/Platform: {url}

Messages:
{text_content[:1500]}

Return JSON only."""

            else:
                system_prompt = """You are a child safety content classifier.

Classify webpages for a child's age group. Consider both the URL and page content.

Return a JSON object only:
{
  "category": "safe" | "social media" | "gaming" | "streaming" | "adult content" | "violence" | "gambling" | "drugs" | "hate speech" | "self harm" | "chat" | "forums",
  "risk_score": 0.0 to 1.0,
  "action": "none" | "warn" | "block",
  "reason": "one sentence explanation"
}

Guidelines:
- Adult content, gambling, drugs, violence → block
- Social media, forums, chat platforms → warn (age dependent)
- Educational, news, entertainment → safe
- risk_score above 0.7 → block, 0.4-0.7 → warn, below 0.4 → none"""

                user_prompt = f"""Classify this webpage for a child aged {child_age}.
URL: {url}
Page text preview: {text_content[:800]}

Return JSON only."""

            response = client.chat.completions.create(
                model='llama-3.3-70b-versatile',
                messages=[
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt}
                ],
                temperature=0.1
            )

            raw = response.choices[0].message.content.strip()

            if raw.startswith('```'):
                raw = re.sub(r'^```(?:json)?\s*', '', raw)
                raw = re.sub(r'\s*```$', '', raw)
                raw = raw.strip()

            if not raw:
                logger.warning('[Classifier] Groq returned empty response')
                return {}

            groq_result = json.loads(raw)
            result = {
                'category': groq_result.get('category', ''),
                'confidence': groq_result.get('risk_score', 0),
                'action': groq_result.get('action', 'none'),
                'safe': groq_result.get('action', 'none') == 'none',
                'reason': groq_result.get('reason', ''),
                'detected_patterns': groq_result.get('detected_patterns', [])
            }
            logger.info(f"[Classifier] Groq classification: {result}")
            return result

        except Exception as e:
            logger.error(f"[Classifier] Groq classification failed: {e}")
            return {}

    # ── FIX: added is_chat param, passed through to _classify_with_groq ──
    async def predict(self, url: str, text_content: str = "", is_chat: bool = False) -> dict:
        result = {
            "safe": True,
            "blocked_by": None,
            "matched_keyword": None,
            "category": None,
            "confidence": 0.0,
            "action": "none"
        }

        # Layer 1: Fast path - URL keyword check (skip for chat)
        if not is_chat:
            is_url_unsafe, matched_keyword = self._check_url_keywords(url)
            if is_url_unsafe:
                result["safe"] = False
                result["blocked_by"] = "url_keywords"
                result["matched_keyword"] = matched_keyword
                result["category"] = "blocked_keyword"
                result["confidence"] = 0.3
                result["action"] = "block"
                return result

        # Layer 2: Groq classification (only if text provided)
        if text_content and text_content.strip():
            groq_result = await self._classify_with_groq(url, text_content, is_chat=is_chat)
            if groq_result:
                is_safe = groq_result.get('action', 'none') == 'none'
                result['safe'] = is_safe
                result['blocked_by'] = 'groq_classification'
                result['category'] = groq_result.get('category', '')
                result['confidence'] = groq_result.get('confidence', 0)
                result['action'] = groq_result.get('action', 'none')
                result['detected_patterns'] = groq_result.get('detected_patterns', [])
                return result

        # Layer 3: Slow path - HuggingFace fallback (only for page content, not chat)
        if not is_chat and text_content and text_content.strip():
            is_content_unsafe, confidence, category = await self._analyze_content_with_api(text_content)
            if is_content_unsafe:
                result["safe"] = False
                result["blocked_by"] = "content_analysis"
                result["category"] = category
                result["confidence"] = confidence
                result["action"] = "block"
                return result

        return result


# Singleton instance
classifier = ContentClassifier()