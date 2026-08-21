# Steelman Solar — Hindi/Hinglish Voice Sales Agent

A Deepgram Voice Agent that cold-calls Indian homeowners about rooftop solar, qualifies them,
quotes a PM Surya Ghar-adjusted estimate, and books a free site survey.

## Run it

```bash
npm install && npm start
```

Open http://localhost:3000, click **Call shuru karein**, allow the mic, and talk.
You can also type in the box at the bottom to test without a mic.

Headless smoke test (scripted Hinglish conversation, no mic, writes `agent-call.wav`):

```bash
node test-agent.js
```

## How it fits together

```
browser mic ──16k PCM──> server.js ──ws──> agent.deepgram.com
browser speaker <─24k PCM── server.js <──── (STT → LLM → TTS)
                              └── tools.js runs function calls locally
```

- `server.js` — static file server + WebSocket proxy. The Deepgram key stays server-side;
  the browser never sees it. Also handles `KeepAlive` and function-call dispatch.
- `agent-config.js` — the Settings message: system prompt, tool schemas, STT/LLM/TTS providers.
- `tools.js` — the five function handlers. Currently in-memory mocks; this is where you
  wire your real CRM and scheduler.
- `public/` — mic capture (AudioWorklet → linear16 @ 16 kHz), playback queue @ 24 kHz,
  barge-in (playback is cut on `UserStartedSpeaking`), and a live transcript.

## Language setup

| Stage | Choice | Why |
|---|---|---|
| STT | `nova-3`, `language: "multi"` | Handles Hindi↔English code-switching in one stream, which is what Hinglish actually is |
| LLM | `gpt-4o` | `gpt-4o-mini` mangled Hindi numerals ("sath hazaar" for 78,000). Override with `LLM_MODEL` |
| TTS | Cartesia `sonic-3`, `language: "hi"` | Deepgram's own Aura voices are English/Spanish only |

**On Deepgram Hindi TTS:** `aura-asteria-hi` and similar names pass Settings validation but
return `400 No such model/version combination found` at synthesis time. They don't exist —
don't be fooled by `SettingsApplied`. Cartesia is Deepgram-managed, so it bills through your
existing Deepgram key with no Cartesia account needed.

Switch voices via `.env`:

```
TTS_PROVIDER=cartesia          # cartesia | elevenlabs | deepgram
CARTESIA_VOICE_ID=<voice id>   # pick a Hindi voice from Cartesia's library
```

`TTS_PROVIDER=elevenlabs` additionally needs your own `ELEVENLABS_API_KEY`.

## The prompt

`agent-config.js` holds the system prompt in Hinglish. The parts that matter:

- **Mirror the caller's language.** Full English in → English out. Shuddh Hindi in → simple Hindi out.
- **Roman script only**, never Devanagari — the text is spoken aloud.
- **Numbers** in Indian units, rounded, with an explicit instruction to fall back to English
  rather than guess a Hindi numeral. Phone numbers digit by digit.
- **No markdown**, no bullet lists — options are read as one flowing sentence.

## Tools

| Function | Does |
|---|---|
| `calculate_savings` | Sizes the system from the monthly bill, caps it by rooftop area, applies the PM Surya Ghar slabs (₹30k/kW for first 2 kW, ₹18k for the 3rd, ₹78k cap), returns net cost and payback |
| `check_availability` | Open survey slots for a date |
| `book_appointment` | Books the slot, returns a confirmation ID |
| `remove_from_list` | DND opt-out — the agent calls this and stops pitching immediately |
| `transfer_to_human` | Hands off to a human rep |

## Guardrails in the prompt

- Every rupee figure must come from `calculate_savings` — no invented prices or payback periods.
- No savings guarantees, no subsidy-approval guarantees, no fake "scheme is expiring" urgency.
- Discloses it's an AI when asked.
- Never asks for Aadhaar, PAN, bank details, OTP, or card numbers.
- Bills under ₹1,500/month are told honestly that solar won't pay off, rather than booked.
- Renters and out-of-service-area callers are turned away politely.

