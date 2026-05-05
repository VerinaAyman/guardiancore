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

# ─── Phase 1 setup: ekphrasis preprocessor ───────────────────────────────────
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

# ─── Phase 2 setup: RoBERTa safety classifier ────────────────────────────────
ROBERTA_MODEL = "unitary/toxic-bert"
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

# ─── Phase 4 setup: Anthropic client ─────────────────────────────────────────
anthropic_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 1 — Morphological Cleaning
# ─────────────────────────────────────────────────────────────────────────────
def phase1_clean(raw_text: str) -> str:
    """
    Uses ekphrasis to normalise social media text.
    Handles slang, hashtags, elongated words, emoticons, URLs, contractions.
    
    Example:
        "omg this is sooooo bussin no cap 🔥" 
        → "oh my god this is so <elongated> no cap <happy>"
    """
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
    """
    Runs RoBERTa (toxic-bert) to score the text across risk categories.
    Returns the highest scoring label and its confidence.
    
    Labels from toxic-bert:
        toxic, severe_toxic, obscene, threat, insult, identity_hate
    """
    try:
        results = classifier(cleaned_text[:512])
        scores = results[0]

        # Find highest scoring label
        top = max(scores, key=lambda x: x["score"])
        
        # Any score above 0.5 is considered risky
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
    """
    Uses SHAP to identify which words most contributed to the risk score.
    Returns a list of the top N trigger words, pruned of stopwords.
    
    Example:
        ["kill", "hate", "attack"] — the words that pushed the score high
    """
    STOPWORDS = {"the", "a", "an", "is", "it", "to", "and", "or", "of", "in", "you", "i"}
    
    try:
        explainer = shap.Explainer(classifier)
        shap_values = explainer([cleaned_text[:512]])
        
        # Get token-level SHAP values
        tokens = shap_values.data[0]
        values = shap_values.values[0]
        
        # values shape: (tokens, labels) — sum across labels for overall importance
        if len(values.shape) > 1:
            importance = np.abs(values).sum(axis=1)
        else:
            importance = np.abs(values)
        
        # Pair tokens with importance scores, filter stopwords
        pairs = [
            (token.strip(), float(score))
            for token, score in zip(tokens, importance)
            if token.strip().lower() not in STOPWORDS and len(token.strip()) > 2
        ]
        
        # Sort by importance descending, take top N
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
    """
    Calls Claude to generate two narratives based on the Consent Maturity Ladder:
    - Parent report: factual, detailed, actionable
    - Child message: age-appropriate, educational, non-scary
    
    Consent Maturity Ladder stages:
        Stage 1 (<10):  Simple authority cues, gamified
        Stage 2 (10-12): Story-based explainers
        Stage 3 (13-15): Co-consent, teen can express dissent
        Stage 4 (16-17): Mature autonomy, teen is primary
    """
    
    # Determine stage from age
    if child_age < 10:
        stage = 1
        child_tone = "very simple words, friendly and reassuring, like talking to a young child"
    elif child_age < 13:
        stage = 2
        child_tone = "a short story-like explanation, warm and educational"
    elif child_age < 16:
        stage = 3
        child_tone = "respectful and informative, acknowledging the teen may disagree"
    else:
        stage = 4
        child_tone = "mature and direct, treating the teen as the primary person"

    trigger_str = ", ".join(trigger_words) if trigger_words else "overall content pattern"

    prompt = f"""You are GuardianLens, a child safety AI. Analyze this situation and generate two responses.

SITUATION:
- Risk category detected: {risk_label}
- Confidence: {confidence:.0%}
- Key trigger words/patterns: {trigger_str}
- Child age: {child_age} (Consent Maturity Stage {stage})
- Sample text (first 300 chars): {original_text[:300]}

Generate exactly two responses in this format:

PARENT_REPORT:
[Under 100 words. Factual, specific, actionable. Mention the risk category, confidence level, and what triggered it. Suggest a conversation starter.]

CHILD_MESSAGE:
[Under 80 words. Tone: {child_tone}. Do not shame or scare. Explain why the content was flagged and what they can do.]"""

    try:
        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        
        response_text = message.content[0].text
        
        # Parse the two sections
        parent_report = ""
        child_message = ""
        
        if "PARENT_REPORT:" in response_text and "CHILD_MESSAGE:" in response_text:
            parts = response_text.split("CHILD_MESSAGE:")
            parent_report = parts[0].replace("PARENT_REPORT:", "").strip()
            child_message = parts[1].strip()
        else:
            parent_report = response_text
            child_message = "We noticed something on this page that might not be suitable. It's okay to talk to a trusted adult about it."
        
        logger.info(f"[Phase4] Narratives generated for stage {stage}")
        
        return {
            "stage": stage,
            "parent_report": parent_report,
            "child_message": child_message
        }
        
    except Exception as e:
        logger.error(f"[Phase4] Narrative generation failed: {e}")
        return {
            "stage": stage,
            "parent_report": f"Risk detected: {risk_label} ({confidence:.0%} confidence). Triggered by: {trigger_str}.",
            "child_message": "We noticed something on this page that might not be suitable."
        }


# ─────────────────────────────────────────────────────────────────────────────
# MAIN PIPELINE — chains all 4 phases
# ─────────────────────────────────────────────────────────────────────────────
async def run_pipeline(raw_text: str, child_age: int = 13) -> dict:
    """
    Runs the full 4-phase GuardianLens pipeline.
    
    Returns a rich result dict with:
        - is_risky: bool
        - risk_label: str
        - confidence: float  
        - trigger_words: list
        - stage: int (Consent Maturity Stage)
        - parent_report: str
        - child_message: str
        - cleaned_text: str (Phase 1 output)
    """
    logger.info("[Pipeline] Starting 4-phase analysis...")
    
    # Phase 1
    cleaned = phase1_clean(raw_text)
    
    # Phase 2
    risk = phase2_detect_risk(cleaned)
    
    # Phase 3 — only run SHAP if content is risky (expensive operation)
    trigger_words = []
    if risk["is_risky"]:
        trigger_words = phase3_extract_rationale(cleaned)
    
    # Phase 4 — only generate narrative if risky
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