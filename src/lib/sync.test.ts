import { describe, expect, it } from "vitest";
import { mergeSnapshots, normalizeSnapshot, sameSnapshot, type SyncSnapshot } from "./sync";

function snapshot(
  nlProgress: SyncSnapshot["languages"]["nl"]["progress"],
  zhProgress: SyncSnapshot["languages"]["zh"]["progress"] = {},
): SyncSnapshot {
  return {
    languages: {
      nl: { progress: nlProgress, totals: { answered: 0, correct: 0, streak: 0 } },
      zh: { progress: zhProgress, totals: { answered: 0, correct: 0, streak: 0 } },
    },
  };
}

describe("sync merge", () => {
  it("keeps known progress over a higher due date", () => {
    const merged = mergeSnapshots(
      snapshot({
        "nl-1": { box: 3, dueAt: 1_000, seen: 4, correct: 3, wrong: 1, known: true },
      }),
      snapshot({
        "nl-1": { box: 4, dueAt: 9_000, seen: 2, correct: 2, wrong: 0, known: false },
      }),
    );

    expect(merged.languages.nl.progress["nl-1"]).toEqual({
      box: 4,
      dueAt: 1_000,
      seen: 4,
      correct: 3,
      wrong: 1,
      known: true,
    });
  });

  it("keeps Dutch and Mandarin progress separate", () => {
    const merged = mergeSnapshots(
      snapshot({ "nl-1": { box: 1, dueAt: 1, seen: 1, correct: 1, wrong: 0, known: false } }),
      snapshot({}, { "zh-1:hanzi->pinyin": { box: 2, dueAt: 2, seen: 2, correct: 2, wrong: 0, known: false } }),
    );

    expect(Object.keys(merged.languages.nl.progress)).toEqual(["nl-1"]);
    expect(Object.keys(merged.languages.zh.progress)).toEqual(["zh-1:hanzi->pinyin"]);
  });

  it("uses max counters so repeated snapshot syncs do not double count", () => {
    const merged = mergeSnapshots(
      {
        languages: {
          nl: { progress: {}, totals: { answered: 12, correct: 9, streak: 2 } },
          zh: { progress: {}, totals: { answered: 1, correct: 1, streak: 1 } },
        },
      },
      {
        languages: {
          nl: { progress: {}, totals: { answered: 8, correct: 8, streak: 5 } },
          zh: { progress: {}, totals: { answered: 3, correct: 2, streak: 0 } },
        },
      },
    );

    expect(merged.languages.nl.totals).toEqual({ answered: 12, correct: 9, streak: 5 });
    expect(merged.languages.zh.totals).toEqual({ answered: 3, correct: 2, streak: 1 });
  });

  it("migrates legacy flat snapshots to Dutch", () => {
    const normalized = normalizeSnapshot({
      progress: {
        "nl-1": { box: 1, dueAt: 1, seen: 1, correct: 1, wrong: 0, known: false },
      },
      totals: { answered: 1, correct: 1, streak: 1 },
    });

    expect(Object.keys(normalized.languages.nl.progress)).toEqual(["nl-1"]);
    expect(normalized.languages.zh.progress).toEqual({});
  });

  it("compares normalized snapshots", () => {
    expect(
      sameSnapshot(
        snapshot({
          "nl-1": { box: 1.7, dueAt: -1, seen: 1, correct: 1, wrong: 0, known: false },
        }),
        snapshot({
          "nl-1": { box: 1, dueAt: 0, seen: 1, correct: 1, wrong: 0, known: false },
        }),
      ),
    ).toBe(true);
  });
});
