import { describe, expect, it } from "vitest";
import { buildValueComputation, computeAnnualHours, computeRoi } from "@/lib/domain/value";

describe("computeAnnualHours (spec §6.1)", () => {
  it("tasks/week × minutes ÷ 60 × 52", () => {
    expect(computeAnnualHours(10, 30)).toBeCloseTo(260, 5); // 10*30/60*52
    expect(computeAnnualHours(28, 23)).toBeCloseTo(558.13, 1);
  });
  it("handles very small values without going negative or NaN", () => {
    expect(computeAnnualHours(1, 3)).toBeCloseTo(2.6, 5);
    expect(Number.isFinite(computeAnnualHours(120, 75))).toBe(true);
  });
});

describe("computeRoi", () => {
  it("computes the spec formula", () => {
    // (100k − 30k − 10k) / (30k + 10k) = 1.5
    expect(computeRoi(100_000, 30_000, 10_000)).toBeCloseTo(1.5, 6);
  });
  it("returns null when the denominator is 0", () => {
    expect(computeRoi(100_000, 0, 0)).toBeNull();
  });
  it("returns null for any missing input — never a made-up ROI", () => {
    expect(computeRoi(null, 10_000, 2_000)).toBeNull();
    expect(computeRoi(50_000, null, 2_000)).toBeNull();
    expect(computeRoi(50_000, 10_000, null)).toBeNull();
  });
  it("handles negative results (loss)", () => {
    expect(computeRoi(10_000, 30_000, 5_000)).toBeCloseTo(-25 / 35, 6);
  });
});

describe("buildValueComputation", () => {
  const inputs = { weekly_frequency: 28, frequency_source: "task_volume", minutes_per_task: 23, hourly_cost_aud: 65 };

  it("derives scenarios from configured reduction ratios, not free choices", () => {
    const comp = buildValueComputation({ inputs, reduction: [0.25, 0.4, 0.6], assumptionNote: "note" });
    const annual = computeAnnualHours(28, 23);
    expect(comp.annual_hours).toBeCloseTo(annual, 1);
    const [c, b, o] = comp.scenarios;
    expect(c.reduction_ratio).toBe(0.25);
    expect(b.reduction_ratio).toBe(0.4);
    expect(o.reduction_ratio).toBe(0.6);
    expect(b.released_hours).toBeCloseTo(annual * 0.4, 0);
    expect(b.time_value_aud).toBeCloseTo(annual * 0.4 * 65, -1);
    // conservative < baseline < optimistic
    expect(c.time_value_aud!).toBeLessThan(b.time_value_aud!);
    expect(b.time_value_aud!).toBeLessThan(o.time_value_aud!);
  });

  it("lists missing inputs instead of defaulting them to zero", () => {
    const comp = buildValueComputation({
      inputs: { weekly_frequency: null, frequency_source: "task_volume", minutes_per_task: null, hourly_cost_aud: null },
      reduction: [0.25, 0.4, 0.6],
      assumptionNote: "note",
    });
    expect(comp.annual_hours).toBeNull();
    expect(comp.scenarios.every((s) => s.released_hours === null && s.time_value_aud === null)).toBe(true);
    expect(comp.missing_inputs).toHaveLength(3);
  });

  it("never claims a cash ROI in the free report", () => {
    const comp = buildValueComputation({ inputs, reduction: [0.25, 0.4, 0.6], assumptionNote: "note" });
    expect(comp.roi_percent).toBeNull();
    expect(comp.roi_note).toMatch(/not shown/i);
  });
});
