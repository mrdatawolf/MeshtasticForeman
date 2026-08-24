import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { request } from "./client.js";

describe("request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("(a) resolves a parsed 2xx JSON response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ value: 42 }), { status: 200 }),
    );

    await expect(request<{ value: number }>("/api/value")).resolves.toEqual({ value: 42 });
  });

  it("(b) resolves undefined for a 204 response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));

    await expect(request("/api/value")).resolves.toBeUndefined();
  });

  it("(c) rejects a string error body as ClientError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "Device unavailable" }), { status: 503 }),
    );

    await expect(request("/api/value")).rejects.toMatchObject({
      name: "ClientError",
      message: "Device unavailable",
      status: 503,
      fieldErrors: undefined,
    });
  });

  it("(d) rejects a validation body with field errors and a non-empty message", async () => {
    const fieldErrors = { port: ["Required"] };
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { fieldErrors, formErrors: [] } }), { status: 400 }),
    );

    const rejection = request("/api/value");
    await expect(rejection).rejects.toMatchObject({
      name: "ClientError",
      status: 400,
      fieldErrors,
    });
    await expect(rejection).rejects.toHaveProperty("message", "port: Required");
  });

  it("(e) rejects a non-JSON error response with a fallback ClientError", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));

    await expect(request("/api/value")).rejects.toMatchObject({
      name: "ClientError",
      message: "HTTP 502",
      status: 502,
      fieldErrors: undefined,
    });
  });

  it("(f) rejects a pre-response network failure with status undefined", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(request("/api/value")).rejects.toMatchObject({
      name: "ClientError",
      message: "Network error",
      status: undefined,
      fieldErrors: undefined,
    });
  });

  it("(g) preserves AbortError instead of wrapping cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const abortError = new DOMException("The operation was aborted", "AbortError");
    vi.mocked(fetch).mockRejectedValue(abortError);

    const rejection = request("/api/value", { signal: controller.signal });
    await expect(rejection).rejects.toBe(abortError);
    await expect(rejection).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/value",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("(h) omits undefined query values and URL-encodes special characters", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await request("/api/search", {
      query: { omitted: undefined, phrase: "mesh nodes", filter: "a&b" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/search?phrase=mesh+nodes&filter=a%26b",
      expect.any(Object),
    );
  });
});
