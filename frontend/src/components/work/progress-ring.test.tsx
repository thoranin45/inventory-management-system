import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { ProgressRing } from "./progress-ring";

describe("ProgressRing", () => {
  it("derives the percentage from decimal strings (exact, no float drift)", () => {
    const { getByRole } = render(<ProgressRing done="1.000" total="3.000" />);
    // 1/3 → 33%
    expect(getByRole("img").getAttribute("aria-label")).toBe("33% complete");
  });

  it("clamps to 100 and switches the stroke to the success colour when done", () => {
    const { getByRole, container } = render(<ProgressRing done="5.000" total="4.000" />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("100% complete");
    const strokes = [...container.querySelectorAll("circle")].map((c) => c.getAttribute("stroke"));
    expect(strokes).toContain("var(--success)");
  });

  it("shows 0% for a zero total without dividing by zero", () => {
    const { getByRole } = render(<ProgressRing done="0" total="0" />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("0% complete");
  });
});
