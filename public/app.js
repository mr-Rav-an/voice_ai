const $ = (id) => document.getElementById(id);
const logEl = $("log");
let ws, micCtx, micNode, micStream, playCtx, playHead = 0, sources = [];

const setStatus = (s) => ($("status").textContent = s);

function addTurn(role, text) {
  const wrap = document.createElement("div");
  wrap.className = `turn ${role}`;
  wrap.innerHTML = `<div class="who"></div><div class="body"></div>`;
  wrap.querySelector(".who").textContent = role === "agent" ? "Saloni (Steelman Solar)" : role;
  wrap.querySelector(".body").textContent = text;
  logEl.appendChild(wrap);
  logEl.scrollTop = logEl.scrollHeight;
}

function addTool(name, result) {
  const el = document.createElement("div");
  el.className = "turn";
  el.innerHTML = `<div class="tool"></div>`;
  el.querySelector(".tool").textContent = `⚙ ${name}\n${JSON.stringify(result, null, 2)}`;
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}

// --- playback: linear16 @ 24kHz, scheduled back-to-back -------------------
function playPcm(arrayBuffer) {
  if (!playCtx) return;
  const pcm = new Int16Array(arrayBuffer);
  if (!pcm.length) return;
  const buf = playCtx.createBuffer(1, pcm.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);
  const now = playCtx.currentTime;
  if (playHead < now) playHead = now + 0.05;
  src.start(playHead);
  playHead += buf.duration;
  sources.push(src);
  src.onended = () => (sources = sources.filter((s) => s !== src));
}

function stopPlayback() {
  for (const s of sources) { try { s.stop(); } catch {} }
  sources = [];
  playHead = 0;
}

// --- call lifecycle --------------------------------------------------------
async function start() {
  $("start").disabled = true;
  setStatus("connecting…");

  playCtx = new AudioContext({ sampleRate: 24000 });
  await playCtx.resume();

  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/agent`);
  ws.binaryType = "arraybuffer";

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) return playPcm(ev.data);
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case "Welcome": setStatus("connected — say hello"); break;
      case "ConversationText":
        addTurn(msg.role === "assistant" ? "agent" : "you", msg.content);
        break;
      case "UserStartedSpeaking": stopPlayback(); setStatus("listening…"); break;
      case "AgentStartedSpeaking": setStatus("agent speaking…"); break;
      case "AgentAudioDone": setStatus("your turn"); break;
      case "ToolCall": addTool(msg.name, msg.result); break;
      case "Error":
      case "Warning": {
        const e = document.createElement("div");
        e.className = "turn err";
        e.textContent = `${msg.type}: ${msg.description || ""}`;
        logEl.appendChild(e);
        break;
      }
    }
  };

  ws.onclose = () => { setStatus("call ended"); teardown(); };
  ws.onerror = () => setStatus("connection error");

  await new Promise((res, rej) => { ws.onopen = res; ws.addEventListener("error", rej, { once: true }); });

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  micCtx = new AudioContext({ sampleRate: 16000 });
  await micCtx.audioWorklet.addModule("/mic-worklet.js");
  micNode = new AudioWorkletNode(micCtx, "mic-processor");
  micNode.port.onmessage = (e) => { if (ws && ws.readyState === 1) ws.send(e.data); };
  micCtx.createMediaStreamSource(micStream).connect(micNode);
  micNode.connect(micCtx.destination); // keeps the graph pulling; worklet emits no audio

  $("stop").disabled = false;
  $("text").disabled = false;
  $("send").disabled = false;
  setStatus("live");
}

function teardown() {
  stopPlayback();
  micNode?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  micCtx?.close(); micCtx = null;
  playCtx?.close(); playCtx = null;
  $("start").disabled = false;
  $("stop").disabled = true;
  $("text").disabled = true;
  $("send").disabled = true;
}

function hangup() { ws?.close(); teardown(); setStatus("call ended"); }

function sendText() {
  const v = $("text").value.trim();
  if (!v || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: "InjectUserMessage", content: v }));
  addTurn("you", v);
  $("text").value = "";
}

$("start").onclick = () => start().catch((e) => { setStatus("error: " + e.message); teardown(); });
$("stop").onclick = hangup;
$("send").onclick = sendText;
$("text").onkeydown = (e) => e.key === "Enter" && sendText();
