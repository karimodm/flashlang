import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, RefreshCw, RotateCcw, Settings, Upload, Volume2 } from "lucide-react";
import deckData from "./data/dutch-deck.json";
import {
  applyAnswer,
  applyKnown,
  buildStats,
  makeCard,
  type AppState,
  type Card,
  type DeckEntry,
  type PromptMode,
} from "./lib/scheduler";
import { mergeStateWithSnapshot, sameSnapshot, snapshotFromState, type RemoteSyncSnapshot } from "./lib/sync";
import "./styles.css";

const deck = (deckData.entries as DeckEntry[]).filter((entry) => entry.translations.length > 0);
const storageKey = "flashlang:v2";
const syncCodeKey = "flashlang:syncCode";
const syncRevisionKey = "flashlang:syncRevision";
const remoteAudio = new Audio();

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "unauthorized";

function createState(): AppState {
  return {
    version: 1,
    settings: {
      activeSize: Math.min(500, deck.length),
      promptMode: "mixed",
      voiceURI: "",
    },
    progress: {},
    totals: {
      answered: 0,
      correct: 0,
      streak: 0,
    },
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return createState();
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return createState();
    return {
      ...createState(),
      ...parsed,
      settings: { ...createState().settings, ...parsed.settings },
      totals: { ...createState().totals, ...parsed.totals },
      progress: parsed.progress || {},
    };
  } catch {
    return createState();
  }
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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const stateRef = useRef(state);
  const syncCodeRef = useRef(syncCode);
  const syncRevisionRef = useRef(syncRevision);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);

  const activeDeck = useMemo(
    () => deck.slice(0, Math.min(state.settings.activeSize, deck.length)),
    [state.settings.activeSize],
  );

  const voice = useMemo(() => pickVoice(voices, state.settings.voiceURI), [voices, state.settings.voiceURI]);
  const audioReady = Boolean(voice || voices.some((item) => item.lang.toLowerCase().startsWith("nl")));
  const stats = useMemo(() => buildStats(state, activeDeck), [state, activeDeck]);

  useEffect(() => {
    stateRef.current = state;
    localStorage.setItem(storageKey, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    syncCodeRef.current = syncCode;
    localStorage.setItem(syncCodeKey, syncCode);
    setSyncStatus(syncCode.trim() ? "idle" : "idle");
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
    const loadVoices = () => setVoices(window.speechSynthesis?.getVoices?.() || []);
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  useEffect(() => {
    setCard(makeCard(state, activeDeck, audioReady));
  }, [activeDeck, audioReady, state.settings.promptMode]);

  useEffect(() => {
    if (card?.promptType === "listen") speak(card.entry.term, voice);
  }, [card?.entry.id, card?.promptType, voice]);

  function advance(nextState: AppState, wasWrong = false) {
    setState(nextState);
    window.setTimeout(() => {
      setFeedback(null);
      setSelected(null);
      setCard(makeCard(nextState, activeDeck, audioReady));
    }, wasWrong ? 420 : 260);
  }

  function answer(label: string) {
    if (!card || feedback) return;
    const isCorrect = label === card.correctLabel;
    setSelected(label);
    setFeedback(isCorrect ? "correct" : "wrong");
    advance(applyAnswer(state, card.entry.id, isCorrect), !isCorrect);
  }

  function markKnown() {
    if (!card || feedback) return;
    setFeedback("correct");
    advance(applyKnown(state, card.entry.id));
  }

  function replay() {
    if (card) speak(card.entry.term, voice);
  }

  function updateSettings(patch: Partial<AppState["settings"]>) {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
  }

  function resetProgress() {
    if (!confirm("Reset all learning progress on this device?")) return;
    const next = createState();
    next.settings = state.settings;
    setState(next);
    setCard(makeCard(next, activeDeck, audioReady));
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
    const parsed = JSON.parse(text) as AppState;
    if (parsed.version !== 1 || !parsed.progress || !parsed.settings) {
      alert("That file does not look like FlashLang progress.");
      return;
    }
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
      const nextState = mergeStateWithSnapshot(current, remote);
      if (!sameSnapshot(snapshotFromState(current), snapshotFromState(nextState))) {
        setState(nextState);
        setCard(makeCard(nextState, activeDeck, audioReady));
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
        <div className="metric">
          <span>{state.totals.streak}</span>
          <small>streak</small>
        </div>
        <div className="topActions">
          <button className="iconButton" onClick={replay} title="Replay audio" aria-label="Replay audio">
            <Volume2 size={21} />
          </button>
          <button className="iconButton" onClick={() => setSettingsOpen((value) => !value)} title="Settings" aria-label="Settings">
            <Settings size={21} />
          </button>
        </div>
      </header>

      <section className="promptArea">
        <div className="modeLabel">{card.promptType === "listen" ? "Listen" : "Read"}</div>
        <button className="promptButton" onClick={replay} disabled={card.promptType !== "listen"}>
          {card.promptType === "listen" ? <Volume2 size={56} strokeWidth={1.8} /> : card.entry.term}
        </button>
        {feedback && (
          <div className="answerReveal">
            <strong>{card.entry.term}</strong>
            <span>{card.correctLabel}</span>
          </div>
        )}
      </section>

      <section className="optionsGrid" aria-label="Translations">
        {card.options.map((option) => {
          const stateClass =
            feedback && option === card.correctLabel
              ? "optionCorrect"
              : feedback && option === selected
                ? "optionWrong"
                : "";
          return (
            <button key={option} className={`optionButton ${stateClass}`} onClick={() => answer(option)}>
              {option}
            </button>
          );
        })}
      </section>

      <footer className="bottomBar">
        <button className="knownButton" onClick={markKnown}>Known</button>
        <div className="progressLine">
          <span style={{ width: `${Math.round((stats.touched / activeDeck.length) * 100)}%` }} />
        </div>
        <span className="rankLabel">#{card.entry.rank}</span>
      </footer>

      {settingsOpen && (
        <aside className="settingsPanel" aria-label="Settings">
          <label>
            Prompt
            <select value={state.settings.promptMode} onChange={(event) => updateSettings({ promptMode: event.target.value as PromptMode })}>
              <option value="mixed">Mixed</option>
              <option value="listen">Listen only</option>
              <option value="read">Read only</option>
            </select>
          </label>
          <label>
            Active words
            <input
              type="range"
              min="100"
              max={deck.length}
              step="100"
              value={state.settings.activeSize}
              onChange={(event) => updateSettings({ activeSize: Number(event.target.value) })}
            />
            <span>{state.settings.activeSize}</span>
          </label>
          <label>
            Voice
            <select value={state.settings.voiceURI} onChange={(event) => updateSettings({ voiceURI: event.target.value })}>
              <option value="">Best Dutch voice</option>
              {voices
                .filter((item) => item.lang.toLowerCase().startsWith("nl"))
                .map((item) => (
                  <option key={item.voiceURI} value={item.voiceURI}>
                    {item.name} ({item.lang})
                  </option>
                ))}
            </select>
          </label>
          <label>
            Sync code
            <input
              type="password"
              autoComplete="current-password"
              value={syncCode}
              placeholder="Private Cloudflare sync code"
              onChange={(event) => setSyncCode(event.target.value)}
            />
          </label>
          <div className="syncRow">
            <button onClick={() => void syncNow()} disabled={!syncCode.trim() || syncStatus === "syncing"}>
              <RefreshCw size={18} /> Sync
            </button>
            <span className={`syncStatus sync-${syncStatus}`}>{syncStatusLabel(syncStatus)}</span>
          </div>
          {!audioReady && <p className="warningText">No Dutch browser voice detected. Listen mode will use web audio pronunciation.</p>}
          <div className="settingsActions">
            <button onClick={exportProgress}><Download size={18} /> Export</button>
            <button onClick={() => fileInputRef.current?.click()}><Upload size={18} /> Import</button>
            <button onClick={resetProgress}><RotateCcw size={18} /> Reset</button>
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
    </main>
  );
}

function pickVoice(voices: SpeechSynthesisVoice[], voiceURI: string) {
  return (
    voices.find((voice) => voice.voiceURI === voiceURI) ||
    voices.find((voice) => voice.lang.toLowerCase() === "nl-nl") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("nl")) ||
    null
  );
}

function speak(text: string, voice: SpeechSynthesisVoice | null) {
  const hasDutchVoice = Boolean(
    voice || window.speechSynthesis?.getVoices?.().some((item) => item.lang.toLowerCase().startsWith("nl")),
  );

  if (!("speechSynthesis" in window) || !hasDutchVoice) {
    playRemoteDutchAudio(text);
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || "nl-NL";
  utterance.rate = 0.92;
  utterance.pitch = 1;
  if (voice) utterance.voice = voice;
  utterance.onerror = () => playRemoteDutchAudio(text);
  window.speechSynthesis.speak(utterance);
}

function playRemoteDutchAudio(text: string) {
  remoteAudio.pause();
  remoteAudio.currentTime = 0;
  remoteAudio.src = `/api/tts?tl=nl&q=${encodeURIComponent(text)}`;
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
