import { describe, expect, it } from "vitest";
import {
  buildAdvicePrompt,
  extractTextFromResponsesSse,
  getPublicConfig,
  getRuntimeConfig,
  parseAdviceText,
  shouldAttemptChatFallback,
  validateAdviceRequest,
} from "./advice.js";

describe("advice service", () => {
  it("uses mock provider without API configuration", () => {
    const config = getRuntimeConfig({});
    expect(config.provider).toBe("mock");
    expect(getPublicConfig(config)).toMatchObject({
      provider: "mock",
      model: "gpt-5.5",
      availableModels: ["gpt-5.4", "gpt-5.5"],
      availableReasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
    });
    expect(getPublicConfig(config)).not.toHaveProperty("baseURL");
  });

  it("uses OpenAI-compatible provider when a custom base URL is configured", () => {
    const config = getRuntimeConfig({
      OPENAI_BASE_URL: "http://127.0.0.1:10531/v1",
      RUMMIKUB_MODEL: "gpt-5.4",
      RUMMIKUB_REASONING_EFFORT: "medium",
    });
    expect(config.provider).toBe("openai");
    expect(config.apiKey).toBe("not-needed");
    expect(config.model).toBe("gpt-5.4");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.useStreamingResponses).toBe(true);
    expect(getPublicConfig(config)).toMatchObject({
      model: "gpt-5.4",
      reasoningEffort: "medium",
    });
  });

  it("rejects unsupported reasoning effort values", () => {
    expect(() => getRuntimeConfig({ RUMMIKUB_REASONING_EFFORT: "extreme" })).toThrow(/Unsupported reasoning effort/);
  });

  it("rejects unsupported configured model values", () => {
    expect(() => getRuntimeConfig({ RUMMIKUB_MODEL: "gpt-4.1-mini" })).toThrow(/Unsupported model/);
  });

  it("builds prompt from rules, screen screenshot, and automatic history only", () => {
    const prompt = buildAdvicePrompt({
      imageDataUrl: "data:image/png;base64,abc",
      history: [
        {
          recognizedState: {
            board: ["이전 보드: 파랑 3-4-5"],
            rack: ["이전 랙: 빨강 8, 빨강 9"],
            uncertainty: ["이전 턴의 일부 타일이 흐림"],
          },
          summary: "이전에는 드로우가 안전했습니다.",
          actions: [{ label: "드로우", reason: "확실한 조합이 없었습니다." }],
          confidence: "low",
        },
      ],
      rackText: "B7 B8 B9 R10 Y10 K10",
      tableNotes: "manual note should be ignored",
    } as Parameters<typeof buildAdvicePrompt>[0]);
    expect(prompt).toContain("Rummikub rules");
    expect(prompt).toContain("Automatic game history");
    expect(prompt).toContain("Capture source: browser screen screenshot");
    expect(prompt).toContain("이전 보드: 파랑 3-4-5");
    expect(prompt).not.toContain("B7 B8 B9");
    expect(prompt).not.toContain("manual note should be ignored");
    expect(prompt).not.toContain("User rack notes");
    expect(prompt).not.toContain("Table notes");
    expect(prompt).toContain("recognizedState");
    expect(prompt).toContain("Return only compact JSON");
  });

  it("parses fenced JSON advice", () => {
    const parsed = parseAdviceText(`\`\`\`json
{"recognizedState":{"board":["R3-R4-R5"],"rack":["B7","B8","B9"],"uncertainty":["없음"]},"summary":"좋은 수가 있습니다.","actions":[{"label":"B7-B8-B9","reason":"연속 run입니다."}],"watchouts":["30점 확인"],"confidence":"high"}
\`\`\``);
    expect(parsed.recognizedState.board[0]).toBe("R3-R4-R5");
    expect(parsed.recognizedState.rack).toEqual(["B7", "B8", "B9"]);
    expect(parsed.summary).toBe("좋은 수가 있습니다.");
    expect(parsed.actions[0]?.label).toBe("B7-B8-B9");
    expect(parsed.confidence).toBe("high");
  });

  it("extracts text from streaming Responses events", () => {
    const text = extractTextFromResponsesSse(`event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"oauth"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"-ok"}

event: response.output_text.done
data: {"type":"response.output_text.done","text":"oauth-ok"}

`);
    expect(text).toBe("oauth-ok");
  });

  it("rejects invalid or oversized image payloads", () => {
    expect(() => validateAdviceRequest({ imageDataUrl: "nope" })).toThrow(/base64 image/);
    expect(() => validateAdviceRequest({ imageDataUrl: "data:image/gif;base64,AAAA" })).toThrow(/PNG, JPEG, or WEBP/);
    expect(() => validateAdviceRequest({ imageDataUrl: `data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}` }))
      .toThrow(/5 MB/);
  });

  it("validates request metadata bounds", () => {
    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      history: [
        {
          recognizedState: { board: [], rack: [], uncertainty: [] },
          summary: "A".repeat(501),
          actions: [],
          confidence: "medium",
        },
      ],
    })).toThrow(/summary/);
  });

  it("accepts supported request model controls only", () => {
    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      model: "gpt-5.4",
      reasoningEffort: "high",
    })).not.toThrow();

    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      model: "gpt-4.1-mini",
    } as unknown as Parameters<typeof validateAdviceRequest>[0])).toThrow(/model must be one of/);

    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      reasoningEffort: "extreme",
    } as unknown as Parameters<typeof validateAdviceRequest>[0])).toThrow(/reasoningEffort must be one of/);
  });

  it("rejects legacy request fields", () => {
    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      captureMode: "board",
    } as Parameters<typeof validateAdviceRequest>[0])).toThrow(/Unsupported request fields: captureMode/);

    expect(() => validateAdviceRequest({
      imageDataUrl: "data:image/png;base64,AAAA",
      rackText: "B7 B8 B9",
      tableNotes: "manual note",
    } as Parameters<typeof validateAdviceRequest>[0])).toThrow(/Unsupported request fields: rackText, tableNotes/);
  });

  it("limits chat fallback to configured endpoint-compatibility failures", () => {
    expect(shouldAttemptChatFallback({ status: 404 }, { allowChatFallback: true })).toBe(true);
    expect(shouldAttemptChatFallback(new Error("unsupported endpoint"), { allowChatFallback: true })).toBe(true);
    expect(shouldAttemptChatFallback(new Error("rsp.output is not iterable"), { allowChatFallback: true })).toBe(true);
    expect(shouldAttemptChatFallback({ status: 401 }, { allowChatFallback: true })).toBe(false);
    expect(shouldAttemptChatFallback({ status: 404 }, { allowChatFallback: false })).toBe(false);
  });
});
