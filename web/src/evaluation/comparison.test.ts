import {describe, expect, it} from "vitest";

import type {
  EvaluatorDataType,
  Experiment,
  ExperimentCase,
  ExperimentEvaluator,
  ExperimentResult,
} from "../api/types";
import {
  compareExperiments,
  hasDatasetRevisionMismatch,
} from "./comparison";

function evaluator(
  key: string,
  dataType: EvaluatorDataType,
): ExperimentEvaluator {
  return {
    experiment_evaluator_id: `evaluator_${key}`,
    key,
    name: key,
    data_type: dataType,
    position: 0,
  };
}

function result(
  evaluatorKey: string,
  value: boolean | number | null,
  errorMessage: string | null = null,
): ExperimentResult {
  return {
    evaluator_key: evaluatorKey,
    value,
    error_message: errorMessage,
    rationale: null,
  };
}

function experimentCase(
  position: number,
  evaluatorResults: ExperimentResult[],
  status: ExperimentCase["status"] = "completed",
): ExperimentCase {
  return {
    experiment_case_id: `case_${position}`,
    dataset_example_id: `example_${position}`,
    position,
    input: {position},
    expected_output: null,
    metadata: {},
    status,
    output: null,
    error: status === "failed" ? {message: "target failed"} : null,
    duration_us: null,
    trace_id: null,
    completed_at: null,
    evaluator_results: evaluatorResults,
  };
}

function experiment({
  id,
  evaluators,
  cases,
  revision = 3,
}: {
  id: string;
  evaluators: ExperimentEvaluator[];
  cases: ExperimentCase[];
  revision?: number;
}): Experiment {
  const failedCaseCount = cases.filter(({status}) => status === "failed").length;
  const completedCaseCount = cases.filter(
    ({status}) => status !== "pending",
  ).length;

  return {
    experiment_id: id,
    dataset_id: "dataset_1",
    dataset_revision: revision,
    name: id,
    status: "completed",
    started_at: "2026-07-29T00:00:00.000Z",
    ended_at: "2026-07-29T00:01:00.000Z",
    case_count: cases.length,
    completed_case_count: completedCaseCount,
    failed_case_count: failedCaseCount,
    target_metadata: {},
    evaluators,
    cases,
  };
}

