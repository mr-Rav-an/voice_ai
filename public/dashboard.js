const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pill = (v) => (v ? `<span class="pill p-${esc(v)}">${esc(String(v).replace(/_/g, " "))}</span>` : '<span class="muted">—</span>');
const inr = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN"));
const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const api = async (p, opts) => {
  const r = await fetch(p, opts);
  if (r.status === 401) {
    location.href = "/login";
    throw new Error("Please sign in again");
  }
  let data;
  try { data = await r.json(); } catch { data = {}; }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
};

function toast(msg, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 300);
  }, 4200);
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  for (const n of ["calls", "leads", "upload"]) $("tab-" + n).hidden = n !== name;
}

function validPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

// --- auth ------------------------------------------------------------------
api("/api/me").then((me) => { if ($("who")) $("who").textContent = me.username || ""; }).catch(() => {});
$("btn-logout")?.addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  location.href = "/login";
});

// --- tabs ------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => showTab(t.dataset.tab))
);

// --- render ----------------------------------------------------------------
function renderStats(s) {
  $("stats").innerHTML = [
    ["Leads", s.leads], ["Pending", s.leadsPending], ["Calls", s.calls],
    ["Connected", `${s.connected} <span class="muted" style="font-size:13px">(${s.connectRate}%)</span>`],
    ["Interested", s.interested], ["Booked", s.booked],
    ["Avg duration", s.avgDurationSec ? `${s.avgDurationSec}s` : "—"],
  ].map(([l, n]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`).join("");

  const c = s.campaign || {};
  const left = c.queued != null ? c.queued : c.pending;
  $("campaign-status").innerHTML = c.running
    ? `<span class="dot live"></span>${c.current ? `calling ${esc(c.current.phone)}` : "running"} · ${left} left`
    : `<span class="dot"></span>idle`;
  $("btn-start").disabled = !!c.running;
  $("btn-stop").disabled = !c.running;
}

function renderCalls(calls) {
  const b = $("calls-body");
  if (!calls.length) {
    b.innerHTML = `<tr><td colspan="11" class="empty">No calls yet.<br><span class="muted">Add leads, then start a campaign.</span></td></tr>`;
    return;
  }
  b.innerHTML = calls.map((c) => {
    const cap = c.captured || {};
    return `<tr class="click" data-id="${c.id}">
      <td class="muted">${when(c.startedAt)}</td>
      <td>${esc(c.phone || "—")}</td>
      <td>${esc(c.leadName || "—")}</td>
      <td>${pill(c.outcome || (c.connected ? "connected" : c.exotelStatus))}</td>
      <td>${pill(c.interest)}</td>
      <td>${esc(cap.city || "—")}</td>
      <td>${cap.monthlyBill ? inr(cap.monthlyBill) : "—"}</td>
      <td>${cap.systemKw ? cap.systemKw + " kW" : "—"}</td>
      <td>${c.booking ? `<span class="pill p-interested">${esc(c.booking.id)}</span>` : "—"}</td>
      <td class="muted">${c.durationSec != null ? c.durationSec + "s" : "—"}</td>
      <td class="muted">${c.turns ?? 0}</td>
    </tr>`;
  }).join("");
  b.querySelectorAll("tr.click").forEach((r) => r.addEventListener("click", () => openCall(r.dataset.id)));
}

const selected = new Set();

function syncSelectionUi(leads) {
  for (const id of [...selected]) if (!leads.some((l) => l.id === id)) selected.delete(id);
  const n = selected.size;
  $("btn-call-selected").disabled = n === 0;
  $("btn-del-selected").disabled = n === 0;
  $("btn-call-selected").textContent = n ? `Call selected (${n})` : "Call selected";
  $("btn-del-selected").textContent = n ? `Delete selected (${n})` : "Delete selected";
  const all = $("check-all");
  if (all) {
    all.checked = n > 0 && n === leads.length;
    all.indeterminate = n > 0 && n < leads.length;
  }
  document.querySelectorAll("#leads-body tr[data-lead]").forEach((tr) =>
    tr.classList.toggle("sel", selected.has(tr.dataset.lead))
  );
}

function renderLeads(leads) {
  $("leads-count").textContent = `${leads.length} lead${leads.length === 1 ? "" : "s"}`;
  const b = $("leads-body");
  if (!leads.length) {
    b.innerHTML = `<tr><td colspan="7" class="empty">No leads yet.<br><button type="button" class="ghost" id="go-upload" style="margin-top:12px">Add your first lead →</button></td></tr>`;
    $("go-upload")?.addEventListener("click", () => showTab("upload"));
    syncSelectionUi(leads);
    return;
  }
  b.innerHTML = leads.map((l) => `<tr data-lead="${l.id}">
    <td><input type="checkbox" data-pick="${l.id}" ${selected.has(l.id) ? "checked" : ""}
        ${l.status === "dnc" ? "disabled title='Do not call'" : ""} /></td>
    <td>${esc(l.name || "—")}</td>
    <td>${esc(l.phone)}</td>
    <td>${esc(l.city || "—")}</td>
    <td>${pill(l.status)}</td>
    <td class="muted">${l.attempts}</td>
    <td style="text-align:right; white-space:nowrap">
      <button class="ghost" data-call="${l.id}">Call now</button>
      <button class="danger" data-del="${l.id}">Delete</button>
    </td></tr>`).join("");

  b.querySelectorAll("[data-pick]").forEach((cb) =>
    cb.addEventListener("change", () => {
      cb.checked ? selected.add(cb.dataset.pick) : selected.delete(cb.dataset.pick);
      syncSelectionUi(leads);
    })
  );
  syncSelectionUi(leads);

  b.querySelectorAll("[data-call]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Place a real call to this lead now?")) return;
      btn.disabled = true;
      btn.textContent = "Dialing…";
      try {
        await api(`/api/leads/${btn.dataset.call}/call`, { method: "POST" });
        toast("Call placed");
        refresh();
      } catch (e) {
        toast(e.message, "bad");
        btn.disabled = false;
        btn.textContent = "Call now";
      }
    })
  );
  b.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this lead?")) return;
      await api(`/api/leads/${btn.dataset.del}`, { method: "DELETE" });
      toast("Lead deleted", "warn");
      refresh();
    })
  );
}

async function openCall(id) {
  const c = await api(`/api/calls/${id}`);
  const cap = c.captured || {};
  $("d-title").textContent = `${c.phone || "Call"} · ${c.id}`;

  const rows = [
    ["Started", when(c.startedAt)],
    ["Duration", c.durationSec != null ? c.durationSec + "s" : "—"],
    ["Outcome", c.outcome ? c.outcome.replace(/_/g, " ") : "—"],
    ["Interest", c.interest || "—"],
    ["Reason", c.reason || "—"],
    ["Homeowner", cap.owner ?? "—"],
    ["City", cap.city || "—"],
    ["Monthly bill", cap.monthlyBill ? inr(cap.monthlyBill) : "—"],
    ["Rooftop", cap.rooftopSqft ? cap.rooftopSqft + " sq ft" : "—"],
    ["System sized", cap.systemKw ? cap.systemKw + " kW" : "—"],
    ["Net cost quoted", cap.netCost ? inr(cap.netCost) : "—"],
    ["Annual savings", cap.annualSavings ? inr(cap.annualSavings) : "—"],
    ["Booking", c.booking ? `${esc(c.booking.id)} · ${esc(c.booking.slot || "")}` : "—"],
    ["Exotel status", c.exotelStatus || "—"],
  ];

  const transcript = (c.transcript || []).length
    ? c.transcript.map((t) => `<div class="turn ${t.role === "agent" ? "agent" : ""}">
        <div class="who">${t.role === "agent" ? "Saloni" : "Customer"}</div>
        <div>${esc(t.text)}</div></div>`).join("")
    : `<div class="muted">No speech recorded — the call was not answered, or nobody spoke.</div>`;

  const tools = (c.toolCalls || []).length
    ? `<h3>Tool calls</h3>` + c.toolCalls.map((t) =>
        `<div class="tool">${esc(t.name)}(${esc(JSON.stringify(t.args))})\n→ ${esc(JSON.stringify(t.result))}</div>`).join("")
    : "";

  $("d-body").innerHTML =
    `<div class="kv">${rows.map(([k, v]) => `<div class="k">${k}</div><div>${v}</div>`).join("")}</div>` +
    `<h3>Transcript</h3>${transcript}${tools}`;
  $("detail").showModal();
}

// --- actions ---------------------------------------------------------------
$("btn-start").addEventListener("click", async () => {
  const s = await api("/api/stats");
  const n = s.leadsPending;
  if (!n) return toast("No pending leads to call", "warn");
  if (!confirm(`Call ${n} pending lead${n === 1 ? "" : "s"} now?\n\nThis places real phone calls.`)) return;
  await api("/api/campaign/start", { method: "POST" });
  toast("Campaign started");
  refresh();
});

$("check-all").addEventListener("change", (e) => {
  const rows = [...document.querySelectorAll("#leads-body [data-pick]:not([disabled])")];
  selected.clear();
  if (e.target.checked) rows.forEach((cb) => selected.add(cb.dataset.pick));
  rows.forEach((cb) => (cb.checked = e.target.checked));
  syncSelectionUi([...document.querySelectorAll("#leads-body tr[data-lead]")].map((tr) => ({ id: tr.dataset.lead })));
});

$("btn-call-selected").addEventListener("click", async () => {
  const leadIds = [...selected];
  if (!leadIds.length) return;
  if (!confirm(`Call ${leadIds.length} selected lead${leadIds.length === 1 ? "" : "s"} now?\n\nThis places real phone calls.`)) return;
  const r = await api("/api/campaign/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadIds }),
  });
  if (!r.ok) toast(r.error || "Could not start", "bad");
  else { toast("Calling selected leads"); selected.clear(); }
  refresh();
});

$("btn-del-selected").addEventListener("click", async () => {
  const ids = [...selected];
  if (!ids.length || !confirm(`Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}?`)) return;
  for (const id of ids) await api(`/api/leads/${id}`, { method: "DELETE" });
  selected.clear();
  toast("Selected leads deleted", "warn");
  refresh();
});
$("btn-stop").addEventListener("click", async () => {
  await api("/api/campaign/stop", { method: "POST" });
  toast("Campaign stopped", "warn");
  refresh();
});

async function importCsv(text) {
  if (!text.trim()) return toast("Paste CSV data or choose a file first", "warn");
  const msg = $("import-msg");
  msg.textContent = "Importing…";
  msg.className = "msg";
  try {
    const r = await api("/api/leads", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
    if (!r.added?.length && !r.skipped?.length) {
      msg.className = "msg bad";
      msg.textContent = "Nothing imported — no phone column found.";
      toast("No valid phone numbers found in CSV", "bad");
      return;
    }
    const byReason = {};
    for (const s of r.skipped || []) (byReason[s.reason] ||= []).push(s.phone || s.name || "?");
    const detail = Object.entries(byReason)
      .map(([reason, xs]) => `${xs.length} ${reason}`)
      .join(", ");

    if (r.added?.length) {
      msg.className = "msg ok";
      msg.textContent = `Added ${r.added.length}${detail ? ` · skipped ${r.skipped.length}: ${detail}` : ""}`;
      toast(`Imported ${r.added.length} lead${r.added.length === 1 ? "" : "s"}`);
      $("csv").value = "";
      showTab("leads");
    } else {
      msg.className = "msg bad";
      msg.textContent = `All ${r.skipped.length} skipped: ${detail}`;
      toast(`Import failed — ${detail}`, "bad");
    }
    if (r.warning) toast(r.warning, "warn");
    refresh();
  } catch (e) {
    msg.className = "msg bad";
    msg.textContent = e.message;
    toast(e.message, "bad");
  }
}

$("btn-import").addEventListener("click", () => importCsv($("csv").value));
$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) {
    const text = await f.text();
    $("csv").value = text;
    importCsv(text);
  }
  e.target.value = "";
});

// Drag-and-drop CSV
const dropzone = $("dropzone");
const fileInput = $("file");

dropzone?.addEventListener("click", () => fileInput?.click());
dropzone?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput?.click(); }
});
dropzone?.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone?.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  const f = e.dataTransfer.files[0];
  if (f) {
    const text = await f.text();
    $("csv").value = text;
    importCsv(text);
  }
});

// --- add single lead -------------------------------------------------------
const phoneInput = $("lead-phone");
const phoneHint = $("phone-hint");

phoneInput?.addEventListener("input", () => {
  const v = phoneInput.value.trim();
  if (!v) {
    phoneInput.classList.remove("invalid");
    phoneHint.className = "hint";
    phoneHint.textContent = "10 digits, or +91 / 0 prefix";
    return;
  }
  const ok = validPhone(v);
  phoneInput.classList.toggle("invalid", !ok);
  phoneHint.className = ok ? "hint" : "hint err";
  phoneHint.textContent = ok ? `Will save as ${ok}` : "Invalid — must be a 10-digit mobile starting with 6–9";
});

$("lead-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("lead-name").value.trim();
  const phone = $("lead-phone").value.trim();
  const city = $("lead-city").value.trim();
  const notes = $("lead-notes").value.trim();
  const msg = $("add-msg");
  const btn = $("btn-add-lead");

  if (!phone) {
    msg.className = "msg bad";
    msg.textContent = "Phone number is required.";
    phoneInput.focus();
    return;
  }
  const normalized = validPhone(phone);
  if (!normalized) {
    msg.className = "msg bad";
    msg.textContent = "Invalid phone — use a 10-digit Indian mobile (6–9 first digit).";
    phoneInput.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = "Saving…";
  msg.className = "msg";
  msg.textContent = "";

  try {
    const r = await api("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, city, notes }),
    });

    if (r.added?.length) {
      const lead = r.added[0];
      const label = lead.name ? `${lead.name} (${lead.phone})` : lead.phone;
      msg.className = "msg ok";
      msg.textContent = `Saved ${label}${lead.city ? " · " + lead.city : ""}`;
      toast(`Lead saved — ${label}`);
      if (r.warning) toast(r.warning, "warn");
      $("lead-form").reset();
      phoneInput.classList.remove("invalid");
      phoneHint.className = "hint";
      phoneHint.textContent = "10 digits, or +91 / 0 prefix";
      showTab("leads");
      refresh();
    } else {
      const reason = r.skipped?.[0]?.reason || "Could not add lead";
      msg.className = "msg bad";
      msg.textContent = reason === "duplicate"
        ? `Phone ${normalized} is already in your leads list.`
        : reason;
      toast(msg.textContent, "bad");
    }
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
    toast(err.message, "bad");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save lead";
  }
});

// --- polling ---------------------------------------------------------------
async function refresh() {
  try {
    const [stats, calls, leads] = await Promise.all([
      api("/api/stats"), api("/api/calls"), api("/api/leads"),
    ]);
    const byId = Object.fromEntries(leads.map((l) => [l.id, l]));
    renderStats(stats);
    renderCalls(calls.map((c) => ({ ...c, leadName: byId[c.leadId]?.name || "" })));
    renderLeads(leads);
  } catch (err) {
    console.error("refresh failed", err);
  }
}
refresh();
setInterval(refresh, 3000);
