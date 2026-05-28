import OpenAI from "openai";
import {
  reasoningEfforts,
  supportedModels,
  type AdviceAction,
  type AdviceHistoryEntry,
  type AdviceRequest,
  type AdviceResponse,
  type PublicConfig,
  type ReasoningEffort,
  type SupportedModel,
} from "../shared/types.js";

const DEFAULT_MODEL: SupportedModel = "gpt-5.5";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY_ITEMS = 6;
const MAX_HISTORY_TEXT_CHARS = 500;

type RuntimeConfig = {
  provider: "mock" | "openai";
  apiKey?: string;
  allowChatFallback: boolean;
  baseURL: string;
  model: SupportedModel;
  reasoningEffort?: ReasoningEffort;
  useStreamingResponses: boolean;
};

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const baseURL = env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const model = parseSupportedModel(env.RUMMIKUB_MODEL ?? env.OPENAI_MODEL);
  const reasoningEffort = parseReasoningEffort(env.RUMMIKUB_REASONING_EFFORT ?? env.OPENAI_REASONING_EFFORT);
  const forcedProvider = env.RUMMIKUB_ADVICE_PROVIDER?.trim().toLowerCase();
  const hasApiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const hasLocalCompatibleProxy = baseURL !== DEFAULT_BASE_URL;
  const allowChatFallback = env.OPENAI_ALLOW_CHAT_FALLBACK?.trim().toLowerCase() === "true"
    || hasLocalCompatibleProxy;

  if (forcedProvider === "mock" || (!hasApiKey && !hasLocalCompatibleProxy)) {
    return { provider: "mock", allowChatFallback: false, baseURL, model, reasoningEffort, useStreamingResponses: false };
  }

  return {
    provider: "openai",
    apiKey: env.OPENAI_API_KEY?.trim() || "not-needed",
    allowChatFallback,
    baseURL,
    model,
    reasoningEffort,
    useStreamingResponses: hasLocalCompatibleProxy,
  };
}

export function getPublicConfig(config = getRuntimeConfig()): PublicConfig {
  return {
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    availableModels: [...supportedModels],
    availableReasoningEfforts: [...reasoningEfforts],
  };
}

export async function generateAdvice(request: AdviceRequest): Promise<AdviceResponse> {
  validateAdviceRequest(request);

  const config = resolveRequestConfig(getRuntimeConfig(), request);
  if (config.provider === "mock") {
    return createMockAdvice(request, config.model);
  }

  const prompt = buildAdvicePrompt(request);

  if (config.useStreamingResponses) {
    const outputText = await createStreamingResponse(config, prompt, request.imageDataUrl);
    return {
      ...parseAdviceText(outputText),
      provider: "responses",
      model: config.model,
      rawText: outputText,
    };
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  try {
    const response = await client.responses.create({
      model: config.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: request.imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      reasoning: reasoningPayload(config.reasoningEffort),
      max_output_tokens: 700,
    });

    const outputText = extractResponseText(response);
    return {
      ...parseAdviceText(outputText),
      provider: "responses",
      model: config.model,
      rawText: outputText,
    };
  } catch (responsesError) {
    if (!shouldAttemptChatFallback(responsesError, config)) {
      throw new Error(`Responses API failed: ${errorMessage(responsesError)}`);
    }

    try {
      const chat = await client.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: request.imageDataUrl,
                  detail: "high",
                },
              },
            ],
          },
        ],
      max_tokens: 700,
      reasoning_effort: chatReasoningEffort(config.reasoningEffort),
      temperature: 0.2,
    });

      const outputText = chat.choices[0]?.message?.content ?? "";
      return {
        ...parseAdviceText(outputText),
        provider: "chat-completions",
        model: config.model,
        rawText: outputText,
      };
    } catch (chatError) {
      const responseMessage = errorMessage(responsesError);
      const chatMessage = errorMessage(chatError);
      throw new Error(`Advice request failed. Responses API: ${responseMessage}. Chat fallback: ${chatMessage}`);
    }
  }
}