## Dashboard

`http://localhost:3000` — upload leads, run a campaign, review every call.
(The browser mic demo moved to `/demo`.)

- **Upload** — paste CSV or pick a file. Columns `name, phone, city, notes`; the header row is
  detected, and a headerless file works if column one is a phone number. Numbers may be
  10-digit, `0`-prefixed or `+91`. Duplicates and invalid numbers are skipped and reported.
- **Campaign** — Start works the pending queue one lead at a time, polling Exotel for each
  outcome so no-answer and busy are recorded too, not just connected calls. Per-lead
  "Call now" dials outside the queue.
- **Calls** — outcome, interest, and captured data inline (city, bill, system size, booking,
  duration, turns). Click a row for the full transcript and every tool call with arguments
  and results.

### How outcomes are decided

Interest is classified by the agent, not inferred from keywords: `set_call_outcome` is a tool
it calls once the outcome is clear (`interested` / `callback` / `not_interested` /
`disqualified`). `book_appointment` also marks the call hot, a sub-₹1,500 bill marks it
disqualified with a reason, and `remove_from_list` sets the lead to `dnc` so the dialer
skips it permanently.

### Storage

[store.js](store.js) is a JSON file under `data/` (gitignored — it holds lead phone numbers).
Deliberately dependency-free and adequate for campaigns in the hundreds.

Two constraints worth knowing before scaling:

- **Single process.** The whole store is held in memory and written back on change, so a
  second process will not see the first's writes. Move to Postgres or SQLite before running
  more than one instance.
- **Sequential dialing.** Each concurrent call is its own Deepgram session with its own cost,
  and Exotel rate-limits Voice APIs to 200/min. `CONCURRENCY` is a one-line change in
  [campaign.js](campaign.js), but make it a deliberate one.

## Real phone calls (Exotel)

```
caller ──PSTN──> Exotel ──ws /exotel-stream──> stream.js ──> Deepgram
                          (Voicebot applet)      base64 <-> PCM
```

Exotel's Voicebot applet streams `raw/slin` — 16-bit, 8 kHz, mono PCM little-endian, base64
inside JSON frames. Deepgram accepts linear16 @ 8000 in **both** directions, so the bridge only
transcodes base64 and re-chunks. No resampling, no quality loss from rate conversion.

- `exotel/stream.js` — the protocol bridge. Handles `connected` / `start` / `media` / `dtmf` /
  `stop`, emits 3200-byte (100 ms) media frames, sends `clear` on barge-in and `mark` at end of turn.
- `exotel/client.js` — Voice v1 REST client (`Calls/connect.json`).
- `exotel/call.js` — place one call: `node exotel/call.js 09876543210`
- `exotel/verify.js` — credential check; auto-retries with key/token swapped.
- `exotel/simulate.js` — replays the exact Exotel protocol against the bridge locally,
  validates 320-byte alignment and stream_sid, writes `exotel-call.wav`. No real call, no cost.

### Setup

1. **Expose the websocket publicly.** Exotel must reach it over `wss://`:
   ```bash
   ngrok http 3000
   ```
2. **Create an Exotel App** (Dashboard → App Bazaar → Create), add a **Voicebot applet**, and set
   its URL to `wss://<your-ngrok-host>/exotel-stream`. Note the numeric App ID from the URL.
3. **Fill in `.env`:**
   ```
   EXOTEL_ACCOUNT_SID=snapecabs1
   EXOTEL_APP_ID=1322504
   EXOTEL_SUBDOMAIN=api.exotel.com   # Singapore DC for this account (Mumbai is api.in.exotel.com)
   ```
   The data centre is not guessable from the credentials — the wrong one returns a plain
   `401 Authentication failed`, identical to a bad key. This account is on Singapore.
4. **Verify, then dial:**
   ```bash
   node exotel/verify.js
   node exotel/call.js 09876543210
   ```

