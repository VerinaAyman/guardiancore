const out = document.getElementById("out");
document.getElementById("ping").addEventListener("click", async () => {
  out.textContent = "Pinging...";
  try {
    const res = await fetch("http://localhost:8000/health");
    const json = await res.json();
    out.textContent = JSON.stringify(json, null, 2);
  } catch (e) {
    out.textContent = "Error: " + e.message;
  }
});