export function validateAdviceRequest(request: AdviceRequest): void {
  if (!request || typeof request !== "object") {
    throw new Error("Request body must be an object.");
  }
  validateRequestKeys(request);

  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(request.imageDataUrl ?? "");
  if (!match) {
    throw new Error("imageDataUrl must be a PNG, JPEG, or WEBP base64 image data URL.");
  }

  const base64Payload = match[2] ?? "";
  if (!isValidBase64(base64Payload)) {
    throw new Error("imageDataUrl contains invalid base64 image data.");
  }

  if (estimateBase64Bytes(base64Payload) > MAX_IMAGE_BYTES) {
    throw new Error("imageDataUrl exceeds the 5 MB image limit.");
  }

  validateHistory(request.history);
  validateRequestedModel(request.model);
  validateRequestedReasoningEffort(request.reasoningEffort);
}

export function shouldAttemptChatFallback(error: unknown, config: Pick<RuntimeConfig, "allowChatFallback">): boolean {
  if (!config.allowChatFallback) {
    return false;
  }

  const status = (error as { status?: unknown }).status;
  if (status === 404 || status === 405) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return message.includes("not found")
    || message.includes("unsupported")
    || message.includes("unknown endpoint")
    || message.includes("responses api")
    || message.includes("output is not iterable");
}

export function extractTextFromResponsesSse(sseText: string): string {
  const state = { deltaText: "", doneText: "" };
  for (const block of sseText.split(/\n\n+/)) {
    const dataText = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");

    if (!dataText || dataText === "[DONE]") {
      continue;
    }

    try {
      applyResponsesEvent(JSON.parse(dataText), state);
    } catch {
      continue;
    }
  }
  return state.doneText || state.deltaText;
}

export function buildAdvicePrompt(request: AdviceRequest): string {
  const historyText = formatHistory(request.history);

  return [
    "You are a Rummikub coach watching the user's current browser game screenshot.",
    "Use only these sources: the current screenshot, the Rummikub rules below, and the automatic game history below.",
    "Do not use or invent default rack text, demo rack text, manual rack notes, or manual table notes. None are provided.",
    "Current screenshot is authoritative. Use history only to understand prior turns; if history conflicts with the screenshot, trust the screenshot and mention the conflict under recognizedState.uncertainty.",
    "Rummikub rules: a valid run is 3+ consecutive tiles of the same color; a valid group is 3 or 4 same-number tiles in distinct colors; all table tiles must remain in valid sets after a move.",
    "Rummikub rules: before the player has opened, their first meld must total at least 30 points from their own rack. After opening, board rearrangement is allowed only if the final board is fully valid.",
    "Rummikub rules: jokers can substitute for a tile, but avoid spending a joker unless it clearly improves the rack or opens the player.",
    "First identify the visible board state and rack state from the screenshot before choosing advice.",
    "Give concise next-action advice. Focus on legal moves, initial meld constraints, runs, groups, joker risks, and whether drawing is better than forcing a weak play.",
    "Do not claim certainty about hidden tiles or exact board state if the screenshot is unclear.",
    "Use Korean for all user-facing values.",
    "recognizedState.board should list visible table melds, groups, runs, or relevant board facts.",
    "recognizedState.rack should list only rack tiles visible in the screenshot, or say the rack is unclear if not visible.",
    "recognizedState.uncertainty should list anything visually uncertain or inferred from history.",
    "Return only compact JSON with this shape:",
    '{"recognizedState":{"board":["short Korean board read"],"rack":["short Korean rack read"],"uncertainty":["short Korean uncertainty"]},"summary":"one Korean sentence","actions":[{"label":"short Korean action","reason":"short Korean reason"}],"watchouts":["short Korean warning"],"confidence":"low|medium|high"}',
    "Capture source: browser screen screenshot",
    `Automatic game history, untrusted observations only:\n${historyText}`,
  ].join("\n");
}

