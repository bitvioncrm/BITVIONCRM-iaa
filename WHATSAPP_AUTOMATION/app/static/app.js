const state = {
  view: "bulk",
  kind: "bulk",
  source: "all",
  statuses: new Set(["new", "contacted", "interested", "follow_up", "excel", "whatsapp_contact"]),
  labels: {},
  count: 0,
  leads: [],
  posters: [],
  selectedPoster: null,
  workspaces: [],
  projects: [],
  activeProjectId: null,
  poll: null,
  qrPoll: null,
  connectedPhone: "",
  activeSession: "",
  accounts: [],
  lastHealth: null,
  lastMeta: null,
  stageCounts: {},
  stageCountsKey: "",
  lastQueryKey: "",
  queryInFlight: null,
  editingLeadId: null,
};

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get("embed") === "1") document.body.classList.add("embed");

const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
if (hashParams.get("t")) {
  sessionStorage.setItem("wa_admin", hashParams.get("t"));
  history.replaceState(null, "", location.pathname + location.search);
}
function adminToken() {
  return sessionStorage.getItem("wa_admin") || "";
}

function toast(msg, bad = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("bad", bad);
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  if (btn.dataset.busy === "1") return;
  const old = btn.textContent;
  btn.dataset.busy = "1";
  btn.disabled = true;
  btn.textContent = label || "Working…";
  try {
    return await fn();
  } finally {
    btn.dataset.busy = "0";
    btn.disabled = false;
    btn.textContent = old;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function labelStatus(s) {
  return state.labels[s] || String(s || "").replaceAll("_", " ");
}

async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  const token = adminToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const msg = typeof detail === "string" ? detail : detail?.[0]?.msg || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function filters() {
  const active = state.projects.find((p) => p.id === state.activeProjectId);
  return {
    statuses: [...state.statuses],
    date_from: $("dateFrom").value || null,
    date_to: $("dateTo").value || null,
    search: $("search").value.trim() || null,
    reminder_only: $("reminderOnly").checked || state.kind === "reminder",
    source: state.source || "all",
    workspace_id: $("workspaceSelect").value || active?.workspace_id || null,
    project_id: state.activeProjectId || null,
  };
}

function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("wa_theme", dark ? "dark" : "light");
  $("btnTheme").textContent = dark ? "☀" : "☾";
  if ($("settingDark")) $("settingDark").checked = dark;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b141a" : "#ffffff");
}

function showView(view) {
  // Instant paint first — never wait on network for navigation
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${view}`);
  });
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  const panel = $(`view-${view}`);
  $("topTitle").textContent = panel?.dataset.title || view;
  $("sidebar").classList.remove("open");
  $("backdrop").classList.add("hidden");

  if (view !== "connect") {
    clearTimeout(state.qrPoll);
    state.qrPoll = null;
    clearInterval(state.qrRefresh);
    state.qrRefresh = null;
  }

  // Background refresh only for the opened page
  queueMicrotask(() => {
    if (view === "bulk") {
      if (state.kind === "poster") setKind("bulk");
      if (!state.lastQueryKey) refreshLeads().catch(() => {});
    } else if (view === "connect") {
      updateConnectInfo();
      // Fetch QR immediately; only force-restart via Start / Refresh buttons
      startQrLoop({ restart: false });
    } else if (view === "posters") {
      setKind("poster");
      updatePosterPage();
      loadPosters().catch(() => {});
    } else if (view === "campaigns") {
      loadCampaigns().catch(() => {});
    } else if (view === "templates") {
      loadTemplates().catch(() => {});
    } else if (view === "settings") {
      fillSettings();
    } else if (view === "projects") {
      loadProjects().catch(() => {});
    }
  });
}

function previewText(raw) {
  const text = raw || $("message").value || "Hi {name}, your message preview will appear here…";
  return text
    .replaceAll("{name}", "Priya")
    .replaceAll("{{name}}", "Priya")
    .replaceAll("{first_name}", "Priya")
    .replaceAll("{{first_name}}", "Priya")
    .replaceAll("{phone}", "919876543210")
    .replaceAll("{status}", "interested");
}

function updatePreview() {
  if (!$("previewBubble")) return;
  $("previewBubble").innerHTML = `${escapeHtml(previewText())}<span class="ticks">✓✓ ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
  const img = $("previewPoster");
  if (state.selectedPoster) {
    img.src = `/posters/${state.selectedPoster}`;
    img.classList.remove("hidden");
  } else {
    img.classList.add("hidden");
  }
  const both = Boolean(($("message")?.value || "").trim() && state.selectedPoster);
  $("sendBtn").textContent = both
    ? `Send message + poster to ${state.count.toLocaleString()} leads`
    : `Send Now to ${state.count.toLocaleString()} Leads`;
  $("previewPhone").textContent = state.connectedPhone ? `+${state.connectedPhone}` : "Not connected";
  if ($("posterRecipientCount")) $("posterRecipientCount").textContent = state.count.toLocaleString();
}

function updatePosterPage() {
  const name = $("posterSelectPage")?.value || state.selectedPoster;
  const img = $("posterPagePreview");
  if (img) {
    if (name) {
      img.src = `/posters/${name}`;
      img.style.display = "block";
    } else {
      img.style.display = "none";
    }
  }
  if ($("posterCaptionPreview")) {
    $("posterCaptionPreview").textContent = previewText($("posterCaption")?.value);
  }
  if ($("posterRecipientCount")) $("posterRecipientCount").textContent = state.count.toLocaleString();
}

function sessionQuery(extra = "") {
  const parts = [];
  if (state.activeSession) parts.push(`session=${encodeURIComponent(state.activeSession)}`);
  if (extra) parts.push(extra);
  return parts.length ? `?${parts.join("&")}` : "";
}

function fillSendFrom() {
  const sel = $("sendFrom");
  if (!sel) return;
  const prev = sel.value || state.activeSession;
  sel.innerHTML = "";
  const rows = state.accounts.length ? state.accounts : [{ id: "default", label: "WhatsApp 1", status: "" }];
  rows.forEach((row) => {
    const opt = document.createElement("option");
    opt.value = row.id;
    const phone = row.phone ? ` · +${String(row.phone).replace(/\D/g, "")}` : "";
    const mark = row.status === "WORKING" ? "Connected" : row.status || "Not linked";
    opt.textContent = `${row.label}${phone} (${mark})`;
    sel.appendChild(opt);
  });
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (state.activeSession) sel.value = state.activeSession;
}

function renderAccounts() {
  const wrap = $("accountList");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!state.accounts.length) {
    wrap.innerHTML = `<div class="lead-row"><div></div><div><strong>No numbers yet</strong><small>Add a WhatsApp to scan its QR</small></div></div>`;
    return;
  }
  state.accounts.forEach((row) => {
    const card = document.createElement("div");
    card.className = `project-card ${row.active ? "active" : ""}`;
    const phone = row.phone ? `+${String(row.phone).replace(/\D/g, "")}` : "Not linked";
    const status = row.status === "WORKING" ? "Connected" : (row.status || "Offline").replaceAll("_", " ");
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(row.label)}</strong>
        <small>${escapeHtml(status)} · ${escapeHtml(phone)}${row.push_name ? ` · ${escapeHtml(row.push_name)}` : ""}</small>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" data-act="use">${row.active ? "Active" : "Use this number"}</button>
        <button type="button" class="btn ghost" data-act="remove">Remove</button>
      </div>`;
    card.querySelector('[data-act="use"]').onclick = () => selectAccount(row.id);
    card.querySelector('[data-act="remove"]').onclick = () => removeAccount(row.id);
    wrap.appendChild(card);
  });
}

async function selectAccount(id) {
  await api(`/api/accounts/${encodeURIComponent(id)}/activate`, { method: "POST" });
  state.activeSession = id;
  if ($("sendFrom")) $("sendFrom").value = id;
  await health();
  if (state.view === "connect") startQrLoop({ restart: false });
  toast("Sending from this number");
}

function refreshAfterWhatsAppClear() {
  state.didAutoSyncContacts = false;
  state.lastQueryKey = "";
  return Promise.all([health(), refreshLeads(true).catch(() => {}), loadAnalytics().catch(() => {})]);
}

async function removeAccount(id) {
  if (!confirm("Remove this WhatsApp? Its imported contacts will be deleted. CRM leads stay.")) return;
  const data = await api(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  const n = data.contacts_removed || 0;
  toast(data.kept_slot ? `Disconnected. ${n.toLocaleString()} WhatsApp contacts removed. CRM leads kept.` : `Removed. ${n.toLocaleString()} WhatsApp contacts removed. CRM leads kept.`);
  await refreshAfterWhatsAppClear();
  if (state.view === "connect") startQrLoop({ restart: true });
}

function updateConnectInfo() {
  const h = state.lastHealth || {};
  const current = (state.accounts || []).find((row) => row.id === state.activeSession);
  $("infoSession").textContent = current?.label || state.activeSession || "default";
  $("infoStatus").textContent = h.waha || "—";
  $("infoPhone").textContent = state.connectedPhone ? `+${state.connectedPhone}` : "—";
  $("infoName").textContent = h.me?.pushName || "—";
  $("infoCrm").textContent = h.crm === "connected" ? "Connected" : "Not configured";
}

function fillSettings() {
  const ab = state.lastMeta?.anti_block || state.lastHealth?.anti_block || {};
  $("setDelay").textContent = `${ab.delay_min ?? "—"}–${ab.delay_max ?? "—"}s`;
  $("setBatch").textContent = String(ab.batch_size ?? "—");
  $("setDaily").textContent = `${ab.daily_sent ?? 0} / ${ab.daily_cap ?? "—"}`;
  $("setHourly").textContent = `${ab.hourly_sent ?? 0} / ${ab.hourly_cap ?? "—"}`;
  $("setHours").textContent = ab.respect_business_hours ? ab.business_hours || "On" : "Disabled";
  $("setSentToday").textContent = String(ab.daily_sent ?? 0);
  $("setCrm").textContent = state.lastHealth?.crm === "connected" ? "Connected" : "Not configured";
  $("setLeads").textContent = ($("kpiLeads")?.textContent || "0");
  $("setWa").textContent = state.lastHealth?.waha || "—";
  $("settingEmbed").textContent = document.body.classList.contains("embed") ? "Yes" : "No";
  $("settingDark").checked = document.documentElement.classList.contains("dark");
}

async function health() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch("/api/health", { signal: ctrl.signal });
    const h = await res.json();
    if (!res.ok) throw new Error(h.detail || "health failed");
    state.lastHealth = h;
    state.accounts = h.accounts || [];
    const active = state.accounts.find((row) => row.active) || state.accounts[0];
    if (active) state.activeSession = active.id;
    const connected = Number(h.connected || 0);
    const ok = h.waha === "WORKING" || connected > 0;
    const needScan = ["SCAN_QR_CODE", "STARTING", "STOPPED", "FAILED", "MISSING", "OFFLINE"].includes(h.waha);
    $("waDot").className = `dot ${ok ? "on" : "off"}`;
    $("waStatus").textContent = connected > 1 ? `${connected} numbers connected` : ok && h.waha === "WORKING" ? "Connected" : needScan ? "Scan QR to connect" : `WhatsApp ${h.waha || "offline"}`;
    const phone = (h.phone || "").replace(/\D/g, "") || String(h.me?.id || "").split("@")[0];
    state.connectedPhone = phone;
    const name = h.me?.pushName || (phone ? `+${phone}` : "Business");
    $("waMeta").textContent = connected > 1 ? state.accounts.filter((row) => row.status === "WORKING").map((row) => row.label).join(" · ") : ok && h.waha === "WORKING" ? `${name}` : "Tap Scan & Connect";
    fillSendFrom();
    renderAccounts();
    if ($("previewBiz")) $("previewBiz").innerHTML = `${escapeHtml(name)} <span class="verified">✓</span>`;
    updatePreview();
    updateConnectInfo();
    return h;
  } finally {
    clearTimeout(timer);
  }
}

function renderStageChips(force = false) {
  const wrap = $("stageChips");
  if (!wrap) return;
  const key = JSON.stringify(state.stageCounts) + [...state.statuses].join(",");
  if (!force && key === state.stageCountsKey && wrap.children.length) {
    // Only sync active classes
    wrap.querySelectorAll(".chip").forEach((b) => {
      b.classList.toggle("on", state.statuses.has(b.dataset.stage));
    });
    return;
  }
  state.stageCountsKey = key;
  const statuses = state.lastMeta?.statuses || Object.keys(state.stageCounts);
  const frag = document.createDocumentFragment();
  statuses.forEach((s) => {
    const count = Number(state.stageCounts[s] || 0);
    const b = document.createElement("button");
    b.type = "button";
    b.className = `chip ${state.statuses.has(s) ? "on" : ""}`;
    b.dataset.stage = s;
    b.innerHTML = `${escapeHtml(labelStatus(s))} <em>${count.toLocaleString()}</em>`;
    b.onclick = () => {
      if (state.statuses.has(s)) state.statuses.delete(s);
      else state.statuses.add(s);
      b.classList.toggle("on", state.statuses.has(s));
      refreshLeads(true);
    };
    frag.appendChild(b);
  });
  wrap.replaceChildren(frag);

  const leadStatus = $("leadStatus");
  if (leadStatus && !leadStatus.options.length) {
    statuses.forEach((s) => {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = labelStatus(s);
      leadStatus.appendChild(o);
    });
  }
}

function fillWorkspaceSelects() {
  const options = [`<option value="">All workspaces</option>`]
    .concat(
      state.workspaces.map((w) => {
        const id = w.id || w.workspace_id || "";
        const name = w.name || w.title || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
      })
    )
    .join("");
  ["workspaceSelect", "projectWorkspace"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    const prev = el.value || params.get("workspace_id") || "";
    el.innerHTML = options;
    if (prev && [...el.options].some((option) => option.value === prev)) el.value = prev;
  });
}

function alignProjectToWorkspace(refresh = true) {
  const ws = ($("workspaceSelect") && $("workspaceSelect").value) || params.get("workspace_id") || "";
  if (!ws) return;
  const match = state.projects.find((p) => p.workspace_id === ws);
  if (!match || match.id === state.activeProjectId) {
    if (refresh) refreshLeads();
    return;
  }
  state.activeProjectId = match.id;
  renderProjectSelect();
  renderProjectList();
  api(`/api/projects/${match.id}/activate?bootstrap=0`, { method: "POST" }).catch(() => {});
  if (refresh) {
    state.lastQueryKey = "";
    refreshLeads(true);
  }
}

function renderProjectSelect() {
  const sel = $("projectSelect");
  if (!sel) return;
  const prev = state.activeProjectId || sel.value;
  sel.innerHTML = "";
  state.projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  else if (state.activeProjectId) sel.value = state.activeProjectId;
  state.activeProjectId = sel.value || null;
}

function renderProjectList() {
  const wrap = $("projectList");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!state.projects.length) {
    wrap.innerHTML = `<div class="lead-row"><div></div><div><strong>No projects yet</strong><small>Create one to start</small></div></div>`;
    return;
  }
  state.projects.forEach((p) => {
    const card = document.createElement("div");
    card.className = `project-card ${p.id === state.activeProjectId ? "active" : ""}`;
    const wsName =
      state.workspaces.find((w) => (w.id || w.workspace_id) === p.workspace_id)?.name ||
      p.workspace_id ||
      "All workspaces";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <small>CRM: ${escapeHtml(wsName)} · Auto CRM ${p.auto_sync_crm ? "on" : "off"} · Auto WA ${p.auto_sync_wa ? "on" : "off"}</small>
        <small>CRM leads: ${(p.crm_count || 0).toLocaleString()} · WA contacts: ${(p.wa_count || 0).toLocaleString()}</small>
      </div>
      <div class="actions">
        <button type="button" class="btn ghost" data-act="use">${p.id === state.activeProjectId ? "Active" : "Open"}</button>
        <button type="button" class="btn ghost" data-act="sync">Sync now</button>
        <button type="button" class="btn ghost" data-act="del">Delete</button>
      </div>`;
    card.querySelector('[data-act="use"]').onclick = () => activateProject(p.id, true);
    card.querySelector('[data-act="sync"]').onclick = () => syncProject(p.id);
    card.querySelector('[data-act="del"]').onclick = () => deleteProject(p.id);
    wrap.appendChild(card);
  });
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects || [];
  state.activeProjectId = data.active_id || state.projects[0]?.id || null;
  renderProjectSelect();
  renderProjectList();
  return data;
}

