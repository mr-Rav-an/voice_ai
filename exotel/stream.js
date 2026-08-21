// Exotel Voicebot applet <-> Deepgram Voice Agent bridge.
//
// Exotel speaks raw/slin: 16-bit, 8 kHz, mono PCM little-endian, base64-encoded inside
// JSON frames. Deepgram accepts linear16 @ 8000 in both directions, so audio passes
// through with only base64 transcoding and re-chunking — no resampling.
import { connectAgent } from "../deepgram-agent.js";

// Exotel wants multiples of 320 bytes; 3200 = 100ms of 8 kHz 16-bit mono.
const CHUNK = 3200;
const MAX_QUEUED = 100 * 1024; // Exotel's per-chunk ceiling, used as a backpressure guard

export function handleExotelStream(ws) {
  let streamSid = null;
  let seq = 1;
  let chunkNo = 1;
  let outBuf = Buffer.alloc(0);
  let callSid = null;
  let agent = null;

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
      sendJson({
        event: "media",
        sequence_number: seq++,
        stream_sid: streamSid,
        media: { chunk: chunkNo++, timestamp: String(Date.now()), payload: slice.toString("base64") },
      });
      if (force) break;
    }
  };

  const startAgent = () => {
    agent = connectAgent({
      sampleRate: 8000,
      onAudio: (pcm) => {
        if (outBuf.length > MAX_QUEUED) outBuf = outBuf.subarray(outBuf.length - MAX_QUEUED);
        outBuf = Buffer.concat([outBuf, pcm]);
        flush();
      },
      onEvent: (msg) => {
        switch (msg.type) {
          case "UserStartedSpeaking":
            // Barge-in: drop everything queued locally and in Exotel's playout buffer.
            outBuf = Buffer.alloc(0);
            sendJson({ event: "clear", stream_sid: streamSid });
            break;
          case "AgentAudioDone":
            flush(true);
            sendJson({
              event: "mark", sequence_number: seq++, stream_sid: streamSid,
              mark: { name: `turn-${chunkNo}` },
            });
            break;
          case "Closed":
            console.log(`[exotel ${callSid}] agent closed`, msg.code, msg.reason || "");
            if (ws.readyState === ws.OPEN) ws.close();
            break;
        }
      },
    });
  };

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.event) {
      case "connected":
        console.log("[exotel] websocket connected");
        break;

      case "start": {
        streamSid = msg.stream_sid || msg.start?.stream_sid;
        callSid = msg.start?.call_sid;
        const fmt = msg.start?.media_format;
        console.log(`[exotel] start call=${callSid} from=${msg.start?.from} to=${msg.start?.to}`,
                    fmt ? `format=${fmt.encoding}/${fmt.sample_rate}` : "");
        if (fmt?.sample_rate && Number(fmt.sample_rate) !== 8000) {
          console.warn(`[exotel] unexpected sample rate ${fmt.sample_rate}; bridge assumes 8000`);
        }
        startAgent();
        break;
      }

      case "media":
        if (agent && msg.media?.payload) {
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

      case "stop":
        console.log(`[exotel] stop call=${msg.stop?.call_sid} reason=${msg.stop?.reason}`);
        agent?.close();
        if (ws.readyState === ws.OPEN) ws.close();
        break;
    }
  });

  ws.on("close", () => {
    console.log(`[exotel ${callSid}] websocket closed`);
    agent?.close();
  });
  ws.on("error", (e) => console.error("[exotel] ws error", e.message));
}
