import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, RefreshCw, RotateCcw, Settings, Upload, Volume2 } from "lucide-react";
import dutchDeckData from "./data/dutch-deck.json";
import mandarinDeckData from "./data/mandarin-deck.json";
import {
  applyAnswer,
  applyKnown,
  buildStats,
  labelFor,
  makeCard,
  type AppState,
  type Card,
  type DeckEntry,
  type LanguageCode,
  type LanguageSettings,
  type LanguageState,
  type PromptMode,
} from "./lib/scheduler";
import { mergeStateWithSnapshot, sameSnapshot, snapshotFromState, type RemoteSyncSnapshot } from "./lib/sync";
import "./styles.css";

const decks: Record<LanguageCode, DeckEntry[]> = {
  nl: (dutchDeckData.entries as DeckEntry[]).filter((entry) => entry.translations.length > 0),
  zh: (mandarinDeckData.entries as DeckEntry[]).filter((entry) => entry.translations.length > 0 && entry.pinyin),
};

const languageLabels: Record<LanguageCode, { flag: string; name: string; ttsLang: string }> = {
  nl: { flag: "🇳🇱", name: "Dutch", ttsLang: "nl-NL" },
  zh: { flag: "🇨🇳", name: "Mandarin", ttsLang: "zh-CN" },
};

const storageKey = "flashlang:v3";
const legacyStorageKey = "flashlang:v2";
const syncCodeKey = "flashlang:syncCode";
const syncRevisionKey = "flashlang:syncRevision";
const remoteAudio = new Audio();

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "unauthorized";

function createLanguageState(language: LanguageCode): LanguageState {
  return {
    settings: {
      activeSize: Math.min(language === "zh" ? 300 : 500, decks[language].length),
      promptMode: "mixed",
      audioEnabled: true,
    },
    progress: {},
    totals: {
      answered: 0,
      correct: 0,
      streak: 0,
    },
  };
}

function createState(): AppState {
  return {
    version: 2,
    activeLanguage: "nl",
    languages: {
      nl: createLanguageState("nl"),
      zh: createLanguageState("zh"),
    },
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return normalizeState(JSON.parse(raw));

    const legacyRaw = localStorage.getItem(legacyStorageKey);
    if (legacyRaw) return migrateLegacyState(JSON.parse(legacyRaw));
  } catch {
    return createState();
  }
  return createState();
}

function normalizeState(value: Partial<AppState>): AppState {
  const base = createState();
  if (value.version !== 2) return base;
  return {
    ...base,
    ...value,
    activeLanguage: value.activeLanguage === "zh" ? "zh" : "nl",
    languages: {
      nl: normalizeLanguageState(value.languages?.nl, base.languages.nl),
      zh: normalizeLanguageState(value.languages?.zh, base.languages.zh),
    },
  };
}

function normalizeLanguageState(
  value: { settings?: Partial<LanguageSettings>; progress?: LanguageState["progress"]; totals?: Partial<LanguageState["totals"]> } | undefined,
  fallback: LanguageState,
): LanguageState {
  return {
    ...fallback,
    ...value,
    settings: { ...fallback.settings, ...value?.settings },
    totals: { ...fallback.totals, ...value?.totals },
    progress: value?.progress || {},
  };
}

function migrateLegacyState(value: {
  settings?: Partial<LanguageSettings>;
  progress?: LanguageState["progress"];
  totals?: LanguageState["totals"];
}): AppState {
  const next = createState();
  next.languages.nl = normalizeLanguageState(
    {
      settings: value.settings,
      progress: value.progress,
      totals: value.totals,
    },
    next.languages.nl,
  );
  return next;
}

