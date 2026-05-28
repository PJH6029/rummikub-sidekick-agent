export type AdviceAction = {
  label: string;
  reason: string;
};

export const supportedModels = ["gpt-5.4", "gpt-5.5"] as const;
export const reasoningEfforts = ["none", "low", "medium", "high", "xhigh"] as const;

export type SupportedModel = (typeof supportedModels)[number];
export type ReasoningEffort = (typeof reasoningEfforts)[number];

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

export type AdviceHistoryEntry = {
  recognizedState: RecognizedState;
  summary: string;
  actions: AdviceAction[];
  confidence: "low" | "medium" | "high";
};

export type AdviceRequest = {
  imageDataUrl: string;
  history?: AdviceHistoryEntry[];
  model?: SupportedModel;
  reasoningEffort?: ReasoningEffort;
};

export type PublicConfig = {
  provider: "mock" | "openai";
  model: SupportedModel;
  reasoningEffort?: ReasoningEffort;
  availableModels: SupportedModel[];
  availableReasoningEfforts: ReasoningEffort[];
};
