/**
 * Anthropic client for the research agent (server only). The key and model
 * come from the deployment's secrets; the browser never sees either.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/src/lib/env";
import type { TokenUsage } from "./pricing";

/** Server-side refusal fallback: a declined request is retried on the default fallback model. */
export const AGENT_BETAS: Anthropic.Beta.AnthropicBeta[] = ["server-side-fallback-2026-07-01"];

/** Effort for planning and explanations (cost/latency lever), configurable per deployment. */
export const AI_EFFORT: "low" | "medium" | "high" = ((): "low" | "medium" | "high" => {
  const value = process.env.AI_EFFORT;
  return value === "low" || value === "high" ? value : "medium";
})();

export class AgentUnavailableError extends Error {
  readonly reason: string;
  readonly usage?: TokenUsage;
  constructor(message: string, reason: string, usage?: TokenUsage) {
    super(message);
    this.name = "AgentUnavailableError";
    this.reason = reason;
    this.usage = usage;
  }
}

let client: Anthropic | null = null;

export function agentModel(): string {
  return config.anthropicModel;
}

export function anthropicClient(): Anthropic {
  const apiKey = config.anthropicKey;
  if (!apiKey) throw new AgentUnavailableError("The AI provider is not configured on the server.", "not_configured");
  client ??= new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  return client;
}

/** Maps SDK errors to a short, user-safe status without leaking request details. */
export function describeAgentError(error: unknown): { reason: string; message: string } {
  if (error instanceof AgentUnavailableError) return { reason: error.reason, message: error.message };
  if (error instanceof Anthropic.AuthenticationError) return { reason: "auth", message: "The AI provider rejected the server credentials." };
  if (error instanceof Anthropic.RateLimitError) return { reason: "rate_limited", message: "The AI provider is rate limiting requests; try again shortly." };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { reason: "timeout", message: "The AI provider did not answer in time." };
  if (error instanceof Anthropic.APIConnectionError) return { reason: "network", message: "The AI provider could not be reached." };
  if (error instanceof Anthropic.APIError) return { reason: `http_${error.status ?? "error"}`, message: `The AI provider returned an error (${error.status ?? "unknown"}).` };
  return { reason: "internal", message: "The AI step failed unexpectedly." };
}
