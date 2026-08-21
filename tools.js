// Client-side function handlers. Swap these for real CRM / scheduler calls.
import { COMPANY } from "./agent-config.js";
import * as store from "./store.js";

const inr = (n) => Math.round(n);

function subsidyFor(kw) {
  const { firstTwoKwPerKw, thirdKw, cap } = COMPANY.subsidy;
  const s = Math.min(kw, 2) * firstTwoKwPerKw + (kw > 2 ? thirdKw : 0);
  return Math.min(s, cap);
}

function slotsFor(dateLabel) {
  return [
    `${dateLabel} subah 10 baje`,
    `${dateLabel} dopahar 1:30 baje`,
    `${dateLabel} shaam 5 baje`,
  ];
}

export const handlers = {
  calculate_savings({ monthly_bill_inr, city, rooftop_sqft }, ctx) {
    record(ctx, {
      captured: {
        monthlyBill: Number(monthly_bill_inr) || null,
        city: city || undefined,
        rooftopSqft: Number(rooftop_sqft) || undefined,
      },
    });
    const bill = Number(monthly_bill_inr) || 0;
    if (bill < 1500) {
      record(ctx, { outcome: "disqualified", interest: "cold", reason: `bill only ${bill}` });
      return {
        qualifies: false,
        note: "Bill itna kam hai ki solar theek se pay off nahi hoga. Honestly bata do, appointment mat book karo.",
      };
    }
    const unitsPerMonth = bill / COMPANY.avgTariffINR;
    let kw = Math.max(1, Math.round((unitsPerMonth * 12) / COMPANY.unitsPerKwPerYear));

    let roof_note;
    if (rooftop_sqft) {
      const maxKw = Math.floor(Number(rooftop_sqft) / COMPANY.sqftPerKw);
      if (maxKw < kw) {
        roof_note = `Chhat sirf ${maxKw} kW support karegi, isliye system chhota rakha hai.`;
        kw = Math.max(1, maxKw);
      }
    }

    const gross = inr(kw * COMPANY.costPerKwINR);
    const subsidy = subsidyFor(kw);
    const annualUnits = kw * COMPANY.unitsPerKwPerYear;
    const annualSavings = inr(Math.min(annualUnits * COMPANY.avgTariffINR, bill * 12 * 0.9));
    const net = gross - subsidy;

    record(ctx, {
      captured: { systemKw: kw, netCost: net, annualSavings: annualSavings },
    });
    return {
      qualifies: true,
      city: city || "unspecified",
      system_size_kw: kw,
      rooftop_needed_sqft: kw * COMPANY.sqftPerKw,
      roof_note,
      gross_cost_inr: gross,
      pm_surya_ghar_subsidy_inr: subsidy,
      net_cost_inr: net,
      est_annual_savings_inr: annualSavings,
      payback_years: Math.round((net / annualSavings) * 10) / 10,
      disclaimer:
        "Rough estimate hai. Estimate bolkar batao — final number site survey, discom tariff aur " +
        "net metering approval ke baad confirm hota hai. Subsidy ki guarantee mat do.",
    };
  },

  check_availability({ date }) {
    const label = String(date || "kal");
    return { date: label, open_slots: slotsFor(label), timezone: "IST" };
  },

  book_appointment(args, ctx) {
    const id = `SS-${1000 + store.listCalls().filter((c) => c.booking).length}`;
    const booking = { ...args, id, booked_at: new Date().toISOString() };
    record(ctx, { booking, outcome: "interested", interest: "hot" });
    if (ctx?.leadId) store.updateLead(ctx.leadId, { status: "done" });
    console.log("[booking]", booking);
    return {
      confirmed: true,
      confirmation_id: id,
      slot: booking.slot,
      note: `Slot confirm karke bata do, aur mention karo ki WhatsApp par confirmation aayega. Helpline ${COMPANY.phone}.`,
    };
  },

  remove_from_list({ reason }, ctx) {
    record(ctx, { outcome: "dnc", interest: "cold", reason: reason || "requested" });
    if (ctx?.leadId) store.updateLead(ctx.leadId, { status: "dnc" });
    console.log("[opt-out]", reason);
    return { removed: true, note: "Removal confirm karo, chhoti si maafi, call end. Dobara pitch mat karo." };
  },

  set_call_outcome({ outcome, interest, reason }, ctx) {
    record(ctx, { outcome, interest: interest || null, reason: reason || null });
    return { recorded: true };
  },

  transfer_to_human({ reason }, ctx) {
    record(ctx, { outcome: "callback", interest: "warm", reason: reason || "wants a human" });
    console.log("[transfer]", reason);
    return {
      transferring: true,
      note: `Bata do ki abhi ek senior consultant se connect kar rahe hain, ya ${COMPANY.phone} se call aayega.`,
    };
  },
};

function record(ctx, patch) {
  if (ctx?.callId) store.updateCall(ctx.callId, patch);
}

export function runTool(name, argsJson, ctx) {
  const fn = handlers[name];
  if (!fn) return { error: `Unknown function: ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Could not parse arguments." };
  }
  try {
    const result = fn(args, ctx);
    if (ctx?.callId) store.appendToolCall(ctx.callId, name, args, result);
    return result;
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) };
  }
}
