import type {
  AdviceContext,
  AdviceResponse,
  ChatMessage,
  PlayerRegistrationStatus,
  ReasoningEffort,
  SupportedModel,
} from "../shared/types";

export const maxAdviceThreads = 6;
export const maxThreadMessages = 20;

export type ThreadMessage = ChatMessage & {
  id: string;
  createdAt: number;
};

export type AdviceThread = {
  id: string;
  createdAt: number;
  screenshot: string;
  advice: AdviceResponse;
  messages: ThreadMessage[];
  model: SupportedModel;
  reasoningEffort: ReasoningEffort;
  registrationStatus: PlayerRegistrationStatus;
};

export function prependThread(threads: AdviceThread[], thread: AdviceThread): AdviceThread[] {
  return [thread, ...threads].slice(0, maxAdviceThreads);
}

export function appendThreadMessage(
  threads: AdviceThread[],
  threadId: string,
  message: ThreadMessage,
): AdviceThread[] {
  return threads.map((thread) => (
    thread.id === threadId
      ? { ...thread, messages: windowThreadMessages([...thread.messages, message]) }
      : thread
  ));
}

export function toChatMessage(message: ThreadMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

export function toAdviceContext(advice: AdviceResponse): AdviceContext {
  return {
    recognizedState: advice.recognizedState,
    summary: advice.summary,
    actions: advice.actions,
    watchouts: advice.watchouts,
    confidence: advice.confidence,
  };
}

export function buildThreadChatPayload(thread: AdviceThread, messages: ThreadMessage[]) {
  return {
    threadId: thread.id,
    imageDataUrl: thread.screenshot,
    initialAdvice: toAdviceContext(thread.advice),
    messages: windowThreadMessages(messages).map(toChatMessage),
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    playerRegistrationStatus: thread.registrationStatus,
  };
}

export function windowThreadMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return messages.slice(-maxThreadMessages);
}
