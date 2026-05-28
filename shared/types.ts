export type AdviceAction = {
  label: string;
  reason: string;
};

export const supportedModels = ["gpt-5.4", "gpt-5.5"] as const;
export const reasoningEfforts = ["none", "low", "medium", "high", "xhigh"] as const;
export const playerRegistrationStatuses = ["unknown", "unregistered", "registered"] as const;

export type SupportedModel = (typeof supportedModels)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export type PlayerRegistrationStatus = (typeof playerRegistrationStatuses)[number];

export type RecognizedState = {
  board: string[];
  rack: string[];
  uncertainty: string[];
};

export type AdviceResponse = {
  recognizedState: RecognizedState;
  summary: string;
  actions: AdviceAction[];
  watchouts: string[];
  confidence: "low" | "medium" | "high";
  provider: "mock" | "responses" | "chat-completions";
  model: string;
  rawText?: string;
};

export type AdviceRequest = {
  imageDataUrl: string;
  model?: SupportedModel;
  reasoningEffort?: ReasoningEffort;
  playerRegistrationStatus?: PlayerRegistrationStatus;
};

export type PublicConfig = {
  provider: "mock" | "openai";
  model: SupportedModel;
  reasoningEffort?: ReasoningEffort;
  availableModels: SupportedModel[];
  availableReasoningEfforts: ReasoningEffort[];
};
