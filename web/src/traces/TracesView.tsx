import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";

import {
  addAnnotationQueueItems,
  addTraceToDataset,
  deleteAnnotation,
  deleteTrace,
  getAnnotationQueues,
  getDatasets,
  getObservation,
  getTrace,
  getTraces,
  putAnnotation,
  putTraceMemo,
} from "../api/client";
import type {
  AnnotationValue,
  DatasetSummary,
  Observation,
  ScoreConfig,
  TraceDetail,
  TraceListItem,
  TraceStatus,
} from "../api/types";
import {
  ColumnHeaderCell,
  EmptyBlock,
  ErrorBlock,
  IconArrowLeft,
  IconArrowRight,
  IconChevronDown,
  IconClose,
  IconMore,
  LoadingBlock,
  Modal,
  Pagination,
  SelectColGroup,
  StatusDot,
  deferState,
  formatClockTime,
  formatDateTime,
  formatDuration,
  fromLocalInput,
  sortRows,
  toLocalInput,
  type ReorderableColumnDef,
  useReorderableColumns,
} from "../components";
import { RuntimeGraphView } from "../graph/RuntimeGraphView";
import {
  observationKindBadges,
  runtimeKindLabel,
} from "../graph/runtimeGraph";
import { ObservationPayloadPanel } from "./ObservationPayloadPanel";
import { useLocale, useT, type Translate } from "../i18n/context";
import {previewText} from "../preview";
import { flattenText } from "./retrieval";
import { useSplitLayout } from "./useSplitLayout";

type TraceFilters = {
  query: string;
  status: "" | TraceStatus;
  period: "7d" | "24h" | "30d" | "custom";
  from: string;
  to: string;
  tag: string;
  sessionId: string;
};
type ActionPanel = "menu" | "delete" | null;
type TargetPanel = "queue" | "dataset" | null;

const EMPTY_FILTERS: TraceFilters = {
  query: "",
  status: "",
  period: "7d",
  from: "",
  to: "",
  tag: "",
  sessionId: "",
};

const TRACE_COLUMNS: ReorderableColumnDef[] = [
  { id: "status", label: "Status", width: 144 },
  { id: "started", label: "Started", width: 175 },
  { id: "trace_id", label: "Trace ID", width: 212 },
  { id: "input", label: "Input", width: 275 },
  { id: "output", label: "Output", width: 275 },
  { id: "latency", label: "Latency", width: 152, align: "end" },
  { id: "count", label: "# Observations", width: 208, align: "end" },
];

const TRACE_SORT_VALUES: Record<
  string,
  (trace: TraceListItem) => string | number
> = {
  status: (trace) => trace.status,
  started: (trace) => trace.started_at,
  trace_id: (trace) => trace.trace_id,
  input: (trace) => previewText(trace.input_preview),
  output: (trace) => previewText(trace.output_preview),
  latency: (trace) => trace.duration_us,
  count: (trace) => trace.observation_count,
};

function traceCardPreviewText(raw: string): string {
  return previewText(raw).replace(/^(?:human|ai):\s*/, "");
}

