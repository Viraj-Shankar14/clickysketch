/**
 * Microphone capture: 16 kHz mono PCM (what speech-to-text wants) plus a real-time loudness meter
 * for the HUD waveform (spec section 5.2).
 *
 * The microphone is opened when the push-to-talk key goes down and released when it comes up, so
 * the operating system's "microphone in use" indicator only shows while you are actually talking.
 */

export const TARGET_SAMPLE_RATE = 16000;
const MAX_SECONDS = 90;
const LEVEL_INTERVAL_MS = 33;

export interface Recording {
  samples: Int16Array;
  sampleRate: number;
  durationMs: number;
  /** Largest absolute sample, 0..1. Near zero means nothing but silence was captured. */
  peak: number;
}

/** AudioWorklet processor source: hands every 128-frame block of mic audio to the page. */
const WORKLET_SOURCE = `
class ClickyCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("clicky-capture", ClickyCapture);
`;

/** Streaming linear-interpolation resampler; keeps its fractional position across chunks. */
export class Resampler {
  private readonly step: number;
  private position = 0;
  private previous = 0;

  constructor(inputRate: number, outputRate: number) {
    this.step = inputRate / outputRate;
  }

  process(input: Float32Array): Float32Array {
    const length = input.length;
    if (length === 0) return new Float32Array(0);
    const output = new Float32Array(Math.ceil((length + 1) / this.step) + 1);
    let written = 0;
    let position = this.position;
    // Position -1 means "between the last sample of the previous chunk and input[0]".
    while (position < length - 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      const a = index < 0 ? this.previous : (input[index] ?? 0);
      const b = input[index + 1] ?? 0;
      output[written] = a + (b - a) * fraction;
      written += 1;
      position += this.step;
    }
    this.position = position - length;
    this.previous = input[length - 1] ?? 0;
    return output.subarray(0, written);
  }
}

/** Loudness 0..1 on a decibel scale: -55 dB reads as silence, -10 dB as full scale. */
export function levelFromRms(rms: number): number {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db + 55) / 45));
}

type AudioContextCtor = typeof AudioContext;

export class MicRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioNode | null = null;
  private sink: GainNode | null = null;
  private resampler: Resampler | null = null;
  private starting: Promise<void> | null = null;

  private chunks: Int16Array[] = [];
  private total = 0;
  private peak = 0;
  private sumSquares = 0;
  private sampleCount = 0;
  private lastLevelAt = 0;
  private onLevel: ((level: number) => void) | null = null;

  /** Opens the microphone and starts capturing. Rejects with the browser's own error (NotAllowedError, ...). */
  start(onLevel: (level: number) => void): Promise<void> {
    if (this.starting) return this.starting;
    this.reset();
    this.onLevel = onLevel;
    this.starting = this.open().catch((error: unknown) => {
      this.teardown();
      throw error;
    });
    return this.starting;
  }

  private async open(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.stream = stream;

    const Ctor: AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext;
    const context = new Ctor();
    this.context = context;
    if (context.state === "suspended") await context.resume();

    this.resampler = new Resampler(context.sampleRate, TARGET_SAMPLE_RATE);
    const source = context.createMediaStreamSource(stream);
    this.source = source;

    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
      await context.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const worklet = new AudioWorkletNode(context, "clicky-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => this.consume(event.data);
      source.connect(worklet);
      this.node = worklet;
    } catch {
      // Older WebKit builds without AudioWorklet: the deprecated ScriptProcessor still works everywhere.
      const processor = context.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (event: AudioProcessingEvent) => this.consume(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor);
      this.node = processor;
    }

    // A silent path to the destination keeps the graph pulling audio on every engine.
    const sink = context.createGain();
    sink.gain.value = 0;
    this.node.connect(sink);
    sink.connect(context.destination);
    this.sink = sink;
  }

  /** Called with each block of raw microphone samples at the context's native rate. */
  private consume(chunk: Float32Array): void {
    for (let i = 0; i < chunk.length; i += 1) {
      const value = chunk[i] ?? 0;
      this.sumSquares += value * value;
    }
    this.sampleCount += chunk.length;

    const now = performance.now();
    if (now - this.lastLevelAt >= LEVEL_INTERVAL_MS && this.sampleCount > 0) {
      this.onLevel?.(levelFromRms(Math.sqrt(this.sumSquares / this.sampleCount)));
      this.sumSquares = 0;
      this.sampleCount = 0;
      this.lastLevelAt = now;
    }

    if (this.total >= TARGET_SAMPLE_RATE * MAX_SECONDS || this.resampler === null) return;
    const resampled = this.resampler.process(chunk);
    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i += 1) {
      const value = Math.max(-1, Math.min(1, resampled[i] ?? 0));
      pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
      const magnitude = Math.abs(value);
      if (magnitude > this.peak) this.peak = magnitude;
    }
    this.chunks.push(pcm);
    this.total += pcm.length;
  }

  /** Stops capturing, releases the microphone and returns everything that was recorded. */
  async stop(): Promise<Recording> {
    if (this.starting) {
      try {
        await this.starting;
      } catch {
        // start() already reported the failure to its caller.
      }
    }
    const samples = new Int16Array(this.total);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const recording: Recording = {
      samples,
      sampleRate: TARGET_SAMPLE_RATE,
      durationMs: (samples.length / TARGET_SAMPLE_RATE) * 1000,
      peak: this.peak,
    };
    this.teardown();
    this.reset();
    return recording;
  }

  /** Throws the recording away. */
  cancel(): void {
    this.teardown();
    this.reset();
  }

  private reset(): void {
    this.chunks = [];
    this.total = 0;
    this.peak = 0;
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.lastLevelAt = 0;
  }

  private teardown(): void {
    this.starting = null;
    this.onLevel = null;
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close().catch(() => undefined);
    this.stream = null;
    this.context = null;
    this.source = null;
    this.node = null;
    this.sink = null;
    this.resampler = null;
  }
}

export type MicProbe = "granted" | "denied" | "missing" | "error";

/** Opens and immediately closes the microphone: triggers the permission prompt, reports the outcome. */
export async function probeMicrophone(): Promise<MicProbe> {
  if (!navigator.mediaDevices?.getUserMedia) return "error";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
    return "error";
  }
}

export function describeMicError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked. Click Allow when Windows or the app asks, or turn it on under Settings, Privacy, Microphone.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "I can't find a microphone. Plug one in and try again.";
  return `The microphone could not be opened (${error instanceof Error ? error.message : String(error)}).`;
}
