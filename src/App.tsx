import {
  Bot,
  Gamepad2,
  Loader2,
  RefreshCw,
  Send,
} from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { fetchConfig, requestAdvice } from "./api";
import { captureScreenFrame } from "./capture";
import {
  reasoningEfforts,
  supportedModels,
  type AdviceHistoryEntry,
  type AdviceResponse,
  type PublicConfig,
  type ReasoningEffort,
  type SupportedModel,
} from "../shared/types";

const rummikubGameUrl = "https://rummikub-apps.com/?cb=37";
const defaultModel: SupportedModel = "gpt-5.5";
const defaultReasoningEffort: ReasoningEffort = "medium";

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

const maxHistoryEntries = 6;

export default function App() {
  const gameFrameRef = useRef<HTMLIFrameElement>(null);
  const [gameVersion, setGameVersion] = useState(0);
  const [advice, setAdvice] = useState<AdviceResponse>(defaultAdvice);
  const [history, setHistory] = useState<AdviceHistoryEntry[]>([]);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [selectedModel, setSelectedModel] = useState<SupportedModel>(defaultModel);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort>(defaultReasoningEffort);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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

  async function handleAdviceRequest() {
    setIsLoading(true);
    setError(null);

    try {
      const capture = await captureScreenFrame({
        element: gameFrameRef.current,
      });

      setScreenshot(capture.imageDataUrl);
      const nextAdvice = await requestAdvice({
        imageDataUrl: capture.imageDataUrl,
        history,
        model: selectedModel,
        reasoningEffort: selectedReasoningEffort,
      });
      setAdvice(nextAdvice);
      setHistory((currentHistory) => [
        ...currentHistory,
        toHistoryEntry(nextAdvice),
      ].slice(-maxHistoryEntries));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "조언 요청에 실패했습니다.");
    } finally {
      setIsLoading(false);
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
                setHistory([]);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="game-surface">
            <EmbeddedGame key={gameVersion} ref={gameFrameRef} url={rummikubGameUrl} />
          </div>
        </div>

        <aside className="advice-panel">
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

          {error ? <div className="error-box">{error}</div> : null}

          {screenshot ? (
            <div className="screenshot-card">
              <span>Last capture</span>
              <img src={screenshot} alt="Last captured Rummikub screen" />
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function toHistoryEntry(advice: AdviceResponse): AdviceHistoryEntry {
  return {
    recognizedState: advice.recognizedState,
    summary: advice.summary,
    actions: advice.actions,
    confidence: advice.confidence,
  };
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

const EmbeddedGame = forwardRef<HTMLIFrameElement, { url: string }>(function EmbeddedGame({ url }, ref) {
  return (
    <iframe
      className="game-frame"
      title="Rummikub web game"
      src={url}
      allow="fullscreen; autoplay; clipboard-read; clipboard-write; pointer-lock; gamepad; screen-wake-lock"
      allowFullScreen
      ref={ref}
    />
  );
});
