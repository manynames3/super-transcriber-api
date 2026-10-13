const API = "https://pn72sppog0.execute-api.us-east-1.amazonaws.com";
const query = new URLSearchParams(location.search);
let storedReceipt;
try { storedReceipt = JSON.parse(sessionStorage.getItem("st-checkout-receipt") ?? "null"); } catch { storedReceipt = null; }
const receipt = query.has("session_id") && query.has("claim_token") ? { checkoutSessionId: query.get("session_id"), claimToken: query.get("claim_token") } : storedReceipt;
history.replaceState({}, "", location.pathname);
if (receipt) { try { sessionStorage.setItem("st-checkout-receipt", JSON.stringify(receipt)); } catch {} }
const status = document.getElementById("receipt-status");
const recover = document.getElementById("receipt-recover");
async function claim(replacement = false) {
  if (!receipt) { status.textContent = "No checkout receipt is available. Return to your checkout confirmation."; return; }
  recover.disabled = true;
  try {
    const response = await fetch(API + "/v1/billing/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...receipt, recover: replacement }), signal: AbortSignal.timeout(30000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    document.getElementById("receipt-secret").value = body.apiKey;
    document.getElementById("receipt-key").hidden = false;
    status.textContent = `${body.planId} access is active.`;
  } catch (error) { status.textContent = error.message ?? "Could not claim API access."; }
  finally { recover.hidden = false; recover.disabled = false; }
}
recover.addEventListener("click", () => { if (confirm("Replace the key issued by this receipt and revoke its previous value?")) claim(true); });
document.getElementById("receipt-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(document.getElementById("receipt-secret").value); status.textContent = "API key copied."; }
  catch { status.textContent = "Clipboard unavailable. Select the API key to retrieve it."; }
});
claim();
