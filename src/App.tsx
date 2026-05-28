import {
  Bot,
  ChevronRight,
  Gamepad2,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  User,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { fetchConfig, requestAdvice, requestChat } from "./api";
import { captureScreenFrame } from "./capture";
import {
  playerRegistrationStatuses,
  reasoningEfforts,
  maxChatTextChars,
  supportedModels,
  type AdviceResponse,
  type PlayerRegistrationStatus,
  type PublicConfig,
  type ReasoningEffort,
  type SupportedModel,
} from "../shared/types";
import {
  appendThreadMessage,
  buildThreadChatPayload,
  prependThread,
  type AdviceThread,
  type ThreadMessage,
} from "./threading";

const rummikubGameUrl = "https://rummikub-apps.com/?cb=37";
const defaultModel: SupportedModel = "gpt-5.5";
const defaultReasoningEffort: ReasoningEffort = "medium";
const registrationStorageKey = "rummikub.registrationStatus";
const registrationStatusLabels: Record<PlayerRegistrationStatus, string> = {
  unknown: "모름",
  unregistered: "등록 전",
  registered: "등록 완료",
};

const defaultAdvice: AdviceResponse = {
  recognizedState: {
    board: [],
    rack: [],
    uncertainty: ["아직 캡처 전입니다."],
  },
  summary: "훈수 받기를 누르면 현재 Rummikub 화면 기준의 다음 수가 여기에 표시됩니다.",
  actions: [
    {
      label: "대기 중",
      reason: "화면 캡처가 준비되면 조합 후보를 분석합니다.",
    },
  ],
  watchouts: ["초기 등록 전이면 합계 30 조건을 확인하세요."],
  confidence: "low",
  provider: "mock",
  model: "local",
};

export default function App() {
  const gameCaptureRef = useRef<HTMLDivElement>(null);
  const [gameVersion, setGameVersion] = useState(0);
  const [threads, setThreads] = useState<AdviceThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(defaultModel);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>(defaultReasoningEffort);
  const [playerRegistrationStatus, setPlayerRegistrationStatus] = useState<PlayerRegistrationStatus>(
    getInitialRegistrationStatus,
  );
  const [chatDraft, setChatDraft] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatLoadingThreadId, setChatLoadingThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch((configError: unknown) => {
        setError(configError instanceof Error ? configError.message : "설정을 불러오지 못했습니다.");
      });
  }, []);

  useEffect(() => {
    if (!config) {
      return;
    }
    if (config.availableModels.includes(config.model)) {
      setSelectedModel(config.model);
    }
    if (config.reasoningEffort && config.availableReasoningEfforts.includes(config.reasoningEffort)) {
      setSelectedReasoningEffort(config.reasoningEffort);
    }
  }, [config]);

  const availableModels = config?.availableModels ?? [...supportedModels];
  const availableReasoningEfforts = config?.availableReasoningEfforts ?? [...reasoningEfforts];
  const providerLabel = `${selectedModel} / ${selectedReasoningEffort}`;
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const inactiveThreads = threads.filter((thread) => thread.id !== activeThreadId);
  const displayedAdvice = activeThread?.advice ?? defaultAdvice;
  const displayedScreenshot = activeThread?.screenshot ?? null;

  useEffect(() => {
    setChatDraft("");
  }, [activeThreadId]);

  async function handleAdviceRequest() {
    setIsLoading(true);
    setError(null);

    try {
      const capture = await captureScreenFrame({
        element: gameCaptureRef.current,
      });

      const nextAdvice = await requestAdvice({
        imageDataUrl: capture.imageDataUrl,
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
        playerRegistrationStatus,
      });
      const nextThread: AdviceThread = {
        id: createId("thread"),
        createdAt: Date.now(),
        screenshot: capture.imageDataUrl,
        advice: nextAdvice,
        messages: [],
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
        registrationStatus: playerRegistrationStatus,
      };
      setThreads((currentThreads) => prependThread(currentThreads, nextThread));
      setActiveThreadId(nextThread.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "조언 요청에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = chatDraft.trim();
    if (!content || !activeThread || chatLoadingThreadId) {
      return;
    }
    if (content.length > maxChatTextChars) {
      setError(`채팅 질문은 ${maxChatTextChars.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`);
      return;
    }

    const userMessage: ThreadMessage = {
      id: createId("message"),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    const messagesForRequest = [...activeThread.messages, userMessage];

    setError(null);
    setChatDraft("");
    setThreads((currentThreads) => appendThreadMessage(currentThreads, activeThread.id, userMessage));
    setChatLoadingThreadId(activeThread.id);

    try {
      const reply = await requestChat(buildThreadChatPayload(activeThread, messagesForRequest));
      const assistantMessage: ThreadMessage = {
        id: createId("message"),
        role: "assistant",
        content: reply.message.content,
        createdAt: Date.now(),
      };
      setThreads((currentThreads) => appendThreadMessage(currentThreads, activeThread.id, assistantMessage));
    } catch (chatError) {
      setError(chatError instanceof Error ? chatError.message : "채팅 응답 요청에 실패했습니다.");
    } finally {
      setChatLoadingThreadId((currentThreadId) => currentThreadId === activeThread.id ? null : currentThreadId);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Rummikub Sidekick</p>
          <h1>다음 수 말풍선</h1>
        </div>
        <div className="status-pill">
          <Bot size={16} aria-hidden="true" />
          <span>{providerLabel}</span>
        </div>
      </section>

      <section className="workspace">
        <div className="play-column">
          <div className="toolbar" aria-label="play controls">
            <div className="mode-pill">
              <Gamepad2 size={16} aria-hidden="true" />
              <span>Rummikub Web</span>
            </div>

            <div className="model-controls" aria-label="model controls">
              <label className="select-control">
                <span>모델</span>
                <select
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.target.value as SupportedModel)}
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              </label>
              <label className="select-control">
                <span>추론</span>
                <select
                  value={selectedReasoningEffort}
                  onChange={(event) => setSelectedReasoningEffort(event.target.value as ReasoningEffort)}
                >
                  {availableReasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>{effort}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="registration-control" aria-label="registration status">
              <span>등록</span>
              <div className="segmented-status">
                {playerRegistrationStatuses.map((status) => (
                  <button
                    aria-pressed={playerRegistrationStatus === status}
                    className={playerRegistrationStatus === status ? "is-selected" : undefined}
                    key={status}
                    onClick={() => updateRegistrationStatus(status, setPlayerRegistrationStatus)}
                    type="button"
                  >
                    {registrationStatusLabels[status]}
                  </button>
                ))}
              </div>
            </div>

            <button className="primary-action" disabled={isLoading} onClick={handleAdviceRequest}>
              {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
              훈수 받기
            </button>
          </div>

          <div className="embed-controls">
            <button
              aria-label="Reload Rummikub game"
              onClick={() => {
                setGameVersion((currentVersion) => currentVersion + 1);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="game-surface">
            <div className="game-capture-window" ref={gameCaptureRef}>
              <EmbeddedGame key={gameVersion} url={rummikubGameUrl} />
            </div>
          </div>
        </div>

        <aside className="advice-panel">
          {inactiveThreads.length > 0 ? (
            <ThreadArchive
              activeThreadId={activeThreadId}
              onSelectThread={setActiveThreadId}
              threads={inactiveThreads}
            />
          ) : null}

          <AdviceBubble advice={displayedAdvice} />

          {activeThread ? (
            <ThreadChat
              draft={chatDraft}
              isLoading={chatLoadingThreadId === activeThread.id}
              messages={activeThread.messages}
              onDraftChange={setChatDraft}
              onSubmit={handleChatSubmit}
              thread={activeThread}
            />
          ) : null}

          {error ? <div className="error-box">{error}</div> : null}

          {displayedScreenshot ? (
            <div className="screenshot-card">
              <span>Thread capture</span>
              <img src={displayedScreenshot} alt="Captured Rummikub screen for the active thread" />
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getInitialRegistrationStatus(): PlayerRegistrationStatus {
  try {
    const stored = window.localStorage.getItem(registrationStorageKey);
    return isPlayerRegistrationStatus(stored) ? stored : "unknown";
  } catch {
    return "unknown";
  }
}

function updateRegistrationStatus(
  status: PlayerRegistrationStatus,
  setStatus: (status: PlayerRegistrationStatus) => void,
) {
  setStatus(status);
  try {
    window.localStorage.setItem(registrationStorageKey, status);
  } catch {
    // localStorage is optional; the in-memory state still works for this session.
  }
}

function isPlayerRegistrationStatus(value: unknown): value is PlayerRegistrationStatus {
  return typeof value === "string" && (playerRegistrationStatuses as readonly string[]).includes(value);
}

function ThreadArchive({
  activeThreadId,
  onSelectThread,
  threads,
}: {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  threads: AdviceThread[];
}) {
  return (
    <div className="thread-archive" aria-label="previous advice threads">
      <div className="thread-archive-header">
        <MessageCircle size={15} aria-hidden="true" />
        <span>이전 스레드</span>
      </div>
      <div className="thread-list">
        {threads.map((thread) => (
          <button
            aria-pressed={activeThreadId === thread.id}
            className="thread-summary"
            key={thread.id}
            onClick={() => onSelectThread(thread.id)}
            type="button"
          >
            <span>{formatThreadTime(thread.createdAt)}</span>
            <strong>{thread.advice.summary}</strong>
            <small>{formatThreadMeta(thread)}</small>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function AdviceBubble({ advice }: { advice: AdviceResponse }) {
  return (
    <div className="bubble">
      <div className="bubble-avatar">
        <Bot size={22} aria-hidden="true" />
      </div>
      <div className="bubble-body">
        <div className="bubble-meta">
          <span>RESPONSES</span>
        </div>
        <RecognizedStateView state={advice.recognizedState} />
        <p className="summary">{advice.summary}</p>
        <div className="action-list">
          {advice.actions.map((action) => (
            <div className="action-item" key={`${action.label}-${action.reason}`}>
              <strong>{action.label}</strong>
              <span>{action.reason}</span>
            </div>
          ))}
        </div>
        <div className="watchouts">
          {advice.watchouts.map((watchout) => (
            <span key={watchout}>{watchout}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThreadChat({
  draft,
  isLoading,
  messages,
  onDraftChange,
  onSubmit,
  thread,
}: {
  draft: string;
  isLoading: boolean;
  messages: ThreadMessage[];
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  thread: AdviceThread;
}) {
  return (
    <div className="thread-chat">
      <div className="thread-context">
        <span>{formatThreadMeta(thread)}</span>
      </div>
      {messages.length > 0 ? (
        <div className="chat-log" aria-label="thread chat log">
          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}
          {isLoading ? (
            <div className="chat-message assistant pending">
              <Bot size={16} aria-hidden="true" />
              <span>답변 생성 중...</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <form className="chat-form" onSubmit={onSubmit}>
        <textarea
          aria-label="follow-up question"
          disabled={isLoading}
          maxLength={maxChatTextChars}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="보드/랙 교정, 새로 뽑은 카드 가정, 조커 활용 질문을 이어서 물어보세요."
          rows={3}
          value={draft}
        />
        <button disabled={isLoading || draft.trim().length === 0} type="submit">
          {isLoading ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          보내기
        </button>
      </form>
    </div>
  );
}

function ChatMessageBubble({ message }: { message: ThreadMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`chat-message ${isUser ? "user" : "assistant"}`}>
      {isUser ? <User size={16} aria-hidden="true" /> : <Bot size={16} aria-hidden="true" />}
      <p>{message.content}</p>
    </div>
  );
}

function formatThreadTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function formatThreadMeta(thread: AdviceThread): string {
  return `${thread.model} / ${thread.reasoningEffort} / ${registrationStatusLabels[thread.registrationStatus]}`;
}

function RecognizedStateView({ state }: { state: AdviceResponse["recognizedState"] }) {
  const hasBoard = state.board.length > 0;
  const hasRack = state.rack.length > 0;
  const hasUncertainty = state.uncertainty.length > 0;

  if (!hasBoard && !hasRack && !hasUncertainty) {
    return null;
  }

  return (
    <div className="recognized-state">
      {hasBoard ? <StateGroup label="읽은 보드" items={state.board} /> : null}
      {hasRack ? <StateGroup label="읽은 랙" items={state.rack} /> : null}
      {hasUncertainty ? <StateGroup label="불확실" items={state.uncertainty} /> : null}
    </div>
  );
}

function StateGroup({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="state-group">
      <strong>{label}</strong>
      <div>
        {items.map((item) => (
          <span key={`${label}-${item}`}>{item}</span>
        ))}
      </div>
    </div>
  );
}

function EmbeddedGame({ url }: { url: string }) {
  return (
    <iframe
      className="game-frame"
      title="Rummikub web game"
      src={url}
      allow="fullscreen; autoplay; clipboard-read; clipboard-write; pointer-lock; gamepad; screen-wake-lock"
      allowFullScreen
    />
  );
}
