import { useCallback, useEffect, useState } from "react";
import {
  addAnnotationQueueItems,
  addTraceToDataset,
  deleteTrace,
  getAnnotationQueues,
  getDatasets,
  getObservation,
  getTrace,
  getTraces,
  resetAllData,
} from "./api/client";
import type {
  AnnotationQueue,
  DatasetSummary,
  Observation,
  TraceDetail,
  TraceQuery,
  TraceListResponse,
  TraceStatus,
} from "./api/types";
import {
  AnnotationQueuesView,
  ScoresView,
  TraceAnnotationPanel,
} from "./annotations/AnnotationViews";
import { APP_TITLE } from "./constants";
import {
  ObservationInspector,
  type LoadState,
} from "./components/ObservationInspector";
import { useDismissiblePopover } from "./components/useDismissiblePopover";
import { RuntimeExecutionGraph } from "./graph/RuntimeExecutionGraph";
import { DatasetsView } from "./evaluation/DatasetsView";
import { OverviewView } from "./overview/OverviewView";
import "./styles.css";
import {
  readAppUrlState,
  replaceAppUrlState,
  type EvaluationUrlState,
  type OverviewUrlState,
} from "./url";
import logo from "./assets/logo.png";

const STATUS_LABEL: Record<TraceStatus, string> = {
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function formatDuration(durationUs: number): string {
  if (durationUs < 1_000) {
    return `${durationUs} µs`;
  }
  if (durationUs < 1_000_000) {
    return `${(durationUs / 1_000).toFixed(0)} ms`;
  }
  return `${(durationUs / 1_000_000).toFixed(2)} s`;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function StatusBadge({ status }: { status: TraceStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      <span aria-hidden="true" className="status-dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function TraceActions({
  traceId,
  deleting,
  onDelete,
}: {
  traceId: string;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"actions" | "queues" | "datasets">(
    "actions",
  );
  const [queues, setQueues] = useState<AnnotationQueue[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingQueueId, setPendingQueueId] = useState<string | null>(null);
  const [pendingDatasetId, setPendingDatasetId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const { rootRef, triggerRef } = useDismissiblePopover(open, () => {
    setOpen(false);
    setView("actions");
  });

  const loadQueues = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await getAnnotationQueues();
      setQueues(response.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setView("actions");
    setQuery("");
    setOpen(true);
  };

  const openQueues = () => {
    setView("queues");
    setQuery("");
    void loadQueues();
  };

  const openDatasets = () => {
    setView("datasets");
    setQuery("");
    setLoading(true);
    setError(false);
    void getDatasets()
      .then((response) => setDatasets(response.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  const filteredQueues = queues.filter((queue) => {
    const searchText = `${queue.name} ${queue.description ?? ""}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

  const add = async (queue: AnnotationQueue) => {
    setPendingQueueId(queue.annotation_queue_id);
    setError(false);
    try {
      const updated = await addAnnotationQueueItems(queue.annotation_queue_id, [
        traceId,
      ]);
      setQueues((current) =>
        current.map((item) =>
          item.annotation_queue_id === updated.annotation_queue_id
            ? updated
            : item,
        ),
      );
    } catch {
      setError(true);
    } finally {
      setPendingQueueId(null);
    }
  };

  const addToDataset = async (dataset: DatasetSummary) => {
    setPendingDatasetId(dataset.dataset_id);
    setError(false);
    try {
      const updated = await addTraceToDataset(dataset.dataset_id, traceId);
      setDatasets((current) =>
        current.map((item) =>
          item.dataset_id === updated.dataset_id ? updated : item,
        ),
      );
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setPendingDatasetId(null);
    }
  };

  return (
    <div className="trace-actions" ref={rootRef}>
      <button
        ref={triggerRef}
        className="icon-button trace-actions-trigger"
        type="button"
        aria-expanded={open}
        aria-label="Trace actions"
        onClick={toggle}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>
      {open && (
        <div
          className="trace-actions-popover"
          role="menu"
          aria-label="Trace actions menu"
        >
          {view === "actions" ? (
            <>
              <button
                className="trace-action-item"
                type="button"
                onClick={openQueues}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Add to Queue
              </button>
              <button
                className="trace-action-item"
                type="button"
                onClick={openDatasets}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M5 5h14v14H5z" />
                  <path d="M8 9h8M8 13h5" />
                </svg>
                Add to Dataset
              </button>
              <button
                className="trace-action-item trace-action-danger"
                type="button"
                disabled={deleting}
                aria-label="이 요청 삭제"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 7h16" />
                  <path d="M9 7V4h6v3" />
                  <path d="m7 7 1 13h8l1-13" />
                  <path d="M10 11v5M14 11v5" />
                </svg>
                Delete
              </button>
            </>
          ) : view === "queues" ? (
            <>
              <div className="trace-actions-heading">
                <button
                  className="trace-actions-back"
                  type="button"
                  aria-label="Trace actions 뒤로"
                  onClick={() => setView("actions")}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <strong>Add to Queue</strong>
              </div>
              <label className="queue-popover-search">
                <span aria-hidden="true" className="search-icon" />
                <input
                  type="search"
                  aria-label="Queue 검색"
                  placeholder="Queue 검색"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              {loading ? (
                <span className="queue-popover-state">불러오는 중…</span>
              ) : error ? (
                <button
                  className="queue-popover-state queue-popover-retry"
                  type="button"
                  onClick={() => void loadQueues()}
                >
                  다시 시도
                </button>
              ) : queues.length === 0 ? (
                <span className="queue-popover-state">Queue가 없습니다.</span>
              ) : filteredQueues.length === 0 ? (
                <span className="queue-popover-state">
                  검색 결과가 없습니다.
                </span>
              ) : (
                filteredQueues.map((queue) => {
                  const added = queue.items.some(
                    (item) => item.trace_id === traceId,
                  );
                  const pending = pendingQueueId === queue.annotation_queue_id;
                  return (
                    <button
                      className="queue-choice"
                      type="button"
                      key={queue.annotation_queue_id}
                      disabled={added || pending}
                      aria-label={`${queue.name}${added ? " 추가됨" : ""}`}
                      onClick={() => void add(queue)}
                    >
                      <span>{queue.name}</span>
                      {added && <small>추가됨</small>}
                      {pending && <small>추가 중…</small>}
                    </button>
                  );
                })
              )}
            </>
          ) : (
            <>
              <div className="trace-actions-heading">
                <button
                  className="trace-actions-back"
                  type="button"
                  aria-label="Trace actions 뒤로"
                  onClick={() => setView("actions")}
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                </button>
                <strong>Add to Dataset</strong>
              </div>
              <p className="trace-actions-note">
                Trace input만 example으로 저장합니다. Expected output은 비워
                둡니다.
              </p>
              {loading ? (
                <span className="queue-popover-state">불러오는 중…</span>
              ) : error ? (
                <button
                  className="queue-popover-state queue-popover-retry"
                  type="button"
                  onClick={openDatasets}
                >
                  다시 시도
                </button>
              ) : datasets.length === 0 ? (
                <span className="queue-popover-state">Dataset이 없습니다.</span>
              ) : (
                datasets.map((dataset) => {
                  const pending = pendingDatasetId === dataset.dataset_id;
                  return (
                    <button
                      className="queue-choice"
                      type="button"
                      key={dataset.dataset_id}
                      disabled={pending}
                      onClick={() => void addToDataset(dataset)}
                    >
                      <span>{dataset.name}</span>
                      <small>
                        r{dataset.revision}
                        {pending ? " · 추가 중…" : ""}
                      </small>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingCard({ message }: { message: string }) {
  return (
    <div className="state-card" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="state-card state-card-error" role="alert">
      <div>
        <strong>{message}</strong>
        <p>서버가 실행 중인지 확인한 뒤 다시 시도해 주세요.</p>
      </div>
      <button className="secondary-button" type="button" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

type TraceFilterDraft = {
  query: string;
  status: "" | TraceStatus;
  from: string;
  to: string;
  tag: string;
  session_id: string;
};

const EMPTY_FILTERS: TraceFilterDraft = {
  query: "",
  status: "",
  from: "",
  to: "",
  tag: "",
  session_id: "",
};

function traceQueryFromFilters(filters: TraceFilterDraft): TraceQuery {
  const toIso = (value: string) =>
    value === "" ? undefined : new Date(value).toISOString();
  return {
    query: filters.query || undefined,
    status: filters.status || undefined,
    from: toIso(filters.from),
    to: toIso(filters.to),
    tag: filters.tag || undefined,
    session_id: filters.session_id || undefined,
  };
}

function TraceFilters({
  value,
  onChange,
  onApply,
  onClear,
}: {
  value: TraceFilterDraft;
  onChange: (value: TraceFilterDraft) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const update = (key: keyof TraceFilterDraft, next: string) => {
    onChange({ ...value, [key]: next });
  };
  const advancedFilterCount = [
    value.status,
    value.from,
    value.to,
    value.tag,
    value.session_id,
  ].filter((filter) => filter !== "").length;

  return (
    <form
      className="trace-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="trace-search-row">
        <label className="trace-search">
          <span aria-hidden="true" className="search-icon" />
          <input
            aria-label="이름 또는 입출력 검색"
            placeholder="Search traces"
            value={value.query}
            onChange={(event) => update("query", event.target.value)}
          />
        </label>
        <button
          className="filter-toggle"
          type="button"
          aria-label="Filters"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span aria-hidden="true" className="filter-icon" />
          Filters
          {advancedFilterCount > 0 && (
            <span className="filter-count">{advancedFilterCount}</span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="trace-filter-popover">
          <div className="trace-filter-row">
            <label>
              <span>상태</span>
              <select
                aria-label="상태 필터"
                value={value.status}
                onChange={(event) => update("status", event.target.value)}
              >
                <option value="">전체</option>
                <option value="completed">완료</option>
                <option value="failed">실패</option>
                <option value="cancelled">취소</option>
              </select>
            </label>
            <label>
              <span>태그</span>
              <input
                aria-label="태그 필터"
                placeholder="quickstart"
                value={value.tag}
                onChange={(event) => update("tag", event.target.value)}
              />
            </label>
          </div>
          <div className="trace-filter-row">
            <label>
              <span>시작</span>
              <input
                aria-label="시작 시간 필터"
                type="datetime-local"
                value={value.from}
                onChange={(event) => update("from", event.target.value)}
              />
            </label>
            <label>
              <span>끝</span>
              <input
                aria-label="끝 시간 필터"
                type="datetime-local"
                value={value.to}
                onChange={(event) => update("to", event.target.value)}
              />
            </label>
          </div>
          <label>
            <span>세션</span>
            <input
              aria-label="세션 필터"
              placeholder="Session ID"
              value={value.session_id}
              onChange={(event) => update("session_id", event.target.value)}
            />
          </label>
          <div className="trace-filter-actions">
            <button className="primary-button" type="submit">
              적용
            </button>
            <button className="text-button" type="button" onClick={onClear}>
              초기화
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function LocalDataControls({ onReset }: { onReset: () => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const reset = () => {
    if (confirmation !== "RESET") {
      return;
    }
    setPending(true);
    setError(false);
    void resetAllData()
      .then(() => {
        setConfirmation("");
        onReset();
      })
      .catch(() => {
        setError(true);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <section className="local-data-controls" aria-labelledby="local-data-title">
      <div>
        <h2 id="local-data-title">백업과 초기화</h2>
        <p>원본 trace 데이터는 이 컴퓨터에만 저장됩니다.</p>
      </div>
      <a className="backup-link" href="/api/v1/admin/backup" download>
        SQLite 백업 다운로드
      </a>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          reset();
        }}
      >
        <label>
          <span>
            <code>RESET</code>을 입력하면 모든 추적과 피드백을 지웁니다.
          </span>
          <input
            aria-label="전체 데이터 초기화 확인"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="RESET"
          />
        </label>
        <button
          className="delete-button"
          type="submit"
          disabled={confirmation !== "RESET" || pending}
        >
          {pending ? "초기화 중…" : "모든 데이터 초기화"}
        </button>
      </form>
      {error && (
        <p className="local-data-error" role="alert">
          데이터를 초기화하지 못했습니다. 다시 시도해 주세요.
        </p>
      )}
    </section>
  );
}

function TraceList({
  response,
  selectedTraceId,
  hasFilters,
  loadingMore,
  onSelect,
  onLoadMore,
}: {
  response: TraceListResponse;
  selectedTraceId: string | null;
  hasFilters: boolean;
  loadingMore: boolean;
  onSelect: (traceId: string) => void;
  onLoadMore: () => void;
}) {
  if (response.items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-feather" aria-hidden="true">
          ↘
        </div>
        <h3>
          {hasFilters
            ? "조건에 맞는 요청이 없습니다"
            : "아직 기록된 요청이 없습니다"}
        </h3>
        <p>
          {hasFilters ? (
            "검색어나 필터를 바꿔 다시 확인해 보세요."
          ) : (
            <>
              <code>wrap_runnable()</code>로 감싼 LangGraph를 실행하면 여기에
              요청이 나타납니다.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="trace-list">
        {response.items.map((trace) => (
          <li key={trace.trace_id}>
            <button
              className="trace-card"
              type="button"
              aria-pressed={selectedTraceId === trace.trace_id}
              onClick={() => {
                onSelect(trace.trace_id);
              }}
            >
              <span className="trace-card-heading">
                <strong>{trace.name}</strong>
                <StatusBadge status={trace.status} />
              </span>
              <span className="trace-preview">{trace.input_preview}</span>
              <span className="trace-card-meta">
                <time dateTime={trace.started_at}>
                  {formatTimestamp(trace.started_at)}
                </time>
                <span>{formatDuration(trace.duration_us)}</span>
                <span>노드 {trace.observation_count}개</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {response.next_cursor !== null && (
        <button
          className="load-more-button"
          type="button"
          disabled={loadingMore}
          onClick={onLoadMore}
        >
          {loadingMore ? "더 불러오는 중…" : "이전 요청 더 보기"}
        </button>
      )}
    </>
  );
}

function TraceDetailPanel({
  detail,
  selectedObservationId,
  payloadState,
  deleting,
  onSelectObservation,
  onSelectTrace,
  onRetryObservation,
  onRefresh,
  onDelete,
}: {
  detail: TraceDetail;
  selectedObservationId: string | null;
  payloadState: LoadState<Observation>;
  deleting: boolean;
  onSelectObservation: (observationId: string) => void;
  onSelectTrace: (traceId: string) => void;
  onRetryObservation: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const selectedObservation =
    detail.observations.find(
      (observation) => observation.observation_id === selectedObservationId,
    ) ?? null;

  return (
    <article className="trace-detail">
      <header className="detail-header">
        <div>
          <h2>{detail.name}</h2>
          <p className="trace-id">{detail.trace_id}</p>
        </div>
        <div className="detail-summary">
          <StatusBadge status={detail.status} />
          <span>{formatDuration(detail.duration_us)}</span>
          <time dateTime={detail.started_at}>
            {formatTimestamp(detail.started_at)}
          </time>
          <TraceActions
            key={detail.trace_id}
            traceId={detail.trace_id}
            deleting={deleting}
            onDelete={onDelete}
          />
        </div>
      </header>

      {detail.session_id !== null && (
        <nav className="session-navigation" aria-label="같은 세션의 요청 이동">
          <span>{detail.session_id}</span>
          <button
            className="text-button"
            type="button"
            disabled={
              detail.previous_trace_id === null ||
              detail.previous_trace_id === undefined
            }
            onClick={() =>
              detail.previous_trace_id !== null &&
              detail.previous_trace_id !== undefined &&
              onSelectTrace(detail.previous_trace_id)
            }
          >
            이전 요청 <kbd>K</kbd>
          </button>
          <button
            className="text-button"
            type="button"
            disabled={
              detail.next_trace_id === null ||
              detail.next_trace_id === undefined
            }
            onClick={() =>
              detail.next_trace_id !== null &&
              detail.next_trace_id !== undefined &&
              onSelectTrace(detail.next_trace_id)
            }
          >
            다음 요청 <kbd>J</kbd>
          </button>
        </nav>
      )}

      <section className="path-section" aria-labelledby="path-heading">
        <div className="path-heading">
          <h3 id="path-heading">Execution</h3>
          <span className="node-count">{detail.observation_count}</span>
        </div>

        <div className="detail-grid">
          <div className="graph-panel">
            <RuntimeExecutionGraph
              key={detail.trace_id}
              observations={detail.observations}
              selectedObservationId={selectedObservationId}
              onSelect={onSelectObservation}
            />
          </div>
          <ObservationInspector
            selectedObservation={selectedObservation}
            payloadState={payloadState}
            onRetry={onRetryObservation}
          />
        </div>
      </section>
      <TraceAnnotationPanel
        key={[
          detail.trace_id,
          detail.memo?.updated_at ?? "no-memo",
          ...detail.annotations.map((annotation) => annotation.updated_at),
        ].join(":")}
        detail={detail}
        onChanged={onRefresh}
      />
    </article>
  );
}

export function App() {
  const [initialUrlState] = useState(readAppUrlState);
  const [activeView, setActiveView] = useState(initialUrlState.view);
  const [overviewUrlState, setOverviewUrlState] = useState<OverviewUrlState>(
    initialUrlState.overview,
  );
  const [evaluationUrlState, setEvaluationUrlState] =
    useState<EvaluationUrlState>(initialUrlState.evaluation);
  const [evaluationMountRevision, setEvaluationMountRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [payloadRevision, setPayloadRevision] = useState(0);
  const [listState, setListState] = useState<LoadState<TraceListResponse>>({
    status: "loading",
  });
  const [filters, setFilters] = useState<TraceFilterDraft>(EMPTY_FILTERS);
  const [activeFilters, setActiveFilters] =
    useState<TraceFilterDraft>(EMPTY_FILTERS);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(
    initialUrlState.traceId,
  );
  const [detailState, setDetailState] = useState<LoadState<TraceDetail>>({
    status: initialUrlState.traceId === null ? "idle" : "loading",
  });
  const [selectedObservationId, setSelectedObservationId] = useState<
    string | null
  >(null);
  const [payloadState, setPayloadState] = useState<LoadState<Observation>>({
    status: "idle",
  });
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    replaceAppUrlState({
      view: activeView,
      overview: overviewUrlState,
      evaluation: evaluationUrlState,
      traceId: selectedTraceId,
    });
  }, [activeView, evaluationUrlState, overviewUrlState, selectedTraceId]);

  useEffect(() => {
    const restoreUrlState = () => {
      const restored = readAppUrlState();
      setActiveView(restored.view);
      setOverviewUrlState(restored.overview);
      setEvaluationUrlState(restored.evaluation);
      setEvaluationMountRevision((revision) => revision + 1);
      setSelectedTraceId(restored.traceId);
      setSelectedObservationId(null);
      setPayloadState({ status: "idle" });
      setDetailState({
        status: restored.traceId === null ? "idle" : "loading",
      });
    };
    window.addEventListener("popstate", restoreUrlState);
    return () => window.removeEventListener("popstate", restoreUrlState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void getTraces(traceQueryFromFilters(activeFilters), controller.signal)
      .then((response) => {
        setListState({ status: "success", data: response });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setListState({ status: "error" });
        }
      });

    return () => {
      controller.abort();
    };
  }, [activeFilters, listRevision]);

  useEffect(() => {
    if (selectedTraceId === null) {
      return;
    }

    const controller = new AbortController();

    void getTrace(selectedTraceId, controller.signal)
      .then((detail) => {
        setDetailState({ status: "success", data: detail });
        const rootObservation = detail.observations.find(
          (observation) => observation.parent_observation_id === null,
        );
        const failedObservation = [...detail.observations]
          .sort((left, right) => left.sequence - right.sequence)
          .find((observation) => observation.status === "failed");
        const initialObservation = failedObservation ?? rootObservation;
        if (initialObservation !== undefined) {
          setSelectedObservationId(initialObservation.observation_id);
          setPayloadState({ status: "loading" });
        } else {
          setSelectedObservationId(null);
          setPayloadState({ status: "idle" });
        }
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setDetailState({ status: "error" });
        }
      });

    return () => {
      controller.abort();
    };
  }, [detailRevision, selectedTraceId]);

  useEffect(() => {
    if (selectedObservationId === null) {
      return;
    }

    const controller = new AbortController();

    void getObservation(selectedObservationId, controller.signal)
      .then((observation) => {
        setPayloadState({ status: "success", data: observation });
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) {
          setPayloadState({ status: "error" });
        }
      });

    return () => {
      controller.abort();
    };
  }, [payloadRevision, selectedObservationId]);

  const selectTrace = useCallback(
    (traceId: string) => {
      if (traceId === selectedTraceId && detailState.status !== "error") {
        return;
      }
      setSelectedTraceId(traceId);
      setSelectedObservationId(null);
      setPayloadState({ status: "idle" });
      setDetailState({ status: "loading" });
    },
    [detailState.status, selectedTraceId],
  );

  useEffect(() => {
    if (activeView !== "traces" || detailState.status !== "success") {
      return;
    }
    const moveBetweenSessionTraces = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const traceId =
        key === "j"
          ? detailState.data.next_trace_id
          : key === "k"
            ? detailState.data.previous_trace_id
            : null;
      if (traceId !== null && traceId !== undefined) {
        event.preventDefault();
        selectTrace(traceId);
      }
    };
    document.addEventListener("keydown", moveBetweenSessionTraces);
    return () => {
      document.removeEventListener("keydown", moveBetweenSessionTraces);
    };
  }, [activeView, detailState, selectTrace]);

  const selectObservation = (observationId: string) => {
    if (
      observationId === selectedObservationId &&
      payloadState.status !== "error"
    ) {
      return;
    }
    setSelectedObservationId(observationId);
    setPayloadState({ status: "loading" });
  };

  const retryList = () => {
    setListState({ status: "loading" });
    setListRevision((revision) => revision + 1);
  };

  const applyFilters = () => {
    setSelectedTraceId(null);
    setDetailState({ status: "idle" });
    setSelectedObservationId(null);
    setPayloadState({ status: "idle" });
    setListState({ status: "loading" });
    setActiveFilters({ ...filters });
    setListRevision((revision) => revision + 1);
  };

  const clearFilters = () => {
    const cleared = { ...EMPTY_FILTERS };
    setFilters(cleared);
    setSelectedTraceId(null);
    setDetailState({ status: "idle" });
    setSelectedObservationId(null);
    setPayloadState({ status: "idle" });
    setListState({ status: "loading" });
    setActiveFilters(cleared);
    setListRevision((revision) => revision + 1);
  };

  const loadMore = () => {
    if (listState.status !== "success" || listState.data.next_cursor === null) {
      return;
    }
    const cursor = listState.data.next_cursor;
    setLoadingMore(true);
    void getTraces({ ...traceQueryFromFilters(activeFilters), cursor })
      .then((response) => {
        setListState((current) => {
          if (
            current.status !== "success" ||
            current.data.next_cursor !== cursor
          ) {
            return current;
          }
          return {
            status: "success",
            data: {
              items: [...current.data.items, ...response.items],
              next_cursor: response.next_cursor,
            },
          };
        });
      })
      .finally(() => {
        setLoadingMore(false);
      });
  };

  const retryDetail = () => {
    setDetailState({ status: "loading" });
    setDetailRevision((revision) => revision + 1);
  };

  const retryObservation = () => {
    setPayloadState({ status: "loading" });
    setPayloadRevision((revision) => revision + 1);
  };

  const refreshDetail = () => {
    setDetailState({ status: "loading" });
    setDetailRevision((revision) => revision + 1);
  };

  const removeTrace = () => {
    if (
      selectedTraceId === null ||
      !window.confirm("이 요청과 노드, 피드백을 모두 삭제할까요?")
    ) {
      return;
    }
    setDeleting(true);
    void deleteTrace(selectedTraceId)
      .then(() => {
        setSelectedTraceId(null);
        setDetailState({ status: "idle" });
        setSelectedObservationId(null);
        setPayloadState({ status: "idle" });
        retryList();
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  const resetAll = () => {
    setSelectedTraceId(null);
    setDetailState({ status: "idle" });
    setSelectedObservationId(null);
    setPayloadState({ status: "idle" });
    setActiveView("traces");
    retryList();
  };

  const hasFilters = Object.values(activeFilters).some((value) => value !== "");

  return (
    <div className="app-frame" data-testid="app-frame">
      <header className="app-header">
        <a className="brand" href="/" aria-label={`${APP_TITLE} 홈`}>
          <span className="brand-mark" aria-hidden="true">
            <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          </span>
          <strong>{APP_TITLE}</strong>
        </a>
        <nav className="primary-navigation" aria-label="주요 메뉴">
          <button
            type="button"
            aria-pressed={activeView === "overview"}
            onClick={() => setActiveView("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            aria-pressed={activeView === "traces"}
            onClick={() => setActiveView("traces")}
          >
            Traces
          </button>
          <button
            type="button"
            aria-label="Annotation Queues"
            aria-pressed={activeView === "queues"}
            onClick={() => setActiveView("queues")}
          >
            <span className="desktop-nav-label" aria-hidden="true">
              Annotation Queues
            </span>
            <span className="mobile-nav-label" aria-hidden="true">
              Queues
            </span>
          </button>
          <button
            type="button"
            aria-pressed={activeView === "scores"}
            onClick={() => setActiveView("scores")}
          >
            Scores
          </button>
          <button
            type="button"
            aria-label="Evaluation"
            aria-pressed={activeView === "datasets"}
            onClick={() => setActiveView("datasets")}
          >
            <span className="desktop-nav-label" aria-hidden="true">
              Evaluation
            </span>
            <span className="mobile-nav-label" aria-hidden="true">
              Eval
            </span>
          </button>
          <button
            type="button"
            aria-label="Local Data"
            aria-pressed={activeView === "data"}
            onClick={() => setActiveView("data")}
          >
            <span className="desktop-nav-label" aria-hidden="true">
              Local Data
            </span>
            <span className="mobile-nav-label" aria-hidden="true">
              Data
            </span>
          </button>
        </nav>
        <span className="local-badge">
          <span aria-hidden="true" />
          Stored locally
        </span>
      </header>

      {activeView === "overview" && (
        <OverviewView
          key={JSON.stringify(overviewUrlState)}
          value={overviewUrlState}
          onUrlStateChange={setOverviewUrlState}
        />
      )}
      {activeView === "traces" && (
        <main className="workspace">
          <aside className="trace-sidebar" aria-labelledby="trace-list-title">
            <div className="sidebar-heading">
              <h1 id="trace-list-title">Traces</h1>
              {listState.status === "success" && (
                <span className="record-count">
                  {listState.data.items.length}
                </span>
              )}
            </div>
            <TraceFilters
              value={filters}
              onChange={setFilters}
              onApply={applyFilters}
              onClear={clearFilters}
            />

            <div className="sidebar-content">
              {listState.status === "loading" && (
                <LoadingCard message="추적 기록을 불러오는 중입니다…" />
              )}
              {listState.status === "error" && (
                <ErrorCard
                  message="추적 기록을 불러오지 못했습니다"
                  onRetry={retryList}
                />
              )}
              {listState.status === "success" && (
                <TraceList
                  response={listState.data}
                  selectedTraceId={selectedTraceId}
                  hasFilters={hasFilters}
                  loadingMore={loadingMore}
                  onSelect={selectTrace}
                  onLoadMore={loadMore}
                />
              )}
            </div>
          </aside>

          <section className="detail-area" aria-label="추적 상세">
            {selectedTraceId === null && (
              <div className="detail-placeholder">
                <h2>요청을 선택하세요</h2>
              </div>
            )}
            {selectedTraceId !== null && detailState.status === "loading" && (
              <LoadingCard message="실행 경로를 불러오는 중입니다…" />
            )}
            {selectedTraceId !== null && detailState.status === "error" && (
              <ErrorCard
                message="실행 경로를 불러오지 못했습니다"
                onRetry={retryDetail}
              />
            )}
            {selectedTraceId !== null && detailState.status === "success" && (
              <TraceDetailPanel
                detail={detailState.data}
                selectedObservationId={selectedObservationId}
                payloadState={payloadState}
                deleting={deleting}
                onSelectObservation={selectObservation}
                onSelectTrace={selectTrace}
                onRetryObservation={retryObservation}
                onRefresh={refreshDetail}
                onDelete={removeTrace}
              />
            )}
          </section>
        </main>
      )}
      {activeView === "queues" && <AnnotationQueuesView />}
      {activeView === "scores" && <ScoresView />}
      {activeView === "datasets" && (
        <DatasetsView
          key={evaluationMountRevision}
          urlState={evaluationUrlState}
          onUrlStateChange={setEvaluationUrlState}
          onOpenTrace={(traceId) => {
            selectTrace(traceId);
            setActiveView("traces");
          }}
        />
      )}
      {activeView === "data" && (
        <main className="local-data-page">
          <LocalDataControls onReset={resetAll} />
        </main>
      )}
    </div>
  );
}