function relativePeriodRange(period: TraceFilters["period"]) {
  const hours = period === "24h" ? 24 : period === "30d" ? 24 * 30 : 24 * 7;
  const to = new Date();
  const from = new Date(to.valueOf() - hours * 60 * 60 * 1_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

const TRACES_PAGE_SIZE = 20;

function queryFor(filters: TraceFilters, page: number) {
  const relativeRange = relativePeriodRange(filters.period);
  return {
    limit: TRACES_PAGE_SIZE,
    page,
    query: filters.query || undefined,
    status: filters.status || undefined,
    from: filters.from || relativeRange.from,
    to: filters.to || relativeRange.to,
    tag: filters.tag || undefined,
    session_id: filters.sessionId || undefined,
  };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function defaultObservation(detail: TraceDetail): string | null {
  const failed = [...detail.observations]
    .sort((left, right) => left.sequence - right.sequence)
    .find((observation) => observation.status === "failed");
  return (
    failed?.observation_id ??
    detail.observations.find(
      (observation) => observation.parent_observation_id === null,
    )?.observation_id ??
    null
  );
}

function scoreValueFor(
  config: ScoreConfig,
  current: AnnotationValue | null | undefined,
  setValue: (value: AnnotationValue | null) => void,
  t: Translate,
) {
  if (config.data_type === "boolean") {
    return (
      <div className="annotation-toggle" role="group" aria-label={config.name}>
        <button
          type="button"
          aria-pressed={current === true}
          onClick={() => setValue(true)}
        >
          {config.boolean_true_label ?? "True"}
        </button>
        <button
          type="button"
          aria-pressed={current === false}
          onClick={() => setValue(false)}
        >
          {config.boolean_false_label ?? "False"}
        </button>
      </div>
    );
  }
  if (config.data_type === "number") {
    return (
      <input
        className="annotation-number"
        aria-label={t("{name} 값", {name: config.name})}
        type="number"
        min={config.number_min ?? undefined}
        max={config.number_max ?? undefined}
        value={typeof current === "number" ? current : ""}
        onChange={(event) =>
          setValue(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
      />
    );
  }
  const selected = Array.isArray(current) ? current : [];
  return (
    <div className="annotation-options" role="group" aria-label={config.name}>
      {config.options
        .filter((option) => option.archived_at === null)
        .map((option) => {
          const isSelected = selected.includes(option.score_option_id);
          return (
            <button
              key={option.score_option_id}
              type="button"
              aria-pressed={isSelected}
              onClick={() =>
                setValue(
                  config.categorical_selection_mode === "multiple"
                    ? isSelected
                      ? selected.filter(
                          (value) => value !== option.score_option_id,
                        )
                      : [...selected, option.score_option_id]
                    : isSelected
                      ? []
                      : [option.score_option_id],
                )
              }
            >
              {option.label}
            </button>
          );
        })}
    </div>
  );
}

export function TracesView({
  selectedTraceId,
  onSelectTrace,
  onClearTrace,
}: {
  selectedTraceId: string | null;
  onSelectTrace: (traceId: string) => void;
  onClearTrace: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const split = useSplitLayout();
  const [draft, setDraft] = useState<TraceFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<TraceFilters>(EMPTY_FILTERS);
  const [traces, setTraces] = useState<TraceListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [listState, setListState] = useState<"loading" | "success" | "error">(
    "loading",
  );
  const [listError, setListError] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const columns = useReorderableColumns(TRACE_COLUMNS);
  const sortedTraces = useMemo(
    () => sortRows(traces, columns.sort, TRACE_SORT_VALUES),
    [traces, columns.sort],
  );
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailState, setDetailState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [payloadState, setPayloadState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [payloadError, setPayloadError] = useState("");
  const [payloadRetry, setPayloadRetry] = useState(0);
  const [downstreamLlmInput, setDownstreamLlmInput] = useState<string | null>(
    null,
  );
  const [action, setAction] = useState<ActionPanel>(null);
  const [targetPanel, setTargetPanel] = useState<TargetPanel>(null);
  const [queues, setQueues] = useState<Array<{ id: string; name: string }>>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  const [targetLoading, setTargetLoading] = useState(false);
  const [mutationStatus, setMutationStatus] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [annotationValues, setAnnotationValues] = useState<
    Record<string, AnnotationValue | null>
  >({});
  const [memo, setMemo] = useState("");
  const [savingAnnotations, setSavingAnnotations] = useState(false);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  // 3분할에서만 쓰는 필터 접기. 좁은 화면은 목록 단이 화면 전체라 늘 펼친다.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // 카드마다 따로 펼친다. 여러 개를 나란히 펴 놓고 비교할 수 있어야 한다.
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  // 좁은 화면은 3분할 대신 단을 하나씩 보여준다. drawer로 덮지 않는다.
  const [stackedPane, setStackedPane] = useState<
    "list" | "graph" | "inspector"
  >("list");
  const [scorePickerOpen, setScorePickerOpen] = useState(false);
  const [pickerScoreIds, setPickerScoreIds] = useState<string[]>([]);
  const [activeScoreIds, setActiveScoreIds] = useState<string[]>([]);
  const triggerRef = useRef<HTMLElement | null>(null);
  const lastTraceIdRef = useRef<string | null>(null);
  const scorePickerRef = useRef<HTMLDivElement | null>(null);
  const closeTargetPanel = useCallback(() => {
    setTargetPanel(null);
    setTargetId("");
    setAction(null);
  }, []);

  const loadLists = useCallback(async () => {
    setTargetLoading(true);
    setMutationError("");
    try {
      const [queueResponse, datasetResponse] = await Promise.all([
        getAnnotationQueues(),
        getDatasets(),
      ]);
      setQueues(
        queueResponse.items.map((queue) => ({
          id: queue.annotation_queue_id,
          name: queue.name,
        })),
      );
      setDatasets(datasetResponse.items);
    } catch {
      setMutationError("추가할 대상을 불러오지 못했습니다.");
    } finally {
      setTargetLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setListState("loading");
      setListError("");
      setSelectedIds([]);
    });
    void getTraces(queryFor(filters, page), controller.signal)
      .then((response) => {
        setTraces(response.items);
        setTotalCount(response.total_count);
        setListState("success");
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setListState("error");
        setListError("Trace 목록을 불러오지 못했습니다.");
        setTraces([]);
      });
    return () => controller.abort();
  }, [filters, page, listRetry]);

  useEffect(() => {
    if (selectedTraceId === null) {
      deferState(() => {
        setDetail(null);
        setDetailState("idle");
        setObservation(null);
        setObservationId(null);
      });
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setDetailState("loading");
      setDetailError("");
      setDetail(null);
      setObservation(null);
    });
    void getTrace(selectedTraceId, controller.signal)
      .then((response) => {
        setDetail(response);
        setDetailState("success");
        setObservationId(defaultObservation(response));
        setMemo(response.memo?.content ?? "");
        setAnnotationValues(
          Object.fromEntries(
            response.annotations.map((annotation) => [
              annotation.score_config_id,
              annotation.value,
            ]),
          ),
        );
        setActiveScoreIds(
          response.annotations.map((annotation) => annotation.score_config_id),
        );
        setPickerScoreIds([]);
        setScorePickerOpen(false);
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setDetailState("error");
        setDetailError("Trace 상세를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [selectedTraceId, detailRetry]);

  useEffect(() => {
    if (!observationId) {
      deferState(() => {
        setObservation(null);
        setPayloadState("idle");
      });
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setPayloadState("loading");
      setPayloadError("");
    });
    void getObservation(observationId, controller.signal)
      .then((response) => {
        setObservation(response);
        setPayloadState("success");
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setPayloadState("error");
        setPayloadError("선택한 observation payload를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [observationId, payloadRetry]);

  // retriever 문서가 답변에 실렸는지 대조하려면 하류 llm의 input이 필요하다.
  // 그 observation은 선택되지 않았으므로 payload가 없다. retriever를 볼 때만
  // 한 건 더 가져온다. 실패하면 null로 두고 배지를 붙이지 않는다.
  useEffect(() => {
    const target =
      observation?.kind === "retriever" && detail !== null
        ? detail.observations
            .filter(
              (item) =>
                item.kind === "llm" && item.sequence > observation.sequence,
            )
            .sort((left, right) => left.sequence - right.sequence)[0]
        : undefined;
    if (target === undefined) {
      deferState(() => setDownstreamLlmInput(null));
      return;
    }
    const controller = new AbortController();
    void getObservation(target.observation_id, controller.signal)
      .then((response) => setDownstreamLlmInput(flattenText(response.input)))
      .catch(() => setDownstreamLlmInput(null));
    return () => controller.abort();
  }, [observation, detail]);

  useEffect(() => {
    if (selectedTraceId !== null) {
      lastTraceIdRef.current = selectedTraceId;
      return;
    }
    const fallback = Array.from(
      document.querySelectorAll<HTMLElement>("[data-trace-id]"),
    ).find((row) => row.dataset.traceId === lastTraceIdRef.current);
    const trigger = triggerRef.current ?? fallback;
    trigger?.focus();
  }, [selectedTraceId, traces]);

  useEffect(() => {
    if (!selectedTraceId) return;
    const move = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.matches("input, textarea, select, [contenteditable=true]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "j" || event.key === "J") {
        if (detail?.next_trace_id) onSelectTrace(detail.next_trace_id);
      }
      if (event.key === "k" || event.key === "K") {
        if (detail?.previous_trace_id) onSelectTrace(detail.previous_trace_id);
      }
    };
    document.addEventListener("keydown", move);
    return () => document.removeEventListener("keydown", move);
  }, [detail, onSelectTrace, selectedTraceId]);

  useEffect(() => {
    if (!selectedTraceId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || bulkDelete) return;
      if (targetPanel) {
        closeTargetPanel();
        return;
      }
      if (scorePickerOpen) {
        setScorePickerOpen(false);
        return;
      }
      if (action) {
        setAction(null);
        return;
      }
      onClearTrace();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [
    action,
    bulkDelete,
    closeTargetPanel,
    onClearTrace,
    scorePickerOpen,
    selectedTraceId,
    targetPanel,
  ]);

  // 비어 있는 단을 보여주지 않는다. 좁은 화면도 목록 단에 머무르므로 자동 선택이
  // 목록을 가리지 않는다. 닫기 버튼이 없어 이 effect가 되돌이표가 되지 않는다.
  useEffect(() => {
    if (selectedTraceId !== null) return;
    if (listState !== "success") return;
    const first = sortedTraces[0];
    if (first === undefined) return;
    onSelectTrace(first.trace_id);
  }, [selectedTraceId, listState, sortedTraces, onSelectTrace]);

  useEffect(() => {
    if (!scorePickerOpen) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (scorePickerRef.current?.contains(target as Node)) return;
      if (
        target instanceof Element &&
        target.closest('[aria-controls="scorePicker"]')
      )
        return;
      setScorePickerOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [scorePickerOpen]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draft);
    setPage(1);
  };
  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const totalPages = Math.max(1, Math.ceil(totalCount / TRACES_PAGE_SIZE));
  const toggleAll = (checked: boolean) =>
    setSelectedIds(checked ? traces.map((trace) => trace.trace_id) : []);
  const openTrace = (trace: TraceListItem, row: HTMLElement) => {
    triggerRef.current = row;
    lastTraceIdRef.current = trace.trace_id;
    onSelectTrace(trace.trace_id);
  };
  const openTargets = async (panel: TargetPanel) => {
    setTargetPanel(panel);
    setTargetId("");
    setAction(null);
    await loadLists();
  };
  const addToTarget = async () => {
    const ids =
      targetPanel && selectedTraceId
        ? targetPanel === "queue"
          ? [selectedTraceId]
          : [selectedTraceId]
        : [];
    const traceIds = ids.length ? ids : selectedIds;
    if (!targetPanel || !targetId || traceIds.length === 0) return;
    setTargetLoading(true);
    setMutationError("");
    try {
      if (targetPanel === "queue")
        await addAnnotationQueueItems(targetId, traceIds);
      else
        await Promise.all(
          traceIds.map((traceId) => addTraceToDataset(targetId, traceId)),
        );
      setMutationStatus(
        t(
          targetPanel === "queue"
            ? "{n}개 trace를 queue에 추가했습니다."
            : "{n}개 trace를 dataset에 추가했습니다.",
          {n: traceIds.length},
        ),
      );
      closeTargetPanel();
    } catch {
      setMutationError("추가 요청을 완료하지 못했습니다.");
    } finally {
      setTargetLoading(false);
    }
  };
  const deleteSelectedTrace = async () => {
    if (!selectedTraceId) return;
    setTargetLoading(true);
    setMutationError("");
    try {
      await deleteTrace(selectedTraceId);
      setTraces((items) =>
        items.filter((trace) => trace.trace_id !== selectedTraceId),
      );
      setAction(null);
      onClearTrace();
    } catch {
      setMutationError("Trace를 삭제하지 못했습니다.");
    } finally {
      setTargetLoading(false);
    }
  };
  const deleteBulk = async () => {
    setBulkPending(true);
    setMutationError("");
    try {
      await Promise.all(selectedIds.map((traceId) => deleteTrace(traceId)));
      setTraces((items) =>
        items.filter((trace) => !selectedIds.includes(trace.trace_id)),
      );
      setSelectedIds([]);
      setBulkDelete(false);
    } catch {
      setMutationError("선택한 Trace를 모두 삭제하지 못했습니다.");
    } finally {
      setBulkPending(false);
    }
  };
  const saveAnnotations = async () => {
    if (!selectedTraceId || !detail) return;
    setSavingAnnotations(true);
    setMutationError("");
    try {
      const existing = new Set(
        detail.annotations.map((annotation) => annotation.score_config_id),
      );
      const annotationMutations = detail.score_configs.map(async (config) => {
        const value = annotationValues[config.score_config_id];
        if (
          !activeScoreIds.includes(config.score_config_id) ||
          value === null ||
          (Array.isArray(value) && value.length === 0)
        ) {
          return existing.has(config.score_config_id)
            ? deleteAnnotation(selectedTraceId, config.score_config_id)
            : undefined;
        }
        if (value === undefined) return undefined;
        return putAnnotation(selectedTraceId, config.score_config_id, value);
      });
      await Promise.all([
        ...annotationMutations,
        putTraceMemo(selectedTraceId, memo),
      ]);
      setMutationStatus("Annotations와 메모를 저장했습니다.");
      setDetailRetry((value) => value + 1);
    } catch {
      setMutationError("Annotations를 저장하지 못했습니다.");
    } finally {
      setSavingAnnotations(false);
    }
  };
  const currentTrace = traces.find(
    (trace) => trace.trace_id === selectedTraceId,
  );
  const selectedAll =
    traces.length > 0 &&
    traces.every((trace) => selectedIds.includes(trace.trace_id));

  return (
    <main
      className={`page traces-page${split ? " is-split" : " is-stacked"}${
        split && listCollapsed ? " is-list-collapsed" : ""
      }`}
      data-pane={split ? undefined : stackedPane}
      id="lf-main"
      tabIndex={-1}
    >
      {!split ? (
        <nav className="pane-switch" aria-label={t("단 전환")}>
          {(
            [
              ["list", t("목록")],
              ["graph", t("실행 흐름")],
              ["inspector", t("검사기")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={stackedPane === id}
              disabled={id !== "list" && selectedTraceId === null}
              onClick={() => setStackedPane(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="traces-pane-list">
      <header className="page-head traces-head">
        <h1>Traces</h1>
        <div className="list-actions">
          <span className="result">
            {listState === "success" ? t("{n}건", {n: totalCount}) : ""}
          </span>
          {/* 목록 단을 접는다. 경계에 걸친 22px 조각은 무엇을 접는지 알 수
              없었고 bulk action과 겹쳤다. 라벨을 달아 헤더 안에 둔다. */}
          {split ? (
            <button
              className="list-collapse lf-btn"
              type="button"
              aria-expanded={!listCollapsed}
              aria-label={listCollapsed ? t("목록 펼치기") : t("목록 접기")}
              onClick={() => setListCollapsed((value) => !value)}
            >
              <span aria-hidden="true">{listCollapsed ? "›" : "‹"}</span>
              <span className="list-collapse-label" aria-hidden="true">
                {listCollapsed ? t("목록 펼치기") : t("목록 접기")}
              </span>
            </button>
          ) : null}
        </div>
      </header>
      <form
        // 3분할의 목록 단은 280–360px이다. 기획서 스케치가 그 자리에 입력
        // 하나만 그린 이유이며, 5개 field를 세로로 쌓으면 목록이 화면 밖으로
        // 밀린다. 접어도 값은 그대로 제출된다.
        className={`filter-panel${split && !filtersOpen ? " is-collapsed" : ""}`}
        onSubmit={applyFilters}
        onReset={resetFilters}
      >
        <label className="field">
          <span>{t("검색")}</span>
          <input
            type="search"
            value={draft.query}
            placeholder={t("Trace ID 또는 input 검색")}
            onChange={(event) =>
              setDraft({ ...draft, query: event.target.value })
            }
          />
        </label>
        <label className="field">
          <span>{t("상태")}</span>
          <select
            value={draft.status}
            onChange={(event) =>
              setDraft({
                ...draft,
                status: event.target.value as TraceFilters["status"],
              })
            }
          >
            <option value="">{t("전체")}</option>
            <option value="completed">{t("성공")}</option>
            <option value="failed">{t("실패")}</option>
            <option value="cancelled">{t("취소")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("기간")}</span>
          <select
            value={draft.period}
            onChange={(event) => {
              const period = event.target.value as TraceFilters["period"];
              if (period === "custom") {
                const range = relativePeriodRange(
                  draft.period === "custom" ? "7d" : draft.period,
                );
                setDraft({
                  ...draft,
                  period,
                  from: draft.from || range.from,
                  to: draft.to || range.to,
                });
              } else {
                setDraft({ ...draft, period, from: "", to: "" });
              }
            }}
          >
            <option value="7d">{t("최근 7일")}</option>
            <option value="24h">{t("24시간")}</option>
            <option value="30d">{t("30일")}</option>
            <option value="custom">{t("커스텀")}</option>
          </select>
        </label>
        {draft.period === "custom" ? (
          <>
            <label className="field">
              <span>{t("시작")}</span>
              <input
                type="datetime-local"
                value={toLocalInput(draft.from)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    from: fromLocalInput(event.target.value) ?? draft.from,
                  })
                }
              />
            </label>
            <label className="field">
              <span>{t("종료")}</span>
              <input
                type="datetime-local"
                value={toLocalInput(draft.to)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    to: fromLocalInput(event.target.value) ?? draft.to,
                  })
                }
              />
            </label>
          </>
        ) : null}
        <label className="field">
          <span>{t("태그")}</span>
          <input
            value={draft.tag}
            placeholder={t("태그")}
            onChange={(event) =>
              setDraft({ ...draft, tag: event.target.value })
            }
          />
        </label>
        <div className="filter-actions">
          <button
            className="lf-btn"
            type="button"
            aria-label={t("Trace 목록 새로고침")}
            disabled={listState === "loading"}
            onClick={() => setListRetry((value) => value + 1)}
          >
            {t("새로고침")}
          </button>
          {split ? (
            <button
              className="lf-btn filter-toggle"
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? t("필터 접기") : t("필터")}
            </button>
          ) : null}
          <button className="lf-btn is-primary" type="submit">
            {t("적용")}
          </button>
          <button className="lf-btn" type="reset">
            {t("초기화")}
          </button>
        </div>
      </form>
      {mutationError ? (
        <p className="mutation-status is-error" role="alert">
          {t(mutationError)}
        </p>
      ) : mutationStatus ? (
        <p className="mutation-status" role="status">
          {t(mutationStatus)}
        </p>
      ) : null}
      <section className="trace-list" aria-label={t("Trace 목록")}>
        {listState === "loading" ? (
          <LoadingBlock label={t("Trace 목록을 불러오는 중…")} />
        ) : listState === "error" ? (
          <ErrorBlock
            message={t(listError)}
            onRetry={() => setListRetry((value) => value + 1)}
          />
        ) : traces.length === 0 ? (
          <EmptyBlock>{t("조건에 맞는 Trace가 없습니다.")}</EmptyBlock>
        ) : (
          <>
            {/*
              기획서 05절 스케치의 왼쪽 단은 카드 목록이다. 3분할에서 목록은
              280–360px으로 묶여 있어 7열 표가 들어갈 자리가 없다. 좁은 화면은
              목록 단이 화면 전체를 쓰므로 표를 그대로 둔다 — 열 순서·폭·정렬은
              acceptance 계약이고 그 폭에서만 실제로 쓸 수 있다.
            */}
            {/*
              선택 바. bulk action은 page header에 있었는데 목록 단이 340px라
              버튼 라벨이 세로로 쪼개지고 옆 pane에 가렸다. 선택은 목록에
              대한 일이므로 목록 안, 카드 바로 위에 둔다.
            */}
            <div className="list-select">
              {split ? (
                <label className="list-select-all">
                  <input
                    type="checkbox"
                    aria-label={t("모든 trace 선택")}
                    checked={selectedAll}
                    onChange={(event) => toggleAll(event.target.checked)}
                  />
                  <span>{t("전체 선택")}</span>
                </label>
              ) : null}
              {selectedIds.length ? (
                <>
                  <span className="list-select-count">
                    {t("{n}개 선택", {n: selectedIds.length})}
                  </span>
                  <div className="bulk-actions">
                    <button
                      className="lf-btn"
                      type="button"
                      onClick={() => void openTargets("queue")}
                    >
                      {t("Queue에 추가")}
                    </button>
                    <button
                      className="lf-btn"
                      type="button"
                      onClick={() => void openTargets("dataset")}
                    >
                      {t("Dataset에 추가")}
                    </button>
                    <button
                      className="lf-btn is-danger"
                      type="button"
                      onClick={() => setBulkDelete(true)}
                    >
                      {t("삭제")}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            {split ? (
              <>
                <ol className="trace-cards">
                  {sortedTraces.map((trace) => (
                    <li key={trace.trace_id}>
                      <div
                        className={`trace-card${selectedTraceId === trace.trace_id ? " is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        data-trace-id={trace.trace_id}
                        aria-pressed={selectedTraceId === trace.trace_id}
                        onClick={(event) => {
                          // checkbox와 펼치기 버튼은 카드 선택이 아니다.
                          if (
                            (event.target as HTMLElement).closest(
                              "input, button",
                            )
                          )
                            return;
                          openTrace(trace, event.currentTarget);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openTrace(trace, event.currentTarget);
                          }
                        }}
                      >
                        {/* 왼쪽 선택 · 가운데 정보 · 오른쪽 펼치기. 세 몫이
                            각자 열을 가져야 이름과 메타가 같은 선에서 시작한다. */}
                        <input
                          className="trace-card-check"
                          type="checkbox"
                          aria-label={t("{id} 선택", {id: trace.trace_id})}
                          checked={selectedIds.includes(trace.trace_id)}
                          onChange={(event) =>
                            setSelectedIds((ids) =>
                              event.target.checked
                                ? [...ids, trace.trace_id]
                                : ids.filter((id) => id !== trace.trace_id),
                            )
                          }
                        />
                        <div className="trace-card-main">
                          <div className="trace-card-title">
                            <StatusDot status={trace.status} />
                            <strong>{trace.name}</strong>
                          </div>
                          <p className="trace-card-meta">
                            {formatClockTime(trace.started_at)}
                            {" · "}
                            {formatDuration(trace.duration_us)}
                            {" · "}
                            {t("{n} obs", {n: trace.observation_count})}
                          </p>
                          {trace.total_tokens !== null ||
                          trace.time_to_first_token_us !== null ? (
                            <p className="trace-card-usage">
                              {trace.total_tokens !== null ? (
                                <span>
                                  Tokens{" "}
                                  {new Intl.NumberFormat(locale).format(
                                    trace.total_tokens,
                                  )}
                                </span>
                              ) : null}
                              {trace.time_to_first_token_us !== null ? (
                                <span>
                                  First token{" "}
                                  {formatDuration(
                                    trace.time_to_first_token_us,
                                  )}
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                        <button
                          className="trace-card-toggle"
                          type="button"
                          aria-expanded={expandedIds.includes(trace.trace_id)}
                          aria-label={t("{id} 미리보기", {
                            id: trace.trace_id,
                          })}
                          onClick={() =>
                            setExpandedIds((ids) =>
                              ids.includes(trace.trace_id)
                                ? ids.filter((id) => id !== trace.trace_id)
                                : [...ids, trace.trace_id],
                            )
                          }
                        >
                          <IconChevronDown />
                        </button>
                        {expandedIds.includes(trace.trace_id) ? (
                          // 목록에서 바로 읽는 요약. 오른쪽 상세를 열지 않고도
                          // 질문과 답변의 앞부분을 빠르게 확인한다.
                          <dl className="trace-card-preview">
                            <dt>input</dt>
                            <dd>{traceCardPreviewText(trace.input_preview)}</dd>
                            <dt>output</dt>
                            <dd>{traceCardPreviewText(trace.output_preview)}</dd>
                          </dl>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
            <table>
              <SelectColGroup columns={columns} />
              <thead>
                <tr>
                  <th className="select-col">
                    <input
                      type="checkbox"
                      aria-label={t("모든 trace 선택")}
                      checked={selectedAll}
                      onChange={(event) => toggleAll(event.target.checked)}
                    />
                  </th>
                  {columns.order.map((id) => {
                    const def = TRACE_COLUMNS.find((c) => c.id === id)!;
                    return (
                      <ColumnHeaderCell
                        key={id}
                        id={id}
                        label={t(def.label)}
                        align={def.align}
                        columns={columns}
                      />
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedTraces.map((trace) => {
                  const cell: Record<string, ReactNode> = {
                    status: <StatusDot status={trace.status} />,
                    started: formatClockTime(trace.started_at),
                    trace_id: trace.trace_id,
                    input: previewText(trace.input_preview),
                    output: previewText(trace.output_preview),
                    latency: formatDuration(trace.duration_us),
                    count: trace.observation_count,
                  };
                  const cellClass: Record<string, string> = {
                    started: "relative",
                    trace_id: "trace-id mono",
                    input: "payload",
                    output: "payload",
                    latency: "mono is-end",
                    count: "mono is-end",
                  };
                  return (
                    <tr
                      className={`trace-row${selectedTraceId === trace.trace_id ? " is-selected" : ""}`}
                      tabIndex={0}
                      key={trace.trace_id}
                      data-trace-id={trace.trace_id}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("input"))
                          return;
                        openTrace(trace, event.currentTarget);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTrace(trace, event.currentTarget);
                          if (!split) setStackedPane("graph");
                        }
                      }}
                    >
                      <td className="select-col">
                        <input
                          type="checkbox"
                          aria-label={t("{id} 선택", {id: trace.trace_id})}
                          checked={selectedIds.includes(trace.trace_id)}
                          onChange={(event) =>
                            setSelectedIds((ids) =>
                              event.target.checked
                                ? [...ids, trace.trace_id]
                                : ids.filter((id) => id !== trace.trace_id),
                            )
                          }
                        />
                      </td>
                      {columns.order.map((id) => (
                        <td key={id} className={cellClass[id]}>
                          {cell[id]}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
            {totalCount > 0 ? (
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            ) : null}
          </>
        )}
      </section>
      </div>
      <div
        className={`trace-scrim${selectedTraceId ? " is-open" : ""}`}
        onClick={onClearTrace}
      />
      <aside
        className="trace-drawer is-open"
        // 넓은 화면은 3분할, 좁은 화면은 단 전환이다. 어느 쪽도 목록을 덮지
        // 않으므로 dialog가 아니다.
        role="complementary"
        aria-label={t("Trace 상세")}
      >
        <DrawerContent
          detail={detail}
          detailState={detailState}
          detailError={detailError}
          detailRetry={() => setDetailRetry((value) => value + 1)}
          selectedTraceId={selectedTraceId}
          currentTrace={currentTrace ?? null}
          observationId={observationId}
          setObservationId={setObservationId}
          observation={observation}
          payloadState={payloadState}
          payloadError={payloadError}
          downstreamLlmInput={downstreamLlmInput}
          retryPayload={() => setPayloadRetry((value) => value + 1)}
          memo={memo}
          setMemo={setMemo}
          annotationValues={annotationValues}
          setAnnotationValues={setAnnotationValues}
          activeScoreIds={activeScoreIds}
          scorePickerOpen={scorePickerOpen}
          pickerScoreIds={pickerScoreIds}
          scorePickerRef={scorePickerRef}
          onToggleScorePicker={() => setScorePickerOpen((open) => !open)}
          onTogglePickerScore={(id, checked) =>
            setPickerScoreIds((ids) =>
              checked ? [...ids, id] : ids.filter((value) => value !== id),
            )
          }
          onAddPickerScores={() => {
            setActiveScoreIds((ids) => [
              ...new Set([...ids, ...pickerScoreIds]),
            ]);
            setPickerScoreIds([]);
            setScorePickerOpen(false);
          }}
          onRemoveScore={(id) => {
            setActiveScoreIds((ids) => ids.filter((value) => value !== id));
            setAnnotationValues((values) => ({ ...values, [id]: null }));
          }}
          saving={savingAnnotations}
          onSave={() => void saveAnnotations()}
          action={action}
          setAction={setAction}
          onClose={onClearTrace}
          onNavigate={onSelectTrace}
          onTargets={(panel) => void openTargets(panel)}
          onDelete={() => void deleteSelectedTrace()}
          showGraph={split || stackedPane === "graph"}
          asPane
        />
      </aside>
      <Modal
        open={targetPanel !== null}
        title={targetPanel === "queue" ? "Add to queue" : "Add to dataset"}
        onClose={closeTargetPanel}
      >
        <div className="lf-modal-body">
          {targetLoading ? (
            <LoadingBlock />
          ) : mutationError ? (
            <ErrorBlock message={t(mutationError)} />
          ) : (
            <>
              <p className="modal-copy">
                {t("선택한 Trace를 추가할 대상을 고르세요.")}
              </p>
              <label className="modal-field">
                {t("대상")}
                <select
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                >
                  <option value="">{t("선택")}</option>
                  {targetPanel === "queue"
                    ? queues.map((queue) => (
                        <option key={queue.id} value={queue.id}>
                          {queue.name}
                        </option>
                      ))
                    : datasets.map((dataset) => (
                        <option
                          key={dataset.dataset_id}
                          value={dataset.dataset_id}
                        >
                          {dataset.name}
                        </option>
                      ))}
                </select>
              </label>
            </>
          )}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              onClick={closeTargetPanel}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-primary"
              type="button"
              disabled={!targetId || targetLoading}
              onClick={() => void addToTarget()}
            >
              {t("추가")}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={bulkDelete}
        title={t("선택한 trace를 삭제할까요?")}
        onClose={() => {
          if (!bulkPending) setBulkDelete(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t("{n}개 trace와 연결된 observations, annotations도 삭제됩니다.", {
              n: selectedIds.length,
            })}
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={bulkPending}
              onClick={() => setBulkDelete(false)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={bulkPending}
              onClick={() => void deleteBulk()}
            >
              {bulkPending ? t("삭제 중…") : t("삭제")}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}

export function OverviewTraceDrawer({
  selectedTraceId,
  onClose,
}: {
  selectedTraceId: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [detailState, setDetailState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [observationId, setObservationId] = useState<string | null>(null);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [payloadState, setPayloadState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [payloadError, setPayloadError] = useState("");
  const [payloadRetry, setPayloadRetry] = useState(0);
  const [downstreamLlmInput, setDownstreamLlmInput] = useState<string | null>(
    null,
  );
  const [drawerWidth, setDrawerWidth] = useState(950);
  const [annotationValues, setAnnotationValues] = useState<
    Record<string, AnnotationValue | null>
  >({});
  const [memo, setMemo] = useState("");
  const [activeScoreIds, setActiveScoreIds] = useState<string[]>([]);
  const [scorePickerOpen, setScorePickerOpen] = useState(false);
  const [pickerScoreIds, setPickerScoreIds] = useState<string[]>([]);
  const [action, setAction] = useState<ActionPanel>(null);
  const [savingAnnotations, setSavingAnnotations] = useState(false);
  const [annotationError, setAnnotationError] = useState("");
  const scorePickerRef = useRef<HTMLDivElement | null>(null);
  const drawerResize = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    if (selectedTraceId === null) {
      deferState(() => {
        setDetail(null);
        setDetailState("idle");
        setObservation(null);
        setObservationId(null);
      });
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setDetailState("loading");
      setDetailError("");
      setDetail(null);
      setObservation(null);
    });
    void getTrace(selectedTraceId, controller.signal)
      .then((response) => {
        setDetail(response);
        setDetailState("success");
        setObservationId(defaultObservation(response));
        setMemo(response.memo?.content ?? "");
        setAnnotationValues(
          Object.fromEntries(
            response.annotations.map((annotation) => [
              annotation.score_config_id,
              annotation.value,
            ]),
          ),
        );
        setActiveScoreIds(
          response.annotations.map((annotation) => annotation.score_config_id),
        );
        setPickerScoreIds([]);
        setScorePickerOpen(false);
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setDetailState("error");
        setDetailError("Trace 상세를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [detailRetry, selectedTraceId]);

  const saveAnnotations = async () => {
    if (!selectedTraceId || !detail) return;
    setSavingAnnotations(true);
    setAnnotationError("");
    try {
      const existing = new Set(
        detail.annotations.map((annotation) => annotation.score_config_id),
      );
      const annotationMutations = detail.score_configs.map(async (config) => {
        const value = annotationValues[config.score_config_id];
        if (
          !activeScoreIds.includes(config.score_config_id) ||
          value === null ||
          (Array.isArray(value) && value.length === 0)
        ) {
          return existing.has(config.score_config_id)
            ? deleteAnnotation(selectedTraceId, config.score_config_id)
            : undefined;
        }
        if (value === undefined) return undefined;
        return putAnnotation(selectedTraceId, config.score_config_id, value);
      });
      await Promise.all([
        ...annotationMutations,
        putTraceMemo(selectedTraceId, memo),
      ]);
      setDetailRetry((value) => value + 1);
    } catch {
      setAnnotationError("Annotations를 저장하지 못했습니다.");
    } finally {
      setSavingAnnotations(false);
    }
  };

  useEffect(() => {
    if (!observationId) {
      deferState(() => {
        setObservation(null);
        setPayloadState("idle");
      });
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setPayloadState("loading");
      setPayloadError("");
    });
    void getObservation(observationId, controller.signal)
      .then((response) => {
        setObservation(response);
        setPayloadState("success");
      })
      .catch((error: unknown) => {
        if (isAbort(error)) return;
        setPayloadState("error");
        setPayloadError("선택한 observation payload를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [observationId, payloadRetry]);

  // retriever 문서가 답변에 실렸는지 대조하려면 하류 llm의 input이 필요하다.
  // 그 observation은 선택되지 않았으므로 payload가 없다. retriever를 볼 때만
  // 한 건 더 가져온다. 실패하면 null로 두고 배지를 붙이지 않는다.
  useEffect(() => {
    const target =
      observation?.kind === "retriever" && detail !== null
        ? detail.observations
            .filter(
              (item) =>
                item.kind === "llm" && item.sequence > observation.sequence,
            )
            .sort((left, right) => left.sequence - right.sequence)[0]
        : undefined;
    if (target === undefined) {
      deferState(() => setDownstreamLlmInput(null));
      return;
    }
    const controller = new AbortController();
    void getObservation(target.observation_id, controller.signal)
      .then((response) => setDownstreamLlmInput(flattenText(response.input)))
      .catch(() => setDownstreamLlmInput(null));
    return () => controller.abort();
  }, [observation, detail]);

  useEffect(() => {
    if (!selectedTraceId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, selectedTraceId]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = drawerResize.current;
      if (!current) return;
      setDrawerWidth(
        Math.max(
          525,
          Math.min(1625, current.startWidth + current.startX - event.clientX),
        ),
      );
    };
    const end = () => {
      drawerResize.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, []);

  return (
    <>
      <div
        className={`trace-scrim${selectedTraceId ? " is-open" : ""}`}
        onClick={onClose}
      />
      <aside
        className={`trace-drawer${selectedTraceId ? " is-open" : ""}`}
        style={{ "--drawer-width": `${drawerWidth}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawerTitle"
        aria-hidden={selectedTraceId === null}
      >
        <DrawerContent
          detail={detail}
          detailState={detailState}
          detailError={detailError}
          detailRetry={() => setDetailRetry((value) => value + 1)}
          selectedTraceId={selectedTraceId}
          currentTrace={null}
          observationId={observationId}
          setObservationId={setObservationId}
          observation={observation}
          payloadState={payloadState}
          payloadError={payloadError}
          downstreamLlmInput={downstreamLlmInput}
          retryPayload={() => setPayloadRetry((value) => value + 1)}
          memo={memo}
          setMemo={setMemo}
          annotationValues={annotationValues}
          setAnnotationValues={setAnnotationValues}
          activeScoreIds={activeScoreIds}
          scorePickerOpen={scorePickerOpen}
          pickerScoreIds={pickerScoreIds}
          scorePickerRef={scorePickerRef}
          onToggleScorePicker={() => setScorePickerOpen((open) => !open)}
          onTogglePickerScore={(id, checked) =>
            setPickerScoreIds((ids) =>
              checked ? [...ids, id] : ids.filter((value) => value !== id),
            )
          }
          onAddPickerScores={() => {
            setActiveScoreIds((ids) => [
              ...new Set([...ids, ...pickerScoreIds]),
            ]);
            setPickerScoreIds([]);
            setScorePickerOpen(false);
          }}
          onRemoveScore={(id) =>
            setActiveScoreIds((ids) => ids.filter((value) => value !== id))
          }
          onResizeStart={(event) => {
            drawerResize.current = {
              startX: event.clientX,
              startWidth: drawerWidth,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          saving={savingAnnotations}
          saveError={annotationError}
          onSave={() => void saveAnnotations()}
          action={action}
          setAction={setAction}
          onClose={onClose}
          onNavigate={() => undefined}
          onTargets={() => undefined}
          onDelete={() => undefined}
          readOnly
        />
      </aside>
    </>
  );
}

function DrawerContent({
  detail,
  detailState,
  detailError,
  detailRetry,
  selectedTraceId,
  currentTrace,
  observationId,
  setObservationId,
  observation,
  payloadState,
  payloadError,
  retryPayload,
  memo,
  setMemo,
  annotationValues,
  setAnnotationValues,
  activeScoreIds,
  scorePickerOpen,
  pickerScoreIds,
  scorePickerRef,
  onToggleScorePicker,
  onTogglePickerScore,
  onAddPickerScores,
  onRemoveScore,
  onResizeStart,
  saving,
  saveError,
  onSave,
  action,
  setAction,
  onClose,
  onNavigate,
  onTargets,
  onDelete,
  showGraph = true,
  readOnly = false,
  asPane = false,
  downstreamLlmInput = null,
}: {
  detail: TraceDetail | null;
  detailState: "idle" | "loading" | "success" | "error";
  detailError: string;
  detailRetry: () => void;
  selectedTraceId: string | null;
  currentTrace: TraceListItem | null;
  observationId: string | null;
  setObservationId: (id: string | null) => void;
  observation: Observation | null;
  payloadState: "idle" | "loading" | "success" | "error";
  payloadError: string;
  retryPayload: () => void;
  memo: string;
  setMemo: (value: string) => void;
  annotationValues: Record<string, AnnotationValue | null>;
  setAnnotationValues: Dispatch<
    SetStateAction<Record<string, AnnotationValue | null>>
  >;
  activeScoreIds: string[];
  scorePickerOpen: boolean;
  pickerScoreIds: string[];
  scorePickerRef: RefObject<HTMLDivElement | null>;
  onToggleScorePicker: () => void;
  onTogglePickerScore: (id: string, checked: boolean) => void;
  onAddPickerScores: () => void;
  onRemoveScore: (id: string) => void;
  /** 넘기지 않으면 폭 조절 handle을 그리지 않는다. 단(pane)에는 조절할 폭이 없다. */
  onResizeStart?: (event: ReactPointerEvent<HTMLSpanElement>) => void;
  saving: boolean;
  saveError?: string;
  onSave: () => void;
  action: ActionPanel;
  setAction: (action: ActionPanel) => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onTargets: (panel: TargetPanel) => void;
  onDelete: () => void;
  showGraph?: boolean;
  readOnly?: boolean;
  /** 목록을 덮지 않는 단이면 true. 닫을 것이 없으므로 닫기 버튼을 두지 않는다. */
  asPane?: boolean;
  /** retriever 문서의 "사용됨" 대조에만 쓴다. null이면 대조하지 않는다. */
  downstreamLlmInput?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  if (!selectedTraceId) return null;
  const traceTitle = detail?.name ?? currentTrace?.name ?? "Trace detail";
  const displayedScores =
    detail?.score_configs.filter((config) =>
      activeScoreIds.includes(config.score_config_id),
    ) ?? [];
  return (
    <>
      {onResizeStart ? (
        <span
          className="drawer-resize"
          onPointerDown={onResizeStart}
          aria-hidden="true"
        />
      ) : null}
      <header className="drawer-head">
        <div className="drawer-title">
          <h2 id="drawerTitle">{traceTitle}</h2>
          <p>{selectedTraceId}</p>
        </div>
        <div className="drawer-actions">
          {!readOnly ? <div className="session-nav">
            <button
              className="lf-icon-btn"
              type="button"
              aria-label={t("이전 요청")}
              disabled={!detail?.previous_trace_id}
              onClick={() =>
                detail?.previous_trace_id &&
                onNavigate(detail.previous_trace_id)
              }
            >
              <IconArrowLeft />
            </button>
            <span className="session-position">
              {detail?.session_position && detail.session_total
                ? `${detail.session_position} / ${detail.session_total}`
                : "1 / 1"}
            </span>
            <button
              className="lf-icon-btn"
              type="button"
              aria-label={t("다음 요청")}
              disabled={!detail?.next_trace_id}
              onClick={() =>
                detail?.next_trace_id && onNavigate(detail.next_trace_id)
              }
            >
              <IconArrowRight />
            </button>
          </div> : null}
          {!readOnly ? (
            <button
              className="lf-icon-btn"
              type="button"
              aria-label={t("Trace 작업")}
              aria-expanded={action !== null}
              onClick={() => setAction(action === "menu" ? null : "menu")}
            >
              <IconMore />
            </button>
          ) : null}
          {!asPane ? (
            <button
              className="lf-icon-btn"
              type="button"
              aria-label={t("상세 닫기")}
              onClick={onClose}
            >
              <IconClose />
            </button>
          ) : null}
          {!readOnly && action === "menu" ? (
            <div className="action-menu">
              <button type="button" onClick={() => onTargets("queue")}>
                Add to queue
              </button>
              <button type="button" onClick={() => onTargets("dataset")}>
                Add to dataset
              </button>
              <button
                className="is-danger"
                type="button"
                onClick={() => setAction("delete")}
              >
                Delete trace
              </button>
            </div>
          ) : null}
          {!readOnly && action === "delete" ? (
            <div className="confirm-popover">
              <p>{t("이 trace와 연결된 observations, annotations를 삭제합니다.")}</p>
              <div className="popover-actions">
                <button
                  className="lf-btn"
                  type="button"
                  onClick={() => setAction(null)}
                >
                  {t("취소")}
                </button>
                <button
                  className="lf-btn is-danger"
                  type="button"
                  onClick={onDelete}
                >
                  {t("삭제")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </header>
      <div className="drawer-body">
        {detailState === "loading" ? (
          <LoadingBlock label={t("Trace 상세를 불러오는 중…")} />
        ) : detailState === "error" ? (
          <ErrorBlock message={t(detailError)} onRetry={detailRetry} />
        ) : detail === null ? (
          <EmptyBlock>{t("목록에서 trace를 고르세요.")}</EmptyBlock>
        ) : (
          <>
            <div className="detail-grid">
              <section className="detail-card">
                <h3>{t("실행 흐름")}</h3>
                {showGraph ? (
                  <RuntimeGraphView
                    observations={detail.observations}
                    selectedObservationId={observationId}
                    onSelect={setObservationId}
                  />
                ) : null}
              </section>
              <section className="detail-card">
                <h3 className="io-card-head">
                  <span>{observation ? observation.name : "Trace"}</span>
                  {observation ? (
                    <span className="io-card-kinds">
                      {observationKindBadges(
                        detail.observations,
                        observation.observation_id,
                      ).map(({kind, count}) => (
                        <span
                          className="runtime-child-kind"
                          data-kind={kind}
                          key={kind}
                        >
                          {runtimeKindLabel(kind)}
                          {count > 1 ? <em>{count}</em> : null}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </h3>
                <div className="io-panel">
                  {payloadState === "loading" ? (
                    <LoadingBlock label={t("Payload를 불러오는 중…")} />
                  ) : payloadState === "error" ? (
                    <ErrorBlock message={t(payloadError)} onRetry={retryPayload} />
                  ) : payloadState === "success" && observation ? (
                    <ObservationPayloadPanel
                      observation={observation}
                      downstreamLlmInput={downstreamLlmInput}
                    />
                  ) : (
                    <EmptyBlock>{t("그래프에서 observation을 선택하세요.")}</EmptyBlock>
                  )}
                </div>
              </section>
            </div>
            <div className="trace-meta">
              <div>
                <span>{t("상태")}</span>
                <b>{detail.status}</b>
              </div>
              <div>
                <span>{t("시작")}</span>
                <b>{formatDateTime(detail.started_at, locale)}</b>
              </div>
              <div>
                <span>{t("지연")}</span>
                <b>{formatDuration(detail.duration_us)}</b>
              </div>
              <div>
                <span>Session</span>
                <b>{detail.session_id ?? "—"}</b>
              </div>
              <div>
                <span>Release</span>
                <b>{detail.release ?? "—"}</b>
              </div>
              <div>
                <span>Environment</span>
                <b>{detail.environment ?? "—"}</b>
              </div>
            </div>
            <section className="annotation-section">
              <header className="annotation-head">
                <h3>Annotations</h3>
                <button
                  className="lf-btn"
                  type="button"
                  aria-expanded={scorePickerOpen}
                  aria-controls="scorePicker"
                  onClick={onToggleScorePicker}
                >
                  + Add scores
                </button>
              </header>
              {scorePickerOpen ? (
                <div
                  className="score-picker"
                  id="scorePicker"
                  ref={scorePickerRef}
                >
                  {detail.score_configs.filter(
                    (config) =>
                      config.archived_at === null &&
                      !activeScoreIds.includes(config.score_config_id),
                  ).length === 0 ? (
                    <p className="annotation-empty">{t("추가할 score가 없습니다.")}</p>
                  ) : (
                    detail.score_configs
                      .filter(
                        (config) =>
                          config.archived_at === null &&
                          !activeScoreIds.includes(config.score_config_id),
                      )
                      .map((config) => (
                        <label
                          className="score-choice"
                          key={config.score_config_id}
                        >
                          <input
                            type="checkbox"
                            checked={pickerScoreIds.includes(
                              config.score_config_id,
                            )}
                            onChange={(event) =>
                              onTogglePickerScore(
                                config.score_config_id,
                                event.target.checked,
                              )
                            }
                          />
                          <span>{config.name}</span>
                          <small>{config.data_type}</small>
                        </label>
                      ))
                  )}
                  <div className="picker-actions">
                    <button
                      className="lf-btn"
                      type="button"
                      onClick={onAddPickerScores}
                      disabled={pickerScoreIds.length === 0}
                    >
                      {t("추가")}
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="annotation-list">
                {displayedScores.length === 0 ? (
                  <p className="annotation-empty">{t("추가된 score가 없습니다.")}</p>
                ) : (
                  displayedScores.map((config) => (
                    <article
                      className="annotation-card"
                      key={config.score_config_id}
                    >
                      <div className="annotation-card-head">
                        <div>
                          <strong>{config.name}</strong>
                          <span>{config.data_type}</span>
                        </div>
                        <button
                          className="remove-score"
                          type="button"
                          aria-label={t("{name} 제거", {name: config.name})}
                          onClick={() => onRemoveScore(config.score_config_id)}
                        >
                          <IconClose />
                        </button>
                      </div>
                      {scoreValueFor(
                        config,
                        annotationValues[config.score_config_id],
                        (value) =>
                          setAnnotationValues((values) => ({
                            ...values,
                            [config.score_config_id]: value,
                          })),
                        t,
                      )}
                    </article>
                  ))
                )}
              </div>
              <label className="memo-field">
                <span>Memo</span>
                <textarea
                  value={memo}
                  onChange={(event) => setMemo(event.target.value)}
                  placeholder={t("검토 메모")}
                />
              </label>
              <footer className="annotation-footer">
                {saveError ? (
                  <span className="annotation-error">{t(saveError)}</span>
                ) : null}
                <button
                  className="lf-btn is-primary"
                  type="button"
                  disabled={saving}
                  onClick={onSave}
                >
                  {saving ? t("저장 중…") : t("저장")}
                </button>
              </footer>
            </section>
          </>
        )}
      </div>
    </>
  );
}
