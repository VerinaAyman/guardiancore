const p = new URLSearchParams(window.location.search);

const category = p.get("category") || "Restricted content";
const reason   = p.get("reason")   || "";
const tokens   = p.get("tokens")   || "";
const stage    = parseInt(p.get("stage") || "3");

// ── Human-readable category map ──
const categoryLabels = {
  "blocked_keyword":  "Harmful Language",
  "toxic":            "Toxic Content",
  "hate_speech":      "Hate Speech",
  "self_harm":        "Self-Harm Content",
  "violence":         "Violent Content",
  "adult_content":    "Adult Content",
  "grooming":         "Unsafe Contact Patterns",
  "cyberbullying":    "Bullying or Harassment",
  "drug_content":     "Drug-Related Content",
  "ai_blocked":       "AI Safety Detection",
  "restricted":       "Restricted Content",
  "unsafe_content":   "Unsafe Content",
};

const humanCategory = categoryLabels[category.toLowerCase()] || 
  category.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

// ── Category pill ──
document.getElementById("category-pill").textContent = humanCategory;

// ── Stage-aware narrative (Paper 32 DAD framework) ──
const narratives = {
  1: "This page had some content that isn't right for you right now. It's totally okay — just go back!",
  2: "Our system noticed this page might have some upsetting content. If anything felt weird or scary, talk to a grown-up you trust.",
  3: "This page contained language sometimes used to talk about hurting yourself or others. Our AI isn't always right — but we wanted to check in. You're not in trouble.",
  4: "We flagged content on this page that may relate to harm, hate speech, or adult material. You have the right to know why — see the trigger words below.",
};
document.getElementById("narrative").textContent = reason || narratives[stage] || narratives[3];

// ── XAI trigger tokens — Stage 3+ only (Papers 30, 32) ──
if (tokens && stage >= 3) {
  const row = document.getElementById("tokens-row");
  tokens.split(",").forEach(tok => {
    if (!tok.trim()) return;
    const s = document.createElement("span");
    s.className = "token";
    s.textContent = tok.trim();
    row.appendChild(s);
  });
  document.getElementById("tokens-wrap").style.display = "block";
}

// ── Stage label ──
const stageLabels = {
  1: "Stage 1 — Simple guidance (under 10)",
  2: "Stage 2 — Story-based explanation (10–12)",
  3: "Stage 3 — Co-consent model (13–15)",
  4: "Stage 4 — Mature autonomy (16–17)",
};
document.getElementById("stage-label").textContent =
  "Consent Maturity Ladder: " + (stageLabels[stage] || stageLabels[3]);

// ── Navigation buttons ──
document.getElementById("btn-back").addEventListener("click", () => {
  if (history.length > 1) {
    history.back();
  } else {
    window.location.href = "https://www.google.com";
  }
});

document.getElementById("btn-home").addEventListener("click", () => {
  window.location.href = "https://www.google.com";
});

document.getElementById("btn-help").addEventListener("click", () => {
  const panel = document.getElementById("help-panel");
  panel.classList.toggle("open");
  document.getElementById("btn-help").textContent = 
    panel.classList.contains("open") ? "Close" : "Talk to someone";
});