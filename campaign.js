// Sequential dialer over the pending lead queue.
// Deliberately one call at a time: each concurrent call is its own Deepgram session,
// and Exotel rate-limits Voice APIs to 200/min. Raise CONCURRENCY only with both in mind.
import * as store from "./store.js";
import { callWithVoicebot, getCall as getExotelCall } from "./exotel/client.js";

const GAP_MS = 5000;       // breathing room between calls
const MAX_ATTEMPTS = 2;

let running = false;
let stopRequested = false;
let current = null;
let queue = null; // explicit lead ids, or null to work the whole pending list
const listeners = new Set();

export const onCampaignEvent = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const emit = (e) => listeners.forEach((fn) => { try { fn(e); } catch {} });

export const campaignState = () => ({
  running,
  current,
  queued: queue ? queue.length : null,
  pending: store.listLeads().filter((l) => l.status === "pending").length,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function dialOne(lead) {
  current = { leadId: lead.id, phone: lead.phone, name: lead.name };
  emit({ type: "dialing", ...current });
  store.updateLead(lead.id, { status: "calling", attempts: lead.attempts + 1 });

  let call;
  try {
    const res = await callWithVoicebot(`0${lead.phone}`);
    const sid = res?.Call?.Sid;
    call = store.createCall({ callSid: sid, leadId: lead.id, phone: lead.phone });
    store.updateLead(lead.id, { lastCallId: call.id });
  } catch (err) {
    console.error(`[campaign] dial failed for ${lead.phone}:`, err.message);
    store.updateLead(lead.id, { status: "failed" });
    emit({ type: "error", leadId: lead.id, error: err.message });
    current = null;
    return;
  }

  // Poll Exotel until the call leaves in-progress, so outcomes are recorded even
  // when the websocket never opens (no-answer, busy).
  for (let i = 0; i < 40 && !stopRequested; i++) {
    await sleep(3000);
    try {
      const info = (await getExotelCall(call.callSid))?.Call;
      if (!info) continue;
      if (info.Status && info.Status !== "in-progress") {
        const connected = store.getCall(call.id)?.connected;
        store.updateCall(call.id, {
          exotelStatus: info.Status,
          durationSec: Number(info.Duration) || store.getCall(call.id)?.durationSec || 0,
          endedAt: new Date().toISOString(),
          ...(connected ? {} : { outcome: info.Status === "busy" ? "no_answer" : info.Status }),
        });
        store.updateLead(lead.id, { status: connected ? "done" : "failed" });
        break;
      }
    } catch (err) {
      console.error("[campaign] status poll:", err.message);
    }
  }
  emit({ type: "call-done", leadId: lead.id, callId: call.id });
  current = null;
}

/**
 * @param {string[]} [leadIds] Dial exactly these, in order. Omit to work the pending queue.
 * Explicitly selected leads are dialed regardless of status — you may want to call someone
 * back — except `dnc`, which is never dialed again under any circumstances.
 */
export async function startCampaign(leadIds) {
  if (running) return { ok: false, error: "already running" };

  if (Array.isArray(leadIds) && leadIds.length) {
    const leads = leadIds.map((id) => store.getLead(id)).filter(Boolean);
    const dnc = leads.filter((l) => l.status === "dnc");
    queue = leads.filter((l) => l.status !== "dnc").map((l) => l.id);
    if (!queue.length) {
      queue = null; // don't leave a stale empty queue in campaignState
      return { ok: false, error: "nothing dialable in selection" };
    }
    if (dnc.length) console.log(`[campaign] skipping ${dnc.length} lead(s) on the do-not-call list`);
  } else {
    queue = null;
  }

  running = true;
  stopRequested = false;
  emit({ type: "started", count: queue ? queue.length : null });

  (async () => {
    while (!stopRequested) {
      const lead = queue ? store.getLead(queue.shift()) : store.nextPendingLead(MAX_ATTEMPTS);
      if (!lead) break;
      await dialOne(lead);
      if (stopRequested) break;
      await sleep(GAP_MS);
    }
    running = false;
    current = null;
    queue = null;
    emit({ type: "stopped" });
  })();

  return { ok: true };
}

export function stopCampaign() {
  stopRequested = true;
  return { ok: true };
}

/** Dial a single lead outside the campaign loop. */
export async function dialLead(leadId) {
  const lead = store.getLead(leadId);
  if (!lead) return { ok: false, error: "no such lead" };
  dialOne(lead);
  return { ok: true };
}
