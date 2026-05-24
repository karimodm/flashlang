export type LanguageCode = "nl" | "zh";

export type DeckEntryKind = "word" | "character";

export type DeckEntry = {
  id: string;
  language: LanguageCode;
  ttsLang: string;
  rank: number;
  term: string;
  frequency: number;
  translations: string[];
  pinyin?: string;
  kind?: DeckEntryKind;
  hskLevel?: number;
};

export type Progress = {
  box: number;
  dueAt: number;
  seen: number;
  correct: number;
  wrong: number;
  known: boolean;
};

export type PromptMode = "mixed" | "listen" | "read" | "audio" | "hanzi" | "pinyin" | "meaning";

export type AnswerType = "meaning" | "pinyin" | "hanzi";

export type LanguageSettings = {
  activeSize: number;
  promptMode: PromptMode;
  audioEnabled: boolean;
};

export type LanguageState = {
  settings: LanguageSettings;
  progress: Record<string, Progress>;
  totals: {
    answered: number;
    correct: number;
    streak: number;
  };
};

export type AppState = {
  version: 2;
  activeLanguage: LanguageCode;
  languages: Record<LanguageCode, LanguageState>;
};

export type Card = {
  entry: DeckEntry;
  progressId: string;
  promptType: "listen" | "read" | "hanzi" | "pinyin" | "meaning";
  answerType: AnswerType;
  promptLabel: string;
  options: string[];
  correctLabel: string;
  isNew?: boolean;
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

const mandarinPairs: Array<{ promptType: Card["promptType"]; answerType: AnswerType }> = [
  { promptType: "hanzi", answerType: "meaning" },
  { promptType: "hanzi", answerType: "pinyin" },
  { promptType: "pinyin", answerType: "meaning" },
  { promptType: "pinyin", answerType: "hanzi" },
  { promptType: "meaning", answerType: "hanzi" },
  { promptType: "meaning", answerType: "pinyin" },
  { promptType: "listen", answerType: "meaning" },
  { promptType: "listen", answerType: "pinyin" },
  { promptType: "listen", answerType: "hanzi" },
];

export function makeCard(state: LanguageState, activeDeck: DeckEntry[]): Card {
  const entry = pickNextEntry(state, activeDeck);
  if (entry.language === "zh") return makeMandarinCard(entry, state, activeDeck);
  return makeDutchCard(entry, state.settings.promptMode, activeDeck, state.settings.audioEnabled);
}

export function pickNextEntry(state: LanguageState, activeDeck: DeckEntry[], now = Date.now()) {
  const unseen = activeDeck.find((entry) => !hasAnyProgress(state, entry.id));
  const due = activeDeck
    .filter((entry) => {
      return progressForEntry(state, entry.id).some((progress) => !progress.known && progress.dueAt <= now);
    })
    .sort((a, b) => earliestDueAt(state, a.id) - earliestDueAt(state, b.id));

  if (activeDeck[0]?.language === "zh") {
    if (due.length && (!unseen || (state.totals.answered > 0 && state.totals.answered % 4 === 0))) {
      return due[Math.floor(Math.random() * Math.min(8, due.length))];
    }
    if (unseen) return unseen;
  }

  if (due.length) return due[Math.floor(Math.random() * Math.min(8, due.length))];
  if (unseen) return unseen;
  return [...activeDeck].sort((a, b) => earliestDueAt(state, a.id) - earliestDueAt(state, b.id))[0] || activeDeck[0];
}

export function pickPromptType(mode: PromptMode, audioEnabled = true): "listen" | "read" {
  if (!audioEnabled) return "read";
  if (mode === "read") return "read";
  if (mode === "listen") return "listen";
  return Math.random() < 0.5 ? "listen" : "read";
}

export function makeOptions(entry: DeckEntry, activeDeck: DeckEntry[], correctLabel = labelFor(entry), answerType: AnswerType = "meaning") {
  const labels = new Set([normalizeLabel(correctLabel)]);
  const options = [correctLabel];
  const pool = activeDeck
    .filter((candidate) => candidate.id !== entry.id)
    .sort((a, b) => Math.abs(a.rank - entry.rank) - Math.abs(b.rank - entry.rank));
  const nearPool = shuffle(pool.slice(0, 160));
  for (const candidate of nearPool) {
    const label = labelForAnswer(candidate, answerType);
    const normalized = normalizeLabel(label);
    if (!labels.has(normalized)) {
      labels.add(normalized);
      options.push(label);
    }
    if (options.length === 4) break;
  }
  return shuffle(options);
}

export function applyAnswer(state: LanguageState, id: string, correct: boolean, now = Date.now()): LanguageState {
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

export function applyKnown(state: LanguageState, id: string, now = Date.now()): LanguageState {
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

export function buildStats(state: LanguageState, activeDeck: DeckEntry[]) {
  let touched = 0;
  let learned = 0;
  for (const entry of activeDeck) {
    const progress = progressForEntry(state, entry.id);
    if (progress.length) touched += 1;
    if (progress.some((item) => item.known || item.box >= 5)) learned += 1;
  }
  return { touched, learned };
}

export function labelFor(entry: DeckEntry) {
  return entry.translations.slice(0, 2).join(" / ");
}

export function labelForAnswer(entry: DeckEntry, answerType: AnswerType) {
  if (answerType === "hanzi") return entry.term;
  if (answerType === "pinyin") return entry.pinyin || entry.term;
  return labelFor(entry);
}

export function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

function makeDutchCard(entry: DeckEntry, mode: PromptMode, activeDeck: DeckEntry[], audioEnabled: boolean): Card {
  const promptType = pickPromptType(mode, audioEnabled);
  const correctLabel = labelFor(entry);
  return {
    entry,
    progressId: entry.id,
    promptType,
    answerType: "meaning",
    promptLabel: promptType === "listen" ? "" : entry.term,
    correctLabel,
    options: makeOptions(entry, activeDeck, correctLabel, "meaning"),
  };
}

function makeMandarinCard(entry: DeckEntry, state: LanguageState, activeDeck: DeckEntry[]): Card {
  const isNew = !hasAnyProgress(state, entry.id);
  const pair = pickMandarinPair(state.settings.promptMode, isNew ? 0 : learningStage(state, entry.id), state.settings.audioEnabled);
  const correctLabel = labelForAnswer(entry, pair.answerType);
  return {
    entry,
    progressId: `${entry.id}:${pair.promptType}->${pair.answerType}`,
    promptType: pair.promptType,
    answerType: pair.answerType,
    promptLabel: promptLabelFor(entry, pair.promptType),
    correctLabel,
    options: makeOptions(entry, activeDeck, correctLabel, pair.answerType),
    isNew,
  };
}

function pickMandarinPair(mode: PromptMode, stage: number, audioEnabled = true) {
  const availablePairs = audioEnabled ? mandarinPairs : mandarinPairs.filter((pair) => pair.promptType !== "listen");
  const modePairs = availablePairs.filter((pair) => {
    if (mode === "mixed") return true;
    if (mode === "audio" || mode === "listen") return pair.promptType === "listen";
    return pair.promptType === mode;
  });
  const modePool = modePairs.length ? modePairs : availablePairs;
  const allowed = modePool.filter((pair) => mandarinPairAllowedAtStage(pair, stage));
  const pool = allowed.length ? allowed : modePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function mandarinPairAllowedAtStage(pair: { promptType: Card["promptType"]; answerType: AnswerType }, stage: number) {
  if (stage === 0) return pair.answerType === "meaning";
  if (stage <= 1) {
    return (
      (pair.promptType === "hanzi" && pair.answerType === "meaning") ||
      (pair.promptType === "listen" && pair.answerType === "meaning")
    );
  }
  if (stage <= 3) {
    return (
      pair.answerType === "meaning" ||
      (pair.promptType === "hanzi" && pair.answerType === "pinyin") ||
      (pair.promptType === "listen" && pair.answerType === "pinyin")
    );
  }
  return true;
}

function promptLabelFor(entry: DeckEntry, promptType: Card["promptType"]) {
  if (promptType === "listen") return "";
  if (promptType === "pinyin") return entry.pinyin || entry.term;
  if (promptType === "meaning") return labelFor(entry);
  return entry.term;
}

function hasAnyProgress(state: LanguageState, entryId: string) {
  return Object.keys(state.progress).some((id) => id === entryId || id.startsWith(`${entryId}:`));
}

function progressForEntry(state: LanguageState, entryId: string) {
  return Object.entries(state.progress)
    .filter(([id]) => id === entryId || id.startsWith(`${entryId}:`))
    .map(([, progress]) => progress);
}

function learningStage(state: LanguageState, entryId: string) {
  const progress = progressForEntry(state, entryId);
  if (!progress.length) return 0;
  return Math.max(...progress.map((item) => item.box));
}

function earliestDueAt(state: LanguageState, entryId: string) {
  const dueDates = progressForEntry(state, entryId).map((progress) => progress.dueAt);
  return dueDates.length ? Math.min(...dueDates) : 0;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
