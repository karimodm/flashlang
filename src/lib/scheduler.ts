export type DeckEntry = {
  id: string;
  language: string;
  ttsLang: string;
  rank: number;
  term: string;
  frequency: number;
  translations: string[];
};

export type Progress = {
  box: number;
  dueAt: number;
  seen: number;
  correct: number;
  wrong: number;
  known: boolean;
};

export type PromptMode = "mixed" | "listen" | "read";

export type AppState = {
  version: 1;
  settings: {
    activeSize: number;
    promptMode: PromptMode;
    voiceURI: string;
  };
  progress: Record<string, Progress>;
  totals: {
    answered: number;
    correct: number;
    streak: number;
  };
};

export type Card = {
  entry: DeckEntry;
  promptType: "listen" | "read";
  options: string[];
  correctLabel: string;
};

export const intervals = [
  10_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  6 * 3600_000,
  24 * 3600_000,
  3 * 24 * 3600_000,
  7 * 24 * 3600_000,
  21 * 24 * 3600_000,
  60 * 24 * 3600_000,
];

export function makeCard(state: AppState, activeDeck: DeckEntry[], audioReady: boolean): Card {
  const entry = pickNextEntry(state, activeDeck);
  const correctLabel = labelFor(entry);
  const promptType = pickPromptType(state.settings.promptMode, audioReady);
  return {
    entry,
    promptType,
    correctLabel,
    options: makeOptions(entry, activeDeck, correctLabel),
  };
}

export function pickNextEntry(state: AppState, activeDeck: DeckEntry[], now = Date.now()) {
  const unseen = activeDeck.find((entry) => !state.progress[entry.id]);
  const due = activeDeck
    .filter((entry) => {
      const progress = state.progress[entry.id];
      return progress && !progress.known && progress.dueAt <= now;
    })
    .sort((a, b) => (state.progress[a.id]?.dueAt || 0) - (state.progress[b.id]?.dueAt || 0));
  if (due.length) return due[Math.floor(Math.random() * Math.min(8, due.length))];
  if (unseen) return unseen;
  return [...activeDeck].sort((a, b) => (state.progress[a.id]?.dueAt || 0) - (state.progress[b.id]?.dueAt || 0))[0] || activeDeck[0];
}

export function pickPromptType(mode: PromptMode, audioReady: boolean): "listen" | "read" {
  if (mode === "read") return "read";
  if (mode === "listen") return "listen";
  if (!audioReady) return "listen";
  return Math.random() < 0.5 ? "listen" : "read";
}

export function makeOptions(entry: DeckEntry, activeDeck: DeckEntry[], correctLabel = labelFor(entry)) {
  const labels = new Set([normalizeLabel(correctLabel)]);
  const options = [correctLabel];
  const pool = activeDeck
    .filter((candidate) => candidate.id !== entry.id)
    .sort((a, b) => Math.abs(a.rank - entry.rank) - Math.abs(b.rank - entry.rank));
  const nearPool = shuffle(pool.slice(0, 160));
  for (const candidate of nearPool) {
    const label = labelFor(candidate);
    const normalized = normalizeLabel(label);
    if (!labels.has(normalized)) {
      labels.add(normalized);
      options.push(label);
    }
    if (options.length === 4) break;
  }
  return shuffle(options);
}

export function applyAnswer(state: AppState, id: string, correct: boolean, now = Date.now()): AppState {
  const current = state.progress[id] || { box: 0, dueAt: 0, seen: 0, correct: 0, wrong: 0, known: false };
  const nextBox = correct ? Math.min(current.box + 1, intervals.length - 1) : Math.max(0, current.box - 2);
  const delay = correct ? intervals[nextBox] : 7_000;
  return {
    ...state,
    progress: {
      ...state.progress,
      [id]: {
        box: nextBox,
        dueAt: now + delay,
        seen: current.seen + 1,
        correct: current.correct + (correct ? 1 : 0),
        wrong: current.wrong + (correct ? 0 : 1),
        known: false,
      },
    },
    totals: {
      answered: state.totals.answered + 1,
      correct: state.totals.correct + (correct ? 1 : 0),
      streak: correct ? state.totals.streak + 1 : 0,
    },
  };
}

export function applyKnown(state: AppState, id: string, now = Date.now()): AppState {
  const current = state.progress[id] || { box: 0, dueAt: 0, seen: 0, correct: 0, wrong: 0, known: false };
  return {
    ...state,
    progress: {
      ...state.progress,
      [id]: {
        ...current,
        box: intervals.length - 1,
        dueAt: now + intervals[intervals.length - 1],
        seen: current.seen + 1,
        correct: current.correct + 1,
        known: true,
      },
    },
  };
}

export function buildStats(state: AppState, activeDeck: DeckEntry[]) {
  let touched = 0;
  let learned = 0;
  for (const entry of activeDeck) {
    const progress = state.progress[entry.id];
    if (progress) touched += 1;
    if (progress?.known || (progress?.box || 0) >= 5) learned += 1;
  }
  return { touched, learned };
}

export function labelFor(entry: DeckEntry) {
  return entry.translations.slice(0, 2).join(" / ");
}

export function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[^a-z]+/g, " ").trim();
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