async function activateProject(id, bootstrap = true) {
  toast(bootstrap ? "Switching project & syncing…" : "Switching project…");
  const data = await api(`/api/projects/${id}/activate?bootstrap=${bootstrap ? "1" : "0"}`, {
    method: "POST",
  });
  state.activeProjectId = data.project?.id || id;
  await loadProjects();
  const boot = data.bootstrap || {};
  const crmN = boot.crm?.synced;
  const waN = boot.whatsapp?.synced;
  if (bootstrap) {
    toast(
      `Project active` +
        (crmN != null ? ` · CRM ${crmN}` : "") +
        (waN != null ? ` · WA ${waN}` : "")
    );
  } else toast("Project active");
  state.lastQueryKey = "";
  await Promise.all([refreshLeads(true).catch(() => {}), loadAnalytics().catch(() => {})]);
}

async function syncProject(id) {
  toast("Syncing project (CRM + WhatsApp)…");
  const data = await api(`/api/projects/${id}/sync`, { method: "POST" });
  await loadProjects();
  const crmN = data.crm?.synced ?? 0;
  const waN = data.whatsapp?.synced ?? 0;
  toast(`Synced · CRM ${crmN} · WA ${waN}`);
  state.lastQueryKey = "";
  await Promise.all([refreshLeads(true).catch(() => {}), loadAnalytics().catch(() => {})]);
}

