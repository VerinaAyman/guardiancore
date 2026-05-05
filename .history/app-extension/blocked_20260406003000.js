// Parse URL parameters and display block reason
const params = new URLSearchParams(window.location.search);

const category = params.get("category") || "restricted";
const childMessage = params.get("reason") || "We noticed something on this page that might not be suitable.";
const parentReport = params.get("parent_report") || "";
const stage = parseInt(params.get("stage") || "3");

document.getElementById("category").textContent = category.replace(/_/g, " ");
document.getElementById("child-message").textContent = childMessage;

if (parentReport) {
  document.getElementById("parent-report").textContent = parentReport;
} else {
  document.getElementById("parent-box").style.display = "none";
}

const stageLabels = {
  1: "Stage 1 — Simple guidance (under 10)",
  2: "Stage 2 — Story-based explanation (10-12)",
  3: "Stage 3 — Co-consent model (13-15)",
  4: "Stage 4 — Mature autonomy (16-17)"
};
document.getElementById("stage-box").textContent =
  "Consent Maturity Ladder: " + (stageLabels[stage] || "Stage 3");
