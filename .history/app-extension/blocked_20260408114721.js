const params = new URLSearchParams(window.location.search);

const category    = params.get("category") || "Restricted content";
const reason      = params.get("reason")   || "";
const tokens      = params.get("tokens")   || "";   // comma-separated trigger words
const stage       = parseInt(params.get("stage") || "3");
// NOTE: parent_report param is intentionally NOT displayed here.
// It is sent to the parent via email by the backend (Paper 26 — dignity gap fix).

// ── Category pill ──
document.getElementById("category-pill").textContent = category;

// ── Narrative — stage-aware (Paper 32 DAD framework) ──
const narratives = {
  1: "This page had some content that isn't right for you right now. It's totally okay — just go back and explore something else!",
  2: "Our system noticed this page might have some grown-up or upsetting content. If anything felt weird or scary, it's okay to talk to someone you trust.",
  3: "This page contained language sometimes used to talk about hurting yourself or others. Our AI isn't always right — but we wanted to check in. You're not in trouble.",
  4: "We flagged content on this page that may relate to harm, hate speech, or adult material. You have the right to know why — see the trigger words below. If anything doesn't seem right, you can flag it as a false positive.",
};
const narrative = reason || narratives[stage] || narratives[3];
document.getElementById("narrative").textContent = narrative;

// ── Trigger tokens (XAI layer — Papers 30, 32) ──
// Show for Stage 3+ so older children understand WHY, not just THAT
if (tokens && stage >= 3) {
  const tokensRow = document.getElementById("tokens-row");
  tokens.split(",").forEach(tok => {
    const span = document.createElement("span");
    span.className = "token";
    span.textContent = tok.trim();
    tokensRow.appendChild(span);
  });
  document.getElementById("tokens-section").style.display = "block";
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

// ── Help panel toggle (Paper 5 FR2 — help button gap) ──
function toggleHelp() {
  const panel = document.getElementById("help-panel");
  panel.classList.toggle("visible");
}