async function deleteProject(id) {
  if (!confirm("Delete this project?")) return;
  await api(`/api/projects/${id}`, { method: "DELETE" });
  toast("Project deleted");
  await loadProjects();
  state.lastQueryKey = "";
  await refreshLeads(true).catch(() => {});
}

async function createProject() {
  const name = ($("projectName").value || "").trim();
  if (!name) return toast("Enter a project name", true);
  toast("Creating project & auto-fetching…");
  const data = await api("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      workspace_id: $("projectWorkspace").value || null,
      auto_sync_crm: $("projectAutoCrm").checked,
      auto_sync_wa: $("projectAutoWa").checked,
      activate: true,
      bootstrap: true,
    }),
  });
  $("projectName").value = "";
  state.activeProjectId = data.project?.id;
  await loadProjects();
  const boot = data.bootstrap || {};
  toast(
    `Project ready · CRM ${boot.crm?.synced ?? 0} · WA ${boot.whatsapp?.synced ?? 0}`
  );
  state.lastQueryKey = "";
  await Promise.all([refreshLeads(true).catch(() => {}), loadAnalytics().catch(() => {})]);
  showView("bulk");
}

async function loadMeta() {
  const meta = await api("/api/meta");
  state.lastMeta = meta;
  state.labels = meta.status_labels || {};
  state.workspaces = meta.workspaces || [];
  if (meta.projects) {
    state.projects = meta.projects.projects || [];
    state.activeProjectId = meta.projects.active_id || state.projects[0]?.id || null;
  }
  renderStageChips();
  fillWorkspaceSelects();
  alignProjectToWorkspace(false);
  renderProjectSelect();
  renderProjectList();

  const ab = meta.anti_block || {};
  $("antiPill").textContent = `Safe send · ${ab.delay_min || 8}–${ab.delay_max || 18}s · cap ${ab.daily_cap || 800}/day`;
}

async function loadAnalytics() {
  const a = await api("/api/analytics");
  state.stageCounts = a.stage_counts || a.by_status || state.stageCounts;
  $("kpiLeads").textContent = (a.total_leads || 0).toLocaleString();
  if ($("kpiCrm")) $("kpiCrm").textContent = (a.crm_leads || 0).toLocaleString();
  if ($("kpiExcel")) $("kpiExcel").textContent = (a.excel_leads || 0).toLocaleString();
  if ($("kpiWa")) $("kpiWa").textContent = (a.whatsapp_contacts || 0).toLocaleString();
  $("kpiSent").textContent = (a.messages_sent || 0).toLocaleString();
  $("kpiActive").textContent = a.active_campaigns || 0;
  if ($("kpiScheduled")) $("kpiScheduled").textContent = `${a.scheduled || 0} scheduled`;
  renderStageChips();
}

