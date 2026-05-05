"""
GuardianLens 4-Phase Content Analysis Pipeline

Phase 1: Morphological Cleaning  — fastText + ekphrasis slang normalisation
Phase 2: Contextual Risk Engine  — RoBERTa intent detection
Phase 3: Rationale Extraction    — SHAP explainability
Phase 4: Tiered Narrative        — Claude-generated parent/child explanation
"""

import logging
import re
import numpy as np
from ekphrasis.classes.preprocessor import TextPreProcessor
from ekphrasis.classes.tokenizer import SocialTokenizer
from ekphrasis.dicts.emoticons import emoticons
from transformers import pipeline as hf_pipeline, AutoTokenizer, AutoModelForSequenceClassification
import shap
import anthropic
from ..config import settings

logger = logging.getLogger(__name__)

# All models start as None — loaded in background after startup
text_processor = None
tokenizer = None
roberta = None
classifier = None

ROBERTA_MODEL = "unitary/toxic-bert"

# ── Risk thresholds ────────────────────────────────────────────────────────────
BLOCK_THRESHOLD = 0.4   # above this → full block (red)
WARN_THRESHOLD  = 0.15  # above this → orange bubble warning


# ── Fallback keyword scorer — used when RoBERTa models aren't loaded yet ──────
# Gives a real confidence score so the warn bubble fires even before ML is ready
ADULT_KEYWORDS = {
    # High risk (score contribution: 0.35 each, cap 0.95)
    "porn": 0.35, "pornography": 0.35, "xxx": 0.35, "nude": 0.30,
    "naked": 0.28, "hentai": 0.35, "explicit": 0.25, "nsfw": 0.30,
    "onlyfans": 0.35, "sex": 0.25, "sexual": 0.25, "erotic": 0.30,
    "rape": 0.40, "molestation": 0.40,
    # Medium risk (0.20 each)
    "adult": 0.20, "mature": 0.18, "18+": 0.22, "violence": 0.20,
    "gore": 0.25, "drugs": 0.22, "weed": 0.18, "cocaine": 0.30,
    "gambling": 0.20, "casino": 0.18, "alcohol": 0.15, "dating": 0.15,
    # Self-harm
    "suicide": 0.35, "self-harm": 0.35, "kms": 0.35, "kys": 0.35,
    # Hate / harassment
    "hate": 0.20, "racist": 0.28, "slur": 0.25,
}

def keyword_score(text: str) -> tuple[float, str, list[str]]:
    """
    Fast keyword-based scorer used when ML models aren't loaded.
    Returns (confidence, label, trigger_words).
    """
    text_lower = text.lower()
    score = 0.0
    found = []
    label = "safe"

    for keyword, weight in ADULT_KEYWORDS.items():
        # whole-word match to avoid false positives (e.g. "class" containing "ass")
        if re.search(rf"\b{re.escape(keyword)}\b", text_lower):
            score += weight
            found.append(keyword)
            if weight >= 0.28:
                label = "adult_content" if "sex" in keyword or keyword in ("nude","naked","porn","xxx","hentai","erotic","nsfw","onlyfans") else "restricted"
            elif label == "safe":
                label = "mature_content"

    score = min(score, 0.95)  # cap at 95%
    return score, label, found[:5]


def load_models():
    global text_processor, tokenizer, roberta, classifier
    logger.info("[Pipeline] Loading all models in background...")

    text_processor = TextPreProcessor(
        normalize=["url", "email", "percent", "money", "phone", "time", "date", "number"],
        annotate={"hashtag", "allcaps", "elongated", "repeated", "emphasis", "censored"},
        fix_html=True,
        segmenter="twitter",
        corrector="twitter",
        unpack_hashtags=True,
        unpack_contractions=True,
        spell_correct_aggressiveness=0.2,
        tokenizer=SocialTokenizer(lowercase=True).tokenize,
        dicts=[emoticons]
    )

    tokenizer = AutoTokenizer.from_pretrained(ROBERTA_MODEL)
    roberta = AutoModelForSequenceClassification.from_pretrained(ROBERTA_MODEL)
    classifier = hf_pipeline(
        "text-classification",
        model=roberta,
        tokenizer=tokenizer,
        return_all_scores=True,
        truncation=True,
        max_length=512
    )
    logger.info("[Pipeline] All models loaded and ready!")


