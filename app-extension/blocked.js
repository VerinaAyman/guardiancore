// Parse URL parameters and display block reason
const params = new URLSearchParams(window.location.search);
const reason = params.get("reason") || "This content has been blocked by parental controls.";
const category = params.get("category") || "Restricted Content";

document.getElementById("reason").textContent = reason;
document.getElementById("category").textContent = category.replace(/_/g, " ").toUpperCase();
