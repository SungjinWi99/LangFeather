import type { DashboardBucket } from "./api/types";

export type AppView =
  | "overview"
  | "traces"
  | "evaluate"
  | "queues"
  | "scores"
  | "settings";

/**
 * Evaluate 안의 세그먼트. dataset에 매달린 것만 여기 남는다 — Queues와 Scores는
 * dataset과 무관한 화면이라 top-level로 올렸다. dataset 선택은 세그먼트가
 * 아니라 상단의 context bar가 맡는다.
 */
export type EvaluateSection = "examples" | "experiments";

/**
 * 상대 시간 범위. `null`은 절대 구간(deep-link, 과거 특정 구간 조사)이고 그 동작은
 * 그대로 얼어붙어 있어야 한다 — 의도한 동작이다.
 */
export type OverviewRange = "1h" | "24h" | "7d" | "30d";

/** range -> 폭(시간). 여기 한 곳에서만 정의한다. */
const OVERVIEW_RANGE_HOURS: Record<OverviewRange, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const OVERVIEW_RANGES: readonly OverviewRange[] = ["1h", "24h", "7d", "30d"];

function windowForRange(
  range: OverviewRange,
  now: Date,
): { from: string; to: string } {
  return {
    from: new Date(
      now.getTime() - OVERVIEW_RANGE_HOURS[range] * 60 * 60 * 1_000,
    ).toISOString(),
    to: now.toISOString(),
  };
}

export type OverviewUrlState = {
  from: string;
  to: string;
  range: OverviewRange | null;
  timezone: string;
  bucket: DashboardBucket;
  query: string;
  tag: string;
  sessionId: string;
  release: string;
  environment: string;
  userId: string;
  scoreIds: string[];
  toolNames: string[];
};

export type EvaluationUrlState = {
  datasetId: string | null;
  experimentIds: string[];
  metricKeys: string[];
  caseId: string | null;
};

export type AppUrlState = {
  view: AppView;
  section: EvaluateSection;
  overview: OverviewUrlState;
  evaluation: EvaluationUrlState;
  traceId: string | null;
};

/**
 * top-level 기능은 이 배열 하나에서만 정의한다. 탭 재편은 되돌릴 수 있어야 한다고
 * 합의했고, 되돌리는 비용은 여기가 유일한 정의 지점일 때만 낮다.
 */
const APP_VIEWS: readonly AppView[] = [
  "overview",
  "traces",
  "scores",
  "queues",
  "evaluate",
  "settings",
];

/** 기본 진입 화면. 배열 순서와 함께 여기 한 곳에서만 정한다. */
const DEFAULT_VIEW: AppView = "overview";

const EVALUATE_SECTIONS: readonly EvaluateSection[] = [
  "examples",
  "experiments",
];

/**
 * 재편 이전 `view` 값. 이미 공유된 link를 깨지 않기 위해 읽을 때만 옮겨 준다.
 * URL을 다시 쓸 때는 항상 새 값으로만 쓴다.
 */
const LEGACY_VIEWS: Record<string, { view: AppView; section?: EvaluateSection }> =
  {
    // 재편 중 잠깐 쓰던 이름. Overview로 되돌렸다.
    insights: { view: "overview" },
    traces: { view: "traces" },
    datasets: { view: "evaluate", section: "examples" },
    data: { view: "settings" },
  };
const DASHBOARD_BUCKETS: readonly DashboardBucket[] = [
  "auto",
  "minute",
  "hour",
  "day",
  "week",
  "month",
];
/**
 * 잠깐 Evaluate 세그먼트로 접혀 있던 값. dataset과 무관한 화면이라 top-level로
 * 되돌렸고, 그 사이 공유된 link만 읽을 때 옮겨 준다.
 */
const LEGACY_SECTION_VIEWS: Record<string, AppView> = {
  queues: "queues",
  scores: "scores",
};

/**
 * 재편 이전의 `tab` 값. 세그먼트가 그 자리를 대신하므로 읽을 때만 옮겨 준다.
 * `compare`는 실제로 experiments 안에서 그려지던 화면이라 그쪽으로 접는다.
 */
const LEGACY_TABS: Record<string, EvaluateSection> = {
  examples: "examples",
  experiments: "experiments",
  compare: "experiments",
};

function oneOf<T extends string>(
  value: string | null,
  choices: readonly T[],
  fallback: T,
): T {
  return value !== null && choices.includes(value as T)
    ? (value as T)
    : fallback;
}

function list(value: string | null): string[] {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "") ?? []
  );
}

function localTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultOverviewUrlState(now = new Date()): OverviewUrlState {
  const range: OverviewRange = "7d";
  return {
    range,
    ...windowForRange(range, now),
    timezone: localTimezone(),
    bucket: "auto",
    query: "",
    tag: "",
    sessionId: "",
    release: "",
    environment: "",
    userId: "",
    scoreIds: [],
    toolNames: [],
  };
}

