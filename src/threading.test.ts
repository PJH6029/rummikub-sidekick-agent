import { describe, expect, it } from "vitest";
import type { AdviceResponse } from "../shared/types";
import {
  appendThreadMessage,
  buildThreadChatPayload,
  maxAdviceThreads,
  maxThreadMessages,
  prependThread,
  type AdviceThread,
  type ThreadMessage,
} from "./threading";

const advice: AdviceResponse = {
  recognizedState: { board: ["보드"], rack: ["랙"], uncertainty: [] },
  summary: "초기 훈수",
  actions: [{ label: "액션", reason: "이유" }],
  watchouts: ["주의"],
  confidence: "medium",
  provider: "responses",
  model: "gpt-5.5",
};

describe("threading helpers", () => {
  it("uses the active thread snapshot for follow-up chat controls", () => {
    const thread = createThread("thread-a", {
      model: "gpt-5.4",
      reasoningEffort: "high",
      registrationStatus: "registered",
    });
    const messages: ThreadMessage[] = [
      {
        id: "message-1",
        role: "user",
        content: "랙의 5는 빨강이 아니라 파랑이야.",
        createdAt: 2,
      },
    ];

    expect(buildThreadChatPayload(thread, messages)).toMatchObject({
      threadId: "thread-a",
      imageDataUrl: "data:image/png;base64,AAAA",
      model: "gpt-5.4",
      reasoningEffort: "high",
      playerRegistrationStatus: "registered",
      messages: [{ role: "user", content: "랙의 5는 빨강이 아니라 파랑이야." }],
    });
  });

  it("caps retained advice threads to avoid unbounded screenshot memory growth", () => {
    const threads = Array.from({ length: maxAdviceThreads }, (_, index) => createThread(`thread-${index}`));
    const nextThread = createThread("new-thread");

    const retainedThreads = prependThread(threads, nextThread);

    expect(retainedThreads).toHaveLength(maxAdviceThreads);
    expect(retainedThreads[0]?.id).toBe("new-thread");
    expect(retainedThreads.at(-1)?.id).toBe(`thread-${maxAdviceThreads - 2}`);
  });

  it("windows per-thread messages below the server request limit", () => {
    const thread = createThread("thread-a");
    const messages = Array.from({ length: maxThreadMessages + 5 }, (_, index) => ({
      id: `message-${index}`,
      role: "user" as const,
      content: `질문 ${index}`,
      createdAt: index,
    }));

    const payload = buildThreadChatPayload(thread, messages);

    expect(payload.messages).toHaveLength(maxThreadMessages);
    expect(payload.messages[0]?.content).toBe("질문 5");
    expect(payload.messages.at(-1)?.content).toBe(`질문 ${maxThreadMessages + 4}`);
  });

  it("caps retained messages when appending to a thread", () => {
    const thread = createThread("thread-a", {
      messages: Array.from({ length: maxThreadMessages }, (_, index) => ({
        id: `message-${index}`,
        role: "assistant",
        content: `답변 ${index}`,
        createdAt: index,
      })),
    });

    const [updatedThread] = appendThreadMessage([thread], "thread-a", {
      id: "new-message",
      role: "user",
      content: "새 질문",
      createdAt: maxThreadMessages + 1,
    });

    expect(updatedThread?.messages).toHaveLength(maxThreadMessages);
    expect(updatedThread?.messages[0]?.content).toBe("답변 1");
    expect(updatedThread?.messages.at(-1)?.content).toBe("새 질문");
  });
});

function createThread(id: string, overrides: Partial<AdviceThread> = {}): AdviceThread {
  return {
    id,
    createdAt: 1,
    screenshot: "data:image/png;base64,AAAA",
    advice,
    messages: [],
    model: "gpt-5.5",
    reasoningEffort: "medium",
    registrationStatus: "unknown",
    ...overrides,
  };
}
