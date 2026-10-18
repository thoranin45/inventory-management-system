import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Untranslated-string tracking (decision D4). R2 localizes the shell, login,
 * command palette, status chips and shared UI; business screens follow in
 * R4–R6. This ratchet records, per file, how many hard-coded English
 * user-visible strings remain, so no screen is forgotten and none regresses:
 *   - R2-scope files must have none;
 *   - other files may only go down (update the baseline when they do:
 *     UPDATE_I18N_BASELINE=1 npx vitest run src/test/i18n-coverage.test.ts).
 * Heuristic: JSX text starting with a capitalized English word, and English
 * literals in aria-label / placeholder / title / label / heading props.
 */
const SRC = resolve(process.cwd(), "src");
const BASELINE_PATH = resolve(SRC, "test/untranslated-baseline.json");

const R2_SCOPE = [
  "app/login/page.tsx",
  "app/login/login-form.tsx",
  "app/login/login-intro.tsx",
  "components/command-palette.tsx",
  "components/shell/app-shell.tsx",
  "components/shell/breadcrumbs.tsx",
  "components/shell/icon-rail.tsx",
  "components/shell/language-switch.tsx",
  "components/shell/mobile-bottom-nav.tsx",
  "components/shell/more-sheet.tsx",
  "components/shell/sidebar.tsx",
  "components/shell/sidebar-search.tsx",
  "components/shell/theme-toggle.tsx",
  "components/shell/topbar.tsx",
  "components/ui/combobox.tsx",
  "components/ui/data-table.tsx",
  "components/ui/dialog.tsx",
  "components/ui/drawer.tsx",
  "components/ui/filter-strip.tsx",
  "components/ui/search-input.tsx",
  "components/ui/states.tsx",
  "components/ui/status-badge.tsx",
];

// R4 (stock + operational screens and their shared primitives) must have none either.
const R4_SCOPE = [
  "components/ui/date-field.tsx",
  "components/ui/expiry-badge.tsx",
  "components/ui/local-date.tsx",
  "components/ui/lot-chip.tsx",
  "components/ui/quantity-display.tsx",
  "components/ui/review-sheet.tsx",
  "components/ui/step-indicator.tsx",
  "components/ui/stock-triad.tsx",
  "components/products/product-balances.tsx",
  "components/products/product-detail.tsx",
  "components/stock/barcode-lookup-sheet.tsx",
  "components/stock/stock-detail-pane.tsx",
  "components/stock/stock-in-console.tsx",
  "components/stock/stock-out-console.tsx",
  "components/stock/stock-task-parts.tsx",
  "components/stock/stock-view.tsx",
  "components/stock/task-trail.tsx",
  "components/purchase-orders/receipt-history.tsx",
  "components/purchase-orders/receive-line.tsx",
  "components/purchase-orders/receiving-console.tsx",
  "components/transfers/transfer-receive-line.tsx",
  "components/transfers/transfer-receiving-console.tsx",
  "components/transfers/transfer-route.tsx",
  "components/stock-adjustments/exact-balance-picker.tsx",
  "components/stock-adjustments/request-detail.tsx",
  "components/stock-adjustments/request-form.tsx",
  "components/stock-adjustments/request-list.tsx",
];

const JSX_TEXT = />\s*([A-Z][a-z]+(?:[ '’&,.:/-]+[A-Za-z]+)*[.…!?]?)\s*</g;
const PROP_TEXT = /\b(?:aria-label|placeholder|title|label|heading|emptyText|ariaLabel)=["{]["`]?([A-Z][a-z]+[^"`}]*)["`]/g;
const ALLOW = /^(?:AKKRATHARA|Ctrl K|Ctrl|Esc|EN|SKU|FEFO|FIFO|ID|OK)$/;

export function englishLiterals(source: string): string[] {
  const found: string[] = [];
  for (const re of [JSX_TEXT, PROP_TEXT]) {
    for (const m of source.matchAll(re)) {
      const text = m[1].trim();
      if (!ALLOW.test(text)) found.push(text);
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "test" && name !== "node_modules") out.push(...sourceFiles(full));
    } else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(SRC)) {
    const n = englishLiterals(readFileSync(file, "utf8")).length;
    if (n > 0) counts[relative(SRC, file).replace(/\\/g, "/")] = n;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

describe("untranslated string tracking (D4)", () => {
  const counts = currentCounts();
  if (process.env.UPDATE_I18N_BASELINE === "1") writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + "\n");
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<string, number>;

  it("the heuristic detects JSX text and English props", () => {
    expect(englishLiterals('<p>Something went wrong.</p><input placeholder="Search…" aria-label="Close" />'))
      .toEqual(["Something went wrong.", "Search…", "Close"]);
    expect(englishLiterals('<p>{t("x")}</p><kbd>Ctrl K</kbd>')).toEqual([]);
  });

  it("R2-scope components contain no hard-coded English", () => {
    for (const file of R2_SCOPE) expect(counts[file] ?? 0, `${file}: ${englishLiterals(readFileSync(join(SRC, file), "utf8"))}`).toBe(0);
  });

  it("R4-scope screens and primitives contain no hard-coded English", () => {
    for (const file of R4_SCOPE) expect(counts[file] ?? 0, `${file}: ${englishLiterals(readFileSync(join(SRC, file), "utf8"))}`).toBe(0);
  });

  it("no file gains untranslated strings beyond the recorded baseline", () => {
    for (const [file, n] of Object.entries(counts)) {
      expect(n, `${file} has ${n} English literals (baseline ${baseline[file] ?? 0})`).toBeLessThanOrEqual(baseline[file] ?? 0);
    }
  });
});

describe("focus visibility (R2.7)", () => {
  // Tailwind 4: outline-none / outline-hidden set --tw-outline-style: none and
  // focus-visible:outline-2 only sets the width, inheriting that "none". A
  // suppressed outline must restore its style on focus, or focus is invisible.
  it("no control suppresses its outline without restoring a solid one on focus", () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter(
          (line) =>
            /(^|[\s"'`])outline-(none|hidden)(\s|["'`])/.test(line) &&
            /focus(-visible)?:outline-2/.test(line) &&
            !/focus(-visible)?:outline-solid/.test(line),
        )
        .map((line) => `${relative(SRC, file)}: ${line.trim().slice(0, 60)}`),
    );
    expect(offenders).toEqual([]);
  });
});
