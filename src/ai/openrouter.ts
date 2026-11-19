/**
 * OpenRouter client (bring your own key). Chat answers stream over server-sent events so the HUD can
 * show and speak the reply while it is still being written.
 */
import { ApiError, errorFromResponse } from "./errors";
import { fetchWithRetry, trimSlash } from "./http";

export type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatPart[];
}

export interface StreamChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  onDelta: (text: string) => void;
}

export interface StreamChatResult {
  text: string;
  finishReason: string | null;
}

interface StreamChunk {
  error?: { message?: string };
  choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
}

type SseEvent = { kind: "done" } | { kind: "chunk"; chunk: StreamChunk } | null;

/** One line of an SSE stream. Comments (": OPENROUTER PROCESSING") and blank lines yield null. */
export function parseSseLine(line: string): SseEvent {
  if (line === "" || line.startsWith(":") || !line.startsWith("data:")) return null;
  const payload = line.slice(5).trim();
  if (payload === "[DONE]") return { kind: "done" };
  try {
    return { kind: "chunk", chunk: JSON.parse(payload) as StreamChunk };
  } catch {
    return null; // a half-delivered line; the rest arrives with the next network chunk
  }
}

export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { baseUrl, apiKey, model, messages, signal } = options;
  const response = await fetchWithRetry(
    `${trimSlash(baseUrl)}/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: options.maxTokens ?? 600,
        temperature: options.temperature ?? 0.6,
      }),
      signal,
    },
    signal,
  );
  if (!response.ok) throw await errorFromResponse(response);

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("OpenRouter sent an empty response.", "other", response.status);

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let finishReason: string | null = null;
  let finished = false;

  const handleLine = (line: string): void => {
    const event = parseSseLine(line);
    if (event === null) return;
    if (event.kind === "done") {
      finished = true;
      return;
    }
    const { chunk } = event;
    if (chunk.error) throw new ApiError(chunk.error.message ?? "The model stopped with an error.", "server");
    const choice = chunk.choices?.[0];
    const delta = choice?.delta?.content;
    if (typeof delta === "string" && delta !== "") {
      text += delta;
      options.onDelta(delta);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline).replace(/\r$/, ""));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    if (buffer.trim() !== "") handleLine(buffer.replace(/\r$/, ""));
  } catch (error) {
    if (signal.aborted) throw new ApiError("Cancelled.", "aborted");
    if (error instanceof ApiError) throw error;
    throw new ApiError("The connection dropped while the answer was arriving.", "network");
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return { text, finishReason };
}

export interface KeyInfo {
  label: string;
  usage: number | null;
  limit: number | null;
  isFreeTier: boolean | null;
}

/** GET /key: the cheapest way to prove a pasted key works. */
export async function checkKey(baseUrl: string, apiKey: string, signal: AbortSignal): Promise<KeyInfo> {
  let response: Response;
  try {
    response = await fetch(`${trimSlash(baseUrl)}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  } catch {
    throw new ApiError("I couldn't reach OpenRouter. Check your internet connection.", "network");
  }
  if (!response.ok) throw await errorFromResponse(response);
  const json = (await response.json()) as { data?: Record<string, unknown> };
  const data = json.data ?? {};
  return {
    label: typeof data["label"] === "string" ? data["label"] : "",
    usage: typeof data["usage"] === "number" ? data["usage"] : null,
    limit: typeof data["limit"] === "number" ? data["limit"] : null,
    isFreeTier: typeof data["is_free_tier"] === "boolean" ? data["is_free_tier"] : null,
  };
}
