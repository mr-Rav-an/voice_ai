// One Deepgram Voice Agent session. Transport-agnostic: the browser bridge and the
// Exotel telephony bridge both drive this.
import { WebSocket } from "ws";
import { buildSettings } from "./agent-config.js";
import { runTool } from "./tools.js";

const DG_URL = "wss://agent.deepgram.com/v1/agent/converse";

/**
 * @param {object} opts
 * @param {number} opts.sampleRate   PCM rate for both directions (8000 for telephony)
 * @param {(pcm: Buffer) => void} opts.onAudio   agent speech, linear16 @ sampleRate
 * @param {(msg: object) => void} opts.onEvent   every JSON message from Deepgram
 * @param {object} [opts.overrides]  shallow-merged into settings.agent
 */
export function connectAgent({ sampleRate = 24000, onAudio, onEvent, overrides = {} }) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY is not set");

  const settings = buildSettings();
  settings.audio.input = { encoding: "linear16", sample_rate: sampleRate };
  settings.audio.output = { encoding: "linear16", sample_rate: sampleRate, container: "none" };
  Object.assign(settings.agent, overrides);

  const dg = new WebSocket(DG_URL, { headers: { Authorization: `Token ${apiKey}` } });
  const pending = [];
  let ready = false;

  const keepAlive = setInterval(() => {
    if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify({ type: "KeepAlive" }));
  }, 8000);

  dg.on("open", () => {
    dg.send(JSON.stringify(settings));
    ready = true;
    for (const chunk of pending.splice(0)) dg.send(chunk);
  });

  dg.on("message", (data, isBinary) => {
    if (isBinary) return onAudio?.(data);
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.type === "FunctionCallRequest") {
      for (const call of msg.functions || []) {
        const result = runTool(call.name, call.arguments);
        console.log(`[tool] ${call.name} ->`, JSON.stringify(result));
        dg.send(JSON.stringify({
          type: "FunctionCallResponse", id: call.id, name: call.name,
          content: JSON.stringify(result),
        }));
        onEvent?.({ type: "ToolCall", name: call.name, args: call.arguments, result });
      }
      return;
    }
    if (msg.type === "ConversationText") console.log(`[${msg.role}] ${msg.content}`);
    if (msg.type === "Error" || msg.type === "Warning") console.error("[deepgram]", msg);
    onEvent?.(msg);
  });

  dg.on("error", (err) => onEvent?.({ type: "Error", description: err.message }));
  dg.on("close", (code, reason) => {
    clearInterval(keepAlive);
    onEvent?.({ type: "Closed", code, reason: reason?.toString() });
  });

  return {
    /** Raw linear16 PCM from the caller. */
    sendAudio(pcm) {
      if (ready && dg.readyState === WebSocket.OPEN) dg.send(pcm);
      else if (pending.length < 200) pending.push(pcm);
    },
    /** Any client message (InjectUserMessage, UpdatePrompt, …). */
    send(obj) {
      if (dg.readyState === WebSocket.OPEN) dg.send(JSON.stringify(obj));
    },
    sendRaw(text) {
      if (dg.readyState === WebSocket.OPEN) dg.send(text);
    },
    close() {
      clearInterval(keepAlive);
      if (dg.readyState === WebSocket.OPEN) dg.close();
    },
    get socket() { return dg; },
  };
}