async function refreshLeads(force = false) {
  const body = filters();
  const key = JSON.stringify(body);
  if (!force && key === state.lastQueryKey && state.leads.length) {
    updatePreview();
    return;
  }
  const reqId = (state.querySeq = (state.querySeq || 0) + 1);
  $("matchCount").textContent = "…";
  if ($("posterRecipientCount")) $("posterRecipientCount").textContent = "…";
  try {
    const data = await api("/api/leads/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (reqId !== state.querySeq) return; // newer filter click won
    state.lastQueryKey = key;
    state.count = data.count || 0;
    state.leads = data.leads || [];
    if (data.stage_counts) {
      state.stageCounts = data.stage_counts;
      renderStageChips();
    }
    $("matchCount").textContent = state.count.toLocaleString();
    if ($("posterRecipientCount")) $("posterRecipientCount").textContent = state.count.toLocaleString();
    _paintLeadResults(data);
  } catch (e) {
    if (reqId !== state.querySeq) return;
    $("matchCount").textContent = String(state.count || 0);
    throw e;
  }
}

function _paintLeadResults(data) {

  const br = $("statusBreakdown");
  br.innerHTML = "";
  const breakdown = data.stats?.by_status || data.stage_counts || {};
  Object.entries(breakdown)
    .filter(([, v]) => Number(v) > 0)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      const s = document.createElement("span");
      s.textContent = `${labelStatus(k)} · ${Number(v).toLocaleString()}`;
      br.appendChild(s);
    });

  const list = $("leadList");
  const frag = document.createDocumentFragment();
  if (!state.leads.length) {
    const empty = document.createElement("div");
    empty.className = "lead-row";
    empty.innerHTML = `<div></div><div><strong>No leads matched</strong><small>Sync CRM or WhatsApp contacts</small></div>`;
    frag.appendChild(empty);
  } else {
    state.leads.slice(0, 50).forEach((l) => {
      const row = document.createElement("div");
      row.className = "lead-row";
      const initial = (l.full_name || "?").trim().charAt(0).toUpperCase();
      row.innerHTML = `
        <div class="lead-av">${escapeHtml(initial)}</div>
        <div>
          <strong>${escapeHtml(l.full_name || "Lead")}</strong>
          <small>${escapeHtml(l.phone || "")} · ${escapeHtml(l.origin || "")}</small>
        </div>
        <div class="row-actions">
          <span class="badge">${escapeHtml(labelStatus(l.status || ""))}</span>
          <button type="button" data-act="edit">Edit</button>
          <button type="button" data-act="del">Del</button>
        </div>`;
      row.querySelector('[data-act="edit"]').onclick = () => fillLeadForm(l);
      row.querySelector('[data-act="del"]').onclick = () => deleteLeadRow(l);
      frag.appendChild(row);
    });
    if (data.truncated) {
      const more = document.createElement("div");
      more.className = "lead-row";
      more.innerHTML = `<div></div><div><strong>+${(state.count - 50).toLocaleString()} more</strong><small>All matched will be messaged</small></div>`;
      frag.appendChild(more);
    }
  }
  list.replaceChildren(frag);
  updatePreview();
}

function fillLeadForm(lead) {
  state.editingLeadId = lead.id;
  $("leadEditId").value = lead.id;
  $("leadName").value = lead.full_name || "";
  $("leadPhone").value = lead.phone || "";
  $("leadStatus").value = lead.status || "new";
  $("leadNotes").value = lead.notes || "";
  $("btnSaveLead").textContent = "Update Lead";
  document.querySelector(".crud-box")?.setAttribute("open", "");
}

function clearLeadForm() {
  state.editingLeadId = null;
  $("leadEditId").value = "";
  $("leadName").value = "";
  $("leadPhone").value = "";
  $("leadNotes").value = "";
  $("btnSaveLead").textContent = "Save Lead";
}

