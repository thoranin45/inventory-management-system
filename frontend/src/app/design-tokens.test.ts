/**
 * Concept B foundation guard: the token values in globals.css are the frozen
 * Design Freeze §B values, both dark blocks agree, and every text / control
 * pairing the components use meets WCAG 2.2 AA contrast in both themes.
 * Reads the stylesheet as text; no browser needed.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from frontend/ (jsdom's import.meta.url is not a file: URL).
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < css.length; end++) {
    if (css[end] === "{") depth++;
    if (css[end] === "}" && --depth === 0) break;
  }
  const tokens: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].replace(/\/\*.*?\*\//g, "").trim().toLowerCase();
  }
  return tokens;
}

const light = block(":root {");
const darkSystem = block(':root:not([data-theme="light"]) {');
const darkExplicit = block(':root[data-theme="dark"] {');

function luminance(hex: string): number {
  const v = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Design Freeze §B "Colour" table (lowercased).
const FROZEN = {
  light: {
    bg: "#f3f5f8", surface: "#ffffff", "surface-raised": "#ffffff", "surface-sunken": "#f1f4f7",
    border: "#e1e5eb", "border-strong": "#788396", foreground: "#0d1624", muted: "#3a4657", faint: "#586577",
    accent: "#1d58d6", primary: "#1d58d6", "accent-fg": "#ffffff", "primary-fg": "#ffffff", "accent-subtle": "#e8effd",
    focus: "#1d58d6", success: "#12704a", "success-subtle": "#e2f3ea", warning: "#8a5500", "warning-subtle": "#fbf0d8",
    danger: "#b42318", "danger-subtle": "#fde7e4", info: "#1d58d6", "info-subtle": "#e8effd",
    "chart-1": "#2b66e0", "chart-muted": "#c9d3e1", "chart-grid": "#e8ecf1", "row-hover": "#f6f8fb",
  },
  dark: {
    bg: "#0a0e13", surface: "#11171f", "surface-raised": "#151c25", "surface-sunken": "#17202a",
    border: "#222c38", "border-strong": "#5c6b7e", foreground: "#e6ebf2", muted: "#b3bdca", faint: "#8b97a7",
    accent: "#78a2ff", primary: "#78a2ff", "accent-fg": "#0a0e13", "primary-fg": "#0a0e13", "accent-subtle": "#16264a",
    focus: "#78a2ff", success: "#52c48d", "success-subtle": "#10261b", warning: "#ebb04c", "warning-subtle": "#2a2010",
    danger: "#ff7d73", "danger-subtle": "#2d1514", info: "#78a2ff", "info-subtle": "#16264a",
    "chart-1": "#5f8ff5", "chart-muted": "#2b3646", "chart-grid": "#1c2531", "row-hover": "#141c26",
  },
};

const THEMES = [
  ["light", light],
  ["dark", darkExplicit],
] as const;

describe("Concept B design tokens", () => {
  it.each(THEMES)("%s theme carries the frozen Design Freeze values", (name, tokens) => {
    for (const [token, value] of Object.entries(FROZEN[name])) {
      expect(tokens[token], `--${token}`).toBe(value);
    }
  });

  it("the system-dark and explicit-dark blocks are identical", () => {
    expect(darkSystem).toEqual(darkExplicit);
  });

  it("uses IBM Plex (Sans, Sans Thai, Mono) and no longer Sarabun", () => {
    expect(light["font-display"]).toContain("var(--font-plex-sans)");
    expect(light["font-display"]).toContain("var(--font-plex-thai)");
    expect(light["font-code"]).toContain("var(--font-plex-mono)");
    expect(css).not.toMatch(/sarabun/i);
  });

  it("keeps B's flat elevation and radius scale", () => {
    expect(light["shadow-sm"]).toBe("none");
    expect(light["shadow-panel"]).toBe("none");
    expect(darkExplicit["shadow-sm"]).toBe("none");
    expect(light["r-lg"]).toBe("12px");
    expect(light["r-xl"]).toBe("12px");
  });

  describe.each(THEMES)("%s theme contrast (WCAG 2.2 AA)", (_name, t) => {
    const surfaces = ["bg", "surface", "surface-raised", "surface-sunken"];

    it.each(["foreground", "muted", "faint"])("%s text is >= 4.5:1 on every surface", (text) => {
      for (const s of surfaces) expect(contrast(t[text], t[s]), `${text} on ${s}`).toBeGreaterThanOrEqual(4.5);
    });

    it("button and chip text pairs are >= 4.5:1", () => {
      const pairs: [string, string][] = [
        ["primary-fg", "primary"],
        ["accent-fg", "accent"],
        ["accent", "accent-subtle"],
        ["foreground", "accent-subtle"],
        ["success", "success-subtle"],
        ["warning", "warning-subtle"],
        ["danger", "danger-subtle"],
        ["info", "info-subtle"],
        ["accent", "surface"],
        ["danger", "surface"],
      ];
      for (const [fg, bg] of pairs) expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    });

    it("control borders, focus indicator and chart marks are >= 3:1", () => {
      for (const s of ["bg", "surface"]) {
        expect(contrast(t["border-strong"], t[s]), `border-strong on ${s}`).toBeGreaterThanOrEqual(3);
        expect(contrast(t.focus, t[s]), `focus on ${s}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(t["chart-1"], t.surface)).toBeGreaterThanOrEqual(3);
    });
  });
});