# ─── Phase 4 setup: Anthropic client ─────────────────────────────────────────
anthropic_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Morphological Cleaning
# ─────────────────────────────────────────────────────────────────────────────
def phase1_clean(raw_text: str) -> str:
    if text_processor is None:
        logger.warning("[Phase1] Models not ready yet, using raw text")
        return raw_text
    try:
        tokens = text_processor.pre_process_doc(raw_text[:2000])
        cleaned = " ".join(tokens)
        logger.info(f"[Phase1] Cleaned text length: {len(cleaned)}")
        return cleaned
    except Exception as e:
        logger.warning(f"[Phase1] Failed, using raw text: {e}")
        return raw_text


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — Contextual Risk Engine
# ─────────────────────────────────────────────────────────────────────────────
def phase2_detect_risk(cleaned_text: str) -> dict:
    # ✅ FIX: when ML models aren't loaded, use keyword scorer instead of returning 0
    if classifier is None:
        logger.warning("[Phase2] ML models not ready — using keyword fallback scorer")
        score, label, found = keyword_score(cleaned_text)
        logger.info(f"[Phase2-fallback] score={score:.2%} | label={label} | found={found}")
        return {
            "is_risky": score >= BLOCK_THRESHOLD,
            "label": label,
            "confidence": score,
            "all_scores": {"keyword_fallback": round(score, 4)},
            "fallback": True
        }

    try:
        results = classifier(cleaned_text[:512])
        scores = results[0]
        top = max(scores, key=lambda x: x["score"])
        logger.info(f"[Pipeline] toxic-bert top score: {top['label']} = {top['score']:.4f}")
        is_risky = top["score"] >= BLOCK_THRESHOLD

        logger.info(f"[Phase2] Top label: {top['label']} ({top['score']:.2%}) | is_risky: {is_risky}")
        return {
            "is_risky": is_risky,
            "label": top["label"],
            "confidence": top["score"],
            "all_scores": {s["label"]: round(s["score"], 4) for s in scores},
            "fallback": False
        }
    except Exception as e:
        logger.error(f"[Phase2] Risk detection failed: {e}")
        # Last resort — still try keyword scoring
        score, label, _ = keyword_score(cleaned_text)
        return {"is_risky": score >= BLOCK_THRESHOLD, "label": label, "confidence": score, "all_scores": {}, "fallback": True}


# ─────────────────────────────────────────────────────────────────────────────
# SLANG NORMALISER
# ─────────────────────────────────────────────────────────────────────────────
SLANG_MAP = {
    "kms": "kill myself",
    "kys": "kill yourself",
    "kmd": "kill me dead",
    "dead": "very funny",
    "dying": "laughing hard",
    "kill it": "succeed",
    "killing it": "succeeding",
    "slay": "do very well",
    "slaying": "doing very well",
    "ded": "laughing hard",
    "im done": "laughing hard",
    "wtf": "surprised",
    "omfg": "very surprised",
    "i hate this": "i dislike this",
    "this is cancer": "this is annoying",
    "cancer": "annoying",
    "trash": "bad quality",
    "rekt": "defeated",
    "destroyed": "defeated in game",
    "murdered": "defeated in game",
}

HUMAN_CATEGORY_LABELS = {
    "blocked_keyword":    "Harmful language",
    "hate_speech":        "Hate speech",
    "self_harm":          "Self-harm content",
    "violence":           "Violent content",
    "adult_content":      "Adult content",
    "mature_content":     "Mature content",
    "grooming":           "Unsafe contact patterns",
    "cyberbullying":      "Bullying or harassment",
    "drug_content":       "Drug-related content",
    "restricted":         "Restricted content",
}

def normalise_slang(text: str) -> str:
    words = text.lower().split()
    normalised = []
    i = 0
    while i < len(words):
        if i < len(words) - 1:
            bigram = words[i].strip(".,!?;:'\"") + " " + words[i+1].strip(".,!?;:'\"")
            if bigram in SLANG_MAP:
                normalised.append(SLANG_MAP[bigram])
                i += 2
                continue
        word = words[i].strip(".,!?;:'\"")
        normalised.append(SLANG_MAP.get(word, words[i]))
        i += 1
    return " ".join(normalised)

