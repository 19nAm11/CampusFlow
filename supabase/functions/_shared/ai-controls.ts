export class AiControlError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly retryAfter?: number) {
    super(message);
  }
}

function setting(name: string, fallback: number, min: number, max: number) {
  const raw = Deno.env.get(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AiControlError("AI limits are not configured correctly.", 500, "ai_configuration_error");
  }
  return value;
}

function configuration() {
  const taskMs = setting("AI_TASK_TIMEOUT_MS", 90000, 15000, 120000);
  const attemptMs = setting("AI_ATTEMPT_TIMEOUT_MS", 30000, 1000, 60000);
  const maxCalls = setting("AI_MAX_PROVIDER_CALLS", 4, 1, 8);
  if (attemptMs > taskMs) {
    throw new AiControlError("AI limits are not configured correctly.", 500, "ai_configuration_error");
  }
  return { taskMs, attemptMs, maxCalls };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function openRouterModel(): string {
  const model = (Deno.env.get("OPENROUTER_MODEL") ?? "openrouter/free").trim();
  if (model.length > 120 || !/^[a-z0-9][a-z0-9_.-]*\/[a-z0-9][a-z0-9_.:-]*$/i.test(model)) {
    throw new AiControlError("The AI model is not configured correctly.", 500, "ai_configuration_error");
  }
  return model;
}

async function quotaRpc(name: string, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new AiControlError("AI usage controls are not configured.", 500, "ai_configuration_error");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: controller.signal, redirect: "error",
    });
    if (!response.ok) throw new Error("Quota RPC failed");
    if (response.status === 204 && name === "finish_ai_task") return null;
    return await response.json() as unknown;
  } catch {
    throw new AiControlError("Unable to check AI usage right now. Please try again.", 503, "ai_usage_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export class AiTask {
  private readonly controller = new AbortController();
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private calls = 0;

  constructor(private readonly userId: string, private readonly taskId: string,
    private readonly config: ReturnType<typeof configuration>) {
    this.deadline = Date.now() + config.taskMs;
    this.timer = setTimeout(() => this.controller.abort(), config.taskMs);
  }

  private checkTime() {
    if (this.controller.signal.aborted || Date.now() >= this.deadline) {
      throw new AiControlError("The AI task took too long. Please try a smaller request.", 504, "ai_task_timeout");
    }
  }

  private checkCalls() {
    this.checkTime();
    if (this.calls >= this.config.maxCalls) {
      throw new AiControlError("The AI could not finish within its retry limit. Please try again.", 502, "ai_call_budget_exceeded");
    }
  }

  private async provider(apiKey: string, body: Record<string, unknown>) {
    this.checkCalls();
    this.calls += 1;
    const attempt = new AbortController();
    const abort = () => attempt.abort();
    this.controller.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.min(this.config.attemptMs, this.deadline - Date.now()));
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: attempt.signal, redirect: "error",
      });
      const result = await response.json().catch((error) => {
        if (attempt.signal.aborted) throw error;
        return null;
      });
      this.checkTime();
      return { response, result: record(result) };
    } catch (error) {
      if (error instanceof AiControlError) throw error;
      this.checkTime();
      throw new AiControlError(attempt.signal.aborted
        ? "The AI service was too slow. Please try again."
        : "The AI service is temporarily unavailable. Please try again.", 503,
      attempt.signal.aborted ? "ai_attempt_timeout" : "ai_provider_unavailable");
    } finally {
      clearTimeout(timer);
      this.controller.signal.removeEventListener("abort", abort);
    }
  }

  private async wait(ms: number) {
    this.checkCalls();
    if (ms >= this.deadline - Date.now()) {
      throw new AiControlError("The AI task took too long. Please try a smaller request.", 504, "ai_task_timeout");
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new AiControlError("The AI task took too long. Please try a smaller request.", 504, "ai_task_timeout"));
      };
      const timer = setTimeout(() => {
        this.controller.signal.removeEventListener("abort", abort);
        resolve();
      }, ms);
      this.controller.signal.addEventListener("abort", abort, { once: true });
    });
    this.checkTime();
  }

  // HTTP retries and output-repair callers share this same call/time budget.
  async generate(apiKey: string, body: Record<string, unknown>): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let delay = 700 * 2 ** attempt;
      try {
        const { response, result } = await this.provider(apiKey, body);
        if (!response.ok || result?.error) {
          // Log only routing/status fields; never log documents, keys or raw provider messages.
          const providerCode = record(result?.error)?.code;
          console.error("AI provider request failed", {
            status: response.status,
            providerCode: typeof providerCode === "number" && Number.isInteger(providerCode) ? providerCode : null,
            model: typeof body.model === "string" && /^[a-z0-9_./:-]{1,120}$/i.test(body.model) ? body.model : null,
          });
        }
        if (!response.ok) {
          const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
          if (!retryable || attempt === 2) {
            throw new AiControlError("The AI service could not complete this request. Please try again.",
              retryable ? 503 : 502, "ai_provider_error");
          }
          // Honor short Retry-After values. Long waits fail fast rather than
          // retrying earlier than the provider requested.
          const retryAfter = response.headers.get("Retry-After");
          if (retryAfter) {
            const numeric = Number(retryAfter);
            const ms = Number.isFinite(numeric) ? numeric * 1000 : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(ms) && ms > 5000) {
              throw new AiControlError("The AI service is busy. Please try again later.", 503, "ai_provider_busy");
            }
            if (Number.isFinite(ms)) delay = Math.max(delay, ms);
          }
        } else {
          const choices = Array.isArray(result?.choices) ? result.choices : [];
          const choice = record(choices[0]);
          const content = record(choice?.message)?.content;
          const output = typeof content === "string" ? content.trim() : Array.isArray(content)
            ? content.map((part) => record(part)?.text).filter((part): part is string => typeof part === "string").join("\n").trim()
            : "";
          if (result?.error) throw new AiControlError("The AI service returned an error. Please try again.", 502, "ai_provider_error");
          if (choice?.finish_reason === "content_filter") {
            throw new AiControlError("The AI service could not process this material.", 422, "ai_content_filtered");
          }
          if (output) return output;
          if (attempt === 2) throw new AiControlError("The AI returned an empty result. Please try again.", 502, "ai_empty_output");
        }
      } catch (error) {
        if (!(error instanceof AiControlError) ||
          !["ai_attempt_timeout", "ai_provider_unavailable"].includes(error.code) || attempt === 2) throw error;
      }
      await this.wait(delay);
    }
    throw new AiControlError("The AI service is unavailable.", 503, "ai_provider_unavailable");
  }

  async finish(outcome: "succeeded" | "failed") {
    clearTimeout(this.timer);
    this.controller.abort();
    try {
      await quotaRpc("finish_ai_task", { p_user_id: this.userId, p_task_id: this.taskId, p_outcome: outcome });
    } catch {
      // The expiring DB lease recovers capacity if cleanup or a worker fails.
      // Keep the original response; never expose credentials or RPC details.
      console.error("Could not release AI task; its lease will expire.");
    }
  }
}

export async function beginAiTask(userId: string, type: "study-assistant" | "analyze-course-file") {
  const config = configuration();
  const result = record(await quotaRpc("reserve_ai_task", {
    p_user_id: userId, p_task_type: type, p_lease_seconds: Math.ceil(config.taskMs / 1000) + 20,
  }));
  if (result?.allowed === false) {
    const messages: Record<string, string> = {
      minute_limit: "You have reached the AI limit for this minute. Please wait before trying again.",
      daily_limit: "You have reached today's AI limit. It resets at midnight UTC.",
      concurrent_limit: "You already have the maximum number of AI tasks running. Wait for one to finish.",
    };
    const message = typeof result.reason === "string" ? messages[result.reason] : undefined;
    if (message && Number.isInteger(result.retry_after) && (result.retry_after as number) > 0) {
      throw new AiControlError(message, 429, String(result.reason), result.retry_after as number);
    }
  }
  if (result?.allowed !== true || typeof result.task_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.task_id)) {
    throw new AiControlError("Unable to check AI usage right now. Please try again.", 503, "ai_usage_unavailable");
  }
  return new AiTask(userId, result.task_id, config);
}