export function parseAdviceText(text: string): Omit<AdviceResponse, "provider" | "model" | "rawText"> {
  const cleaned = stripJsonFence(text.trim());

  try {
    const parsed = JSON.parse(cleaned) as Partial<AdviceResponse>;
    return normalizeAdvice(parsed, text);
  } catch {
    return {
      recognizedState: {
        board: [],
        rack: [],
        uncertainty: ["모델 응답이 JSON이 아니어서 인식 상태를 구조화하지 못했습니다."],
      },
      summary: text.trim() || "현재 화면에서 확실한 조합을 읽지 못했습니다.",
      actions: [
        {
          label: "보드 재확인",
          reason: "모델 응답이 JSON이 아니어서 원문 조언만 표시합니다.",
        },
      ],
      watchouts: ["말풍선의 원문을 확인하고, 불확실하면 타일을 뽑는 선택도 고려하세요."],
      confidence: "low",
    };
  }
}

function normalizeAdvice(
  parsed: Partial<AdviceResponse>,
  fallbackText: string,
): Omit<AdviceResponse, "provider" | "model" | "rawText"> {
  const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
    ? parsed.confidence
    : "medium";

  return {
    recognizedState: normalizeRecognizedState(parsed.recognizedState),
    summary: typeof parsed.summary === "string" && parsed.summary.trim()
      ? parsed.summary.trim()
      : fallbackText.trim() || "다음 수 후보를 정리했습니다.",
    actions: Array.isArray(parsed.actions) && parsed.actions.length > 0
      ? parsed.actions
          .filter((action) => typeof action?.label === "string" && typeof action?.reason === "string")
          .slice(0, 3)
          .map((action) => ({
            label: action.label.trim(),
            reason: action.reason.trim(),
          }))
      : [
          {
            label: "가장 긴 run 우선",
            reason: "랙에서 같은 색 연속 숫자가 있으면 턴 효율이 좋습니다.",
          },
        ],
    watchouts: Array.isArray(parsed.watchouts)
      ? parsed.watchouts.filter((item): item is string => typeof item === "string").slice(0, 3)
      : ["초기 등록 전이면 합계 30 이상인지 먼저 확인하세요."],
    confidence,
  };
}

function createMockAdvice(request: AdviceRequest, model: string): AdviceResponse {
  return {
    recognizedState: {
      board: [
        "mock 모드는 실제 스크린샷을 시각적으로 판독하지 않습니다.",
      ],
      rack: [
        "실제 랙은 화면 공유와 OpenAI provider에서만 판독됩니다.",
      ],
      uncertainty: [
        "mock provider 응답이라 실제 화면 기반 훈수가 아닙니다.",
      ],
    },
    summary: "실전 훈수는 현재 스크린샷을 OpenAI provider로 보내야 정확합니다.",
    actions: [
      {
        label: "현재 화면 캡처",
        reason: "모델이 실제 보드와 랙을 먼저 판독해야 합법 수를 고를 수 있습니다.",
      },
      {
        label: "초기 등록 여부 확인",
        reason: "열기 전이면 랙에서 합계 30 이상 조합을 만들어야 합니다.",
      },
      {
        label: "불확실하면 드로우",
        reason: "보드 재배열이 확실하지 않으면 잘못 둔 타일을 되돌리는 리스크가 큽니다.",
      },
    ],
    watchouts: [
      "초기 등록 전이면 내려놓는 타일 합계가 30 이상이어야 합니다.",
      "조커는 지금 당장 rack을 크게 줄일 때만 쓰는 편이 안전합니다.",
    ],
    confidence: "medium",
    provider: "mock",
    model,
    rawText: "mock advice",
  };
}