def get_human_category(raw_category: str) -> str:
    return HUMAN_CATEGORY_LABELS.get(raw_category, raw_category.replace("_", " ").title())


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Rationale Extraction
# ─────────────────────────────────────────────────────────────────────────────
def phase3_extract_rationale(cleaned_text: str, top_n: int = 5) -> list[str]:
    STOPWORDS = {"the", "a", "an", "is", "it", "to", "and", "or", "of", "in",
                 "you", "i", "my", "we", "this", "that", "was", "are", "be"}
    TOXIC_KEYWORDS = {
        "kill", "hate", "die", "dead", "hurt", "attack", "destroy", "stupid",
        "ugly", "idiot", "loser", "dumb", "trash", "worthless", "violent",
        "punch", "shoot", "stab", "rape", "abuse", "threat", "bomb", "gun",
        "drugs", "porn", "naked", "sex", "nude", "kms", "kys",
    }
    TOKEN_LABELS = {
        "kms":  "kms (self-harm slang)",
        "kys":  "kys (self-harm slang)",
        "kill": "kill (violent language)",
        "hate": "hate (harmful language)",
        "rape": "rape (sexual violence)",
        "bomb": "bomb (threat language)",
        "porn": "porn (adult content)",
        "nude": "nude (adult content)",
        "naked":"naked (adult content)",
    }

    try:
        normalised_text = normalise_slang(cleaned_text)
        words = normalised_text.lower().split()
        original_words = cleaned_text.lower().split()

        found = []
        seen = set()

        for word in original_words:
            clean = word.strip(".,!?;:'\"")
            if clean in TOXIC_KEYWORDS and clean not in seen:
                found.append(TOKEN_LABELS.get(clean, clean))
                seen.add(clean)

        for word in words:
            if len(found) >= top_n:
                break
            clean = word.strip(".,!?;:'\"")
            if len(clean) > 4 and clean not in STOPWORDS and clean not in seen:
                found.append(clean)
                seen.add(clean)

        logger.info(f"[Phase3] Top trigger tokens: {found[:top_n]}")
        return found[:top_n]
    except Exception as e:
        logger.warning(f"[Phase3] Failed, returning empty: {e}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 4 — Tiered Narrative Generation
# ─────────────────────────────────────────────────────────────────────────────
def phase4_generate_narrative(
    original_text: str,
    risk_label: str,
    confidence: float,
    trigger_words: list[str],
    child_age: int = 13
) -> dict:
    if child_age < 10:
        stage = 1
        child_message = "Hey! We noticed this page had some content that isn't right for kids. It's totally okay — just close it and tell a grown-up you trust. You didn't do anything wrong! 😊"
    elif child_age < 13:
        stage = 2
        child_message = f"We flagged this page because it contained some unkind or unsafe content. It's like how some books aren't meant for your age yet — this page is one of those. You can talk to a parent about it if you're curious!"
    elif child_age < 16:
        stage = 3
        child_message = f"This page was flagged because our system detected potentially harmful content ({risk_label}). We respect that you can make your own decisions, but wanted to make sure you're aware. Feel free to talk to a trusted adult if you have questions."
    else:
        stage = 4
        child_message = f"This page was flagged for {risk_label} content ({confidence:.0%} confidence). You're old enough to understand why certain content can be harmful. If you think this was a mistake, let your parent know."

    trigger_str = ", ".join(trigger_words) if trigger_words else "overall content pattern"
    parent_report = (
        f"GuardianLens detected {risk_label.upper()} content with {confidence:.0%} confidence. "
        f"Key trigger words identified: {trigger_str}. "
        f"Your child (age {child_age}, Stage {stage}) attempted to access this content. "
        f"Conversation starter: 'I noticed you visited a page that was flagged — can we talk about what you were looking for?'"
    )

    return {
        "stage": stage,
        "parent_report": parent_report,
        "child_message": child_message
    }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE — chains all 4 phases
# ─────────────────────────────────────────────────────────────────────────────
async def run_pipeline(raw_text: str, child_age: int = 13) -> dict:
    logger.info("[Pipeline] Starting 4-phase analysis...")

    cleaned = phase1_clean(raw_text)
    risk    = phase2_detect_risk(cleaned)

    # Always extract trigger words if confidence is meaningful
    trigger_words = []
    if risk["confidence"] >= WARN_THRESHOLD:
        trigger_words = phase3_extract_rationale(cleaned)

    # Generate narrative
    narrative = {"stage": 1, "parent_report": "", "child_message": ""}
    if risk["is_risky"]:
        narrative = phase4_generate_narrative(
            original_text=raw_text,
            risk_label=get_human_category(risk["label"]),
            confidence=risk["confidence"],
            trigger_words=trigger_words,
            child_age=child_age
        )
    elif risk["confidence"] >= WARN_THRESHOLD:
        # Medium risk — lighter child message for the orange bubble
        narrative["child_message"] = (
            f"Hey, just a heads up 👀 — this page has some content that might not be totally chill for your age. "
            f"Nothing serious, but worth knowing!"
        )

    result = {
        "is_risky":       risk["is_risky"],
        "risk_label":     get_human_category(risk["label"]),
        "risk_label_raw": risk["label"],
        "confidence":     risk["confidence"],
        "all_scores":     risk["all_scores"],
        "trigger_words":  trigger_words,
        "stage":          narrative["stage"],
        "parent_report":  narrative["parent_report"],
        "child_message":  narrative["child_message"],
        "cleaned_text":   cleaned
    }

    logger.info(
        f"[Pipeline] Complete. is_risky={risk['is_risky']} | "
        f"confidence={risk['confidence']:.2%} | label={risk['label']} | "
        f"fallback={risk.get('fallback', False)}"
    )
    return result