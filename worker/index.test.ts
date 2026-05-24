import { describe, expect, it } from "vitest";
import { testInternals } from "./index";

describe("worker api guards", () => {
  it("rejects sync requests when the configured code is missing", () => {
    const response = testInternals.requireAuth(new Request("https://app.test/api/sync"), {});
    expect(response?.status).toBe(503);
  });

  it("rejects sync requests with the wrong code", () => {
    const request = new Request("https://app.test/api/sync", {
      headers: { Authorization: "Bearer wrong" },
    });
    const response = testInternals.requireAuth(request, { SYNC_CODE: "right" });
    expect(response?.status).toBe(401);
  });

  it("accepts sync requests with the configured code", () => {
    const request = new Request("https://app.test/api/sync", {
      headers: { Authorization: "Bearer right" },
    });
    const response = testInternals.requireAuth(request, { SYNC_CODE: "right" });
    expect(response).toBeNull();
  });

  it("rejects invalid tts requests before calling upstream", async () => {
    const response = await testInternals.handleTts(new Request("https://app.test/api/tts?tl=en&q=test"), {
      waitUntil() {},
      passThroughOnException() {},
    });
    expect(response.status).toBe(400);
  });
});