describe("compareExperiments", () => {
  it("calculates a boolean pass rate without errors or missing values in the denominator", () => {
    const exactMatch = evaluator("exact_match", "boolean");
    const comparison = compareExperiments([
      experiment({
        id: "baseline",
        evaluators: [exactMatch],
        cases: [
          experimentCase(0, [result("exact_match", true)]),
          experimentCase(1, [result("exact_match", false)]),
          experimentCase(2, [
            result("exact_match", null, "evaluator crashed"),
          ]),
          experimentCase(3, [result("exact_match", null)]),
        ],
      }),
    ]);

    expect(comparison[0]?.stats.get("exact_match")).toMatchObject({
      caseCount: 4,
      scoredCount: 2,
      errorCount: 1,
      missingCount: 1,
      value: 0.5,
    });
  });

  it("calculates the mean of valid number results", () => {
    const relevance = evaluator("relevance", "number");
    const comparison = compareExperiments([
      experiment({
        id: "baseline",
        evaluators: [relevance],
        cases: [
          experimentCase(0, [result("relevance", 1)]),
          experimentCase(1, [result("relevance", 2)]),
          experimentCase(2, [result("relevance", 6)]),
          experimentCase(3, [
            result("relevance", 100, "invalid evaluator output"),
          ]),
        ],
      }),
    ]);

    expect(comparison[0]?.stats.get("relevance")).toMatchObject({
      scoredCount: 3,
      value: 3,
    });
  });

  it("returns null instead of zero when no case is scored", () => {
    const relevance = evaluator("relevance", "number");
    const comparison = compareExperiments([
      experiment({
        id: "baseline",
        evaluators: [relevance],
        cases: [
          experimentCase(0, [result("relevance", null)]),
          experimentCase(1, [result("relevance", null, "timed out")]),
        ],
      }),
    ]);

    expect(comparison[0]?.stats.get("relevance")).toMatchObject({
      scoredCount: 0,
      value: null,
    });
  });

  it("counts evaluator errors, missing results, and target failures independently", () => {
    const exactMatch = evaluator("exact_match", "boolean");
    const comparison = compareExperiments([
      experiment({
        id: "baseline",
        evaluators: [exactMatch],
        cases: [
          experimentCase(0, [result("exact_match", true)]),
          experimentCase(1, [
            result("exact_match", null, "evaluator failed"),
          ]),
          experimentCase(2, [], "failed"),
          experimentCase(3, [result("exact_match", false)], "failed"),
        ],
      }),
    ]);

    expect(comparison[0]?.stats.get("exact_match")).toMatchObject({
      caseCount: 4,
      scoredCount: 2,
      errorCount: 1,
      missingCount: 1,
      targetFailedCount: 2,
    });
  });

  it("calculates deltas from the first experiment and keeps baseline deltas null", () => {
    const exactMatch = evaluator("exact_match", "boolean");
    const baseline = experiment({
      id: "baseline",
      evaluators: [exactMatch],
      cases: [
        experimentCase(0, [result("exact_match", true)]),
        experimentCase(1, [result("exact_match", false)]),
      ],
    });
    const candidate = experiment({
      id: "candidate",
      evaluators: [exactMatch],
      cases: [
        experimentCase(0, [result("exact_match", true)]),
        experimentCase(1, [result("exact_match", true)]),
      ],
    });

    const comparison = compareExperiments([baseline, candidate]);

    expect(comparison[0]?.stats.get("exact_match")?.delta).toBeNull();
    expect(comparison[1]?.stats.get("exact_match")?.delta).toBe(0.5);
  });

  it("returns null deltas when the baseline has no scored value", () => {
    const relevance = evaluator("relevance", "number");
    const baseline = experiment({
      id: "baseline",
      evaluators: [relevance],
      cases: [experimentCase(0, [result("relevance", null)])],
    });
    const candidate = experiment({
      id: "candidate",
      evaluators: [relevance],
      cases: [experimentCase(0, [result("relevance", 4)])],
    });

    const comparison = compareExperiments([baseline, candidate]);

    expect(comparison[1]?.stats.get("relevance")?.delta).toBeNull();
  });

  it("omits evaluators that are not configured on an experiment", () => {
    const exactMatch = evaluator("exact_match", "boolean");
    const relevance = evaluator("relevance", "number");
    const baseline = experiment({
      id: "baseline",
      evaluators: [exactMatch],
      cases: [experimentCase(0, [result("exact_match", true)])],
    });
    const candidate = experiment({
      id: "candidate",
      evaluators: [relevance],
      cases: [experimentCase(0, [result("relevance", 4)])],
    });

    const comparison = compareExperiments([baseline, candidate]);

    expect(comparison[0]?.stats.has("relevance")).toBe(false);
    expect(comparison[1]?.stats.has("exact_match")).toBe(false);
    expect(comparison[1]?.stats.get("relevance")?.delta).toBeNull();
  });
});

describe("hasDatasetRevisionMismatch", () => {
  it("detects whether selected experiments span dataset revisions", () => {
    const baseline = experiment({
      id: "baseline",
      revision: 3,
      evaluators: [],
      cases: [],
    });
    const sameRevision = experiment({
      id: "candidate",
      revision: 3,
      evaluators: [],
      cases: [],
    });
    const olderRevision = experiment({
      id: "older",
      revision: 2,
      evaluators: [],
      cases: [],
    });

    expect(hasDatasetRevisionMismatch([baseline, sameRevision])).toBe(false);
    expect(hasDatasetRevisionMismatch([baseline, olderRevision])).toBe(true);
    expect(hasDatasetRevisionMismatch([])).toBe(false);
  });

  it("does not subtract results of the same key declared with different types", () => {
    const key = "accuracy";
    const comparison = compareExperiments([
      experiment({
        id: "baseline",
        evaluators: [evaluator(key, "boolean")],
        cases: [
          experimentCase(0, [result(key, true)]),
          experimentCase(1, [result(key, false)]),
        ],
      }),
      experiment({
        id: "candidate",
        evaluators: [evaluator(key, "number")],
        cases: [experimentCase(0, [result(key, 5)])],
      }),
    ]);

    expect(comparison[0]?.stats.get(key)?.value).toBe(0.5);
    expect(comparison[1]?.stats.get(key)?.value).toBe(5);
    expect(comparison[1]?.stats.get(key)?.delta).toBeNull();
  });
});
