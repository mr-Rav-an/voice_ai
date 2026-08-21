// Collects mic frames and ships them to the main thread in ~20ms chunks.
class MicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(0);
    this.chunk = 320; // 20ms @ 16kHz
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const merged = new Float32Array(this.buf.length + ch.length);
    merged.set(this.buf);
    merged.set(ch, this.buf.length);
    this.buf = merged;
    while (this.buf.length >= this.chunk) {
      const slice = this.buf.subarray(0, this.chunk);
      const pcm = new Int16Array(this.chunk);
      for (let i = 0; i < this.chunk; i++) {
        const s = Math.max(-1, Math.min(1, slice[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
      this.buf = this.buf.slice(this.chunk);
    }
    return true;
  }
}
registerProcessor("mic-processor", MicProcessor);
