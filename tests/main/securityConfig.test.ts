import { describe, expect, it } from "vitest";

import { MAIN_WINDOW_CSP, toAllowedConnectOrigin } from "../../config/runtime/security";

describe("runtime security config", () => {
  it("only allows http/https localhost origins and https remote origins", () => {
    expect(toAllowedConnectOrigin("ftp://localhost:8080")).toBeNull();
    expect(toAllowedConnectOrigin("file://localhost")).toBeNull();
    expect(toAllowedConnectOrigin("ws://localhost:3000")).toBeNull();
    expect(toAllowedConnectOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(toAllowedConnectOrigin("https://localhost:5173")).toBe("https://localhost:5173");
    expect(toAllowedConnectOrigin("https://example.com/path")).toBe("https://example.com");
    expect(toAllowedConnectOrigin("http://example.com")).toBeNull();
  });

  it("allows renderer style attributes without weakening script policy", () => {
    expect(MAIN_WINDOW_CSP).toContain("style-src-attr 'unsafe-inline'");
    expect(MAIN_WINDOW_CSP).toContain("script-src 'self'");
    expect(MAIN_WINDOW_CSP).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
