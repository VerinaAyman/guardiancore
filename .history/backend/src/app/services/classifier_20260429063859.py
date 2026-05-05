"""Intelligent Content Classification Service.

Implements a two-layer approach for content analysis:
- Layer 1 (Fast Path): URL tokenization and keyword matching
- Layer 2 (Slow Path): Hugging Face Inference API for content analysis
"""

import httpx
import re
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse
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

# Categories for classification
UNSAFE_CATEGORIES = [
    "nsfw",
    "adult content",
    "pornography", 
    "violence",
    "gore",
    "hate speech",
    "gambling",
    "drugs",
    "self-harm",
    "toxic content"
]
# Domain-based categories (Layer 0)
DOMAIN_CATEGORIES = {
    'twitch.tv': ('streaming', 0.85),
    'youtube.com': ('video', 0.85),
    'tiktok.com': ('social media', 0.90),
    'instagram.com': ('social media', 0.90),
    'twitter.com': ('social media', 0.90),
    'x.com': ('social media', 0.90),
    'reddit.com': ('forums', 0.90),
    'discord.com': ('chat', 0.85),
    'roblox.com': ('gaming', 0.85),
    'snapchat.com': ('social media', 0.90),
    'facebook.com': ('social media', 0.90),
    'netflix.com': ('streaming', 0.85),
    'chatroulette.com': ('chat', 0.95),
    'pornhub.com': ('adult content', 0.99),
    'bet365.com': ('gambling', 0.99),
}


