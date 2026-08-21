// Exotel Voicebot applet <-> Deepgram Voice Agent bridge.
//
// Exotel speaks raw/slin: 16-bit, 8 kHz, mono PCM little-endian, base64-encoded inside
// JSON frames. Deepgram accepts linear16 @ 8000 in both directions, so audio passes
// through with only base64 transcoding and re-chunking — no resampling.
import { connectAgent } from "../deepgram-agent.js";
import * as store from "../store.js";

// Exotel wants multiples of 320 bytes; 3200 = 100ms of 8 kHz 16-bit mono.
const CHUNK = 3200;
const MAX_QUEUED = 100 * 1024; // Exotel's per-chunk ceiling, used as a backpressure guard

export function handleExotelStream(ws) {
  const t0 = Date.now();
  const el = () => `+${((Date.now() - t0) / 1000).toFixed(2)}s`;
  let streamSid = null;
  let seq = 1;
  let chunkNo = 1;
  let outBuf = Buffer.alloc(0);
  let callSid = null;
  let agent = null;
  let callRecord = null;
  let sentFrames = 0;
  let sentBytes = 0;
  let recvFrames = 0;
  let gatedFrames = 0;
  let dgBytes = 0;
  let clears = 0;
  let agentSpeaking = false;
  // Playout position in ms, relative to stream start — Exotel's examples use a small
  // relative value ("10"), not a wall-clock epoch.
  let outMs = 0;
  // Telephony echo: our own audio comes back on the inbound leg and Deepgram transcribes
  // it as the caller, so the agent answers itself. AgentStartedSpeaking never fires here,
  // so we gate on our own playout clock instead: inbound audio is dropped while what we
  // sent is still playing, plus a tail for line delay.
  const ECHO_TAIL_MS = 700;
  let playoutEndsAt = 0;

  const sendJson = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  const flush = (force = false) => {
    if (!streamSid) return;
    while (outBuf.length >= CHUNK || (force && outBuf.length > 0)) {
      const take = Math.min(CHUNK, outBuf.length);
      // Never emit a non-multiple of 320 mid-stream: Exotel inserts a 20ms gap.
      const size = force && take < CHUNK ? Math.ceil(take / 320) * 320 : take;
      let slice = outBuf.subarray(0, take);
      if (size > take) slice = Buffer.concat([slice, Buffer.alloc(size - take)]);
      outBuf = outBuf.subarray(take);
      // Only `event`, `stream_sid` and `media.payload` are required. sequence_number,
      // chunk and timestamp are optional and the docs type them inconsistently, so we
      // omit them rather than risk a rejection on a field Exotel never needed.
      sendJson({
        event: "media",
        stream_sid: streamSid,
        media: { payload: slice.toString("base64") },
      });
      chunkNo++;
      const now = Date.now();
      const durMs = size / 16; // 16 bytes per ms at 8kHz 16-bit mono
      playoutEndsAt = Math.max(playoutEndsAt, now) + durMs;
      outMs += size / 16; // 16 bytes per ms at 8kHz 16-bit mono
      sentFrames++;
      sentBytes += size;
      if (sentFrames === 1) {
        console.log(`[exotel] ${el()} -> first media frame: ${size}B, b64len=${slice.toString("base64").length}`);
      }
    }
  };

  const startAgent = () => {
    agent = connectAgent({
      sampleRate: 8000,
      ctx: { get callId() { return callRecord?.id; }, get leadId() { return callRecord?.leadId; } },
      onAudio: (pcm) => {
        if (dgBytes === 0) console.log(`[exotel] ${el()} FIRST audio from Deepgram (${pcm.length}B)`);
        dgBytes += pcm.length;
        if (outBuf.length > MAX_QUEUED) outBuf = outBuf.subarray(outBuf.length - MAX_QUEUED);
        outBuf = Buffer.concat([outBuf, pcm]);
        flush();
      },
      onEvent: (msg) => {
        if (["AgentStartedSpeaking", "AgentAudioDone", "SettingsApplied", "Welcome", "AgentThinking"].includes(msg.type)) {
          console.log(`[exotel] ${el()} ${msg.type}`,
            msg.total_latency ? `total=${msg.total_latency}s tts=${msg.tts_latency}s ttt=${msg.ttt_latency}s` : "");
        }
        switch (msg.type) {
          case "AgentStartedSpeaking":
            agentSpeaking = true;
            break;

          case "UserStartedSpeaking":
            // Barge-in. Only cut playback if the agent is actually mid-turn — on a phone
            // line, line noise fires this constantly, and clearing unconditionally throws
            // away speech that was never heard.
            console.log(`[exotel] UserStartedSpeaking (agentSpeaking=${agentSpeaking}, queued=${outBuf.length}B)`);
            if (agentSpeaking) {
              outBuf = Buffer.alloc(0);
              clears++;
              sendJson({ event: "clear", stream_sid: streamSid });
            }
            break;
          case "AgentAudioDone":
            agentSpeaking = false;
            flush(true);
            sendJson({ event: "mark", stream_sid: streamSid, mark: { name: `turn-${chunkNo}` } });
            console.log(`[exotel] ${el()} turn done — sent ${sentFrames}/${sentBytes}B, ` +
                        `recv ${recvFrames}, echo-gated ${gatedFrames}`);
            break;
          case "ConversationText":
            if (callRecord) {
              store.appendTranscript(callRecord.id, msg.role === "assistant" ? "agent" : "customer", msg.content);
            }
            break;

          case "Closed":
            console.log(`[exotel ${callSid}] agent closed`, msg.code, msg.reason || "");
            if (ws.readyState === ws.OPEN) ws.close();
            break;
        }
      },
    });
  };

  // Deepgram's handshake takes ~3s. Start it immediately rather than on `start`, so it
  // overlaps Exotel's setup instead of adding to it. Audio is buffered until stream_sid
  // arrives, and flush() is a no-op until then.
  startAgent();

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.event !== "media") console.log(`[exotel] ${el()} <- ${msg.event}`, JSON.stringify(msg).slice(0, 300));

    switch (msg.event) {
      case "connected":
        console.log("[exotel] websocket connected");
        break;

      case "start": {
        streamSid = msg.stream_sid || msg.start?.stream_sid;
        callSid = msg.start?.call_sid;
        const fmt = msg.start?.media_format;
        {
          const phone = msg.start?.from;
          const existing = callSid ? store.getCallBySid(callSid) : null;
          const lead = store.findLeadByPhone(phone);
          callRecord = existing || store.createCall({ callSid, phone, leadId: lead?.id || null });
          store.updateCall(callRecord.id, { connected: true, leadId: callRecord.leadId || lead?.id || null });
          if (lead) store.updateLead(lead.id, { status: "calling", lastCallId: callRecord.id });
        }
        console.log(`[exotel] ${el()} start call=${callSid} from=${msg.start?.from} to=${msg.start?.to}`,
                    fmt ? `format=${fmt.encoding}/${fmt.sample_rate}` : "");
        if (fmt?.sample_rate && Number(fmt.sample_rate) !== 8000) {
          console.warn(`[exotel] unexpected sample rate ${fmt.sample_rate}; bridge assumes 8000`);
        }
        flush(); // greeting audio may already be queued
        break;
      }

      case "media":
        if (agent && msg.media?.payload) {
          recvFrames++;
          if (Date.now() < playoutEndsAt + ECHO_TAIL_MS) {
            gatedFrames++;
            break; // our own audio echoing back — never let Deepgram hear it
          }
          agent.sendAudio(Buffer.from(msg.media.payload, "base64"));
        }
        break;

      case "dtmf":
        // Keypad input reaches the LLM as if the caller said it.
        console.log(`[exotel] dtmf ${msg.dtmf?.digit}`);
        agent?.send({ type: "InjectUserMessage", content: `Caller pressed ${msg.dtmf?.digit} on the keypad.` });
        break;

      case "mark":
        break; // playback of a marked chunk finished

      default:
        console.log(`[exotel] ${el()} UNHANDLED event "${msg.event}"`, JSON.stringify(msg).slice(0, 300));

      case "stop":
        console.log(`[exotel] stop call=${msg.stop?.call_sid} reason=${msg.stop?.reason} — ` +
                    `sent ${sentFrames} frames/${sentBytes}B, received ${recvFrames} frames, ` +
                    `deepgram gave ${dgBytes}B, clears ${clears}, echo-gated ${gatedFrames} frames`);
        agent?.close();
        if (ws.readyState === ws.OPEN) ws.close();
        break;
    }
  });

  ws.on("close", (code, reason) => {
    if (callRecord) {
      const ended = new Date();
      store.updateCall(callRecord.id, {
        endedAt: ended.toISOString(),
        durationSec: Math.round((ended - new Date(callRecord.startedAt)) / 1000),
      });
      const lead = callRecord.leadId ? store.getLead(callRecord.leadId) : null;
      if (lead && lead.status === "calling") store.updateLead(lead.id, { status: "done" });
    }
    console.log(`[exotel ${callSid}] ${el()} websocket closed code=${code} reason="${reason?.toString() || ""}" ` +
                `sent=${sentFrames} recv=${recvFrames}`);
    agent?.close();
  });
  ws.on("error", (e) => console.error("[exotel] ws error", e.message));
}
