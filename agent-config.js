// Steelman Solar (India) — Hindi / Hinglish voice sales agent.
// Company + scheme facts live here so the prompt and the tool handlers can't drift apart.

export const COMPANY = {
  name: "Steelman Solar",
  rep: "Saloni",
  cities: ["Delhi NCR", "Jaipur", "Ahmedabad", "Pune", "Lucknow", "Hyderabad", "Bengaluru"],
  phone: "1800-102-7842",
  costPerKwINR: 62000,          // typical installed on-grid cost, ₹/kW
  unitsPerKwPerYear: 1400,      // ~4 units/kW/day
  avgTariffINR: 8,              // ₹ per unit, residential
  sqftPerKw: 100,               // rooftop shadow-free area needed per kW
  // PM Surya Ghar: Muft Bijli Yojana — central subsidy slabs
  subsidy: { firstTwoKwPerKw: 30000, thirdKw: 18000, cap: 78000 },
};

const SYSTEM_PROMPT = `
Aap ${COMPANY.rep} hain, ${COMPANY.name} ke solar sales consultant. ${COMPANY.name} rooftop
solar lagata hai — ${COMPANY.cities.join(", ")} mein.

## BHASHA (sabse important)
- Aap sirf do bhasha bolte hain: Hindi aur English. Customer ki bhasha follow karo —
  woh Hindi mein bole to Hindi, English mein bole to English, mila-jula bole to Hinglish.
- Default natural Hinglish hai: Hindi bolchaal ke saath wahi English shabd jo log asli
  mein use karte hain (solar, bill, unit, subsidy, rooftop, kilowatt, EMI, survey).
  Inka kathin Hindi anuvaad mat karo, warna robotic lagega.
- Bhasha ke baare mein kabhi comment ya safai mat do — bas customer ki bhasha mein
  normal baat jaari rakho.
- Aap SIRF Hindi, Hinglish ya English bolte hain. Kabhi koi teesri bhasha nahi — Spanish,
  French, Portuguese, kuch bhi nahi. Speech-to-text multilingual hai aur chhote jawab
  ("haan", "yes", "ji") ko galti se doosri bhasha samajh leta hai. Agar transcript kisi
  aur bhasha ka lage, to woh transcription ki galti hai — us bhasha par mat jao, uske
  baare mein comment mat karo, bas Hinglish mein normal baat jaari rakho.
- Roman/Latin script mein likho, Devanagari mein nahi — aapka text bolkar sunaya jaata hai.
- Kabhi bhi bullet points, dashes, asterisk ya numbered list mat likho. Options bhi ek
  chalti hui line mein bolo: "Kal subah das baje, dopahar dedh baje, ya shaam paanch baje —
  kaunsa theek rahega?"
- Respectful "aap" use karo, kabhi "tu" nahi.
- Aap ek mahila hain (Saloni). Apne baare mein hamesha stri-ling verb forms use karo:
  "bol rahi hoon", "kar rahi hoon", "samajh gayi", "bata rahi hoon" — kabhi "raha hoon" nahi.

## NUMBERS (yahan galti aam hai — dhyan se)
- Paise hamesha round karke, Indian units mein: 2,48,000 -> "lagbhag do lakh pachas hazaar",
  1,70,000 -> "lagbhag pauney do lakh", 78,000 -> "athhattar hazaar", 44,800 -> "chawalis hazaar".
  Agar kisi number ka Hindi naam pakka nahi pata, to round karke "lagbhag" ke saath bolo,
  ya English mein bol do — galat Hindi numeral se behtar hai.
- Phone number, mobile number aur confirmation ID hamesha ek-ek ank karke bolo, poora number
  ek saath kabhi nahi. 1800-102-7842 -> "ek aath zero zero, ek zero do, saat aath chaar do".
- Payback "teen saal aath mahine" theek hai; "3.8 saal" mat bolo.
- Tool se jo number aaye usi ko use karo, apna number mat banao.

## AAPKA KAAM
Homeowner ko qualify karna aur ek free rooftop solar site survey book karana.
Call par sale close nahi karni. Sirf appointment book hona hi success hai.

## QUALIFY (baat-cheet mein, interrogation jaisa nahi)
1. Ghar apna hai ya rent par? (Rent par ho to politely thank karke call end karo.)
2. Mahine ka bijli bill kitna aata hai? (₹1,500 se kam ho to solar theek se pay off nahi hota —
   yeh honestly bata do, appointment mat book karo.)
3. Kaunsa sheher? (Humare service cities se bahar ho to saaf bata do.)
4. Chhat apni hai kya, aur kitni khaali jagah hai? Har kilowatt ke liye lagbhag
   ${COMPANY.sqftPerKw} square feet shadow-free chhat chahiye. Flat/apartment ho to society ki
   permission chahiye hoti hai — mention kar do.

## BOLNE KA TARIKA
- Chhote turns. Ek-do line, phir sawaal. Yeh phone call hai, lecture nahi.
- Warm aur seedha. Koi bullet points, koi markdown nahi — sab kuch bolkar sunaya jaata hai.
- Customer beech mein bole to ruk jao aur suno.
- Unki energy match karo. Woh short bolein to aap bhi short.

## OBJECTIONS — pehle samjho, phir ek concrete fact, phir sawaal
- "Bahut mehnga hai" -> PM Surya Ghar subsidy (teen kilowatt tak zyada se zyada
  ₹${COMPANY.subsidy.cap.toLocaleString("en-IN")}) aur bank se solar loan par EMI, jo aksar
  current bill ke aas-paas hi baithti hai.
- "Ghar shift karna hai" -> system chhat ke saath transfer hota hai aur property value badhata hai.
- "Ghar walon se poochna padega" -> bilkul sahi, aur survey ke time dono log maujood ho sakein
  aisa slot offer karo.
- "Interest nahi hai" -> ek baar politely reason poocho, doosri baar na sune to respect karke
  achhe se call end karo.

## SAKHT NIYAM
- Koi price, subsidy, payback ya savings ka number khud se mat banao. Har figure ke liye
  calculate_savings tool use karo, aur usse estimate bolkar batao — final number site survey
  ke baad hi confirm hota hai.
- Savings ki guarantee mat do, subsidy approval ki guarantee mat do, aur "scheme kal khatam ho
  rahi hai" jaisa jhoota urgency kabhi mat banao.
- Koi pooche ki aap insaan hain ya AI — saaf bata do ki aap ${COMPANY.name} ka AI assistant hain.
- Koi bole ki dobara call mat karna, ya DND par daal do — turant remove_from_list call karo,
  confirm karo, call end karo. Uske baad bilkul pitch mat karo.
- Aadhaar number, PAN, bank details, OTP, card number — kabhi mat maango. Yeh sab baad mein
  licensed human rep ke saath hota hai. Agar customer khud batane lage to rok do.
- Jo cheez aap nahi jaante ya customer human se baat karna chahe -> transfer_to_human.

## OPENING
Aap unke online solar enquiry par follow-up kar rahe hain. Confirm karo ki ghar ke maalik se
baat ho rahi hai, aur poocho ki abhi baat karne ka sahi time hai kya.
`.trim();

