import type { LanguageCode } from "../src/lib/scheduler";
import { emptySnapshot, mergeSnapshots, normalizeSnapshot, sameSnapshot, type RemoteSyncSnapshot, type SyncSnapshot } from "../src/lib/sync";

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
};

const maxTtsLength = 80;
const maxSyncCodeLength = 128;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/sync") return handleSync(request, env);
    if (url.pathname === "/api/tts") return handleTts(request, ctx);
    if (url.pathname.startsWith("/api/")) return json({ error: "not_found" }, 404);

    return env.ASSETS.fetch(request);
  },
};

async function handleSync(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const syncCode = syncCodeFromRequest(request);
  if (syncCode instanceof Response) return syncCode;

  if (!await syncCodeExists(env, syncCode)) return json({ error: "unknown_sync_code" }, 401);
  await markSyncCodeUsed(env, syncCode);
  const remote = await loadRemoteSnapshot(env, syncCode);
  if (request.method === "GET") return json(remote);

  if (request.method === "DELETE") {
    const language = languageFromRequest(request);
    if (!language) return json({ error: "invalid_language" }, 400);
    const next: RemoteSyncSnapshot = {
      ...remote,
      languages: {
        ...remote.languages,
        [language]: emptySnapshot().languages[language],
      },
      revision: remote.revision + 1,
      updatedAt: Date.now(),
    };
    await saveRemoteSnapshot(env, syncCode, next);
    return json(next);
  }

  let incoming: SyncSnapshot;
  try {
    incoming = normalizeSnapshot(await request.json());
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const merged = mergeSnapshots(remote, incoming);
  if (sameSnapshot(remote, merged)) return json(remote);

  const next: RemoteSyncSnapshot = {
    ...merged,
    revision: remote.revision + 1,
    updatedAt: Date.now(),
  };
  await saveRemoteSnapshot(env, syncCode, next);
  return json(next);
}

async function handleTts(request: Request, ctx: ExecutionContext) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const language = normalizeTtsLanguage(url.searchParams.get("tl") || "nl");
  const text = (url.searchParams.get("q") || "").trim();

  if (!language) return json({ error: "unsupported_language" }, 400);
  if (!isValidTtsText(text, language)) return json({ error: "invalid_text" }, 400);

  const cacheUrl = new URL(request.url);
  cacheUrl.search = `?tl=${encodeURIComponent(language)}&q=${encodeURIComponent(text.toLowerCase())}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const upstreamUrl = new URL("https://translate.google.com/translate_tts");
  upstreamUrl.searchParams.set("ie", "UTF-8");
  upstreamUrl.searchParams.set("client", "tw-ob");
  upstreamUrl.searchParams.set("tl", language);
  upstreamUrl.searchParams.set("q", text);

  const upstream = await fetch(upstreamUrl.toString(), {
    headers: {
      "Accept": "audio/mpeg,audio/*;q=0.9,*/*;q=0.1",
      "User-Agent": "Mozilla/5.0 FlashLang",
    },
  });

  if (!upstream.ok || !upstream.body) return json({ error: "tts_unavailable" }, 502);

  const response = new Response(upstream.body, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=2592000",
      "Content-Type": upstream.headers.get("Content-Type") || "audio/mpeg",
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function syncCodeExists(env: Env, syncCode: string) {
  const row = await env.DB.prepare("select 1 as ok from sync_codes where code = ?").bind(syncCode).first<{ ok: number }>();
  return Boolean(row);
}

async function markSyncCodeUsed(env: Env, syncCode: string) {
  await env.DB.prepare("update sync_codes set last_used_at = ? where code = ?").bind(Date.now(), syncCode).run();
}

async function loadRemoteSnapshot(env: Env, syncCode: string): Promise<RemoteSyncSnapshot> {
  const row = await env.DB.prepare(
    "select revision, snapshot_json, updated_at from sync_state where code = ?",
  ).bind(syncCode).first<{
    revision: number;
    snapshot_json: string;
    updated_at: number;
  }>();

  if (!row) {
    return {
      ...emptySnapshot(),
      revision: 0,
      updatedAt: 0,
    };
  }

  const snapshot = normalizeSnapshot(parseJson(row.snapshot_json, emptySnapshot()));

  return {
    ...snapshot,
    revision: Number(row.revision || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function saveRemoteSnapshot(env: Env, syncCode: string, snapshot: RemoteSyncSnapshot) {
  await env.DB.prepare(
    `insert into sync_state (code, revision, snapshot_json, updated_at)
     values (?, ?, ?, ?)
     on conflict(code) do update set
       revision = excluded.revision,
       snapshot_json = excluded.snapshot_json,
       updated_at = excluded.updated_at`,
  ).bind(
    syncCode,
    snapshot.revision,
    JSON.stringify({ languages: snapshot.languages }),
    snapshot.updatedAt || Date.now(),
  ).run();
}

function syncCodeFromRequest(request: Request): string | Response {
  const code = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (!isValidSyncCode(code)) return json({ error: "invalid_sync_code" }, 401);
  return code;
}

function languageFromRequest(request: Request): LanguageCode | null {
  const value = new URL(request.url).searchParams.get("language");
  return value === "nl" || value === "zh" ? value : null;
}

function isValidSyncCode(code: string) {
  return code.length >= 4 && code.length <= maxSyncCodeLength && /^[\x21-\x7e]+$/.test(code);
}

function normalizeTtsLanguage(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "nl" || normalized === "nl-nl") return "nl";
  if (normalized === "zh" || normalized === "zh-cn") return "zh-CN";
  return null;
}

function isValidTtsText(text: string, language: string) {
  if (text.length === 0 || text.length > maxTtsLength) return false;
  if (language === "zh-CN") return /^[\p{Script=Han}0-9'’.,!?，。！？、 -]+$/u.test(text);
  return /^[a-zà-ÿ0-9'’.,!? -]+$/i.test(text);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export const testInternals = {
  handleTts,
  isValidSyncCode,
  languageFromRequest,
  syncCodeFromRequest,
};