async function saveLeadRow() {
  const payload = {
    full_name: $("leadName").value.trim() || "Lead",
    phone: $("leadPhone").value.trim(),
    status: $("leadStatus").value || "new",
    notes: $("leadNotes").value.trim(),
    origin: "manual",
    source: "manual",
  };
  if (!payload.phone) throw new Error("Phone required");
  const id = $("leadEditId").value;
  if (id) {
    await api(`/api/leads/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast("Lead updated");
  } else {
    await api("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    toast("Lead created");
  }
  clearLeadForm();
  state.lastQueryKey = "";
  await refreshLeads(true);
  loadAnalytics().catch(() => {});
}

async function deleteLeadRow(lead) {
  if (!confirm(`Delete ${lead.full_name || lead.phone}?`)) return;
  await api(`/api/leads/${lead.id}`, { method: "DELETE" });
  toast("Lead deleted");
  state.lastQueryKey = "";
  await refreshLeads(true);
  loadAnalytics().catch(() => {});
}

async function loadTemplates() {
  const data = await api("/api/templates");
  const wrap = $("templates");
  if (wrap) {
    wrap.innerHTML = "";
    (data.templates || []).forEach((t) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tpl";
      b.textContent = t.name;
      b.onclick = () => {
        $("message").value = t.body || "";
        if (t.kind) setKind(t.kind === "template" ? "bulk" : t.kind);
        updatePreview();
        showView("bulk");
        toast(`Loaded template: ${t.name}`);
      };
      wrap.appendChild(b);
    });
  }

  const list = $("tplList");
  if (list) {
    list.innerHTML = "";
    if (!(data.templates || []).length) {
      list.innerHTML = `<p class="hint">No templates yet. Create one on the left.</p>`;
    }
    (data.templates || []).forEach((t) => {
      const card = document.createElement("div");
      card.className = "tpl-card";
      card.innerHTML = `
        <div>
          <strong>${escapeHtml(t.name)}</strong>
          <span class="badge">${escapeHtml(t.kind || "bulk")}</span>
          <p>${escapeHtml(t.body || "")}</p>
        </div>
        <div class="row-actions">
          <button type="button" class="btn ghost tiny" data-act="use">Use</button>
          <button type="button" class="btn ghost tiny" data-act="edit">Edit</button>
          <button type="button" class="btn ghost tiny" data-act="del">Delete</button>
        </div>`;
      card.querySelector('[data-act="use"]').onclick = () => {
        $("message").value = t.body || "";
        setKind(t.kind === "poster" ? "poster" : t.kind === "reminder" ? "reminder" : "bulk");
        updatePreview();
        showView("bulk");
      };
      card.querySelector('[data-act="edit"]').onclick = () => {
        $("tplName").value = t.name || "";
        $("tplBody").value = t.body || "";
        $("tplKind").value = t.kind || "bulk";
        $("btnCreateTpl").dataset.editId = t.id;
        $("btnCreateTpl").textContent = "Update Template";
        toast("Editing template — save to update");
      };
      card.querySelector('[data-act="del"]').onclick = async () => {
        if (!confirm(`Delete template "${t.name}"?`)) return;
        await api(`/api/templates/${t.id}`, { method: "DELETE" });
        toast("Template deleted");
        loadTemplates();
      };
      list.appendChild(card);
    });
  }
}

async function loadPosters() {
  const data = await api("/api/posters");
  state.posters = data.posters || [];

  const fillSelect = (sel) => {
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">No poster — text only</option>`;
    state.posters.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  };
  fillSelect($("posterSelect"));
  fillSelect($("posterSelectPage"));

  const grid = $("posterGrid");
  if (grid) {
    grid.innerHTML = "";
    if (!state.posters.length) {
      grid.innerHTML = `<p class="hint">No posters yet. Upload an image to start.</p>`;
    }
    state.posters.forEach((p) => {
      const card = document.createElement("div");
      card.className = `poster-card ${state.selectedPoster === p.name ? "on" : ""}`;
      card.innerHTML = `
        <button type="button" class="poster-pick"><img src="${p.url}" alt="" /><span>${escapeHtml(p.name)}</span></button>
        <button type="button" class="btn ghost tiny" data-act="del">Delete</button>`;
      card.querySelector(".poster-pick").onclick = () => {
        state.selectedPoster = p.name;
        if ($("posterSelect")) $("posterSelect").value = p.name;
        if ($("posterSelectPage")) $("posterSelectPage").value = p.name;
        if ($("posterPreview")) $("posterPreview").src = p.url;
        updatePreview();
        updatePosterPage();
        loadPosters();
      };
      card.querySelector('[data-act="del"]').onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete poster ${p.name}?`)) return;
        await api(`/api/posters/${encodeURIComponent(p.name)}`, { method: "DELETE" });
        if (state.selectedPoster === p.name) state.selectedPoster = null;
        toast("Poster deleted");
        loadPosters();
      };
      grid.appendChild(card);
    });
  }
}

async function loadCampaigns() {
  const data = await api("/api/campaigns");
  const rows = data.campaigns || [];
  const body = $("campaignsBody");
  body.innerHTML = "";

  if ($("campTotal")) {
    $("campTotal").textContent = String(rows.length);
    $("campActive").textContent = String(rows.filter((c) => ["queued", "running", "cooling", "paused", "scheduled"].includes(c.status)).length);
    $("campDone").textContent = String(rows.filter((c) => c.status === "completed").length);
    $("campFailed").textContent = String(rows.reduce((n, c) => n + (c.failed || 0), 0));
  }

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9">No campaigns yet. Create one from Bulk Messaging or Bulk Posters.</td></tr>`;
    return;
  }

  rows.slice(0, 50).forEach((c) => {
    const tr = document.createElement("tr");
    const when = c.created_at ? new Date(c.created_at).toLocaleString() : "—";
    const type = c.kind === "poster" ? "Poster" : c.kind === "reminder" ? "Reminder" : "Bulk";
    tr.innerHTML = `
      <td><strong>${escapeHtml(c.name || "Campaign")}</strong></td>
      <td>${type}</td>
      <td>${c.total || 0}</td>
      <td>${c.sent || 0}</td>
      <td>${c.delivered || c.sent || 0}</td>
      <td>${c.failed || 0}</td>
      <td>${escapeHtml(when)}</td>
      <td><span class="status-pill ${escapeHtml(c.status || "")}">${escapeHtml(c.status || "")}</span></td>
      <td class="row-actions"></td>`;
    const actions = tr.querySelector(".row-actions");
    const statsBtn = document.createElement("button");
    statsBtn.type = "button";
    statsBtn.textContent = "Stats";
    statsBtn.onclick = () =>
      toast(`${c.name}: sent ${c.sent}/${c.total}, failed ${c.failed || 0}${c.pause_reason ? " · " + c.pause_reason : ""}`);
    actions.appendChild(statsBtn);
    if (["running", "queued", "cooling", "paused", "scheduled"].includes(c.status)) {
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.onclick = async () => {
        await api(`/api/campaigns/${c.id}/cancel`, { method: "POST" });
        toast("Cancelled");
        loadCampaigns();
        loadAnalytics();
      };
      actions.appendChild(cancel);
    }
    if (c.status === "paused") {
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "Resume";
      resume.onclick = async () => {
        await api(`/api/campaigns/${c.id}/resume`, { method: "POST" });
        toast("Resumed");
        watchCampaign(c.id);
        loadCampaigns();
      };
      actions.appendChild(resume);
    }
    const rename = document.createElement("button");
    rename.type = "button";
    rename.textContent = "Rename";
    rename.onclick = async () => {
      const name = prompt("Campaign name", c.name || "");
      if (!name) return;
      await api(`/api/campaigns/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      toast("Renamed");
      loadCampaigns();
    };
    actions.appendChild(rename);
    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Delete";
    del.onclick = async () => {
      if (!confirm(`Delete campaign "${c.name}"?`)) return;
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      toast("Campaign deleted");
      loadCampaigns();
      loadAnalytics().catch(() => {});
    };
    actions.appendChild(del);
    body.appendChild(tr);
  });
}

function setKind(kind) {
  const uiKind = kind;
  const prev = state.kind;
  state.kind = kind === "template" ? "bulk" : kind;
  document.querySelectorAll("#kindTabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.kind === uiKind);
  });
  if (state.kind === "reminder") {
    $("reminderOnly").checked = true;
  } else if (prev === "reminder") {
    $("reminderOnly").checked = false;
  }
  updatePreview();
  if (state.kind === "reminder" || prev === "reminder") {
    refreshLeads(true).catch(() => {});
  }
}

function setSource(source) {
  state.source = source;
  document.querySelectorAll("#recipientTabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.source === source);
  });
  // Source tabs own the pool — clear stage chips so counts aren't zeroed by sticky filters
  if (source !== "all") {
    state.statuses.clear();
    renderStageChips(true);
  }
  refreshLeads(true).catch((e) => toast(e.message, true));
}

function campaignPayload(extra = {}) {
  const f = filters();
  return {
    session: ($("sendFrom") && $("sendFrom").value) || state.activeSession || null,
    name: $("campaignName").value.trim() || "CRM broadcast",
    kind: state.selectedPoster ? "poster" : state.kind === "template" ? "bulk" : state.kind,
    message: $("message").value,
    poster: state.selectedPoster || null,
    ...f,
    ...extra,
  };
}

async function createCampaign(extra = {}) {
  if (!state.count) throw new Error("No recipients selected — adjust filters first");
  if (!($("message").value || "").trim() && !state.selectedPoster) throw new Error("Write a message or choose a poster");
  return api("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(campaignPayload(extra)),
  });
}

async function createPosterCampaign(extra = {}) {
  const poster = $("posterSelectPage")?.value || state.selectedPoster;
  if (!poster) throw new Error("Select a poster");
  if (!state.count) throw new Error("No recipients selected — set filters in Bulk Messaging");
  state.selectedPoster = poster;
  return api("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: $("posterCampaignName").value.trim() || "Poster blast",
      kind: "poster",
      message: $("posterCaption").value || "",
      session: ($("sendFrom") && $("sendFrom").value) || state.activeSession || null,
      poster,
      ...filters(),
      ...extra,
    }),
  });
}

function watchCampaign(id) {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    try {
      const c = await api(`/api/campaigns/${id}`);
      if ($("antiPill")) {
        $("antiPill").textContent = `${c.status} · ${c.sent || 0}/${c.total || 0}` + (c.pause_reason ? ` · ${c.pause_reason}` : "");
      }
      if (["completed", "cancelled", "dry_run", "paused"].includes(c.status)) {
        clearInterval(state.poll);
        loadCampaigns();
        loadAnalytics();
        if (c.status === "completed") toast(`Done · sent ${c.sent}/${c.total}`);
        if (c.status === "paused") toast(c.pause_reason || "Paused", true);
      }
    } catch {
      clearInterval(state.poll);
    }
  }, 2500);
}

async function syncCrm() {
  toast("Syncing CRM leads…");
  const data = await api("/api/crm/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: $("workspaceSelect").value || null }),
  });
  toast(`Synced ${data.synced} CRM leads`);
  await loadAnalytics();
  await refreshLeads();
}

async function syncContacts() {
  toast("Fetching WhatsApp contacts…");
  const data = await api("/api/contacts/sync", { method: "POST" });
  toast(`Synced ${data.synced} WhatsApp contacts`);
  state.statuses.clear();
  state.source = "whatsapp";
  document.querySelectorAll("#recipientTabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.source === "whatsapp");
  });
  renderStageChips(true);
  state.lastQueryKey = "";
  await Promise.all([loadAnalytics().catch(() => {}), refreshLeads(true)]);
  showView("bulk");
}

function _paintQrStatus(st, extra = "") {
  const label =
    st === "WORKING"
      ? "Connected"
      : st === "SCAN_QR_CODE"
        ? "Scan this QR now — keep this screen open"
        : (st || "UNKNOWN").replaceAll("_", " ");
  $("qrStatusText").textContent = extra ? `${label} · ${extra}` : label;
  $("qrDot").className = `dot ${st === "WORKING" ? "on" : st === "SCAN_QR_CODE" ? "warn" : "off"}`;
  if ($("infoStatus")) $("infoStatus").textContent = st || "—";
}

function _showQrImage(dataUrl) {
  if (!dataUrl) return;
  state.qrShownAt = Date.now();
  $("qrImage").src = dataUrl;
  $("qrImage").classList.remove("hidden");
  $("qrPlaceholder").classList.add("hidden");
}

async function loadQrImage({ fresh = false, restart = false } = {}) {
  if (state.qrFetchBusy) return;
  state.qrFetchBusy = true;
  const hadQr = !$("qrImage").classList.contains("hidden") && ($("qrImage").src || "").startsWith("data:image");
  try {
    if (restart && !hadQr) {
      $("qrPlaceholder").classList.remove("hidden");
      $("qrPlaceholder").textContent = "Starting WhatsApp…";
    }
    if (restart) {
      try {
        await api(`/api/session/start${sessionQuery()}`, { method: "POST" });
      } catch (e) {
        console.warn(e);
      }
    }
    const data = await api(`/api/session/qr${sessionQuery(fresh ? "fresh=1" : "")}`);
    const st = data.status || "UNKNOWN";
    _paintQrStatus(st);
    if (st === "WORKING") {
      $("qrImage").classList.add("hidden");
      $("qrPlaceholder").classList.remove("hidden");
      $("qrPlaceholder").textContent = "WhatsApp connected ✓";
      clearTimeout(state.qrPoll);
      state.qrPoll = null;
      clearInterval(state.qrRefresh);
      state.qrRefresh = null;
      health().catch(() => {});
      toast("WhatsApp connected");
      return data;
    }
    if (data.qr) {
      _showQrImage(data.qr);
      if (!hadQr || fresh || restart) toast(fresh ? "New QR ready — scan now" : "QR ready — scan with WhatsApp");
    } else if (!hadQr) {
      $("qrImage").classList.add("hidden");
      $("qrPlaceholder").classList.remove("hidden");
      $("qrPlaceholder").textContent =
        data.error ||
        (st === "STARTING" ? "Starting browser… QR appears in a few seconds" : "Waiting for QR…");
    }
    return data;
  } finally {
    state.qrFetchBusy = false;
  }
}

async function pollSessionStatus() {
  if (state.qrStatusBusy) return null;
  state.qrStatusBusy = true;
  try {
    // Lightweight fetch — abort if slower than 2.5s so the loop stays snappy
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    let data;
    try {
      const res = await fetch(`/api/session/status${sessionQuery()}`, { signal: ctrl.signal, cache: "no-store" });
      data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "status failed");
    } finally {
      clearTimeout(timer);
    }
    const st = data.status || "UNKNOWN";
    state.lastSessionStatus = st;
    const age = state.qrShownAt ? Math.round((Date.now() - state.qrShownAt) / 1000) : 0;
    _paintQrStatus(st, st === "SCAN_QR_CODE" && age ? `${age}s` : "");
    if (data.phone) {
      state.connectedPhone = String(data.phone).replace(/\D/g, "");
      if ($("infoPhone")) $("infoPhone").textContent = `+${state.connectedPhone}`;
    }
    if (data.me?.pushName && $("infoName")) $("infoName").textContent = data.me.pushName;
    if (st === "WORKING") {
      $("qrImage").classList.add("hidden");
      $("qrPlaceholder").classList.remove("hidden");
      $("qrPlaceholder").textContent = "WhatsApp connected ✓";
      clearTimeout(state.qrPoll);
      state.qrPoll = null;
      clearInterval(state.qrRefresh);
      state.qrRefresh = null;
      health().catch(() => {});
      toast("WhatsApp connected");
      // Auto-pull contacts once after connect so WA Contacts tab fills immediately
      if (!state.didAutoSyncContacts) {
        state.didAutoSyncContacts = true;
        syncContacts().catch((e) => toast(e.message || "Contact sync failed", true));
      }
      return st;
    }
    // Recover only when truly dead — never flap-restart while SCAN_QR_CODE
    const dead = ["FAILED", "STOPPED", "MISSING"].includes(st) || data.engine_state === "UNPAIRED_IDLE";
    const now = Date.now();
    if (
      dead &&
      !state.qrFetchBusy &&
      !state.qrAutoRecovering &&
      now - (state.qrLastRecoverAt || 0) > 20000
    ) {
      state.qrAutoRecovering = true;
      state.qrLastRecoverAt = now;
      toast("Session dropped — restarting…", true);
      loadQrImage({ restart: true })
        .catch(() => {})
        .finally(() => {
          state.qrAutoRecovering = false;
        });
    }
    return st;
  } catch (e) {
    console.warn(e);
    return null;
  } finally {
    state.qrStatusBusy = false;
  }
}

function _scheduleStatusPoll(delayMs) {
  clearTimeout(state.qrPoll);
  if (state.view !== "connect") return;
  state.qrPoll = setTimeout(async () => {
    const st = await pollSessionStatus().catch(() => null);
    if (state.view !== "connect" || st === "WORKING") return;
    // After phone scan, WAHA flips to WORKING — poll every 400ms for instant detect
    _scheduleStatusPoll(400);
  }, delayMs);
}

function startQrLoop({ restart = false } = {}) {
  clearTimeout(state.qrPoll);
  clearInterval(state.qrRefresh);
  state.qrPoll = null;
  // 1) Load QR image once (or restart session)
  loadQrImage({ restart, fresh: false }).catch((e) => toast(e.message, true));
  // 2) Fast status loop — detects phone scan almost immediately (does NOT re-fetch QR)
  _scheduleStatusPoll(300);
  // 3) Soft-refresh QR image every 25s only (WhatsApp QR expires ~20–40s)
  state.qrRefresh = setInterval(() => {
    if (state.view !== "connect") return;
    if (state.lastSessionStatus === "WORKING") return;
    loadQrImage({ fresh: true }).catch(() => {});
  }, 25000);
}

async function uploadPoster(file) {
  const fd = new FormData();
  fd.append("file", file);
  const data = await api("/api/posters", { method: "POST", body: fd });
  await loadPosters();
  state.selectedPoster = data.name;
  if ($("posterSelect")) $("posterSelect").value = data.name;
  if ($("posterSelectPage")) $("posterSelectPage").value = data.name;
  if ($("posterPreview")) $("posterPreview").src = data.url;
  updatePreview();
  updatePosterPage();
  toast("Poster uploaded");
}

function wire() {
  applyTheme(localStorage.getItem("wa_theme") === "dark");

  $("btnTheme").onclick = () => applyTheme(!document.documentElement.classList.contains("dark"));
  $("btnSidebar").onclick = () => {
    $("sidebar").classList.toggle("open");
    $("backdrop").classList.toggle("hidden");
  };
  $("backdrop").onclick = () => {
    $("sidebar").classList.remove("open");
    $("backdrop").classList.add("hidden");
  };

  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.onclick = () => showView(btn.dataset.view);
  });
  document.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.onclick = () => showView(btn.dataset.goto);
  });

  $("btnConnectTop").onclick = () => showView("connect");
  $("openConnect").onclick = () => showView("connect");

  $("btnRefreshQr").onclick = () =>
    withBusy($("btnRefreshQr"), "…", () => {
      toast("Refreshing QR…");
      // Fresh PNG only — do not wipe the running session
      return loadQrImage({ fresh: true }).catch((e) => toast(e.message, true));
    });
  $("btnStartSession").onclick = () =>
    withBusy($("btnStartSession"), "…", async () => {
      toast("Starting session…");
      startQrLoop({ restart: true });
    });
  $("btnLogoutWa").onclick = () =>
    withBusy($("btnLogoutWa"), "…", async () => {
      try {
        const data = await api(`/api/session/logout${sessionQuery()}`, { method: "POST" });
        const n = data.contacts_removed || 0;
        toast(`Disconnected. ${n.toLocaleString()} WhatsApp contacts removed. CRM leads kept.`);
        await refreshAfterWhatsAppClear();
        startQrLoop({ restart: true });
      } catch (e) {
        toast(e.message, true);
      }
    });
  if ($("btnAddAccount")) {
    $("btnAddAccount").onclick = () =>
      withBusy($("btnAddAccount"), "…", async () => {
        const label = ($("accountLabel").value || "").trim();
        if (!label) return toast("Name this WhatsApp number", true);
        toast("Starting a new WhatsApp…");
        const data = await api("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
        $("accountLabel").value = "";
        state.activeSession = data.account?.id || state.activeSession;
        await health();
        startQrLoop({ restart: false });
        toast(data.error ? `Number added. Engine: ${data.error}` : "Scan the QR for this number", Boolean(data.error));
      });
  }
  if ($("sendFrom")) {
    $("sendFrom").onchange = () => {
      const id = $("sendFrom").value;
      if (id) selectAccount(id).catch((e) => toast(e.message, true));
    };
  }

  $("btnSyncContactsPage").onclick = () =>
    withBusy($("btnSyncContactsPage"), "…", () => syncContacts().catch((e) => toast(e.message, true)));

  document.querySelectorAll("#recipientTabs .tab").forEach((t) => {
    t.onclick = () => setSource(t.dataset.source);
  });
  document.querySelectorAll("#kindTabs .tab").forEach((t) => {
    t.onclick = () => setKind(t.dataset.kind);
  });

  document.querySelectorAll(".biz").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll(".biz").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const ws = $("workspaceSelect");
      if (!b.dataset.biz) ws.value = "";
      else {
        const match = [...ws.options].find((o) => (o.textContent || "").toLowerCase().includes(b.dataset.biz));
        if (match) ws.value = match.value;
      }
      refreshLeads();
    };
  });

  document.querySelectorAll(".toolbar [data-fmt]").forEach((b) => {
    b.onclick = () => {
      const mark = b.dataset.fmt;
      const ta = $("message");
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const selected = value.slice(s, e) || "text";
      ta.value = value.slice(0, s) + mark + selected + mark + value.slice(e);
      updatePreview();
    };
  });

  $("varInsert").onchange = () => {
    const v = $("varInsert").value;
    if (!v) return;
    const ta = $("message");
    const s = ta.selectionStart || ta.value.length;
    ta.value = ta.value.slice(0, s) + v + ta.value.slice(s);
    $("varInsert").value = "";
    updatePreview();
  };

  $("message").oninput = updatePreview;
  $("btnEmoji").onclick = () => {
    $("message").value += " 🙂";
    updatePreview();
  };

  let searchTimer;
  $("search").oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshLeads, 120);
  };
  ["dateFrom", "dateTo", "reminderOnly"].forEach((id) => {
    $(id).addEventListener("change", refreshLeads);
  });
  if ($("workspaceSelect")) {
    $("workspaceSelect").addEventListener("change", () => alignProjectToWorkspace(true));
  }

  $("btnRefresh").onclick = () =>
    withBusy($("btnRefresh"), "…", async () => {
      state.lastQueryKey = "";
      await refreshLeads(true);
      toast("Refreshed");
    });
  $("btnSync").onclick = () =>
    withBusy($("btnSync"), "…", () => syncCrm().catch((e) => toast(e.message, true)));
  $("btnSyncContacts").onclick = () =>
    withBusy($("btnSyncContacts"), "…", () => syncContacts().catch((e) => toast(e.message, true)));
  $("btnReloadCampaigns").onclick = () =>
    withBusy($("btnReloadCampaigns"), "…", async () => {
      await loadCampaigns();
      toast("Campaigns refreshed");
    });

  $("excelFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const data = await api("/api/leads/import", { method: "POST", body: fd });
      toast(`Imported ${data.imported} Excel leads`);
      state.statuses.add("excel");
      setSource("excel");
      await loadAnalytics();
      await refreshLeads();
    } catch (err) {
      toast(err.message, true);
    }
    e.target.value = "";
  };

  $("posterSelect").onchange = () => {
    state.selectedPoster = $("posterSelect").value || null;
    $("posterPreview").src = state.selectedPoster ? `/posters/${state.selectedPoster}` : "";
    updatePreview();
  };
  $("posterFile").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadPoster(file);
    } catch (err) {
      toast(err.message, true);
    }
    e.target.value = "";
  };
  $("posterFilePage").onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadPoster(file);
    } catch (err) {
      toast(err.message, true);
    }
    e.target.value = "";
  };
  $("posterSelectPage").onchange = () => {
    state.selectedPoster = $("posterSelectPage").value || null;
    updatePosterPage();
  };
  $("posterCaption").oninput = updatePosterPage;
  $("posterDryRun").onclick = () =>
    withBusy($("posterDryRun"), "…", async () => {
      toast("Previewing…");
      try {
        const c = await createPosterCampaign({ dry_run: true });
        toast(`Preview OK · ${c.total} recipients`);
        loadCampaigns().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });
  $("posterSend").onclick = () =>
    withBusy($("posterSend"), "…", async () => {
      if (!confirm(`Send poster to ${state.count.toLocaleString()} leads?`)) return;
      try {
        const c = await createPosterCampaign({});
        toast(`Poster campaign started · ${c.total}`);
        watchCampaign(c.id);
        showView("campaigns");
        loadCampaigns().catch(() => {});
        loadAnalytics().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });

  $("btnSaveTpl").onclick = () =>
    withBusy($("btnSaveTpl"), "…", async () => {
      try {
        await api("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: $("campaignName").value.trim() || "Template",
            body: $("message").value,
            kind: state.kind,
          }),
        });
        toast("Template saved");
        loadTemplates().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });
  $("btnCreateTpl").onclick = () =>
    withBusy($("btnCreateTpl"), "…", async () => {
      try {
        const name = $("tplName").value.trim();
        const body = $("tplBody").value.trim();
        if (!name || !body) throw new Error("Name and body required");
        const editId = $("btnCreateTpl").dataset.editId;
        const payload = { name, body, kind: $("tplKind").value || "bulk" };
        if (editId) {
          await api(`/api/templates/${editId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          toast("Template updated");
          delete $("btnCreateTpl").dataset.editId;
          $("btnCreateTpl").textContent = "Save Template";
        } else {
          await api("/api/templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          toast("Template created");
        }
        $("tplName").value = "";
        $("tplBody").value = "";
        loadTemplates().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });

  $("btnSaveLead").onclick = () =>
    withBusy($("btnSaveLead"), "…", () => saveLeadRow().catch((e) => toast(e.message, true)));
  $("btnClearLead").onclick = () => {
    clearLeadForm();
    toast("Form cleared");
  };

  $("dryRun").onclick = () =>
    withBusy($("dryRun"), "…", async () => {
      toast("Previewing…");
      try {
        const c = await createCampaign({ dry_run: true });
        toast(`Preview OK · ${c.total} recipients`);
        loadCampaigns().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });
  $("btnSchedule").onclick = () =>
    withBusy($("btnSchedule"), "…", async () => {
      const at = $("scheduleAt").value;
      if (!at) return toast("Pick schedule time", true);
      try {
        const c = await createCampaign({ scheduled_at: new Date(at).toISOString() });
        toast(`Scheduled · ${c.total} leads`);
        watchCampaign(c.id);
        showView("campaigns");
        loadCampaigns().catch(() => {});
        loadAnalytics().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });
  $("sendBtn").onclick = () =>
    withBusy($("sendBtn"), "…", async () => {
      const what = state.selectedPoster ? "message and poster together" : "message";
      if (!confirm(`Send this ${what} to ${state.count.toLocaleString()} leads?`)) return;
      toast("Starting campaign…");
      try {
        const c = await createCampaign({});
        toast(`Started · ${c.total} leads`);
        watchCampaign(c.id);
        showView("campaigns");
        loadCampaigns().catch(() => {});
        loadAnalytics().catch(() => {});
      } catch (e) {
        toast(e.message, true);
      }
    });

  // Settings page
  $("settingDark").onchange = () => applyTheme($("settingDark").checked);
  $("btnSettingsSyncCrm").onclick = () =>
    withBusy($("btnSettingsSyncCrm"), "…", () => syncCrm().catch((e) => toast(e.message, true)));
  $("btnSettingsSyncContacts").onclick = () =>
    withBusy($("btnSettingsSyncContacts"), "…", () => syncContacts().catch((e) => toast(e.message, true)));
  $("btnSettingsRefresh").onclick = () =>
    withBusy($("btnSettingsRefresh"), "…", async () => {
      await safe("Meta", loadMeta);
      await safe("Analytics", loadAnalytics);
      await safe("WhatsApp", health);
      fillSettings();
      toast("Settings refreshed");
    });
  $("btnSettingsLogout").onclick = () =>
    withBusy($("btnSettingsLogout"), "…", async () => {
      try {
        const data = await api(`/api/session/logout${sessionQuery()}`, { method: "POST" });
        const n = data.contacts_removed || 0;
        toast(`Disconnected. ${n.toLocaleString()} WhatsApp contacts removed. CRM leads kept.`);
        await refreshAfterWhatsAppClear();
        fillSettings();
      } catch (e) {
        toast(e.message, true);
      }
    });

  // Projects
  if ($("btnCreateProject")) {
    $("btnCreateProject").onclick = () =>
      withBusy($("btnCreateProject"), "…", () => createProject().catch((e) => toast(e.message, true)));
  }
  if ($("btnReloadProjects")) {
    $("btnReloadProjects").onclick = () =>
      withBusy($("btnReloadProjects"), "…", async () => {
        await loadProjects();
        toast("Projects refreshed");
      });
  }
  if ($("projectSelect")) {
    $("projectSelect").onchange = () => {
      const id = $("projectSelect").value;
      if (id) activateProject(id, true).catch((e) => toast(e.message, true));
    };
  }
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.warn(label, e);
    toast(`${label}: ${e.message || e}`, true);
  }
}

async function boot() {
  wire();
  updatePreview();
  showView(params.get("view") || "bulk");

  // Critical path first for instant usable UI
  await safe("Meta", loadMeta);
  await safe("Leads", () => refreshLeads(true));
  await safe("WhatsApp", health);

  // Secondary data in parallel — does not block clicks
  Promise.all([
    safe("Analytics", loadAnalytics),
    safe("Templates", loadTemplates),
    safe("Posters", loadPosters),
    safe("Campaigns", loadCampaigns),
  ]);

  // Silent CRM sync in background (no toast unless failed hard)
  api("/api/crm/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: $("workspaceSelect").value || null }),
  })
    .then(() => {
      state.lastQueryKey = "";
      return Promise.all([refreshLeads(true), loadAnalytics()]);
    })
    .catch(() => {});

  setInterval(() => {
    health().catch(() => {});
    if (state.view === "bulk" || state.view === "settings") loadAnalytics().catch(() => {});
  }, 30000);
}

boot();
