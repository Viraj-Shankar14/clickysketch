export type ApiErrorKind = "auth" | "credits" | "rate" | "model" | "image" | "server" | "network" | "aborted" | "other";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;

  constructor(message: string, kind: ApiErrorKind, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

interface ErrorBody {
  error?: { message?: string };
}

/** Turns an OpenRouter error response into a sentence a student can act on. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let detail = "";
  try {
    const body = (await response.json()) as ErrorBody;
    detail = body.error?.message ?? "";
  } catch {
    // The body was not JSON; the status code still tells the story.
  }
  const status = response.status;
  const lower = detail.toLowerCase();

  if (status === 401 || status === 403) {
    return new ApiError("OpenRouter rejected the API key. Open Settings and paste it again (it starts with sk-or-).", "auth", status);
  }
  if (status === 402) {
    return new ApiError(
      "Your OpenRouter account has no credits. Voice transcription costs a tiny fraction of a cent per question; adding a few dollars at openrouter.ai/credits fixes this, and a one-time $10 also raises the free-model limit to 1,000 requests a day.",
      "credits",
      status,
    );
  }
  if (status === 429) {
    return new ApiError("The free model is rate limited right now (20 requests a minute, and 50 a day on a new account). Wait a moment and try again.", "rate", status);
  }
  if ((status === 404 || status === 400) && (lower.includes("image") || lower.includes("modalit"))) {
    return new ApiError("This model can't take screenshots.", "image", status);
  }
  if (status === 404) {
    return new ApiError(`OpenRouter couldn't find that model or provider${detail ? ` (${detail})` : ""}. Check the model name in Settings.`, "model", status);
  }
  if (status >= 500) {
    return new ApiError("The model provider is busy or down right now. Try again in a moment.", "server", status);
  }
  return new ApiError(detail || `OpenRouter returned an error (HTTP ${status}).`, "other", status);
}
