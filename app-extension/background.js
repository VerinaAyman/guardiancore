// GuardianCore Audit Probe - Background Service Worker
console.log("GuardianCore Audit Probe loaded");

// --- tiny tracker set (domain suffix match; no URLs stored)
const TRACKERS = new Set([
  "google-analytics.com",
  "doubleclick.net",
  "facebook.net",
  "googletagmanager.com",
  "adservice.google.com",
  "googlesyndication.com",
  "googleadservices.com",
  "facebook.com",
  "connect.facebook.net",
  "analytics.google.com",
  "googletagservices.com"
]);

// in-memory per-tab state (non-PII)
const tabState = new Map(); // tabId -> { trackerCount, lastCsp, lastCors }
function ensureTab(tid) {
  if (!tabState.has(tid)) tabState.set(tid, { trackerCount: 0, lastCsp: false, lastCors: false });
  return tabState.get(tid);
}

// SHA-256 hex (origin hashing)
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Count tracker-ish requests by domain suffix (no paths/queries)
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    try {
      const host = new URL(details.url).hostname.replace(/^www\./, "");
      for (const d of TRACKERS) {
        if (host.endsWith(d)) {
          ensureTab(details.tabId).trackerCount++;
          break;
        }
      }
    } catch (e) {
      // Silently ignore malformed URLs
    }
  },
  { urls: ["<all_urls>"] }
);

// Inspect CSP/CORS from response headers (presence only)
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.responseHeaders) return;
    const st = ensureTab(details.tabId);
    const h = Object.create(null);
    for (const { name, value } of details.responseHeaders) {
      h[name.toLowerCase()] = (value || "");
    }
    st.lastCsp = Boolean(h["content-security-policy"]);
    st.lastCors = Boolean(h["access-control-allow-origin"]) || (h["vary"] || "").includes("Origin");
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders", "extraHeaders"]
);

// On navigation complete, emit sanitized audit record
chrome.webNavigation.onCompleted.addListener(async (nav) => {
  try {
    const st = ensureTab(nav.tabId);
    const tab = await chrome.tabs.get(nav.tabId);
    if (!tab?.url) return;

    const origin = new URL(tab.url).origin;
    const originHash = await sha256Hex(origin);

    const record = {
      origin_hash: originHash,
      ts_iso: new Date().toISOString(),
      check_type: "page_audit_v1",
      policy_state: {
        csp_present: !!st.lastCsp,
        cors_signals: !!st.lastCors,
        tracker_count: st.trackerCount
      },
      client: { ua_major: navigator.userAgentData?.brands?.[0]?.version || "n/a" }
    };

    // reset per nav
    st.trackerCount = 0;

    const { gc_backend_url, gc_api_token } = await chrome.storage.local.get(["gc_backend_url", "gc_api_token"]);
    if (!gc_backend_url) return; // fail-safe silent
    const submitUrl = `${gc_backend_url.replace(/\/+$/, "")}/audit/submit`;

    await fetch(submitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": gc_api_token ? `Bearer ${gc_api_token}` : ""
      },
      body: JSON.stringify(record),
      keepalive: true
    }).catch(() => {
      // Silently ignore network errors
    });
  } catch (e) {
    // Silently ignore all errors
  }
});

// Clean up tab state when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("GuardianCore Audit Probe installed");
});
