import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, getTheme, setTheme } from "@/lib/theme";

afterEach(() => {
  localStorage.clear();
  applyTheme("light");
});

describe("theme", () => {
  it("is light by default", () => {
    expect(getTheme()).toBe("light");
  });

  it("saves the choice and sets the dark class", () => {
    setTheme("light");
    expect(getTheme()).toBe("light");
    expect(document.documentElement).not.toHaveClass("dark");
    setTheme("dark");
    expect(getTheme()).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});
