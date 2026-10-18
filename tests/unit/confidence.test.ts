import { describe, expect, it } from "vitest";
import { computeConfidence } from "@/lib/domain/confidence";
import { fullTradesAnswers } from "../helpers";

describe("computeConfidence (deterministic, never LLM-self-assessed)", () => {
  it("high when all key inputs known and numbers are tracked", () => {
    const c = computeConfidence(fullTradesAnswers());
    expect(c.level).toBe("high");
  });

  it("drops one step per unknown key input", () => {
    const answers = fullTradesAnswers();
    answers.task_volume = { kind: "unknown" };
    expect(computeConfidence(answers).level).toBe("medium");
    answers.minutes_per_task = { kind: "unknown" };
    answers.hourly_cost = { kind: "unknown" };
    const c = computeConfidence(answers);
    expect(c.level).toBe("low");
    expect(c.key_unknowns).toHaveLength(3);
  });

  it("untracked numbers reduce confidence even with full inputs", () => {
    const answers = fullTradesAnswers();
    answers.metrics_tracking = { kind: "single", value: "no" };
    const c = computeConfidence(answers);
    expect(c.level).toBe("medium");
    expect(c.reasons.join(" ")).toMatch(/does not track/i);
  });

  it("missing (unanswered) counts as unknown, not as zero", () => {
    const answers = fullTradesAnswers();
    delete answers.hourly_cost;
    const c = computeConfidence(answers);
    expect(c.key_unknowns).toContain("the hourly cost involved");
  });
});
