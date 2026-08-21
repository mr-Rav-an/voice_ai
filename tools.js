// Client-side function handlers. Swap these for real CRM / scheduler calls.
import { COMPANY } from "./agent-config.js";

const bookings = [];
const optOuts = [];

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
  calculate_savings({ monthly_bill_inr, city, rooftop_sqft }) {
    const bill = Number(monthly_bill_inr) || 0;
    if (bill < 1500) {
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

  book_appointment(args) {
    const record = { ...args, id: `SS-${1000 + bookings.length}`, booked_at: new Date().toISOString() };
    bookings.push(record);
    console.log("[booking]", record);
    return {
      confirmed: true,
      confirmation_id: record.id,
      slot: record.slot,
      note: `Slot confirm karke bata do, aur mention karo ki WhatsApp par confirmation aayega. Helpline ${COMPANY.phone}.`,
    };
  },

  remove_from_list({ reason }) {
    optOuts.push({ reason: reason || "requested", at: new Date().toISOString() });
    console.log("[opt-out]", reason);
    return { removed: true, note: "Removal confirm karo, chhoti si maafi, call end. Dobara pitch mat karo." };
  },

  transfer_to_human({ reason }) {
    console.log("[transfer]", reason);
    return {
      transferring: true,
      note: `Bata do ki abhi ek senior consultant se connect kar rahe hain, ya ${COMPANY.phone} se call aayega.`,
    };
  },
};

export function runTool(name, argsJson) {
  const fn = handlers[name];
  if (!fn) return { error: `Unknown function: ${name}` };
  let args = {};
  try {
    args = argsJson ? JSON.parse(argsJson) : {};
  } catch {
    return { error: "Could not parse arguments." };
  }
  try {
    return fn(args);
  } catch (err) {
    return { error: String(err && err.message ? err.message : err) };
  }
}
