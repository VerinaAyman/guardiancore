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


class ContentClassifier:
    """Two-layer content classification system."""
    
    def __init__(self):
        self.api_key = getattr(settings, 'HUGGINGFACE_API_KEY', None)
        self.api_url = "https://api-inference.huggingface.co/models/facebook/bart-large-mnli"
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
    
    async def _analyze_content_with_api(self, text: str) -> Tuple[bool, float, str]:
        """
        Layer 2 (Slow Path): Analyze content using Hugging Face Inference API.
        Uses zero-shot classification to detect unsafe categories.
        Returns (is_unsafe, confidence, detected_category)
        """
        if not self.api_key:
            logger.warning("[Classifier] No Hugging Face API key configured, skipping content analysis")
            return False, 0.0, ""
        
        # Truncate text to avoid token limits (keep first 1000 chars)
        truncated_text = text[:1000] if len(text) > 1000 else text
        
        if not truncated_text.strip():
            return False, 0.0, ""
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "inputs": truncated_text,
                "parameters": {
                    "candidate_labels": UNSAFE_CATEGORIES,
                    "multi_label": True
                }
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.api_url,
                    json=payload,
                    headers=headers
                )
                
                if response.status_code == 503:
                    # Model is loading, fail-open
                    logger.warning("[Classifier] HF model is loading, allowing content (fail-open)")
                    return False, 0.0, ""
                
                if response.status_code != 200:
                    logger.error(f"[Classifier] HF API error: {response.status_code} - {response.text}")
                    return False, 0.0, ""
                
                result = response.json()
                
                # Parse zero-shot classification results
                # Result format: {"sequence": "...", "labels": [...], "scores": [...]}
                if "labels" in result and "scores" in result:
                    labels = result["labels"]
                    scores = result["scores"]
                    
                    # Check if any unsafe category has high confidence (>0.7)
                    threshold = 0.7
                    for label, score in zip(labels, scores):
                        if score >= threshold:
                            logger.info(f"[Classifier] Content classified as '{label}' with confidence {score:.2f}")
                            return True, score, label
                
                return False, 0.0, ""
                
        except httpx.TimeoutException:
            logger.warning("[Classifier] HF API timeout, allowing content (fail-open)")
            return False, 0.0, ""
        except Exception as e:
            logger.error(f"[Classifier] HF API error: {e}")
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
        
        # Layer 1: Fast path - URL keyword check
        is_url_unsafe, matched_keyword = self._check_url_keywords(url)
        if is_url_unsafe:
            result["safe"] = False
            result["blocked_by"] = "url_keywords"
            result["matched_keyword"] = matched_keyword
            result["category"] = "blocked_keyword"
            result["confidence"] = 1.0
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

