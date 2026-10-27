// Copyright 2026 DriftWallet Contributors.
// SPDX-License-Identifier: Apache-2.0

// U022 navigation + deep-link tests.
import { describe, expect, it } from "vitest";
import {
  deepLinkForWc,
  formatDeepLink,
  goBack,
  initialNav,
  navigate,
  navFromDeepLink,
  parseDeepLink,
} from "./navigation.js";

describe("drift:// deep links", () => {
  it("mirrors mobile wc link shape", () => {
    expect(deepLinkForWc("wc:1234@2?bridge=x")).toBe("drift://wc?uri=wc%3A1234%402%3Fbridge%3Dx");
    expect(() => deepLinkForWc("https://x")).toThrow();
  });

  it("formats and parses screen links", () => {
    expect(formatDeepLink({ screen: "home", params: {} })).toBe("drift://home");
    const link = parseDeepLink("drift://approve?id=a1&origin=https%3A%2F%2Fapp.example");
    expect(link.screen).toBe("approve");
    expect(link.params["id"]).toBe("a1");
    expect(formatDeepLink(link)).toBe("drift://approve?id=a1&origin=https%3A%2F%2Fapp.example");
  });

  it("rejects bad links", () => {
    expect(() => parseDeepLink("https://app.example")).toThrow();
    expect(() => parseDeepLink("drift://unknown-screen")).toThrow();
    expect(() => parseDeepLink("drift://wc")).toThrow(/uri/);
    expect(() => parseDeepLink("not a url")).toThrow();
  });

  it("wc roundtrip", () => {
    const url = deepLinkForWc("wc:abc123");
    expect(navFromDeepLink(url).current).toBe("wc");
    expect(navFromDeepLink(url).params["uri"]).toBe("wc:abc123");
  });
});

describe("navigation stack", () => {
  it("navigates and goes back", () => {
    let s = initialNav();
    expect(s.current).toBe("home");
    s = navigate(s, "activity");
    s = navigate(s, "settings", { tab: "networks" });
    expect(s.current).toBe("settings");
    expect(s.params["tab"]).toBe("networks");
    s = goBack(s);
    expect(s.current).toBe("activity");
    s = goBack(s);
    expect(s.current).toBe("home");
    expect(goBack(s).current).toBe("home"); // empty history stays put
  });

  it("rejects unknown screens", () => {
    expect(() => navigate(initialNav(), "ledger" as never)).toThrow();
    expect(() => initialNav("nope" as never)).toThrow();
  });
});
