import { describe, expect, it } from "vitest";
import { mergeSnapshots, sameSnapshot, type SyncSnapshot } from "./sync";

function snapshot(progress: SyncSnapshot["progress"], totals: SyncSnapshot["totals"] = { answered: 0, correct: 0, streak: 0 }): SyncSnapshot {
  return { progress, totals };
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

    expect(merged.progress["nl-1"]).toEqual({
      box: 4,
      dueAt: 1_000,
      seen: 4,
      correct: 3,
      wrong: 1,
      known: true,
    });
  });

  it("uses the higher box as the strongest schedule", () => {
    const merged = mergeSnapshots(
      snapshot({
        "nl-1": { box: 2, dueAt: 99_000, seen: 1, correct: 1, wrong: 0, known: false },
      }),
      snapshot({
        "nl-1": { box: 5, dueAt: 10_000, seen: 3, correct: 3, wrong: 0, known: false },
      }),
    );

    expect(merged.progress["nl-1"].box).toBe(5);
    expect(merged.progress["nl-1"].dueAt).toBe(10_000);
  });

  it("keeps the later due date when schedule strength ties", () => {
    const merged = mergeSnapshots(
      snapshot({
        "nl-1": { box: 2, dueAt: 12_000, seen: 1, correct: 1, wrong: 0, known: false },
      }),
      snapshot({
        "nl-1": { box: 2, dueAt: 20_000, seen: 2, correct: 1, wrong: 1, known: false },
      }),
    );

    expect(merged.progress["nl-1"].dueAt).toBe(20_000);
  });

  it("uses max counters so repeated snapshot syncs do not double count", () => {
    const merged = mergeSnapshots(
      snapshot({}, { answered: 12, correct: 9, streak: 2 }),
      snapshot({}, { answered: 8, correct: 8, streak: 5 }),
    );

    expect(merged.totals).toEqual({ answered: 12, correct: 9, streak: 5 });
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