function normalizeRecognizedState(value: unknown): AdviceResponse["recognizedState"] {
  const parsed = value as Partial<AdviceResponse["recognizedState"]> | undefined;
  return {
    board: normalizeStringList(parsed?.board),
    rack: normalizeStringList(parsed?.rack),
    uncertainty: normalizeStringList(parsed?.uncertainty),
  };
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 6);
}

function formatHistory(history: AdviceHistoryEntry[] | undefined): string {
  const entries = history?.slice(-MAX_HISTORY_ITEMS) ?? [];
  if (entries.length === 0) {
    return "none";
  }

  return entries
    .map((entry, index) => {
      const actions = entry.actions
        .slice(0, 3)
        .map((action) => `${sanitizeHistoryText(action.label)}: ${sanitizeHistoryText(action.reason)}`)
        .join("; ") || "none";

      return [
        `#${index + 1}`,
        `confidence=${entry.confidence}`,
        `board=${formatHistoryList(entry.recognizedState.board)}`,
        `rack=${formatHistoryList(entry.recognizedState.rack)}`,
        `uncertainty=${formatHistoryList(entry.recognizedState.uncertainty)}`,
        `summary=${sanitizeHistoryText(entry.summary) || "none"}`,
        `actions=${actions}`,
      ].join(" | ");
    })
    .join("\n");
}

function formatHistoryList(items: string[]): string {
  return items.map(sanitizeHistoryText).filter(Boolean).slice(0, 6).join(", ") || "none";
}

function sanitizeHistoryText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_HISTORY_TEXT_CHARS);
}

