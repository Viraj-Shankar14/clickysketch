/**
 * Speech to text through OpenRouter's transcription endpoint (default model: Whisper large-v3-turbo,
 * about $0.000003 per second of audio). The audio goes up as base64 WAV.
 */
import { errorFromResponse } from "./errors";
import { fetchWithRetry, trimSlash } from "./http";

export interface TranscribeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  wavBase64: string;
  /** ISO language hint such as "en"; empty lets the model detect it. */
  language: string;
  signal: AbortSignal;
}

export async function transcribeAudio(options: TranscribeOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    input_audio: { data: options.wavBase64, format: "wav" },
  };
  if (options.language !== "") body["language"] = options.language;

  const response = await fetchWithRetry(
    `${trimSlash(options.baseUrl)}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    },
    options.signal,
  );
  if (!response.ok) throw await errorFromResponse(response);
  const json = (await response.json()) as { text?: unknown };
  return typeof json.text === "string" ? json.text : "";
}