`Calls/connect.json` dials `From` first and connects them to the App on answer, so `From` is the
customer's number and `CallerId` (`01141170795`) is what they see. Call status posts to
`/exotel/status` if you pass a `StatusCallback`.

### Barge-in on a phone call

When Deepgram reports `UserStartedSpeaking`, the bridge drops its local buffer *and* sends
`clear` to Exotel. Without the `clear`, audio already handed to Exotel keeps playing and the
agent talks over the caller for a second or two.

## Deploying to a DigitalOcean droplet

A droplet suits this better than a PaaS: the filesystem persists, so `data/store.json`
(leads, calls, transcripts) survives restarts. Basic 1 vCPU / 1 GB is plenty — the server
proxies audio, it does not transcode. Pick **Bangalore (BLR1)**: voice latency is audible
and every hop counts.

```bash
ssh root@<droplet-ip>
curl -fsSL https://raw.githubusercontent.com/mr-Rav-an/voice_ai/main/deploy/setup.sh -o setup.sh
bash setup.sh agent.yourdomain.com
```

That installs Node 22 and Caddy, clones the repo to `/opt/steelman`, creates an unprivileged
`steelman` user, registers a systemd unit with `Restart=always`, and opens only 22/80/443.

Then fill in `/opt/steelman/.env` and `systemctl restart steelman-agent`.

**No domain?** Use [nip.io](https://nip.io): if the droplet is `203.0.113.45`, pass
`203-0-113-45.nip.io` as the domain. It resolves to that IP and Let'"'"'s Encrypt will issue a
real certificate for it — which matters, because Exotel requires `wss://` with valid TLS.

| Task | Command |
|---|---|
| Logs | `journalctl -u steelman-agent -f` |
| Restart | `systemctl restart steelman-agent` |
| Deploy an update | `cd /opt/steelman && git pull && npm install --omit=dev && systemctl restart steelman-agent` |
| Back up data | `cp /opt/steelman/data/store.json ~/backup-$(date +%F).json` |

`data/store.json` is the only stateful thing on the box. Nothing else needs backing up.

## Deploying to Render

`render.yaml` is ready — Render → New → Blueprint, point it at the repo, then paste the env
vars (all are `sync: false`, so none are stored in git). Notes baked into that file:

- **`plan: starter`, not free.** Free instances sleep; a cold start means the caller hears
  silence for ~30s before the agent speaks.
- **`region: singapore`** to match this account's Exotel data centre. Voice latency is audible,
  so keep the server near the telephony.
- **`healthCheckPath: /health`** returns `{ok, uptime}`.
- **Render'"'"'s filesystem is ephemeral** — `data/store.json` is wiped on every deploy. Attach a
  persistent disk mounted at `data/`, or use a droplet instead.

### Websocket auth

`/exotel-stream` is public by definition — Exotel connects from its own infrastructure and
cannot send auth headers. So the secret rides in the query string, and the applet URL becomes:

```
wss://<host>/exotel-stream?token=<EXOTEL_STREAM_SECRET>
```

Unauthenticated upgrades get a 401 and are logged. If `EXOTEL_STREAM_SECRET` is unset the
server still runs but warns on boot — don't deploy it that way, since every session that
reaches the socket bills Deepgram.

## Before production

- Replace the mocks in `tools.js` with real CRM/calendar calls.
- Replace ngrok with a stable public host + TLS. Exotel needs the websocket reachable for the
  whole call.
- Replace the JSON store with a real database once you are past a few hundred leads.
- DND/TRAI scrubbing before any campaign. `remove_from_list` marks the lead `dnc` in the
  store, but that is not a substitute for scrubbing against the national registry.
- Check DND/TRAI scrubbing before dialing. `remove_from_list` must write to a real suppression list.
- The rupee constants in `agent-config.js` (₹62,000/kW, ₹8/unit, 1,400 units/kW/year) are
  ballpark national averages — replace with your actual pricing and state discom tariffs.
