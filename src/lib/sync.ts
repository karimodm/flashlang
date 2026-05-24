import type { AppState, LanguageCode, LanguageState, Progress } from "./scheduler";

export type SyncSnapshot = {
  languages: Record<LanguageCode, Pick<LanguageState, "progress" | "totals">>;
};

export type RemoteSyncSnapshot = SyncSnapshot & {
  revision: number;
  updatedAt?: number;
};

const languages: LanguageCode[] = ["nl", "zh"];

const emptyTotals: LanguageState["totals"] = {
  answered: 0,
  correct: 0,
  streak: 0,
};

export function emptySnapshot(): SyncSnapshot {
  return {
    languages: {
      nl: emptyLanguageSnapshot(),
      zh: emptyLanguageSnapshot(),
    },
  };
}

export function snapshotFromState(state: AppState): SyncSnapshot {
  return normalizeSnapshot(state);
}

export function mergeStateWithSnapshot(state: AppState, remote: SyncSnapshot): AppState {
  const merged = mergeSnapshots(snapshotFromState(state), remote);
  return {
    ...state,
    languages: {
      nl: {
        ...state.languages.nl,
        progress: merged.languages.nl.progress,
        totals: merged.languages.nl.totals,
      },
      zh: {
        ...state.languages.zh,
        progress: merged.languages.zh.progress,
        totals: merged.languages.zh.totals,
      },
    },
  };
}

export function mergeSnapshots(local: SyncSnapshot, remote: SyncSnapshot): SyncSnapshot {
  const left = normalizeSnapshot(local);
  const right = normalizeSnapshot(remote);
  return {
    languages: {
      nl: mergeLanguageSnapshots(left.languages.nl, right.languages.nl),
      zh: mergeLanguageSnapshots(left.languages.zh, right.languages.zh),
    },
  };
}

export function sameSnapshot(left: SyncSnapshot, right: SyncSnapshot) {
  const normalizedLeft = normalizeSnapshot(left);
  const normalizedRight = normalizeSnapshot(right);
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

export function normalizeSnapshot(value: unknown): SyncSnapshot {
  if (hasLegacySnapshot(value)) {
    return {
      languages: {
        nl: normalizeLanguageSnapshot(value as Partial<Pick<LanguageState, "progress" | "totals">>),
        zh: emptyLanguageSnapshot(),
      },
    };
  }

  const snapshot = value as Partial<SyncSnapshot> | null | undefined;
  const source = snapshot?.languages && typeof snapshot.languages === "object"
    ? snapshot.languages
    : { nl: undefined, zh: undefined };
  return {
    languages: {
      nl: normalizeLanguageSnapshot(source.nl),
      zh: normalizeLanguageSnapshot(source.zh),
    },
  };
}

function mergeLanguageSnapshots(
  local: Pick<LanguageState, "progress" | "totals">,
  remote: Pick<LanguageState, "progress" | "totals">,
) {
  const progress: Record<string, Progress> = {};

  for (const id of new Set([...Object.keys(local.progress), ...Object.keys(remote.progress)])) {
    const merged = mergeProgress(local.progress[id], remote.progress[id]);
    if (merged) progress[id] = merged;
  }

  return {
    progress,
    totals: {
      answered: Math.max(local.totals.answered, remote.totals.answered),
      correct: Math.max(local.totals.correct, remote.totals.correct),
      streak: Math.max(local.totals.streak, remote.totals.streak),
    },
  };
}

function normalizeLanguageSnapshot(value: Partial<Pick<LanguageState, "progress" | "totals">> | null | undefined) {
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

function emptyLanguageSnapshot() {
  return {
    progress: {},
    totals: { ...emptyTotals },
  };
}

function hasLegacySnapshot(value: unknown): value is { progress?: unknown; totals?: unknown } {
  return Boolean(value && typeof value === "object" && ("progress" in value || "totals" in value));
}

function normalizeTotals(value: Partial<LanguageState["totals"]> | null | undefined): LanguageState["totals"] {
  return {
    answered: cleanNumber(value?.answered),
    correct: cleanNumber(value?.correct),
    streak: cleanNumber(value?.streak),
  };
}

function cleanNumber(value: unknown) {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}