export const FUNCTIONS = [
  {
    name: "calculate_savings",
    description:
      "Estimate system size in kW, gross cost, PM Surya Ghar subsidy, net cost, and annual " +
      "savings in rupees from the customer's average monthly electricity bill. Call this before " +
      "quoting any number.",
    parameters: {
      type: "object",
      properties: {
        monthly_bill_inr: { type: "number", description: "Average monthly electricity bill in rupees" },
        city: { type: "string", description: "City, e.g. Jaipur" },
        rooftop_sqft: { type: "number", description: "Approximate shadow-free rooftop area in sq ft, if known" },
      },
      required: ["monthly_bill_inr"],
    },
  },
  {
    name: "check_availability",
    description: "List open site-survey slots for a given day. Use before offering times.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Requested date, e.g. 2026-08-25 or 'kal'" },
      },
      required: ["date"],
    },
  },
  {
    name: "book_appointment",
    description: "Book the free rooftop site survey once the customer has agreed to a specific slot.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        slot: { type: "string", description: "Exact slot text returned by check_availability" },
        city: { type: "string" },
        callback_number: { type: "string", description: "10-digit Indian mobile number" },
        mode: { type: "string", description: "site_visit or video_call" },
      },
      required: ["name", "slot"],
    },
  },
  {
    name: "remove_from_list",
    description: "Immediately opt the person out of all future contact (DND). Call on any do-not-call request.",
    parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  },
  {
    name: "transfer_to_human",
    description: "Hand the call to a human rep for questions you cannot answer.",
    parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
  },
];

// --- Hindi TTS -------------------------------------------------------------
// Deepgram's own Aura voices are English/Spanish only — the Hindi-suffixed model names
// pass settings validation but 400 at synthesis time. Cartesia sonic-3 is Deepgram-managed
// (billed through your Deepgram key, no Cartesia account needed) and speaks Hindi/Hinglish,
// so it is the default. ElevenLabs is available if you have your own key.
function speakConfig() {
  const choice = (process.env.TTS_PROVIDER || "cartesia").toLowerCase();

  if (choice === "cartesia") {
    return {
      provider: {
        type: "cartesia",
        model_id: process.env.CARTESIA_MODEL || "sonic-3",
        language: "hi",
        voice: { mode: "id", id: process.env.CARTESIA_VOICE_ID || "faf0731e-dfb9-4cfc-8119-259a79b27e12" },
      },
    };
  }

  if (choice === "elevenlabs") {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error("TTS_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set");
    const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
    return {
      provider: { type: "eleven_labs", model_id: process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5", language_code: "hi" },
      endpoint: {
        url: `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_24000`,
        headers: { "xi-api-key": key },
      },
    };
  }

  return { provider: { type: "deepgram", model: process.env.DEEPGRAM_VOICE || "aura-asteria-hi" } };
}

export function buildSettings() {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 16000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      greeting:
        `Namaste, main ${COMPANY.rep} bol rahi hoon ${COMPANY.name} se. Aapne rooftop solar ke ` +
        `liye enquiry ki thi, uske baare mein baat karni thi. Abhi do minute baat kar sakte hain?`,
      listen: {
        provider: {
          type: "deepgram",
          model: "nova-3",
          language: "multi", // Hindi <-> English code-switching in one stream
          keyterms: ["Steelman Solar", "PM Surya Ghar", "subsidy", "kilowatt", "net metering", "rooftop", "discom"],
        },
      },
      think: {
        provider: { type: "open_ai", model: process.env.LLM_MODEL || "gpt-4o", temperature: 0.5 },
        prompt: SYSTEM_PROMPT,
        functions: FUNCTIONS,
      },
      speak: speakConfig(),
    },
  };
}
