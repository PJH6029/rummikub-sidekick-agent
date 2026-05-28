import type {
  AdviceResponse,
  PlayerRegistrationStatus,
  PublicConfig,
  ReasoningEffort,
  SupportedModel,
} from "../shared/types";

export async function fetchConfig(): Promise<PublicConfig> {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Failed to load runtime config.");
  }
  return response.json() as Promise<PublicConfig>;
}

export async function requestAdvice(payload: {
  imageDataUrl: string;
  model: SupportedModel;
  reasoningEffort: ReasoningEffort;
  playerRegistrationStatus: PlayerRegistrationStatus;
}): Promise<AdviceResponse> {
  const response = await fetch("/api/advice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "Advice request failed.");
  }

  return response.json() as Promise<AdviceResponse>;
}
