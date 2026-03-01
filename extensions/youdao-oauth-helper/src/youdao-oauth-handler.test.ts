import { describe, expect, it } from "vitest";
import { resolveYoudaoOauthConfig } from "./youdao-oauth-handler.js";

describe("resolveYoudaoOauthConfig", () => {
  it("applies defaults", () => {
    const cfg = resolveYoudaoOauthConfig({});
    expect(cfg.basePath).toBe("/youdao/oauth");
    expect(cfg.stateTtlSeconds).toBe(600);
    expect(cfg.strictState).toBe(true);
    expect(cfg.warnings).toEqual([]);
  });

  it("normalizes base path and clamps ttl", () => {
    const cfg = resolveYoudaoOauthConfig({
      basePath: "oauth/youdao/",
      stateTtlSeconds: 5,
      strictState: "false",
    });
    expect(cfg.basePath).toBe("/oauth/youdao");
    expect(cfg.stateTtlSeconds).toBe(60);
    expect(cfg.strictState).toBe(false);
  });

  it("warns on invalid redirectUri", () => {
    const cfg = resolveYoudaoOauthConfig({
      redirectUri: "not-a-url",
    });
    expect(cfg.redirectUri).toBeUndefined();
    expect(cfg.warnings.length).toBe(1);
    expect(cfg.warnings[0]).toContain("redirectUri");
  });
});