function readOverviewUrlState(params: URLSearchParams): OverviewUrlState {
  const defaults = defaultOverviewUrlState();
  const rangeParam = params.get("overview_range");
  // 절대 구간은 명시적으로 적힌 from/to가 있을 때만이다. 아무 것도 없는 첫
  // 방문은 기본 상대 범위로 열려야 흐르는 대시보드가 된다.
  const absolute =
    params.get("overview_from") !== null || params.get("overview_to") !== null;
  const range =
    rangeParam !== null &&
    OVERVIEW_RANGES.includes(rangeParam as OverviewRange)
      ? (rangeParam as OverviewRange)
      : absolute
        ? null
        : defaults.range;
  const resolved = range !== null ? windowForRange(range, new Date()) : null;
  return {
    range,
    from: resolved?.from ?? (params.get("overview_from") ?? defaults.from),
    to: resolved?.to ?? (params.get("overview_to") ?? defaults.to),
    timezone: params.get("overview_timezone") ?? defaults.timezone,
    bucket: oneOf(
      params.get("overview_bucket"),
      DASHBOARD_BUCKETS,
      defaults.bucket,
    ),
    query: params.get("overview_query") ?? "",
    tag: params.get("overview_tag") ?? "",
    sessionId: params.get("overview_session") ?? "",
    release: params.get("overview_release") ?? "",
    environment: params.get("overview_environment") ?? "",
    userId: params.get("overview_user") ?? "",
    scoreIds: list(params.get("overview_scores")).slice(0, 4),
    toolNames: list(params.get("overview_tools")),
  };
}

function readShell(params: URLSearchParams): {
  view: AppView;
  section: EvaluateSection;
} {
  const raw = params.get("view");
  const legacyTab = LEGACY_TABS[params.get("tab") ?? ""];
  const section = oneOf(
    params.get("section"),
    EVALUATE_SECTIONS,
    legacyTab ?? "examples",
  );
  if (raw !== null && APP_VIEWS.includes(raw as AppView)) {
    // 잠시 Evaluate 세그먼트였던 값. 지금은 top-level 화면이다.
    const promoted = LEGACY_SECTION_VIEWS[params.get("section") ?? ""];
    if (raw === "evaluate" && promoted !== undefined) {
      return { view: promoted, section };
    }
    return { view: raw as AppView, section };
  }
  const legacy = raw === null ? undefined : LEGACY_VIEWS[raw];
  if (legacy === undefined) return { view: DEFAULT_VIEW, section };
  return { view: legacy.view, section: legacy.section ?? section };
}

export function readAppUrlState(search = window.location.search): AppUrlState {
  const params = new URLSearchParams(search);
  return {
    ...readShell(params),
    overview: readOverviewUrlState(params),
    evaluation: {
      datasetId: params.get("dataset"),
      experimentIds: list(params.get("experiments")),
      metricKeys: list(params.get("metrics")),
      caseId: params.get("case"),
    },
    traceId: params.get("trace"),
  };
}

export function replaceAppUrlState(state: AppUrlState): void {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  for (const key of [
    "view",
    "section",
    "overview_from",
    "overview_to",
    "overview_range",
    "overview_timezone",
    "overview_bucket",
    "overview_query",
    "overview_tag",
    "overview_session",
    "overview_release",
    "overview_environment",
    "overview_user",
    "overview_scores",
    "overview_tools",
    "dataset",
    "tab",
    "experiments",
    "metrics",
    "case",
    "trace",
  ]) {
    params.delete(key);
  }

  params.set("view", state.view);
  if (state.view === "evaluate" && state.section !== "examples") {
    params.set("section", state.section);
  }
  const overview = state.overview;
  if (overview.range !== null) {
    params.set("overview_range", overview.range);
  } else {
    params.set("overview_from", overview.from);
    params.set("overview_to", overview.to);
  }
  params.set("overview_timezone", overview.timezone);
  if (overview.bucket !== "auto")
    params.set("overview_bucket", overview.bucket);
  if (overview.query) params.set("overview_query", overview.query);
  if (overview.tag) params.set("overview_tag", overview.tag);
  if (overview.sessionId) params.set("overview_session", overview.sessionId);
  if (overview.release) params.set("overview_release", overview.release);
  if (overview.environment)
    params.set("overview_environment", overview.environment);
  if (overview.userId) params.set("overview_user", overview.userId);
  if (overview.scoreIds.length)
    params.set("overview_scores", overview.scoreIds.join(","));
  if (overview.toolNames.length)
    params.set("overview_tools", overview.toolNames.join(","));
  if (state.evaluation.datasetId !== null) {
    params.set("dataset", state.evaluation.datasetId);
  }
  if (state.evaluation.experimentIds.length > 0) {
    params.set("experiments", state.evaluation.experimentIds.join(","));
  }
  if (state.evaluation.metricKeys.length > 0) {
    params.set("metrics", state.evaluation.metricKeys.join(","));
  }
  if (state.evaluation.caseId !== null) {
    params.set("case", state.evaluation.caseId);
  }
  if (state.traceId !== null) {
    params.set("trace", state.traceId);
  }

  window.history.replaceState(window.history.state, "", url);
}

/**
 * 조회 시점에 실제로 쓸 창을 계산한다. `range`가 있으면 매 호출마다 `now` 기준으로
 * 새로 계산해 polling이 fetch할 때마다 최신 구간을 가리키게 한다. `range`가
 * `null`이면 절대 구간이므로 저장된 from/to를 그대로 돌려준다.
 */
export function resolveOverviewWindow(
  state: OverviewUrlState,
  now = new Date(),
): { from: string; to: string } {
  if (state.range === null) return { from: state.from, to: state.to };
  return windowForRange(state.range, now);
}
