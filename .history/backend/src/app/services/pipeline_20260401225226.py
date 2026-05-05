"""
GuardianLens 4-Phase Content Analysis Pipeline

Phase 1: Morphological Cleaning  — fastText + ekphrasis slang normalisation
Phase 2: Contextual Risk Engine  — RoBERTa intent detection
Phase 3: Rationale Extraction    — SHAP explainability
Phase 4: Tiered Narrative        — Claude-generated parent/child explanation
"""

import logging
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
    if classifier is None:
        logger.warning("[Phase2] Models not ready yet, skipping risk detection")
        return {"is_risky": False, "label": "unknown", "confidence": 0.0, "all_scores": {}}
    try:
        results = classifier(cleaned_text[:512])
        scores = results[0]
        top = max(scores, key=lambda x: x["score"])
        is_risky = top["score"] > 0.4
        logger.info(f"[Phase2] Top label: {top['label']} ({top['score']:.2%})")
        return {
            "is_risky": is_risky,
            "label": top["label"],
            "confidence": top["score"],
            "all_scores": {s["label"]: round(s["score"], 4) for s in scores}
        }
    except Exception as e:
        logger.error(f"[Phase2] Risk detection failed: {e}")
        return {"is_risky": False, "label": "unknown", "confidence": 0.0, "all_scores": {}}


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — Rationale Extraction (SHAP)
# ─────────────────────────────────────────────────────────────────────────────
def phase3_extract_rationale(cleaned_text: str, top_n: int = 5) -> list[str]:
    STOPWORDS = {"the", "a", "an", "is", "it", "to", "and", "or", "of", "in", "you", "i"}
    try:
        explainer = shap.Explainer(classifier)
        shap_values = explainer([cleaned_text[:512]])
        tokens = shap_values.data[0]
        values = shap_values.values[0]
        if len(values.shape) > 1:
            importance = np.abs(values).sum(axis=1)
        else:
            importance = np.abs(values)
        pairs = [
            (token.strip(), float(score))
            for token, score in zip(tokens, importance)
            if token.strip().lower() not in STOPWORDS and len(token.strip()) > 2
        ]
        pairs.sort(key=lambda x: x[1], reverse=True)
        top_tokens = [token.strip() for token, _ in pairs[:top_n]]
        logger.info(f"[Phase3] Top trigger tokens: {top_tokens}")
        return top_tokens
    except Exception as e:
        logger.warning(f"[Phase3] SHAP failed, returning empty rationale: {e}")
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
        child_message = f"Hey! We noticed this page had some content that isn't right for kids. It's totally okay — just close it and tell a grown-up you trust. You didn't do anything wrong! 😊"
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
    risk = phase2_detect_risk(cleaned)
    trigger_words = []
    if risk["is_risky"]:
        trigger_words = phase3_extract_rationale(cleaned)
    narrative = {"stage": 1, "parent_report": "", "child_message": ""}
    if risk["is_risky"]:
        narrative = phase4_generate_narrative(
            original_text=raw_text,
            risk_label=risk["label"],
            confidence=risk["confidence"],
            trigger_words=trigger_words,
            child_age=child_age
        )
    result = {
        "is_risky": risk["is_risky"],
        "risk_label": risk["label"],
        "confidence": risk["confidence"],
        "all_scores": risk["all_scores"],
        "trigger_words": trigger_words,
        "stage": narrative["stage"],
        "parent_report": narrative["parent_report"],
        "child_message": narrative["child_message"],
        "cleaned_text": cleaned
    }
    logger.info(f"[Pipeline] Complete. Risky: {risk['is_risky']}, Label: {risk['label']}")
    return result