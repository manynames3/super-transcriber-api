const API = "https://pn72sppog0.execute-api.us-east-1.amazonaws.com";
const $ = id => document.getElementById(id);
let apiKey = "";
let poll;
let billingEnabled = false;

function notice(message) { $("notice").textContent = message; $("notice").hidden = !message; }
async function api(path, method = "GET", body, authenticated = true) {
  const response = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(authenticated ? { "x-api-key": apiKey } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (response.status === 204) return undefined;
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload;
}
async function run(button, action) {
  button.disabled = true;
  try { notice(""); await action(); }
  catch (error) { notice(error.message ?? "Request failed"); }
  finally { button.disabled = false; }
}
function element(tag, text) { const node = document.createElement(tag); node.textContent = text; return node; }
function action(text, callback) { const button = element("button", text); button.type = "button"; button.className = "button button-secondary"; button.addEventListener("click", () => run(button, callback)); return button; }
function showSecret(secret, title = "New API key") { $("secret-title").textContent = title; $("new-secret").value = secret; $("secret-dialog").showModal(); }
function disconnect() {
  clearTimeout(poll); apiKey = ""; $("api-key").value = ""; $("account-content").hidden = true; $("connect-section").hidden = false;
  $("new-secret").value = ""; $("secret-dialog").close();
  for (const id of ["keys", "jobs", "deliveries", "usage"]) $(id).replaceChildren();
}
async function refreshData(full = false) {
  clearTimeout(poll);
  const connectedKey = apiKey;
  const [account, jobs] = await Promise.all([api("/v1/billing/account"), api("/v1/transcriptions?limit=20")]);
  if (!apiKey || apiKey !== connectedKey) return;
  $("usage").replaceChildren();
  for (const [label, value] of [["Plan", account.planId], ["Minutes used", `${account.usage.usedMinutes.toFixed(2)} / ${account.limits.monthlyTranscriptionMinutes}`],
    ["Minutes available", account.usage.remainingMinutes.toFixed(2)], ["Active jobs", `${account.usage.activeJobs} / ${account.limits.maxActiveJobs}`]]) {
    const item = document.createElement("div"); item.append(element("dt", label), element("dd", String(value))); $("usage").append(item);
  }
  $("portal").disabled = !billingEnabled || !account.stripeCustomerId;
  $("jobs").replaceChildren();
  for (const job of jobs.items) {
    const row = document.createElement("tr"); row.append(element("td", job.fileName), element("td", job.status === "FAILED" ? `FAILED: ${job.failureReason}` : job.status), element("td", job.durationSeconds == null ? "-" : `${Math.ceil(job.durationSeconds)}s`));
    const output = document.createElement("td");
    if (job.status === "COMPLETED") for (const format of ["txt", "json", "srt", "vtt"]) output.append(action(format.toUpperCase(), async () => {
      const response = await fetch(`${API}/v1/transcriptions/${encodeURIComponent(job.jobId)}/transcript?format=${format}`, { headers: { "x-api-key": apiKey }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error((await response.json()).error);
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a");
      link.href = url; link.download = job.fileName.replace(/\.[^.]+$/, "") + "." + format; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }));
    row.append(output); $("jobs").append(row);
  }
  if (!jobs.items.length) { const row = document.createElement("tr"); const cell = element("td", "No transcriptions yet."); cell.colSpan = 4; row.append(cell); $("jobs").append(row); }
  if (full) {
    const [keys, deliveries] = await Promise.allSettled([api("/v1/api-keys"), api("/v1/webhooks/deliveries")]);
    if (!apiKey || apiKey !== connectedKey) return;
    $("keys").replaceChildren();
    if (keys.status === "fulfilled") for (const key of keys.value.items) {
      const row = document.createElement("tr"); row.append(element("td", key.name), element("td", key.keyPrefix), element("td", key.status));
      const controls = document.createElement("td");
      if (key.status === "ACTIVE") {
        controls.append(action("Rotate", async () => {
          if (!confirm(`Replace ${key.name} and immediately revoke its current key?`)) return;
          const result = await api(`/v1/api-keys/${key.keyId}/rotate`, "POST", {});
          if (apiKey.startsWith(`stapi_${key.keyId}_`)) apiKey = result.apiKey;
          showSecret(result.apiKey); await refreshData(true);
        }), action("Revoke", async () => {
          if (!confirm(`Immediately revoke ${key.name}?`)) return;
          const current = apiKey.startsWith(`stapi_${key.keyId}_`); await api(`/v1/api-keys/${key.keyId}`, "DELETE");
          if (current) disconnect(); else await refreshData(true);
          notice("API key revoked.");
        }));
      }
      row.append(controls); $("keys").append(row);
    }
    $("deliveries").replaceChildren();
    if (deliveries.status === "fulfilled") for (const delivery of deliveries.value.items) {
      const row = document.createElement("tr"); row.append(element("td", delivery.eventId), element("td", delivery.status), element("td", String(delivery.attempts)));
      const control = document.createElement("td"); control.append(action("Replay", async () => { await api(`/v1/webhooks/deliveries/${encodeURIComponent(delivery.eventId)}/replay`, "POST", {}); notice("Webhook replay queued."); })); row.append(control); $("deliveries").append(row);
    }
  }
  if (jobs.items.some(job => ["QUEUED", "STARTING", "IN_PROGRESS"].includes(job.status)) && !document.hidden) poll = setTimeout(() => refreshData().catch(error => notice(error.message)), 5000);
}

$("connect-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, async () => {
  apiKey = $("api-key").value.trim(); await refreshData(true); $("api-key").value = ""; $("account-content").hidden = false; $("connect-section").hidden = true;
}); });
$("checkout-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, async () => {
  const result = await api("/v1/billing/checkout", "POST", { email: $("email").value, planId: $("plan").value,
    successUrl: new URL("billing", location.href).href, cancelUrl: location.href }, false);
  location.assign(result.checkoutUrl);
}); });
$("upload-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, async () => {
  const file = $("audio").files[0];
  if (!file || !/\.(mp3|m4a)$/i.test(file.name) || file.size > 200 * 1024 * 1024) throw new Error("Choose an MP3/M4A file up to 200 MB.");
  const contentType = file.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/mp4";
  const upload = await api("/v1/uploads/presign", "POST", { fileName: file.name, contentType, fileSizeBytes: file.size });
  const put = await fetch(upload.uploadUrl, { method: upload.uploadMethod, headers: upload.uploadHeaders, body: file, signal: AbortSignal.timeout(300000) });
  if (!put.ok) throw new Error(`Upload failed: HTTP ${put.status}`);
  await api("/v1/transcriptions", "POST", { ...upload.startRequest, speakerCount: Number($("speakers").value) });
  $("audio").value = ""; await refreshData(); notice("Transcription queued.");
}); });
$("create-key-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, async () => {
  const choice = $("key-scope").value;
  const scopes = choice === "read" ? ["transcriptions:read"] : choice === "integration" ? ["uploads:write", "transcriptions:write", "transcriptions:read"] : undefined;
  const result = await api("/v1/api-keys", "POST", { keyName: $("key-name").value, scopes }); showSecret(result.apiKey); await refreshData(true);
}); });
$("webhook-form").addEventListener("submit", event => { event.preventDefault(); run(event.submitter, async () => {
  const result = await api("/v1/webhooks", "POST", { url: $("webhook-url").value, enabled: true });
  if (result.signingSecret) showSecret(result.signingSecret, "Webhook signing secret"); else notice("Webhook updated.");
}); });
$("refresh").addEventListener("click", () => run($("refresh"), () => refreshData(true)));
$("disconnect").addEventListener("click", disconnect);
$("portal").addEventListener("click", () => run($("portal"), async () => { const result = await api("/v1/billing/portal", "POST", { returnUrl: location.href }); location.assign(result.portalUrl); }));
$("close-secret").addEventListener("click", () => $("secret-dialog").close());
$("secret-dialog").addEventListener("close", () => { $("new-secret").value = ""; });
$("copy-secret").addEventListener("click", () => run($("copy-secret"), async () => { await navigator.clipboard.writeText($("new-secret").value); notice("Secret copied."); }));
document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(poll); else if (apiKey) refreshData().catch(error => notice(error.message)); });
fetch(API + "/health").then(response => response.json()).then(health => {
  $("service-status").textContent = health.ok ? "API online" : "API unavailable";
  billingEnabled = health.features?.billing === true; $("checkout-button").disabled = !billingEnabled;
  $("billing-status").textContent = billingEnabled ? "Payment and subscription terms appear in Stripe Checkout." : "Paid signup is not enabled on this deployment. Existing API keys can connect above.";
}).catch(() => { $("service-status").textContent = "API unavailable"; });
