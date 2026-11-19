/** Spoken replies through the system voices (the Web Speech synthesis API): free, offline, no key. */
export interface SpeakOptions {
  voiceUri: string;
  rate: number;
}

export class Speaker {
  private pending = 0;
  /** Bumped by cancel(); late events from utterances of an earlier epoch must not touch the new queue. */
  private epoch = 0;
  private waiters: Array<() => void> = [];

  get supported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  voices(): SpeechSynthesisVoice[] {
    return this.supported ? window.speechSynthesis.getVoices() : [];
  }

  /** Queues a piece of text; call it once per sentence so playback starts while the answer is still streaming. */
  speak(text: string, options: SpeakOptions): void {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!this.supported || clean === "") return;
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = this.voices().find((candidate) => candidate.voiceURI === options.voiceUri);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = options.rate;

    // Some systems have no usable voice and never fire any event; a watchdog guarantees the queue drains.
    const epoch = this.epoch;
    let finished = false;
    let timer = window.setTimeout(() => done(), 4000);
    const done = (): void => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (epoch !== this.epoch) return;
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.release();
    };
    utterance.onstart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => done(), 8000 + clean.length * 150);
    };
    utterance.onend = done;
    utterance.onerror = done;
    this.pending += 1;
    window.speechSynthesis.speak(utterance);
  }

  /** Resolves when everything queued so far has been spoken (or cancelled). */
  whenIdle(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  cancel(): void {
    this.epoch += 1;
    if (this.supported) window.speechSynthesis.cancel();
    this.pending = 0;
    this.release();
  }

  private release(): void {
    const waiting = this.waiters;
    this.waiters = [];
    waiting.forEach((resolve) => resolve());
  }
}

/** Cuts the not-yet-spoken tail of a streaming answer into complete sentences. */
export function takeSentences(text: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = text;
  const boundary = /^[\s\S]*?(?:[.!?]+["')\]]*(?=\s)|\n)/;
  for (;;) {
    const match = boundary.exec(rest);
    if (!match) break;
    const sentence = match[0].trim();
    if (sentence !== "") sentences.push(sentence);
    rest = rest.slice(match[0].length);
  }
  if (final && rest.trim() !== "") {
    sentences.push(rest.trim());
    rest = "";
  }
  return { sentences, rest };
}