function extractResponseText(response: unknown): string {
  const maybeOutputText = (response as { output_text?: unknown }).output_text;
  if (typeof maybeOutputText === "string") {
    return maybeOutputText;
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .map((content) => {
      const maybeText = (content as { text?: unknown }).text;
      return typeof maybeText === "string" ? maybeText : "";
    })
    .filter(Boolean)
    .join("\n");
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createStreamingResponse(config: RuntimeConfig, prompt: string, imageDataUrl: string): Promise<string> {
  const response = await fetch(`${config.baseURL.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: {
      "Accept": "text/event-stream",
      "Authorization": `Bearer ${config.apiKey ?? "not-needed"}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            {
              type: "input_image",
              image_url: imageDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      reasoning: reasoningPayload(config.reasoningEffort),
      max_output_tokens: 700,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Responses API failed: ${extractProviderError(responseText)}`);
  }

  const outputText = extractTextFromResponsesSse(responseText);
  if (!outputText.trim()) {
    throw new Error("Responses API returned no output text.");
  }
  return outputText;
}

function applyResponsesEvent(event: unknown, state: { deltaText: string; doneText: string }): void {
  const typed = event as { type?: unknown; delta?: unknown; text?: unknown };
  if (typed.type === "response.output_text.delta" && typeof typed.delta === "string") {
    state.deltaText += typed.delta;
  }
  if (typed.type === "response.output_text.done" && typeof typed.text === "string") {
    state.doneText = typed.text;
  }
}

function extractProviderError(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: { message?: unknown }; detail?: unknown };
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message;
    }
    if (typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch {
    return responseText.slice(0, 500);
  }
  return responseText.slice(0, 500);
}

function validateRequestKeys(request: AdviceRequest): void {
  const allowedKeys = new Set(["imageDataUrl", "history", "model", "reasoningEffort"]);
  const unknownKeys = Object.keys(request).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unsupported request fields: ${unknownKeys.join(", ")}`);
  }
}

function validateHistory(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    throw new Error("history must be an array.");
  }
  if (value.length > MAX_HISTORY_ITEMS) {
    throw new Error(`history must contain ${MAX_HISTORY_ITEMS} entries or less.`);
  }

  value.forEach((entry, index) => validateHistoryEntry(entry, index));
}

function validateHistoryEntry(value: unknown, index: number): void {
  const entry = value as Partial<AdviceHistoryEntry> | undefined;
  if (!entry || typeof entry !== "object") {
    throw new Error(`history[${index}] must be an object.`);
  }
  validateHistoryState(entry.recognizedState, index);
  validateHistoryText(`history[${index}].summary`, entry.summary);
  validateHistoryActions(entry.actions, index);
  if (entry.confidence !== "low" && entry.confidence !== "medium" && entry.confidence !== "high") {
    throw new Error(`history[${index}].confidence must be low, medium, or high.`);
  }
}

function validateHistoryState(value: unknown, index: number): void {
  const state = value as Partial<AdviceResponse["recognizedState"]> | undefined;
  if (!state || typeof state !== "object") {
    throw new Error(`history[${index}].recognizedState must be an object.`);
  }
  validateHistoryTextList(`history[${index}].recognizedState.board`, state.board);
  validateHistoryTextList(`history[${index}].recognizedState.rack`, state.rack);
  validateHistoryTextList(`history[${index}].recognizedState.uncertainty`, state.uncertainty);
}

function validateHistoryActions(value: unknown, index: number): void {
  if (!Array.isArray(value)) {
    throw new Error(`history[${index}].actions must be an array.`);
  }
  if (value.length > 3) {
    throw new Error(`history[${index}].actions must contain 3 entries or less.`);
  }
  value.forEach((action, actionIndex) => {
    const typed = action as Partial<AdviceAction> | undefined;
    if (!typed || typeof typed !== "object") {
      throw new Error(`history[${index}].actions[${actionIndex}] must be an object.`);
    }
    validateHistoryText(`history[${index}].actions[${actionIndex}].label`, typed.label);
    validateHistoryText(`history[${index}].actions[${actionIndex}].reason`, typed.reason);
  });
}

function validateHistoryTextList(fieldName: string, value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  if (value.length > 6) {
    throw new Error(`${fieldName} must contain 6 entries or less.`);
  }
  value.forEach((item, index) => validateHistoryText(`${fieldName}[${index}]`, item));
}

function validateHistoryText(fieldName: string, value: unknown): void {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  if (value.length > MAX_HISTORY_TEXT_CHARS) {
    throw new Error(`${fieldName} must be ${MAX_HISTORY_TEXT_CHARS} characters or less.`);
  }
}

function resolveRequestConfig(config: RuntimeConfig, request: AdviceRequest): RuntimeConfig {
  return {
    ...config,
    model: request.model ?? config.model,
    reasoningEffort: request.reasoningEffort ?? config.reasoningEffort,
  };
}

function parseSupportedModel(value: string | undefined): SupportedModel {
  const normalized = value?.trim() || DEFAULT_MODEL;
  if (isSupportedModel(normalized)) {
    return normalized;
  }
  throw new Error(`Unsupported model: ${value}`);
}

function parseReasoningEffort(value: string | undefined): ReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (isReasoningEffort(normalized)) {
    return normalized as ReasoningEffort;
  }
  throw new Error(`Unsupported reasoning effort: ${value}`);
}

function validateRequestedModel(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || !isSupportedModel(value)) {
    throw new Error(`model must be one of: ${supportedModels.join(", ")}`);
  }
}

function validateRequestedReasoningEffort(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string" || !isReasoningEffort(value)) {
    throw new Error(`reasoningEffort must be one of: ${reasoningEfforts.join(", ")}`);
  }
}

function isSupportedModel(value: string): value is SupportedModel {
  return (supportedModels as readonly string[]).includes(value);
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (reasoningEfforts as readonly string[]).includes(value);
}

function reasoningPayload(effort: ReasoningEffort | undefined): { effort: ReasoningEffort } | undefined {
  return effort && effort !== "none" ? { effort } : undefined;
}

function chatReasoningEffort(effort: ReasoningEffort | undefined): ReasoningEffort | undefined {
  return effort === "none" ? undefined : effort;
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function isValidBase64(base64: string): boolean {
  return base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
}
