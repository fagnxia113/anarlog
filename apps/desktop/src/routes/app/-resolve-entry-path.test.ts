import { describe, expect, it } from "vitest";

import {
  isShellEntryPath,
  normalizeAppPath,
  resolveAppEntryPath,
  resolveShellEntryPath,
} from "./-resolve-entry-path";

describe("app entry path resolution", () => {
  it("always resolves to the main shell", async () => {
    await expect(resolveShellEntryPath()).resolves.toBe("/app/main");
    await expect(resolveAppEntryPath()).resolves.toBe("/app/main");
  });

  it("normalizes and identifies shell entry paths", () => {
    expect(normalizeAppPath("/app/main/")).toBe("/app/main");
    expect(isShellEntryPath("/app")).toBe(true);
    expect(isShellEntryPath("/app/main/")).toBe(true);
    expect(isShellEntryPath("/app/unknown")).toBe(false);
  });
});