function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [syncCode, setSyncCode] = useState(() => localStorage.getItem(syncCodeKey) || "");
  const [syncRevision, setSyncRevision] = useState(() => Number(localStorage.getItem(syncRevisionKey) || 0));
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [card, setCard] = useState<Card | null>(null);
  const [feedback, setFeedback] = useState<"correct" | "wrong" | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stateRef = useRef(state);
  const syncCodeRef = useRef(syncCode);
  const syncRevisionRef = useRef(syncRevision);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const syncEpochRef = useRef(0);

  const language = state.activeLanguage;
  const languageState = state.languages[language];
  const deck = decks[language];
  const activeDeck = useMemo(
    () => deck.slice(0, Math.min(languageState.settings.activeSize, deck.length)),
    [deck, languageState.settings.activeSize],
  );
  const stats = useMemo(() => buildStats(languageState, activeDeck), [activeDeck, languageState]);

  useEffect(() => {
    stateRef.current = state;
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    syncCodeRef.current = syncCode;
    localStorage.setItem(syncCodeKey, syncCode);
    setSyncStatus("idle");
  }, [syncCode]);

  useEffect(() => {
    syncRevisionRef.current = syncRevision;
    localStorage.setItem(syncRevisionKey, String(syncRevision));
  }, [syncRevision]);

  useEffect(() => {
    if (!syncCode.trim()) return;
    const timeout = window.setTimeout(() => {
      void syncNow();
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [state, syncCode]);

  useEffect(() => {
    setCard(makeCard(languageState, activeDeck));
  }, [activeDeck, languageState.settings.audioEnabled, languageState.settings.promptMode]);

  useEffect(() => {
    if (languageState.settings.audioEnabled && card?.promptType === "listen") speak(card.entry.term, card.entry.ttsLang);
  }, [card, languageState.settings.audioEnabled]);

  function setLanguage(nextLanguage: LanguageCode) {
    setFeedback(null);
    setSelected(null);
    setState((current) => ({ ...current, activeLanguage: nextLanguage }));
  }

  function updateLanguageState(languageCode: LanguageCode, updater: (current: LanguageState) => LanguageState) {
    setState((current) => ({
      ...current,
      languages: {
        ...current.languages,
        [languageCode]: updater(current.languages[languageCode]),
      },
    }));
  }

  function advance(nextLanguageState: LanguageState) {
    const currentLanguage = language;
    updateLanguageState(currentLanguage, () => nextLanguageState);
  }

  function answer(label: string) {
    if (!card || feedback) return;
    const isCorrect = label === card.correctLabel;
    setSelected(label);
    setFeedback(isCorrect ? "correct" : "wrong");
    advance(applyAnswer(languageState, card.progressId, isCorrect));
  }

  function markKnown() {
    if (!card || feedback) return;
    setFeedback("correct");
    advance(applyKnown(languageState, card.progressId));
  }

  function continueAfterReveal() {
    if (!feedback) return;
    const currentLanguageState = stateRef.current.languages[language];
    setFeedback(null);
    setSelected(null);
    setCard(makeCard(currentLanguageState, activeDeck));
  }

  function replay() {
    if (card && languageState.settings.audioEnabled) speak(card.entry.term, card.entry.ttsLang);
  }

  function updateSettings(patch: Partial<LanguageSettings>) {
    updateLanguageState(language, (current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }

  async function resetProgress() {
    const remoteNotice = syncCodeRef.current.trim() ? " and on the sync server" : "";
    if (!confirm(`Reset ${languageLabels[language].name} learning progress on this device${remoteNotice}?`)) return;
    const currentLanguage = language;
    const next = createLanguageState(language);
    next.settings = languageState.settings;
    const nextState = {
      ...stateRef.current,
      languages: {
        ...stateRef.current.languages,
        [currentLanguage]: next,
      },
    };

    syncEpochRef.current += 1;
    syncQueuedRef.current = false;
    stateRef.current = nextState;
    setState(nextState);
    setFeedback(null);
    setSelected(null);
    setCard(makeCard(next, activeDeck));

    if (syncCodeRef.current.trim()) {
      await resetRemoteProgress(currentLanguage);
    }
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "flashlang-progress.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importProgress(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = normalizeState(JSON.parse(text) as AppState);
    setState(parsed);
    setSettingsOpen(false);
  }

  async function syncNow() {
    const code = syncCodeRef.current.trim();
    if (!code) {
      setSyncStatus("idle");
      return;
    }

    if (syncInFlightRef.current) {
      syncQueuedRef.current = true;
      return;
    }

    syncInFlightRef.current = true;
    setSyncStatus("syncing");
    const syncEpoch = syncEpochRef.current;

    try {
      const current = stateRef.current;
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${code}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...snapshotFromState(current),
          baseRevision: syncRevisionRef.current,
        }),
      });

      if (response.status === 401) {
        setSyncStatus("unauthorized");
        return;
      }

      if (!response.ok) throw new Error(`Sync failed with HTTP ${response.status}`);

      const remote = await response.json() as RemoteSyncSnapshot;
      if (syncEpoch !== syncEpochRef.current) return;
      const nextState = mergeStateWithSnapshot(current, remote);
      if (!sameSnapshot(snapshotFromState(current), snapshotFromState(nextState))) {
        setState(nextState);
        const nextLanguageState = nextState.languages[nextState.activeLanguage];
        setCard(makeCard(nextLanguageState, activeDeck));
      }
      setSyncRevision(remote.revision);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    } finally {
      syncInFlightRef.current = false;
      if (syncQueuedRef.current) {
        syncQueuedRef.current = false;
        window.setTimeout(() => void syncNow(), 100);
      }
    }
  }

  async function resetRemoteProgress(languageCode: LanguageCode) {
    setSyncStatus("syncing");
    await waitForSyncIdle();

    try {
      const code = syncCodeRef.current.trim();
      const response = await fetch(`/api/sync?language=${encodeURIComponent(languageCode)}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${code}`,
        },
      });

      if (response.status === 401) {
        setSyncStatus("unauthorized");
        return;
      }

      if (!response.ok) throw new Error(`Reset failed with HTTP ${response.status}`);

      const remote = await response.json() as RemoteSyncSnapshot;
      setSyncRevision(remote.revision);
      setSyncStatus("synced");
    } catch {
      setSyncStatus("error");
    }
  }

  async function waitForSyncIdle() {
    for (let attempt = 0; attempt < 100 && syncInFlightRef.current; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }

  if (!card) {
    return <main className="appShell">Loading deck...</main>;
  }

  return (
    <main className={`appShell ${feedback ? `is-${feedback}` : ""}`}>
      <header className="topBar">
        <div className="metric">
          <span>{stats.learned}</span>
          <small>known</small>
        </div>
        <button
          className="languageSwitch"
          onClick={() => setLanguage(language === "nl" ? "zh" : "nl")}
          title={`Switch to ${language === "nl" ? "Mandarin" : "Dutch"}`}
          aria-label={`Switch to ${language === "nl" ? "Mandarin" : "Dutch"}`}
        >
          <span>{languageLabels[language].flag}</span>
          <small>{languageLabels[language].name}</small>
        </button>
        <div className="metric metricRight">
          <span>{languageState.totals.streak}</span>
          <small>streak</small>
        </div>
        <div className="topActions">
          <button className="iconButton" onClick={replay} title="Replay audio" aria-label="Replay audio" disabled={!languageState.settings.audioEnabled}>
            <Volume2 size={21} />
          </button>
          <button className="iconButton" onClick={() => setSettingsOpen((value) => !value)} title="Settings" aria-label="Settings">
            <Settings size={21} />
          </button>
        </div>
      </header>

      <section className="promptArea">
        <div className="modeLabel">{promptTitle(card)}</div>
        <button
          className={`promptButton prompt-${card.promptType}`}
          onClick={(event) => {
            event.stopPropagation();
            replay();
          }}
          disabled={card.promptType !== "listen"}
        >
          {card.promptType === "listen" ? <Volume2 size={56} strokeWidth={1.8} /> : card.promptLabel}
        </button>
        {(feedback || card.isNew) && (
          <div className={`answerReveal ${card.isNew ? "teachingReveal" : ""}`}>
            {revealParts(card, Boolean(feedback)).map((part) =>
              part.strong ? <strong key={part.value}>{part.value}</strong> : <span key={part.value}>{part.value}</span>,
            )}
          </div>
        )}
        {feedback && <div className="continueHint">Tap anywhere to continue</div>}
      </section>

      <section className={`optionsGrid answer-${card.answerType}`} aria-label="Answers">
        {card.options.map((option) => {
          const stateClass =
            feedback && option === card.correctLabel
              ? "optionCorrect"
              : feedback && option === selected
                ? "optionWrong"
                : "";
          return (
            <button
              key={option}
              className={`optionButton ${stateClass}`}
              onClick={(event) => {
                event.stopPropagation();
                answer(option);
              }}
            >
              {option}
            </button>
          );
        })}
      </section>

      <footer className="bottomBar">
        <button
          className="knownButton"
          onClick={(event) => {
            event.stopPropagation();
            markKnown();
          }}
        >
          Known
        </button>
        <div className="progressLine">
          <span style={{ width: `${Math.round((stats.touched / activeDeck.length) * 100)}%` }} />
        </div>
        <span className="rankLabel">#{card.entry.rank}</span>
      </footer>

      {settingsOpen && (
        <button
          className="settingsBackdrop"
          onClick={() => setSettingsOpen(false)}
          aria-label="Close settings"
          title="Close settings"
        />
      )}

      {settingsOpen && (
        <aside className="settingsPanel" aria-label="Settings" onClick={(event) => event.stopPropagation()}>
          <label>
            Prompt
            <select value={languageState.settings.promptMode} onChange={(event) => updateSettings({ promptMode: event.target.value as PromptMode })}>
              {promptOptions(language).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="checkRow">
            <input
              type="checkbox"
              checked={languageState.settings.audioEnabled}
              onChange={(event) => updateSettings({ audioEnabled: event.target.checked })}
            />
            Audio
          </label>
          <label>
            Active words
            <input
              type="range"
              min="100"
              max={deck.length}
              step="100"
              value={languageState.settings.activeSize}
              onChange={(event) => updateSettings({ activeSize: Number(event.target.value) })}
            />
            <span>{languageState.settings.activeSize}</span>
          </label>
          <label>
            Sync code
            <input
              type="password"
              autoComplete="current-password"
              value={syncCode}
              placeholder="Private sync code"
              onChange={(event) => setSyncCode(event.target.value)}
            />
          </label>
          <div className="syncRow">
            <button onClick={() => void syncNow()} disabled={!syncCode.trim() || syncStatus === "syncing"}>
              <RefreshCw size={18} /> Sync
            </button>
            <span className={`syncStatus sync-${syncStatus}`}>{syncStatusLabel(syncStatus)}</span>
          </div>
          <div className="settingsActions">
            <button onClick={exportProgress}><Download size={18} /> Export</button>
            <button onClick={() => fileInputRef.current?.click()}><Upload size={18} /> Import</button>
            <button onClick={() => void resetProgress()}><RotateCcw size={18} /> Reset</button>
          </div>
          <input
            ref={fileInputRef}
            className="hiddenInput"
            type="file"
            accept="application/json"
            onChange={(event) => importProgress(event.target.files?.[0])}
          />
        </aside>
      )}
      {feedback && (
        <button
          className="continueOverlay"
          onClick={continueAfterReveal}
          aria-label="Continue to next card"
          title="Continue"
        />
      )}
    </main>
  );
}

function promptOptions(language: LanguageCode) {
  if (language === "nl") {
    return [
      { value: "mixed", label: "Mixed" },
      { value: "listen", label: "Listen only" },
      { value: "read", label: "Read only" },
    ];
  }
  return [
    { value: "mixed", label: "Guided mix" },
    { value: "audio", label: "Listen prompts" },
    { value: "hanzi", label: "Hanzi prompts" },
    { value: "pinyin", label: "Pinyin prompts" },
    { value: "meaning", label: "English prompts" },
  ];
}

function promptTitle(card: Card) {
  if (card.promptType === "listen") return "Listen";
  if (card.promptType === "hanzi") return "Hanzi";
  if (card.promptType === "pinyin") return "Pinyin";
  if (card.promptType === "meaning") return "Meaning";
  return "Read";
}

function revealParts(card: Card, answered: boolean) {
  const parts = [
    { value: card.entry.term, type: "hanzi", strong: true },
    card.entry.pinyin ? { value: card.entry.pinyin, type: "pinyin", strong: false } : null,
    { value: labelFor(card.entry), type: "meaning", strong: false },
  ].filter(Boolean) as Array<{ value: string; type: Card["answerType"]; strong: boolean }>;

  if (answered) return parts;
  return parts.filter((part) => part.type !== card.answerType);
}

function speak(text: string, ttsLang: string) {
  remoteAudio.pause();
  remoteAudio.currentTime = 0;
  remoteAudio.src = `/api/tts?tl=${encodeURIComponent(ttsLang)}&q=${encodeURIComponent(text)}`;
  void remoteAudio.play().catch(() => {
    // Browsers may block playback until the speaker button is tapped.
  });
}

function syncStatusLabel(status: SyncStatus) {
  if (status === "syncing") return "Syncing";
  if (status === "synced") return "Synced";
  if (status === "unauthorized") return "Bad code";
  if (status === "error") return "Offline";
  return "Local";
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
