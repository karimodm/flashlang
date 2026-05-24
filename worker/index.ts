import { emptySnapshot, mergeSnapshots, normalizeSnapshot, sameSnapshot, type RemoteSyncSnapshot, type SyncSnapshot } from "../src/lib/sync";

type Env = {
  ASSETS: Fetcher;
  DB: D1Database;
  SYNC_CODE?: string;
};

const syncId = "default";
const maxTtsLength = 80;

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
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authError = requireAuth(request, env);
  if (authError) return authError;

  const remote = await loadRemoteSnapshot(env);
  if (request.method === "GET") return json(remote);

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
  await saveRemoteSnapshot(env, next);
  return json(next);
}

async function handleTts(request: Request, ctx: ExecutionContext) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const language = url.searchParams.get("tl") || "nl";
  const text = (url.searchParams.get("q") || "").trim();

  if (language !== "nl") return json({ error: "unsupported_language" }, 400);
  if (!isValidTtsText(text)) return json({ error: "invalid_text" }, 400);

  const cacheUrl = new URL(request.url);
  cacheUrl.search = `?tl=nl&q=${encodeURIComponent(text.toLowerCase())}`;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const upstreamUrl = new URL("https://translate.google.com/translate_tts");
  upstreamUrl.searchParams.set("ie", "UTF-8");
  upstreamUrl.searchParams.set("client", "tw-ob");
  upstreamUrl.searchParams.set("tl", "nl");
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

async function loadRemoteSnapshot(env: Env): Promise<RemoteSyncSnapshot> {
  const row = await env.DB.prepare(
    "select revision, progress_json, totals_json, updated_at from sync_state where id = ?",
  ).bind(syncId).first<{
    revision: number;
    progress_json: string;
    totals_json: string;
    updated_at: number;
  }>();

  if (!row) {
    return {
      ...emptySnapshot(),
      revision: 0,
      updatedAt: 0,
    };
  }

  const snapshot = normalizeSnapshot({
    progress: parseJson(row.progress_json, {}),
    totals: parseJson(row.totals_json, {}),
  });

  return {
    ...snapshot,
    revision: Number(row.revision || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function saveRemoteSnapshot(env: Env, snapshot: RemoteSyncSnapshot) {
  await env.DB.prepare(
    `insert into sync_state (id, revision, progress_json, totals_json, updated_at)
     values (?, ?, ?, ?, ?)
     on conflict(id) do update set
       revision = excluded.revision,
       progress_json = excluded.progress_json,
       totals_json = excluded.totals_json,
       updated_at = excluded.updated_at`,
  ).bind(
    syncId,
    snapshot.revision,
    JSON.stringify(snapshot.progress),
    JSON.stringify(snapshot.totals),
    snapshot.updatedAt || Date.now(),
  ).run();
}

function requireAuth(request: Request, env: Env) {
  const expected = (env.SYNC_CODE || "").trim();
  if (!expected) return json({ error: "sync_code_not_configured" }, 503);
  const actual = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "").trim() || "";
  if (actual !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

function isValidTtsText(text: string) {
  return (
    text.length > 0 &&
    text.length <= maxTtsLength &&
    /^[a-zà-ÿ0-9'’.,!? -]+$/i.test(text)
  );
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
  requireAuth,
};