class ContentClassifier:
    """Two-layer content classification system."""
    
    # Model URLs for zero-shot classification (in order of preference)
    PRIMARY_MODEL = "https://api-inference.huggingface.co/models/MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"
    FALLBACK_MODEL = "https://api-inference.huggingface.co/models/cross-encoder/nli-distilroberta-base"
    
    def __init__(self):
        self.api_key = getattr(settings, 'HUGGINGFACE_API_KEY', None)
        self.timeout = 30.0  # 30 seconds timeout for API calls
    
    def _tokenize_url(self, url: str) -> set:
        """
        Tokenize URL into individual tokens for keyword matching.
        Splits by common delimiters and also separates numbers from letters.
        """
        try:
            parsed = urlparse(url)
            # Combine hostname and path for tokenization
            url_string = f"{parsed.netloc}{parsed.path}".lower()
            
            # Split by common delimiters
            tokens = re.split(r'[/.\-_?&=]', url_string)
            
            # Further split alphanumeric tokens (e.g., "1xbet" -> "1", "xbet", "x", "bet")
            expanded_tokens = set()
            for token in tokens:
                if not token.strip():
                    continue
                expanded_tokens.add(token.strip())
                
                # Split by number-letter boundaries (e.g., "1xbet" -> ["1", "xbet"])
                parts = re.split(r'(\d+)', token)
                for part in parts:
                    if part.strip():
                        expanded_tokens.add(part.strip())
                
                # Also try to find known keywords as substrings
                for keyword in HIGH_RISK_KEYWORDS:
                    if keyword in token and len(keyword) >= 3:
                        expanded_tokens.add(keyword)
            
            return expanded_tokens
        except Exception as e:
            logger.warning(f"[Classifier] URL tokenization failed: {e}")
            return set()
    
    def _check_url_keywords(self, url: str) -> Tuple[bool, Optional[str]]:
        """
        Layer 1 (Fast Path): Check URL tokens against high-risk keywords.
        Returns (is_unsafe, matched_keyword)
        """
        tokens = self._tokenize_url(url)
        
        for token in tokens:
            if token in HIGH_RISK_KEYWORDS:
                logger.info(f"[Classifier] Fast path: URL blocked due to keyword '{token}'")
                return True, token
        
        return False, None
    
    async def _call_hf_model(self, model_url: str, text: str, headers: dict) -> Tuple[Optional[dict], int]:
        """
        Call a specific Hugging Face model.
        Returns (result_dict, status_code)
        """
        # Simplified candidate labels for better compatibility
        candidate_labels = ["safe", "unsafe", "adult", "toxic", "gambling", "violence"]
        
        payload = {
            "inputs": text,
            "parameters": {
                "candidate_labels": candidate_labels
            }
        }
        
        model_name = model_url.split("/")[-1]
        logger.info(f"[Classifier] Calling model: {model_name}")
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                model_url,
                json=payload,
                headers=headers
            )
            
            logger.info(f"[Classifier] Model {model_name} responded with status: {response.status_code}")
            
            if response.status_code == 200:
                return response.json(), 200
            else:
                logger.warning(f"[Classifier] Model {model_name} error: {response.status_code} - {response.text[:200]}")
                return None, response.status_code
    
    async def _analyze_content_with_api(self, text: str) -> Tuple[bool, float, str]:
        """
        Layer 2 (Slow Path): Analyze content using Hugging Face Inference API.
        Uses zero-shot classification to detect unsafe categories.
        Implements fallback logic if primary model fails.
        Returns (is_unsafe, confidence, detected_category)
        """
        if not self.api_key:
            logger.warning("[Classifier] No Hugging Face API key configured, skipping content analysis")
            return False, 0.0, ""
        
        # Truncate text to avoid token limits (keep first 1000 chars)
        truncated_text = text[:1000] if len(text) > 1000 else text
        
        if not truncated_text.strip():
            return False, 0.0, ""
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Try models in order of preference
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
                    # 410 = Gone (model unavailable), 503 = Loading
                    logger.warning(f"[Classifier] Model {model_name} unavailable (status {status_code}), trying fallback...")
                    continue
                else:
                    # Other errors, try fallback
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
        
        # Parse zero-shot classification results
        # Result format: {"sequence": "...", "labels": [...], "scores": [...]}
        try:
            if "labels" in result and "scores" in result:
                labels = result["labels"]
                scores = result["scores"]
                
                logger.info(f"[Classifier] Classification results from {used_model}:")
                for label, score in zip(labels[:5], scores[:5]):
                    logger.info(f"[Classifier]   - {label}: {score:.2%}")
                
                # Check for unsafe categories with high confidence
                threshold = 0.6  # Slightly lower threshold for better detection
                unsafe_labels = {"unsafe", "adult", "toxic", "gambling", "violence"}
                
                for label, score in zip(labels, scores):
                    if label.lower() in unsafe_labels and score >= threshold:
                        logger.info(f"[Classifier] ⚠️ Content flagged as '{label}' with confidence {score:.2%}")
                        return True, score, label
                
                # Also check if "safe" has LOW confidence (meaning it's likely unsafe)
                for label, score in zip(labels, scores):
                    if label.lower() == "safe" and score < 0.3:
                        # If "safe" score is very low, it's suspicious
                        logger.info(f"[Classifier] ⚠️ Low 'safe' score ({score:.2%}) - content may be unsafe")
                        # Find the highest non-safe score
                        for l, s in zip(labels, scores):
                            if l.lower() != "safe" and s > 0.4:
                                return True, s, l
            
            return False, 0.0, ""
            
        except Exception as e:
            logger.error(f"[Classifier] Failed to parse API response: {e}")
            return False, 0.0, ""
    
    async def predict(self, url: str, text_content: str = "") -> dict:
        """
        Main prediction method implementing two-layer classification.
        
        Args:
            url: The URL to analyze
            text_content: Optional page text content
            
        Returns:
            dict with keys:
                - safe: bool (True if content is safe)
                - blocked_by: str (what layer blocked it: "url_keywords", "content_analysis", or None)
                - matched_keyword: str or None
                - category: str or None (detected category)
                - confidence: float (0-1 confidence score)
        """
        result = {
            "safe": True,
            "blocked_by": None,
            "matched_keyword": None,
            "category": None,
            "confidence": 0.0
        }
        # Layer 0: Known domain categorization
        try:
            from urllib.parse import urlparse as _urlparse
            hostname = _urlparse(url).netloc.replace('www.', '')
            for domain, (category, confidence) in DOMAIN_CATEGORIES.items():
                if hostname == domain or hostname.endswith('.' + domain):
                    result['safe'] = False
                    result['blocked_by'] = 'domain_category'
                    result['category'] = category
                    result['confidence'] = confidence
                    return result
        except Exception:
            pass
        
        # Layer 1: Fast path - URL keyword check
        is_url_unsafe, matched_keyword = self._check_url_keywords(url)
        if is_url_unsafe:
            result["safe"] = False
            result["blocked_by"] = "url_keywords"
            result["matched_keyword"] = matched_keyword
            result["category"] = "blocked_keyword"
            result["confidence"] = 0.3
            return result
        
        # Layer 2: Slow path - Content analysis (only if text provided)
        if text_content and text_content.strip():
            is_content_unsafe, confidence, category = await self._analyze_content_with_api(text_content)
            if is_content_unsafe:
                result["safe"] = False
                result["blocked_by"] = "content_analysis"
                result["category"] = category
                result["confidence"] = confidence
                return result
        
        return result


# Singleton instance
classifier = ContentClassifier()

