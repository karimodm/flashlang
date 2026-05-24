import type { AppState, Progress } from "./scheduler";

export type SyncSnapshot = {
  progress: Record<string, Progress>;
  totals: AppState["totals"];
};

export type RemoteSyncSnapshot = SyncSnapshot & {
  revision: number;
  updatedAt?: number;
};

const emptyTotals: AppState["totals"] = {
  answered: 0,
  correct: 0,
  streak: 0,
};

export function emptySnapshot(): SyncSnapshot {
  return {
    progress: {},
    totals: { ...emptyTotals },
  };
}

export function snapshotFromState(state: AppState): SyncSnapshot {
  return normalizeSnapshot({
    progress: state.progress,
    totals: state.totals,
  });
}

export function mergeStateWithSnapshot(state: AppState, remote: SyncSnapshot): AppState {
  const merged = mergeSnapshots(snapshotFromState(state), remote);
  return {
    ...state,
    progress: merged.progress,
    totals: merged.totals,
  };
}

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot): SyncSnapshot {
  const left = normalizeSnapshot(local);
  const right = normalizeSnapshot(remote);
  const progress: Record<string, Progress> = {};

  for (const id of new Set([...Object.keys(left.progress), ...Object.keys(right.progress)])) {
    const merged = mergeProgress(left.progress[id], right.progress[id]);
    if (merged) progress[id] = merged;
  }

  return {
    progress,
    totals: {
      answered: Math.max(left.totals.answered, right.totals.answered),
      correct: Math.max(left.totals.correct, right.totals.correct),
      streak: Math.max(left.totals.streak, right.totals.streak),
    },
  };
}

export function sameSnapshot(left: SyncSnapshot, right: SyncSnapshot) {
  const normalizedLeft = normalizeSnapshot(left);
  const normalizedRight = normalizeSnapshot(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function normalizeSnapshot(value: Partial<SyncSnapshot> | null | undefined): SyncSnapshot {
  const progress: Record<string, Progress> = {};
  const sourceProgress = value?.progress && typeof value.progress === "object" ? value.progress : {};

  for (const [id, item] of Object.entries(sourceProgress)) {
    if (!id || !item || typeof item !== "object") continue;
    progress[id] = normalizeProgress(item);
  }

  return {
    progress,
    totals: normalizeTotals(value?.totals),
  };
}

function mergeProgress(local: Progress | undefined, remote: Progress | undefined): Progress | null {
  if (!local && !remote) return null;
  if (!local) return normalizeProgress(remote!);
  if (!remote) return normalizeProgress(local);

  const left = normalizeProgress(local);
  const right = normalizeProgress(remote);
  const strongest = strongerProgress(left, right);

  return {
    box: Math.max(left.box, right.box),
    dueAt: strongest.dueAt,
    seen: Math.max(left.seen, right.seen),
    correct: Math.max(left.correct, right.correct),
    wrong: Math.max(left.wrong, right.wrong),
    known: left.known || right.known,
  };
}

function strongerProgress(left: Progress, right: Progress) {
  if (left.known !== right.known) return left.known ? left : right;
  if (left.box !== right.box) return left.box > right.box ? left : right;
  return left.dueAt >= right.dueAt ? left : right;
}

function normalizeProgress(value: Progress): Progress {
  return {
    box: cleanNumber(value.box),
    dueAt: cleanNumber(value.dueAt),
    seen: cleanNumber(value.seen),
    correct: cleanNumber(value.correct),
    wrong: cleanNumber(value.wrong),
    known: Boolean(value.known),
  };
}

function normalizeTotals(value: Partial<AppState["totals"]> | null | undefined): AppState["totals"] {
  return {
    answered: cleanNumber(value?.answered),
    correct: cleanNumber(value?.correct),
    streak: cleanNumber(value?.streak),
  };
}

function cleanNumber(value: unknown) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}
