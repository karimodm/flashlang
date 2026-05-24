import { describe, expect, it } from "vitest";
import { testInternals } from "./index";

describe("worker api guards", () => {
  it("rejects sync requests when the code is missing", () => {
    const response = testInternals.syncCodeFromRequest(new Request("https://app.test/api/sync"));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });

  it("rejects sync codes that are too short", () => {
    const response = testInternals.syncCodeFromRequest(new Request("https://app.test/api/sync", {
      headers: { Authorization: "Bearer abc" },
    }));
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
  });

  it("accepts printable db-backed sync codes", () => {
    const response = testInternals.syncCodeFromRequest(new Request("https://app.test/api/sync", {
      headers: { Authorization: "Bearer phone-laptop-2026" },
    }));
    expect(response).toBe("phone-laptop-2026");
  });

  it("rejects control characters in sync codes", () => {
    expect(testInternals.isValidSyncCode("line\nbreak")).toBe(false);
  });

  it("accepts only supported reset languages", () => {
    expect(testInternals.languageFromRequest(new Request("https://app.test/api/sync?language=nl"))).toBe("nl");
    expect(testInternals.languageFromRequest(new Request("https://app.test/api/sync?language=zh"))).toBe("zh");
    expect(testInternals.languageFromRequest(new Request("https://app.test/api/sync?language=en"))).toBeNull();
  });

  it("rejects unsupported tts languages before calling upstream", async () => {
    const response = await testInternals.handleTts(new Request("https://app.test/api/tts?tl=en&q=test"), {
      waitUntil() {},
      passThroughOnException() {},
    });
    expect(response.status).toBe(400);
  });

  it("rejects invalid Mandarin tts text before calling upstream", async () => {
    const response = await testInternals.handleTts(new Request("https://app.test/api/tts?tl=zh-CN&q=hello"), {
      waitUntil() {},
      passThroughOnException() {},
    });
    expect(response.status).toBe(400);
  });
});
