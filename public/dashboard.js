const $ = (id) => document.getElementById(id);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pill = (v) => (v ? `<span class="pill p-${esc(v)}">${esc(String(v).replace(/_/g, " "))}</span>` : '<span class="muted">—</span>');
const inr = (n) => (n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN"));
const when = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

// --- tabs ------------------------------------------------------------------
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("on", x === t));
    for (const name of ["calls", "leads", "upload"]) $("tab-" + name).hidden = name !== t.dataset.tab;
  })
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
    b.innerHTML = `<tr><td colspan="11" class="empty">No calls yet. Upload leads, then start a campaign.</td></tr>`;
    return;
  }
  b.innerHTML = calls.map((c) => {
    const cap = c.captured || {};
    return `<tr class="click" data-id="${c.id}">
      <td class="muted">${when(c.startedAt)}</td>
      <td>${esc(c.phone || "—")}</td>
      <td>${esc(c.leadName || "")}</td>
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

// Survives the 3s poll re-render.
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
    b.innerHTML = `<tr><td colspan="7" class="empty">No leads. Add some on the Upload tab.</td></tr>`;
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
      await api(`/api/leads/${btn.dataset.call}/call`, { method: "POST" });
      refresh();
    })
  );
  b.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api(`/api/leads/${btn.dataset.del}`, { method: "DELETE" });
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
// Every start dials real phones. Make it deliberate.
$("btn-start").addEventListener("click", async () => {
  const s = await api("/api/stats");
  const n = s.leadsPending;
  if (!n) return alert("No pending leads to call.");
  if (!confirm(`Call ${n} pending lead${n === 1 ? "" : "s"} now?\n\nThis places real phone calls.`)) return;
  await api("/api/campaign/start", { method: "POST" });
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
  if (!r.ok) alert(r.error || "Could not start");
  else selected.clear();
  refresh();
});

$("btn-del-selected").addEventListener("click", async () => {
  const ids = [...selected];
  if (!ids.length || !confirm(`Delete ${ids.length} lead${ids.length === 1 ? "" : "s"}?`)) return;
  for (const id of ids) await api(`/api/leads/${id}`, { method: "DELETE" });
  selected.clear();
  refresh();
});
$("btn-stop").addEventListener("click", async () => { await api("/api/campaign/stop", { method: "POST" }); refresh(); });

async function importCsv(text) {
  if (!text.trim()) return;
  const r = await api("/api/leads", { method: "POST", headers: { "Content-Type": "text/csv" }, body: text });
  const msg = $("import-msg");

  if (!r.added.length && !r.skipped.length) {
    msg.innerHTML = `<span style="color:var(--bad)">Nothing imported — no phone column found.</span>
      Include a column of 10-digit Indian mobile numbers.`;
    return;
  }

  // Group the rejections: one example each, so a fully-skipped file explains itself.
  const byReason = {};
  for (const s of r.skipped) (byReason[s.reason] ||= []).push(s.phone || s.name || "?");
  const detail = Object.entries(byReason)
    .map(([reason, xs]) => `${xs.length} ${reason} (e.g. ${esc(xs[0])})`)
    .join(", ");

  msg.innerHTML =
    `<span style="color:${r.added.length ? "var(--ok)" : "var(--bad)"}">Added ${r.added.length}</span>` +
    (detail ? ` · skipped ${r.skipped.length}: ${detail}` : "");
  if (r.added.length) $("csv").value = "";
  refresh();
}
$("btn-import").addEventListener("click", () => importCsv($("csv").value));
$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (f) importCsv(await f.text());
  e.target.value = "";
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
