import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  applyKnown,
  buildStats,
  intervals,
  makeCard,
  makeOptions,
  pickPromptType,
  pickNextEntry,
  type DeckEntry,
  type LanguageState,
} from "./scheduler";

const deck: DeckEntry[] = [
  entry("nl-1", "nl", 1, "ik", ["I"]),
  entry("nl-2", "nl", 2, "je", ["you", "your"]),
  entry("nl-3", "nl", 3, "huis", ["house"]),
  entry("nl-4", "nl", 4, "eten", ["eat", "food"]),
  entry("nl-5", "nl", 5, "goed", ["good", "well"]),
];

const mandarinDeck: DeckEntry[] = [
  entry("zh-1", "zh", 1, "我", ["I", "me"], "wǒ", "character"),
  entry("zh-2", "zh", 2, "我们", ["we", "us"], "wǒ men", "word"),
  entry("zh-3", "zh", 3, "你", ["you"], "nǐ", "character"),
  entry("zh-4", "zh", 4, "知道", ["know"], "zhī dào", "word"),
  entry("zh-5", "zh", 5, "好", ["good"], "hǎo", "character"),
];

function entry(
  id: string,
  language: "nl" | "zh",
  rank: number,
  term: string,
  translations: string[],
  pinyin?: string,
  kind?: "word" | "character",
): DeckEntry {
  return {
    id,
    rank,
    term,
    translations,
    pinyin,
    kind,
    frequency: 1000 - rank,
    language,
    ttsLang: language === "zh" ? "zh-CN" : "nl-NL",
  };
}

function state(): LanguageState {
  return {
    settings: { activeSize: deck.length, promptMode: "mixed", audioEnabled: true },
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

  it("marks known learning items far ahead", () => {
    const next = applyKnown(state(), "zh-1:hanzi->pinyin", 5_000);
    expect(next.progress["zh-1:hanzi->pinyin"].known).toBe(true);
    expect(next.progress["zh-1:hanzi->pinyin"].box).toBe(intervals.length - 1);
    expect(next.progress["zh-1:hanzi->pinyin"].dueAt).toBe(5_000 + intervals.at(-1)!);
  });

  it("prefers due cards before unseen cards", () => {
    const base = state();
    base.progress["nl-1"] = { box: 1, dueAt: 10, seen: 1, correct: 1, wrong: 0, known: false };
    expect(pickNextEntry(base, deck, 20).id).toBe("nl-1");
  });

  it("introduces new Mandarin entries before due reviews", () => {
    const base = state();
    base.progress["zh-1:hanzi->meaning"] = { box: 1, dueAt: 10, seen: 1, correct: 1, wrong: 0, known: false };
    expect(pickNextEntry(base, mandarinDeck, 20).id).toBe("zh-2");
  });

  it("periodically interleaves due Mandarin reviews", () => {
    const base = state();
    base.totals.answered = 4;
    base.progress["zh-1:hanzi->meaning"] = { box: 1, dueAt: 0, seen: 1, correct: 1, wrong: 0, known: false };
    expect(pickNextEntry(base, mandarinDeck, 20).id).toBe("zh-1");
  });

  it("creates one correct option with unique labels", () => {
    const options = makeOptions(deck[0], deck);
    expect(options).toContain("I");
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
  });

  it("keeps explicit listen prompts hidden", () => {
    expect(pickPromptType("listen")).toBe("listen");
  });

  it("falls back to read prompts when Dutch audio is disabled", () => {
    const base = state();
    base.settings.promptMode = "listen";
    base.settings.audioEnabled = false;
    expect(makeCard(base, deck).promptType).toBe("read");
  });

  it("keeps explicit Dutch prompt modes on the selected prompt type", () => {
    const listenState = state();
    listenState.settings.promptMode = "listen";
    expect(makeCard(listenState, deck).promptType).toBe("listen");

    const readState = state();
    readState.settings.promptMode = "read";
    expect(makeCard(readState, deck).promptType).toBe("read");
  });

  it("counts known and high-box entries as learned", () => {
    const base = state();
    base.progress["nl-1"] = { box: 5, dueAt: 0, seen: 5, correct: 5, wrong: 0, known: false };
    base.progress["nl-2"] = { box: 9, dueAt: 0, seen: 1, correct: 1, wrong: 0, known: true };
    expect(buildStats(base, deck)).toEqual({ touched: 2, learned: 2 });
  });

  it("creates Mandarin first-contact quiz cards with full context", () => {
    const base = state();
    base.settings.promptMode = "hanzi";
    const card = makeCard(base, mandarinDeck);
    expect(card.isNew).toBe(true);
    expect(card.promptType).toBe("hanzi");
    expect(card.answerType).toBe("meaning");
    expect(card.options).toContain("I / me");
    expect(card.progressId).toBe("zh-1:hanzi->meaning");
  });

  it("creates early Mandarin recognition cards after an intro", () => {
    const base = state();
    base.settings.promptMode = "hanzi";
    base.progress["zh-1:hanzi->meaning"] = { box: 1, dueAt: 0, seen: 1, correct: 1, wrong: 0, known: false };
    const card = makeCard(base, [mandarinDeck[0]]);
    expect(card.promptType).toBe("hanzi");
    expect(card.answerType).toBe("meaning");
    expect(card.progressId).toMatch(/^zh-\d+:hanzi->/);
  });

  it("unlocks Mandarin pinyin prompts after stronger exposure", () => {
    const base = state();
    base.settings.promptMode = "pinyin";
    base.progress["zh-1:hanzi->meaning"] = { box: 4, dueAt: 0, seen: 4, correct: 4, wrong: 0, known: false };
    const card = makeCard(base, [mandarinDeck[0]]);
    expect(card.promptType).toBe("pinyin");
    expect(["meaning", "hanzi"]).toContain(card.answerType);
  });

  it("keeps explicit Mandarin pinyin mode on pinyin prompts for new entries", () => {
    const base = state();
    base.settings.promptMode = "pinyin";
    const card = makeCard(base, mandarinDeck);
    expect(card.promptType).toBe("pinyin");
    expect(card.answerType).toBe("meaning");
  });

  it("keeps every explicit Mandarin prompt mode on the selected prompt type", () => {
    const expectedPromptTypes: Array<[LanguageState["settings"]["promptMode"], string]> = [
      ["audio", "listen"],
      ["hanzi", "hanzi"],
      ["pinyin", "pinyin"],
      ["meaning", "meaning"],
    ];

    for (const [mode, expectedPromptType] of expectedPromptTypes) {
      const base = state();
      base.settings.promptMode = mode;
      const card = makeCard(base, mandarinDeck);
      expect(card.promptType).toBe(expectedPromptType);
      expect(card.options).toHaveLength(4);
    }
  });

  it("does not create Mandarin listen prompts when audio is disabled", () => {
    const base = state();
    base.settings.promptMode = "audio";
    base.settings.audioEnabled = false;
    const card = makeCard(base, mandarinDeck);
    expect(card.promptType).not.toBe("listen");
    expect(card.answerType).toBe("meaning");
  });

  it("creates Mandarin pinyin answer options with tone marks", () => {
    const options = makeOptions(mandarinDeck[0], mandarinDeck, "wǒ", "pinyin");
    expect(options).toContain("wǒ");
    expect(options).toHaveLength(4);
    expect(new Set(options).size).toBe(4);
  });
});
