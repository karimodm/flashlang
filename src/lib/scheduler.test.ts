import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  applyKnown,
  buildStats,
  intervals,
  makeOptions,
  pickPromptType,
  pickNextEntry,
  type AppState,
  type DeckEntry,
} from "./scheduler";

const deck: DeckEntry[] = [
  entry("nl-1", 1, "ik", ["I"]),
  entry("nl-2", 2, "je", ["you", "your"]),
  entry("nl-3", 3, "huis", ["house"]),
  entry("nl-4", 4, "eten", ["eat", "food"]),
  entry("nl-5", 5, "goed", ["good", "well"]),
];

function entry(id: string, rank: number, term: string, translations: string[]): DeckEntry {
  return {
    id,
    rank,
    term,
    translations,
    frequency: 1000 - rank,
    language: "nl",
    ttsLang: "nl-NL",
  };
}

function state(): AppState {
  return {
    version: 1,
    settings: { activeSize: deck.length, promptMode: "mixed", voiceURI: "" },
    progress: {},
    totals: { answered: 0, correct: 0, streak: 0 },
  };
}

describe("scheduler", () => {
  it("advances correct answers to a longer interval", () => {
    const now = 1_000;
    const next = applyAnswer(state(), "nl-1", true, now);
    expect(next.progress["nl-1"].box).toBe(1);
    expect(next.progress["nl-1"].dueAt).toBe(now + intervals[1]);
    expect(next.totals.streak).toBe(1);
  });

  it("keeps wrong answers due soon and resets streak", () => {
    const base = state();
    base.progress["nl-1"] = { box: 4, dueAt: 0, seen: 2, correct: 2, wrong: 0, known: false };
    base.totals.streak = 8;
    const next = applyAnswer(base, "nl-1", false, 2_000);
    expect(next.progress["nl-1"].box).toBe(2);
    expect(next.progress["nl-1"].dueAt).toBe(9_000);
    expect(next.totals.streak).toBe(0);
  });

  it("marks known words far ahead", () => {
    const next = applyKnown(state(), "nl-2", 5_000);
    expect(next.progress["nl-2"].known).toBe(true);
    expect(next.progress["nl-2"].box).toBe(intervals.length - 1);
    expect(next.progress["nl-2"].dueAt).toBe(5_000 + intervals.at(-1)!);
  });

  it("prefers due cards before unseen cards", () => {
    const base = state();
    base.progress["nl-1"] = { box: 1, dueAt: 10, seen: 1, correct: 1, wrong: 0, known: false };
    expect(pickNextEntry(base, deck, 20).id).toBe("nl-1");
  });

  it("creates one correct option with unique labels", () => {
    const options = makeOptions(deck[0], deck);
    expect(options).toContain("I");
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
  });

  it("keeps listen prompts hidden even when no Dutch voice is detected", () => {
    expect(pickPromptType("listen", false)).toBe("listen");
    expect(pickPromptType("mixed", false)).toBe("listen");
  });

  it("counts known and high-box words as learned", () => {
    const base = state();
    base.progress["nl-1"] = { box: 5, dueAt: 0, seen: 5, correct: 5, wrong: 0, known: false };
    base.progress["nl-2"] = { box: 9, dueAt: 0, seen: 1, correct: 1, wrong: 0, known: true };
    expect(buildStats(base, deck)).toEqual({ touched: 2, learned: 2 });
  });
});
