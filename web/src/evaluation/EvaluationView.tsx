import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  addDatasetExample,
  ApiError,
  createDataset,
  deleteDataset,
  deleteDatasetExample,
  deleteExperiment,
  getDataset,
  getDatasets,
  getExperiment,
  getExperiments,
  updateDatasetExample,
} from "../api/client";
import type {
  Dataset,
  DatasetExample,
  DatasetSummary,
  Experiment,
  ExperimentCase,
  ExperimentSummary,
  JsonValue,
} from "../api/types";
import {
  ColumnHeaderCell,
  EmptyBlock,
  ErrorBlock,
  IconClose,
  IconMore,
  LIST_PAGE_SIZE,
  LoadingBlock,
  Modal,
  Pagination,
  SelectColGroup,
  deferState,
  formatDuration,
  jsonPreview,
  valuePreview,
  jsonText,
  paginate,
  sortRows,
  type ReorderableColumnDef,
  useEscape,
  useReorderableColumns,
} from "../components";
import { useT, type Translate } from "../i18n/context";
import { compareExperiments, hasDatasetRevisionMismatch } from "./comparison";
import {
  downloadJsonl,
  examplesToJsonl,
  jsonlFileName,
  parseJsonl,
  readTextFile,
  type JsonlEntry,
} from "./jsonl";
import type { EvaluationUrlState } from "../url";

type LoadState = "loading" | "success" | "error";

const EXAMPLE_COLUMNS: ReorderableColumnDef[] = [
  { id: "input", label: "Input", width: 375 },
  { id: "expected_output", label: "Reference output", width: 375 },
  { id: "metadata", label: "Metadata", width: 325 },
];

const EXAMPLE_SORT_VALUES: Record<
  string,
  (example: DatasetExample) => string | number
> = {
  input: (example) => valuePreview(example.input),
  expected_output: (example) => valuePreview(example.expected_output),
  metadata: (example) => jsonPreview(example.metadata),
};

const EXPERIMENT_COLUMNS: ReorderableColumnDef[] = [
  { id: "name", label: "Experiment", width: 325 },
  { id: "status", label: "Status", width: 138 },
  { id: "revision", label: "Revision", width: 128 },
  { id: "cases", label: "Cases", width: 138 },
  { id: "duration", label: "Duration", width: 138 },
];

const EXPERIMENT_SORT_VALUES: Record<
  string,
  (summary: ExperimentSummary) => string | number
> = {
  name: (summary) => summary.name,
  status: (summary) => summary.status,
  revision: (summary) => summary.dataset_revision,
  cases: (summary) => summary.completed_case_count + summary.failed_case_count,
  duration: (summary) =>
    summary.ended_at
      ? Math.max(
          0,
          new Date(summary.ended_at).valueOf() -
            new Date(summary.started_at).valueOf(),
        )
      : -1,
};

function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function experimentDuration(summary: ExperimentSummary): string {
  if (!summary.ended_at) return "—";
  return formatDuration(
    Math.max(
      0,
      new Date(summary.ended_at).valueOf() -
        new Date(summary.started_at).valueOf(),
    ) * 1_000,
  );
}

export function EvaluationView({
  section,
  state,
  onChange,
  onSection,
}: {
  /** Examples와 Experiments는 이제 상단 세그먼트다. 내부 탭을 두지 않는다. */
  section: "examples" | "experiments";
  state: EvaluationUrlState;
  onChange: (state: EvaluationUrlState) => void;
  onSection: (section: "examples" | "experiments") => void;
}) {
  const t = useT();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [experiments, setExperiments] = useState<ExperimentSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState("");
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetState, setDatasetState] = useState<LoadState>("loading");
  const [datasetError, setDatasetError] = useState("");
  const [experimentDetails, setExperimentDetails] = useState<
    Record<string, Experiment>
  >({});
  const [compareState, setCompareState] = useState<LoadState>("success");
  const [selectionWarning, setSelectionWarning] = useState("");
  const [newDatasetOpen, setNewDatasetOpen] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [newDatasetDescription, setNewDatasetDescription] = useState("");
  const [newDatasetPending, setNewDatasetPending] = useState(false);
  const [newDatasetError, setNewDatasetError] = useState("");
  const [datasetMenuId, setDatasetMenuId] = useState<string | null>(null);
  const [deleteDatasetTarget, setDeleteDatasetTarget] =
    useState<DatasetSummary | null>(null);
  const [deleteDatasetPending, setDeleteDatasetPending] = useState(false);
  const [deleteDatasetError, setDeleteDatasetError] = useState("");
  const [openExperimentId, setOpenExperimentId] = useState<string | null>(null);
  const [drawerExperiment, setDrawerExperiment] = useState<Experiment | null>(
    null,
  );
  const [drawerState, setDrawerState] = useState<LoadState>("success");
  const [drawerError, setDrawerError] = useState("");
  const [drawerWidth, setDrawerWidth] = useState(950);
  const drawerResize = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setLoadState("loading");
      setError("");
    });
    void Promise.all([
      getDatasets(controller.signal),
      getExperiments(controller.signal),
    ])
      .then(([datasetResponse, experimentResponse]) => {
        setDatasets(datasetResponse.items);
        setExperiments(experimentResponse.items);
        setLoadState("success");
      })
      .catch((reason: unknown) => {
        if (!aborted(reason)) {
          setLoadState("error");
          setError("Dataset과 experiment 목록을 불러오지 못했습니다.");
        }
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!state.datasetId) {
      deferState(() => setDataset(null));
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setDatasetState("loading");
      setDatasetError("");
    });
    void getDataset(state.datasetId, controller.signal)
      .then((result) => {
        setDataset(result);
        setDatasetState("success");
      })
      .catch((reason: unknown) => {
        if (aborted(reason)) return;
        setDataset(null);
        setDatasetState("error");
        setDatasetError("Dataset 상세를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [state.datasetId]);

  useEffect(() => {
    if (!openExperimentId) {
      deferState(() => setDrawerExperiment(null));
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (controller.signal.aborted) return;
      setDrawerState("loading");
      setDrawerError("");
    });
    void getExperiment(openExperimentId, controller.signal)
      .then((result) => {
        setDrawerExperiment(result);
        setDrawerState("success");
      })
      .catch((reason: unknown) => {
        if (aborted(reason)) return;
        setDrawerExperiment(null);
        setDrawerState("error");
        setDrawerError("Experiment 상세를 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [openExperimentId]);

  useEffect(() => {
    if (!openExperimentId) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenExperimentId(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [openExperimentId]);

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

  useEffect(() => {
    if (!datasetMenuId) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".row-menu-anchor"))
        return;
      setDatasetMenuId(null);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [datasetMenuId]);

  const datasetExperiments = useMemo(
    () =>
      experiments.filter(
        (experiment) => experiment.dataset_id === state.datasetId,
      ),
    [experiments, state.datasetId],
  );
  const selectedSummaries = useMemo(
    () =>
      state.experimentIds
        .map((id) =>
          datasetExperiments.find(
            (experiment) => experiment.experiment_id === id,
          ),
        )
        .filter(
          (experiment): experiment is ExperimentSummary =>
            experiment !== undefined,
        ),
    [datasetExperiments, state.experimentIds],
  );

  useEffect(() => {
    if (selectedSummaries.length === 0) {
      deferState(() => setExperimentDetails({}));
      return;
    }
    const controller = new AbortController();
    deferState(() => {
      if (!controller.signal.aborted) setCompareState("loading");
    });
    void Promise.all(
      selectedSummaries.map((summary) =>
        getExperiment(summary.experiment_id, controller.signal),
      ),
    )
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setExperimentDetails(
          Object.fromEntries(
            loaded.map((experiment) => [experiment.experiment_id, experiment]),
          ),
        );
        setCompareState("success");
      })
      .catch((reason: unknown) => {
        if (!aborted(reason)) setCompareState("error");
      });
    return () => controller.abort();
  }, [selectedSummaries]);

  const visible = datasets.filter((entry) =>
    `${entry.name} ${entry.description ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selectedDetails = state.experimentIds
    .map((id) => experimentDetails[id])
    .filter((experiment): experiment is Experiment => experiment !== undefined);
  const comparisons = compareExperiments(selectedDetails);
  const commonMetricKeys = useMemo(() => {
    if (selectedDetails.length < 2) return [];
    const first = selectedDetails[0];
    if (!first) return [];
    return first.evaluators
      .filter((evaluator) =>
        selectedDetails.every((experiment) =>
          experiment.evaluators.some(
            (candidate) =>
              candidate.key === evaluator.key &&
              candidate.data_type === evaluator.data_type,
          ),
        ),
      )
      .map((evaluator) => evaluator.key);
  }, [selectedDetails]);
  const selectedMetrics = state.metricKeys.filter((key) =>
    commonMetricKeys.includes(key),
  );

  const chooseDataset = (datasetId: string) => {
    // 새 dataset을 고르면 예제부터 본다. 재편 이전 tab: "examples"와 같다.
    if (section !== "examples") onSection("examples");
    onChange({
      ...state,
      datasetId,
      experimentIds: [],
      metricKeys: [],
      caseId: null,
    });
  };
  const deleteExamples = async (exampleIds: string[]) => {
    if (!dataset) return;
    await Promise.all(
      exampleIds.map((id) => deleteDatasetExample(dataset.dataset_id, id)),
    );
    const refreshed = await getDataset(dataset.dataset_id);
    setDataset(refreshed);
    setDatasets((items) =>
      items.map((entry) =>
        entry.dataset_id === refreshed.dataset_id ? refreshed : entry,
      ),
    );
  };
  const addExample = async (example: {
    input: JsonValue;
    expected_output: JsonValue | null;
    metadata: { [key: string]: JsonValue };
  }) => {
    if (!dataset) return;
    const refreshed = await addDatasetExample(dataset.dataset_id, example);
    setDataset(refreshed);
    setDatasets((items) =>
      items.map((entry) =>
        entry.dataset_id === refreshed.dataset_id ? refreshed : entry,
      ),
    );
  };
  /* Import saves line by line: one rejected line must not drop the rest. */
  const importExamples = async (entries: JsonlEntry[]): Promise<number[]> => {
    if (!dataset) return entries.map((entry) => entry.lineNumber);
    const failedLines: number[] = [];
    let latest: Dataset | null = null;
    for (const entry of entries) {
      try {
        latest = await addDatasetExample(dataset.dataset_id, entry.example);
      } catch {
        failedLines.push(entry.lineNumber);
      }
    }
    if (latest) {
      const refreshed = latest;
      setDataset(refreshed);
      setDatasets((items) =>
        items.map((entry) =>
          entry.dataset_id === refreshed.dataset_id ? refreshed : entry,
        ),
      );
    }
    return failedLines;
  };
  const updateExample = async (
    exampleId: string,
    patch: {
      input?: JsonValue;
      expected_output?: JsonValue | null;
      metadata?: { [key: string]: JsonValue };
    },
  ) => {
    if (!dataset) return;
    const refreshed = await updateDatasetExample(
      dataset.dataset_id,
      exampleId,
      patch,
    );
    setDataset(refreshed);
    setDatasets((items) =>
      items.map((entry) =>
        entry.dataset_id === refreshed.dataset_id ? refreshed : entry,
      ),
    );
  };
  const deleteExperiments = async (experimentIds: string[]) => {
    await Promise.all(experimentIds.map((id) => deleteExperiment(id)));
    setExperiments((items) =>
      items.filter((item) => !experimentIds.includes(item.experiment_id)),
    );
    onChange({
      ...state,
      experimentIds: state.experimentIds.filter(
        (id) => !experimentIds.includes(id),
      ),
    });
  };
  const removeDataset = async () => {
    if (!deleteDatasetTarget) return;
    setDeleteDatasetPending(true);
    setDeleteDatasetError("");
    try {
      await deleteDataset(deleteDatasetTarget.dataset_id);
      setDatasets((items) =>
        items.filter(
          (entry) => entry.dataset_id !== deleteDatasetTarget.dataset_id,
        ),
      );
      setDeleteDatasetTarget(null);
    } catch (reason: unknown) {
      setDeleteDatasetError(
        reason instanceof ApiError && reason.status === 409
          ? "Experiment 기록이 있는 dataset은 삭제할 수 없습니다."
          : "Dataset을 삭제하지 못했습니다.",
      );
    } finally {
      setDeleteDatasetPending(false);
    }
  };
  const createNewDataset = async (event: FormEvent) => {
    event.preventDefault();
    if (!newDatasetName.trim()) return;
    setNewDatasetPending(true);
    setNewDatasetError("");
    try {
      const created = await createDataset({
        name: newDatasetName.trim(),
        description: newDatasetDescription.trim() || null,
      });
      setDatasets((items) => [created, ...items]);
      setNewDatasetName("");
      setNewDatasetDescription("");
      setNewDatasetOpen(false);
    } catch {
      setNewDatasetError("Dataset을 생성하지 못했습니다.");
    } finally {
      setNewDatasetPending(false);
    }
  };
  const toggleExperiment = (summary: ExperimentSummary, checked: boolean) => {
    setSelectionWarning("");
    if (checked) {
      if (state.experimentIds.length >= 4) {
        setSelectionWarning("최대 4개까지 비교할 수 있습니다.");
        return;
      }
      if (
        selectedSummaries.length > 0 &&
        selectedSummaries[0]?.dataset_revision !== summary.dataset_revision
      ) {
        setSelectionWarning("같은 dataset revision만 함께 비교할 수 있습니다.");
        return;
      }
      onChange({
        ...state,
        experimentIds: [...state.experimentIds, summary.experiment_id],
        metricKeys: state.metricKeys,
      });
    } else {
      onChange({
        ...state,
        experimentIds: state.experimentIds.filter(
          (id) => id !== summary.experiment_id,
        ),
        metricKeys: state.metricKeys,
      });
    }
  };
  return (
    <main className="page evaluation-page" id="lf-main" tabIndex={-1}>
      {loadState === "loading" ? (
        <LoadingBlock label={t("Datasets를 불러오는 중…")} />
      ) : loadState === "error" ? (
        <ErrorBlock
          message={t(error)}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : !state.datasetId ? (
        <DatasetList
          entries={visible}
          experiments={experiments}
          search={search}
          onSearch={setSearch}
          onSelect={chooseDataset}
          onNew={() => setNewDatasetOpen(true)}
          menuId={datasetMenuId}
          onMenuToggle={setDatasetMenuId}
          onDelete={(entry) => {
            setDeleteDatasetError("");
            setDeleteDatasetTarget(entry);
            setDatasetMenuId(null);
          }}
        />
      ) : datasetState === "loading" ? (
        <LoadingBlock label={t("Dataset 상세를 불러오는 중…")} />
      ) : datasetState === "error" ? (
        <ErrorBlock
          message={t(datasetError)}
          onRetry={() => setRetry((value) => value + 1)}
        />
      ) : dataset ? (
        <section className="dataset-detail-view">
          {/*
            기획서 05절: "상단에 dataset 컨텍스트 바, 그 아래 세그먼트 컨트롤".
            Examples와 Experiments는 App의 세그먼트가 됐으므로 여기서는 어느
            dataset을 보고 있는지만 계속 알려 주고 바꿀 길을 연다.
          */}
          <header className="dataset-context" role="region" aria-label="Dataset">
            <div className="dataset-context-main">
              <h1>{dataset.name}</h1>
              <p className="sub">{dataset.description ?? t("설명 없음")}</p>
            </div>
            <span className="compare-count">revision {dataset.revision}</span>
            <button
              className="lf-btn"
              type="button"
              onClick={() =>
                onChange({
                  ...state,
                  datasetId: null,
                  experimentIds: [],
                  metricKeys: [],
                  caseId: null,
                })
              }
            >
              {t("Dataset 바꾸기")}
            </button>
          </header>
          {section === "examples" ? (
            <ExamplesTable
              dataset={dataset}
              onDelete={deleteExamples}
              onAdd={addExample}
              onUpdate={updateExample}
              onImport={importExamples}
            />
          ) : (
            <ExperimentsPanel
              summaries={datasetExperiments}
              selectedIds={state.experimentIds}
              comparisons={comparisons}
              metrics={selectedMetrics}
              compareState={compareState}
              warning={selectionWarning}
              onMetricsToggle={(metricKey, checked) =>
                onChange({
                  ...state,
                  metricKeys: checked
                    ? [...selectedMetrics, metricKey]
                    : selectedMetrics.filter((key) => key !== metricKey),
                })
              }
              onToggle={toggleExperiment}
              onOpen={setOpenExperimentId}
              onDelete={deleteExperiments}
            />
          )}
        </section>
      ) : (
        <DatasetList
          entries={visible}
          experiments={experiments}
          search={search}
          onSearch={setSearch}
          onSelect={chooseDataset}
          onNew={() => setNewDatasetOpen(true)}
          menuId={datasetMenuId}
          onMenuToggle={setDatasetMenuId}
          onDelete={(entry) => {
            setDeleteDatasetError("");
            setDeleteDatasetTarget(entry);
            setDatasetMenuId(null);
          }}
        />
      )}
      <Modal
        open={newDatasetOpen}
        title="New Dataset"
        onClose={() => {
          if (!newDatasetPending) setNewDatasetOpen(false);
        }}
      >
        <form
          className="lf-modal-body"
          onSubmit={(event) => void createNewDataset(event)}
        >
          <label className="modal-field">
            {t("이름")}
            <input
              autoFocus
              required
              value={newDatasetName}
              placeholder={t("예: PolicyRAGEval")}
              onChange={(event) => setNewDatasetName(event.target.value)}
            />
          </label>
          <label className="modal-field">
            {t("설명")}
            <textarea
              value={newDatasetDescription}
              placeholder={t("선택 사항")}
              onChange={(event) => setNewDatasetDescription(event.target.value)}
            />
          </label>
          {newDatasetError ? (
            <p className="mutation-status is-error">{t(newDatasetError)}</p>
          ) : null}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={newDatasetPending}
              onClick={() => setNewDatasetOpen(false)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-primary"
              type="submit"
              disabled={newDatasetPending}
            >
              {newDatasetPending ? t("생성 중…") : t("생성")}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleteDatasetTarget !== null}
        title={t("\"{name}\" dataset을 삭제할까요?", {name: deleteDatasetTarget?.name ?? ""})}
        onClose={() => {
          if (!deleteDatasetPending) setDeleteDatasetTarget(null);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t("Dataset과 포함된 모든 example이 영구 삭제됩니다.")}
          </p>
          {deleteDatasetError ? (
            <p className="mutation-status is-error" role="alert">
              {t(deleteDatasetError)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={deleteDatasetPending}
              onClick={() => setDeleteDatasetTarget(null)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={deleteDatasetPending}
              onClick={() => void removeDataset()}
            >
              {deleteDatasetPending ? t("삭제 중…") : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
      <ExperimentDrawer
        experimentId={openExperimentId}
        experiment={drawerExperiment}
        state={drawerState}
        error={drawerError}
        onClose={() => setOpenExperimentId(null)}
        drawerWidth={drawerWidth}
        onResizeStart={(event) => {
          drawerResize.current = {
            startX: event.clientX,
            startWidth: drawerWidth,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      />
    </main>
  );
}

function DatasetList({
  entries,
  experiments,
  search,
  onSearch,
  onSelect,
  onNew,
  menuId,
  onMenuToggle,
  onDelete,
}: {
  entries: DatasetSummary[];
  experiments: ExperimentSummary[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (datasetId: string) => void;
  onNew: () => void;
  menuId: string | null;
  onMenuToggle: (id: string | null) => void;
  onDelete: (entry: DatasetSummary) => void;
}) {
  const t = useT();
  return (
    <section className="dataset-list-view">
      <h1>Datasets</h1>
      <div className="dataset-toolbar">
        <button className="lf-btn is-primary" type="button" onClick={onNew}>
          + New Dataset
        </button>
        <input
          className="search"
          type="search"
          aria-label={t("Dataset 검색")}
          value={search}
          placeholder={t("Dataset 검색")}
          onChange={(event) => onSearch(event.target.value)}
        />
        <span className="count">{t("{n}개", {n: entries.length})}</span>
      </div>
      {entries.length === 0 ? (
        <EmptyBlock>{t("검색 결과가 없습니다.")}</EmptyBlock>
      ) : (
        <div className="dataset-list">
          {entries.map((entry) => (
            <div
              className="dataset-card"
              key={entry.dataset_id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(entry.dataset_id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(entry.dataset_id);
                }
              }}
            >
              <span>
                <span className="dataset-name">{entry.name}</span>
                <span className="dataset-desc">
                  {entry.description ?? t("설명 없음")}
                </span>
              </span>
              <span className="metric">
                <b>r{entry.revision}</b>revision
              </span>
              <span className="metric">
                <b>{entry.example_count}</b>examples
              </span>
              <span className="metric">
                <b>
                  {
                    experiments.filter(
                      (experiment) =>
                        experiment.dataset_id === entry.dataset_id,
                    ).length
                  }
                </b>
                experiments
              </span>
              <div className="row-menu-anchor">
                <button
                  className="more"
                  type="button"
                  aria-label={t("Dataset 작업 메뉴")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onMenuToggle(
                      menuId === entry.dataset_id ? null : entry.dataset_id,
                    );
                  }}
                >
                  <IconMore />
                </button>
                {menuId === entry.dataset_id ? (
                  <div className="row-menu" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => onDelete(entry)}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="menu-icon">
      <path d="M8 2v8m0 0 3-3m-3 3-3-3M3 14h10" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="menu-icon">
      <path d="M8 14V6m0 0 3 3M8 6 5 9M3 2h10" />
    </svg>
  );
}

function ExamplesTable({
  dataset,
  onDelete,
  onAdd,
  onUpdate,
  onImport,
}: {
  dataset: Dataset;
  onDelete: (exampleIds: string[]) => Promise<void>;
  onAdd: (example: {
    input: JsonValue;
    expected_output: JsonValue | null;
    metadata: { [key: string]: JsonValue };
  }) => Promise<void>;
  onUpdate: (
    exampleId: string,
    patch: {
      input?: JsonValue;
      expected_output?: JsonValue | null;
      metadata?: { [key: string]: JsonValue };
    },
  ) => Promise<void>;
  onImport: (entries: JsonlEntry[]) => Promise<number[]>;
}) {
  const t = useT();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addOutput, setAddOutput] = useState("");
  const [addMetadata, setAddMetadata] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");
  const [editMetadata, setEditMetadata] = useState("");
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState("");
  const [importing, setImporting] = useState(false);
  const [jsonlMenuOpen, setJsonlMenuOpen] = useState(false);
  const [jsonlStatus, setJsonlStatus] = useState<{
    text: string;
    tone: "info" | "error";
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [drawerWidth, setDrawerWidth] = useState(700);
  const drawerResize = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const columns = useReorderableColumns(EXAMPLE_COLUMNS);

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

  useEscape(jsonlMenuOpen, () => setJsonlMenuOpen(false));
  useEffect(() => {
    if (!jsonlMenuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".jsonl-menu-anchor"))
        return;
      setJsonlMenuOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [jsonlMenuOpen]);

  const editingExample = dataset.examples.find(
    (example) => example.dataset_example_id === editingId,
  );

  const openEdit = (example: DatasetExample) => {
    setEditingId(example.dataset_example_id);
    setEditInput(jsonText(example.input));
    setEditOutput(
      example.expected_output === null ? "" : jsonText(example.expected_output),
    );
    setEditMetadata(jsonText(example.metadata));
    setEditError("");
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId) return;
    let input: JsonValue;
    try {
      input = JSON.parse(editInput || "null") as JsonValue;
    } catch {
      setEditError("Input이 올바른 JSON이 아닙니다.");
      return;
    }
    let expectedOutput: JsonValue | null = null;
    if (editOutput.trim()) {
      try {
        expectedOutput = JSON.parse(editOutput) as JsonValue;
      } catch {
        setEditError("Reference output이 올바른 JSON이 아닙니다.");
        return;
      }
    }
    let metadata: { [key: string]: JsonValue } = {};
    if (editMetadata.trim()) {
      try {
        const parsed: unknown = JSON.parse(editMetadata);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          setEditError("Metadata는 JSON object여야 합니다.");
          return;
        }
        metadata = parsed as { [key: string]: JsonValue };
      } catch {
        setEditError("Metadata가 올바른 JSON이 아닙니다.");
        return;
      }
    }
    setEditPending(true);
    setEditError("");
    try {
      await onUpdate(editingId, {
        input,
        expected_output: expectedOutput,
        metadata,
      });
      setEditingId(null);
    } catch {
      setEditError("Example을 저장하지 못했습니다.");
    } finally {
      setEditPending(false);
    }
  };

  const removeSelected = async () => {
    setPending(true);
    setError("");
    try {
      await onDelete(selectedIds);
      setSelectedIds([]);
      setConfirmOpen(false);
    } catch {
      setError("선택한 Example을 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  const openAdd = () => {
    setAddInput("");
    setAddOutput("");
    setAddMetadata("");
    setAddError("");
    setAddOpen(true);
  };

  const submitAdd = async (event: FormEvent) => {
    event.preventDefault();
    let input: JsonValue;
    try {
      input = JSON.parse(addInput || "null") as JsonValue;
    } catch {
      setAddError("Input이 올바른 JSON이 아닙니다.");
      return;
    }
    let expectedOutput: JsonValue | null = null;
    if (addOutput.trim()) {
      try {
        expectedOutput = JSON.parse(addOutput) as JsonValue;
      } catch {
        setAddError("Reference output이 올바른 JSON이 아닙니다.");
        return;
      }
    }
    let metadata: { [key: string]: JsonValue } = {};
    if (addMetadata.trim()) {
      try {
        const parsed: unknown = JSON.parse(addMetadata);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          setAddError("Metadata는 JSON object여야 합니다.");
          return;
        }
        metadata = parsed as { [key: string]: JsonValue };
      } catch {
        setAddError("Metadata가 올바른 JSON이 아닙니다.");
        return;
      }
    }
    setAddPending(true);
    setAddError("");
    try {
      await onAdd({ input, expected_output: expectedOutput, metadata });
      setAddOpen(false);
    } catch {
      setAddError("Example을 추가하지 못했습니다.");
    } finally {
      setAddPending(false);
    }
  };

  const exportJsonl = () => {
    downloadJsonl(jsonlFileName(dataset), examplesToJsonl(dataset.examples));
    setJsonlStatus({
      text: t("Example {n}개를 JSONL로 내보냈습니다.", {n: dataset.examples.length}),
      tone: "info",
    });
  };

  const importJsonl = async (file: File) => {
    setImporting(true);
    setJsonlStatus(null);
    try {
      let contents: string;
      try {
        contents = await readTextFile(file);
      } catch {
        setJsonlStatus({
          text: t("JSONL 파일을 읽지 못했습니다."),
          tone: "error",
        });
        return;
      }
      const { entries, failedLines } = parseJsonl(contents);
      const writeFailures = await onImport(entries);
      const failed = [...failedLines, ...writeFailures].sort((a, b) => a - b);
      const imported = entries.length - writeFailures.length;
      setJsonlStatus(
        failed.length === 0
          ? {
              text: t("JSONL import: {n}개를 추가했습니다.", {n: imported}),
              tone: "info",
            }
          : {
              text: t("JSONL import: {n}개 추가, 실패한 줄 {lines}.", {n: imported, lines: failed.join(", ")}),
              tone: "error",
            },
      );
    } finally {
      setImporting(false);
    }
  };

  const visible = dataset.examples.filter((example) =>
    `${jsonPreview(example.input)} ${jsonPreview(example.expected_output)} ${jsonPreview(example.metadata)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const sortedVisible = useMemo(
    () => sortRows(visible, columns.sort, EXAMPLE_SORT_VALUES),
    [visible, columns.sort],
  );
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(visible.length / LIST_PAGE_SIZE));
  const pagedVisible = paginate(sortedVisible, page);

  return (
    <>
      <div className="dataset-toolbar">
        <button className="lf-btn is-primary" type="button" onClick={openAdd}>
          + Add Example
        </button>
        <div className="jsonl-menu-anchor">
          <button
            className="more"
            type="button"
            aria-label={t("JSONL 작업 메뉴")}
            aria-haspopup="menu"
            aria-expanded={jsonlMenuOpen}
            onClick={() => setJsonlMenuOpen((open) => !open)}
          >
            <IconMore />
          </button>
          {jsonlMenuOpen ? (
            <div className="row-menu jsonl-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={importing}
                onClick={() => {
                  setJsonlMenuOpen(false);
                  fileInput.current?.click();
                }}
              >
                <ImportIcon />
                Import
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={importing || dataset.examples.length === 0}
                onClick={() => {
                  setJsonlMenuOpen(false);
                  exportJsonl();
                }}
              >
                <ExportIcon />
                Export
              </button>
            </div>
          ) : null}
        </div>
        {/* The picker stays outside the menu so choosing Import can open it. */}
        <input
          ref={fileInput}
          className="sr-only"
          type="file"
          tabIndex={-1}
          accept=".jsonl,application/x-ndjson,application/json"
          aria-label={t("JSONL 가져오기")}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importJsonl(file);
          }}
        />
        <input
          className="search"
          type="search"
          aria-label={t("Example 검색")}
          value={search}
          placeholder={t("Example 검색")}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        {selectedIds.length ? (
          <div className="bulk-actions">
            <button
              className="lf-btn is-danger"
              type="button"
              onClick={() => setConfirmOpen(true)}
            >
              Delete ({selectedIds.length})
            </button>
          </div>
        ) : null}
        <span className="count">{t("{n}개", {n: visible.length})}</span>
      </div>
      {error ? <p className="mutation-status is-error">{error}</p> : null}
      {/* The live region stays mounted so a later message is announced. */}
      <p
        className={`mutation-status${jsonlStatus?.tone === "error" ? " is-error" : ""}`}
        data-tone={jsonlStatus?.tone}
        role="status"
        aria-live={jsonlStatus?.tone === "error" ? "assertive" : "polite"}
      >
        {jsonlStatus?.text ?? ""}
      </p>
      <section className="table-shell">
        <table>
          <SelectColGroup columns={columns} />
          <thead>
            <tr>
              <th className="select-col">
                <input
                  type="checkbox"
                  aria-label={t("모든 example 선택")}
                  checked={
                    visible.length > 0 &&
                    visible.every((example) =>
                      selectedIds.includes(example.dataset_example_id),
                    )
                  }
                  onChange={(event) =>
                    setSelectedIds(
                      event.target.checked
                        ? visible.map((example) => example.dataset_example_id)
                        : [],
                    )
                  }
                />
              </th>
              {columns.order.map((id) => {
                const def = EXAMPLE_COLUMNS.find((c) => c.id === id)!;
                return (
                  <ColumnHeaderCell
                    key={id}
                    id={id}
                    label={t(def.label)}
                    columns={columns}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pagedVisible.length === 0 ? (
              <tr>
                <td colSpan={columns.order.length + 1}>
                  <EmptyBlock>{t("등록된 Example이 없습니다.")}</EmptyBlock>
                </td>
              </tr>
            ) : (
              pagedVisible.map((example) => {
                const cell: Record<string, ReactNode> = {
                  input: (
                    <span className="json">{valuePreview(example.input)}</span>
                  ),
                  expected_output: (
                    <span className="json">
                      {valuePreview(example.expected_output)}
                    </span>
                  ),
                  metadata: (
                    <span className="json">
                      {jsonPreview(example.metadata)}
                    </span>
                  ),
                };
                return (
                  <tr
                    className="example-row"
                    key={example.dataset_example_id}
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("input"))
                        return;
                      openEdit(example);
                    }}
                    onKeyDown={(event) => {
                      if ((event.target as HTMLElement).closest("input"))
                        return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openEdit(example);
                      }
                    }}
                  >
                    <td className="select-col">
                      <input
                        type="checkbox"
                        aria-label={t("Example 선택")}
                        checked={selectedIds.includes(
                          example.dataset_example_id,
                        )}
                        onChange={(event) =>
                          setSelectedIds((ids) =>
                            event.target.checked
                              ? [...ids, example.dataset_example_id]
                              : ids.filter(
                                  (id) => id !== example.dataset_example_id,
                                ),
                          )
                        }
                      />
                    </td>
                    {columns.order.map((id) => (
                      <td key={id}>{cell[id]}</td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
      {visible.length > 0 ? (
        <Pagination page={page} totalPages={totalPages} onChange={setPage} />
      ) : null}
      <Modal
        open={confirmOpen}
        title={t("선택한 Example을 삭제할까요?")}
        onClose={() => {
          if (!pending) setConfirmOpen(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t("{n}개 example이 영구 삭제되며, dataset revision이 올라갑니다.", {
              n: selectedIds.length,
            })}
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={pending}
              onClick={() => void removeSelected()}
            >
              {pending ? t("삭제 중…") : t("삭제")}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={addOpen}
        title="Add Example"
        onClose={() => {
          if (!addPending) setAddOpen(false);
        }}
      >
        <form
          className="lf-modal-body"
          onSubmit={(event) => void submitAdd(event)}
        >
          <label className="modal-field">
            Input (JSON)
            <textarea
              autoFocus
              required
              rows={4}
              value={addInput}
              placeholder='{"question": "..."}'
              onChange={(event) => setAddInput(event.target.value)}
            />
          </label>
          <label className="modal-field">
            {t("Reference output (JSON, 선택 사항)")}
            <textarea
              rows={3}
              value={addOutput}
              placeholder='{"answer": "..."}'
              onChange={(event) => setAddOutput(event.target.value)}
            />
          </label>
          <label className="modal-field">
            {t("Metadata (JSON object, 선택 사항)")}
            <textarea
              rows={2}
              value={addMetadata}
              placeholder="{}"
              onChange={(event) => setAddMetadata(event.target.value)}
            />
          </label>
          {addError ? (
            <p className="mutation-status is-error" role="alert">
              {t(addError)}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              onClick={() => setAddOpen(false)}
              disabled={addPending}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-primary"
              type="submit"
              disabled={addPending}
            >
              {addPending ? t("추가 중…") : t("추가")}
            </button>
          </div>
        </form>
      </Modal>
      <div
        className={`trace-scrim${editingId ? " is-open" : ""}`}
        onClick={() => !editPending && setEditingId(null)}
      />
      <aside
        className={`trace-drawer${editingId ? " is-open" : ""}`}
        style={{ "--drawer-width": `${drawerWidth}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exampleDrawerTitle"
        aria-hidden={editingId === null}
      >
        {editingId === null ? null : (
          <>
            <span
              className="drawer-resize"
              onPointerDown={(event) => {
                drawerResize.current = {
                  startX: event.clientX,
                  startWidth: drawerWidth,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              aria-hidden="true"
            />
            <header className="drawer-head">
              <div className="drawer-title">
                <h2 id="exampleDrawerTitle">{t("Example 수정")}</h2>
                <p>{editingId}</p>
              </div>
              <div className="drawer-actions">
                <button
                  className="lf-icon-btn"
                  type="button"
                  aria-label={t("닫기")}
                  onClick={() => setEditingId(null)}
                >
                  <IconClose />
                </button>
              </div>
            </header>
            <div className="drawer-body">
              {editingExample ? (
                <form
                  className="lf-modal-body"
                  onSubmit={(event) => void submitEdit(event)}
                >
                  <label className="modal-field">
                    Input (JSON)
                    <textarea
                      autoFocus
                      required
                      rows={6}
                      value={editInput}
                      onChange={(event) => setEditInput(event.target.value)}
                    />
                  </label>
                  <label className="modal-field">
                    {t("Reference output (JSON, 선택 사항)")}
                    <textarea
                      rows={5}
                      value={editOutput}
                      onChange={(event) => setEditOutput(event.target.value)}
                    />
                  </label>
                  <label className="modal-field">
                    {t("Metadata (JSON object, 선택 사항)")}
                    <textarea
                      rows={3}
                      value={editMetadata}
                      onChange={(event) => setEditMetadata(event.target.value)}
                    />
                  </label>
                  {editError ? (
                    <p className="mutation-status is-error" role="alert">
                      {t(editError)}
                    </p>
                  ) : null}
                  <div className="modal-actions">
                    <button
                      className="lf-btn"
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={editPending}
                    >
                      {t("취소")}
                    </button>
                    <button
                      className="lf-btn is-primary"
                      type="submit"
                      disabled={editPending}
                    >
                      {editPending ? t("저장 중…") : t("저장")}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function ExperimentsPanel({
  summaries,
  selectedIds,
  comparisons,
  metrics,
  compareState,
  warning,
  onMetricsToggle,
  onToggle,
  onOpen,
  onDelete,
}: {
  summaries: ExperimentSummary[];
  selectedIds: string[];
  comparisons: ReturnType<typeof compareExperiments>;
  metrics: string[];
  compareState: LoadState;
  warning: string;
  onMetricsToggle: (key: string, checked: boolean) => void;
  onToggle: (summary: ExperimentSummary, checked: boolean) => void;
  onOpen: (experimentId: string) => void;
  onDelete: (experimentIds: string[]) => Promise<void>;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [metricPickerOpen, setMetricPickerOpen] = useState(false);
  const metricPickerRef = useRef<HTMLDivElement | null>(null);
  const columns = useReorderableColumns(EXPERIMENT_COLUMNS);

  useEffect(() => {
    if (!metricPickerOpen) return;
    const dismiss = (event: MouseEvent) => {
      const target = event.target;
      if (metricPickerRef.current?.contains(target as Node)) return;
      if (
        target instanceof Element &&
        target.closest('[aria-controls="metricPicker"]')
      )
        return;
      setMetricPickerOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [metricPickerOpen]);
  const visible = summaries.filter((summary) =>
    summary.name.toLowerCase().includes(search.toLowerCase()),
  );
  const sortedVisible = useMemo(
    () => sortRows(visible, columns.sort, EXPERIMENT_SORT_VALUES),
    [visible, columns.sort],
  );

  const removeSelected = async () => {
    setPending(true);
    setError("");
    try {
      await onDelete(selectedIds);
      setConfirmOpen(false);
    } catch {
      setError("선택한 Experiment를 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };
  const firstStats = comparisons[0]?.stats;
  const metricOptions =
    comparisons.length > 1 && firstStats
      ? [...firstStats.keys()].filter((key) =>
          comparisons.every(
            (comparison) =>
              comparison.stats.get(key)?.dataType ===
              firstStats.get(key)?.dataType,
          ),
        )
      : [];
  const mismatch = hasDatasetRevisionMismatch(
    comparisons.map((comparison) => ({
      dataset_revision:
        summaries.find(
          (summary) => summary.experiment_id === comparison.experimentId,
        )?.dataset_revision ?? -1,
    })),
  );
  return (
    <section>
      <div className="compare-grid">
        <article className="chart-card">
          <header className="chart-head">
            <div>
              <h2>Metric comparison</h2>
            </div>
            {metricOptions.length ? (
              <div className="metric-picker-anchor">
                <button
                  className="lf-btn"
                  type="button"
                  aria-expanded={metricPickerOpen}
                  aria-controls="metricPicker"
                  onClick={() => setMetricPickerOpen((open) => !open)}
                >
                  Metrics{metrics.length ? ` (${metrics.length})` : ""}
                  <span className="caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {metricPickerOpen ? (
                  <div
                    className="metric-picker"
                    id="metricPicker"
                    ref={metricPickerRef}
                  >
                    {metricOptions.map((key) => {
                      const active = metrics.includes(key);
                      return (
                        <label className="score-choice" key={key}>
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={(event) =>
                              onMetricsToggle(key, event.target.checked)
                            }
                          />
                          <span>{key}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>
          {compareState === "loading" ? (
            <LoadingBlock />
          ) : compareState === "error" ? (
            <ErrorBlock message={t("Experiment 상세를 불러오지 못했습니다.")} />
          ) : comparisons.length < 2 ? (
            <p className="chart-empty">
              {t("같은 revision의 experiment를 2–4개 선택하세요.")}
            </p>
          ) : (
            <MetricBars comparisons={comparisons} metrics={metrics} />
          )}
        </article>
        <article className="chart-card">
          <header className="chart-head">
            <div>
              <h2>Selection</h2>
            </div>
          </header>
          {comparisons.length < 2 ? (
            <p className="chart-empty">
              {t("같은 revision의 experiment를 2–4개 선택하세요.")}
            </p>
          ) : (
            <div className="selection-table-wrap">
              <table className="selection-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {comparisons.map((comparison, index) => (
                      <th key={comparison.experimentId}>
                        <span className={`legend-color c${index}`} />
                        {comparison.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((key) => (
                    <tr key={key}>
                      <td className="mono">{key}</td>
                      {comparisons.map((comparison) => (
                        <td key={comparison.experimentId}>
                          {formatStat(
                            comparison.stats.get(key)?.value ?? null,
                            comparison.stats.get(key)?.dataType,
                            t,
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
      <p className={`selection-note${warning || mismatch ? " warn" : ""}`}>
        {warning
          ? t(warning)
          : mismatch
            ? t("같은 dataset revision만 함께 비교할 수 있습니다.")
            : t("동일 dataset revision의 experiment를 최대 4개 비교할 수 있습니다.")}
      </p>
      <div className="dataset-toolbar">
        <input
          className="search"
          type="search"
          aria-label={t("Experiment 검색")}
          value={search}
          placeholder={t("Experiment 검색")}
          onChange={(event) => setSearch(event.target.value)}
        />
        {selectedIds.length ? (
          <div className="bulk-actions">
            <button
              className="lf-btn is-danger"
              type="button"
              onClick={() => setConfirmOpen(true)}
            >
              Delete ({selectedIds.length})
            </button>
          </div>
        ) : null}
        <span className="count">{t("{n}개", {n: visible.length})}</span>
      </div>
      {error ? <p className="mutation-status is-error">{error}</p> : null}
      <section className="table-shell">
        <table>
          <SelectColGroup columns={columns} />
          <thead>
            <tr>
              <th className="select-col">
                <span>✓</span>
              </th>
              {columns.order.map((id) => {
                const def = EXPERIMENT_COLUMNS.find((c) => c.id === id)!;
                return (
                  <ColumnHeaderCell
                    key={id}
                    id={id}
                    label={t(def.label)}
                    columns={columns}
                  />
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedVisible.length === 0 ? (
              <tr>
                <td colSpan={columns.order.length + 1}>
                  <EmptyBlock>{t("기록된 Experiment가 없습니다.")}</EmptyBlock>
                </td>
              </tr>
            ) : (
              sortedVisible.map((summary) => {
                const cell: Record<string, ReactNode> = {
                  name: summary.name,
                  status: (
                    <span className={`experiment-status is-${summary.status}`}>
                      {summary.status}
                    </span>
                  ),
                  revision: `r${summary.dataset_revision}`,
                  cases: (
                    <>
                      {summary.completed_case_count +
                        summary.failed_case_count}{" "}
                      / {summary.case_count}
                    </>
                  ),
                  duration: experimentDuration(summary),
                };
                const cellClass: Record<string, string> = {
                  name: "mono",
                  revision: "mono",
                  cases: "mono",
                  duration: "mono",
                };
                return (
                  <tr
                    className="experiment-row"
                    key={summary.experiment_id}
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("input"))
                        return;
                      onOpen(summary.experiment_id);
                    }}
                    onKeyDown={(event) => {
                      if ((event.target as HTMLElement).closest("input"))
                        return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(summary.experiment_id);
                      }
                    }}
                  >
                    <td className="select-col">
                      <input
                        type="checkbox"
                        aria-label={t("{name} 선택", {name: summary.name})}
                        checked={selectedIds.includes(summary.experiment_id)}
                        onChange={(event) =>
                          onToggle(summary, event.target.checked)
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
              })
            )}
          </tbody>
        </table>
      </section>
      <Modal
        open={confirmOpen}
        title={t("선택한 Experiment를 삭제할까요?")}
        onClose={() => {
          if (!pending) setConfirmOpen(false);
        }}
      >
        <div className="lf-modal-body">
          <p className="modal-copy">
            {t("{n}개 experiment와 기록된 case 결과가 영구 삭제됩니다.", {
              n: selectedIds.length,
            })}
          </p>
          <div className="modal-actions">
            <button
              className="lf-btn"
              type="button"
              disabled={pending}
              onClick={() => setConfirmOpen(false)}
            >
              {t("취소")}
            </button>
            <button
              className="lf-btn is-danger"
              type="button"
              disabled={pending}
              onClick={() => void removeSelected()}
            >
              {pending ? t("삭제 중…") : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

function MetricBars({
  comparisons,
  metrics,
}: {
  comparisons: ReturnType<typeof compareExperiments>;
  metrics: string[];
}) {
  const t = useT();
  const [hover, setHover] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const trackHover =
    (key: string) => (event: ReactMouseEvent<HTMLDivElement>) => {
      // Percentages of the hovered group: a pointer offset measured in
      // viewport pixels is not the same unit as the CSS left it would feed.
      const rect = event.currentTarget.getBoundingClientRect();
      setHover({
        key,
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      });
    };
  return (
    <>
      <div className="bar-chart">
        <div className="bar-chart-yaxis" aria-hidden="true">
          <div className="bar-chart-yaxis-ticks">
            {[0, 25, 50, 75, 100].map((pct) => (
              <span key={pct} style={{ top: `${100 - pct}%` }}>
                {pct}%
              </span>
            ))}
          </div>
          <span className="bar-chart-yaxis-spacer" />
        </div>
        {metrics.map((key) => {
          const stats = comparisons.map((comparison) =>
            comparison.stats.get(key),
          );
          const max = Math.max(
            1,
            ...stats.map((stat) => stat?.value ?? 0),
          );
          return (
            <div
              className="bar-group"
              key={key}
              onMouseMove={trackHover(key)}
              onMouseLeave={() =>
                setHover((current) => (current?.key === key ? null : current))
              }
            >
              <div className="bar-group-bars">
                {comparisons.map((comparison, index) => {
                  const stat = stats[index];
                  return (
                    <div
                      key={comparison.experimentId}
                      className={`bar c${index}`}
                      title={`${comparison.name}: ${formatStat(stat?.value ?? null, stat?.dataType, t)}`}
                      style={{
                        height: `${Math.max(3, ((stat?.value ?? 0) / max) * 100)}%`,
                      }}
                    />
                  );
                })}
              </div>
              <span className="bar-group-label">{key}</span>
              {hover?.key === key ? (
                <div
                  className="chart-tooltip"
                  role="status"
                  style={{
                    left: `${hover.x}%`,
                    top: `${hover.y}%`,
                    marginLeft: 15,
                    marginTop: -10,
                  }}
                >
                  <span className="tooltip-time">{key}</span>
                  {comparisons.map((comparison, index) => {
                    const stat = stats[index];
                    return (
                      <span
                        className={`tooltip-row c${index}`}
                        key={comparison.experimentId}
                      >
                        <span className="tooltip-label">{comparison.name}</span>
                        <b>{formatStat(stat?.value ?? null, stat?.dataType, t)}</b>
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {comparisons.map((comparison, index) => (
          <span key={comparison.experimentId}>
            <i className={`legend-color c${index}`} />
            {comparison.name}
          </span>
        ))}
      </div>
    </>
  );
}

function formatStat(
  value: number | null,
  kind: "boolean" | "number" | undefined,
  t: Translate,
): string {
  if (value === null) return t("값 없음");
  return kind === "boolean" ? `${(value * 100).toFixed(1)}%` : value.toFixed(3);
}

function formatEvaluatorValue(
  result: ExperimentCase["evaluator_results"][number] | undefined,
  dataType: "boolean" | "number",
  t: Translate,
): string {
  if (!result) return "—";
  // error_message는 사용자 코드가 낸 문자열이다. 번역하지 않는다.
  if (result.error_message) return t("오류: {message}", {message: result.error_message});
  if (result.value === null) return "—";
  return dataType === "boolean"
    ? result.value
      ? "true"
      : "false"
    : String(result.value);
}

function evaluatorCell(
  result: ExperimentCase["evaluator_results"][number] | undefined,
  dataType: "boolean" | "number",
  t: Translate,
): ReactNode {
  const value = formatEvaluatorValue(result, dataType, t);
  if (!result?.rationale) return value;
  return (
    <>
      {value}
      <details className="evaluator-rationale">
        <summary>{t("근거 보기")}</summary>
        <p>{result.rationale}</p>
      </details>
    </>
  );
}

function ExperimentDrawer({
  experimentId,
  experiment,
  state,
  error,
  onClose,
  drawerWidth,
  onResizeStart,
}: {
  experimentId: string | null;
  experiment: Experiment | null;
  state: LoadState;
  error: string;
  onClose: () => void;
  drawerWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLSpanElement>) => void;
}) {
  const t = useT();
  return (
    <>
      <div
        className={`trace-scrim${experimentId ? " is-open" : ""}`}
        onClick={onClose}
      />
      <aside
        className={`trace-drawer experiment-drawer${experimentId ? " is-open" : ""}`}
        style={{ "--drawer-width": `${drawerWidth}px` } as CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby="experimentDrawerTitle"
        aria-hidden={experimentId === null}
      >
        {experimentId === null ? null : (
          <>
            <span
              className="drawer-resize"
              onPointerDown={onResizeStart}
              aria-hidden="true"
            />
            <header className="drawer-head">
              <div className="drawer-title">
                <h2 id="experimentDrawerTitle">
                  {experiment?.name ?? "Experiment"}
                </h2>
                <p>{experimentId}</p>
              </div>
              <div className="drawer-actions">
                <button
                  className="lf-icon-btn"
                  type="button"
                  aria-label={t("상세 닫기")}
                  onClick={onClose}
                >
                  <IconClose />
                </button>
              </div>
            </header>
            <div className="drawer-body">
              {state === "loading" ? (
                <LoadingBlock label={t("Experiment 상세를 불러오는 중…")} />
              ) : state === "error" ? (
                <ErrorBlock message={t(error)} />
              ) : experiment ? (
                <>
                  <div className="trace-meta">
                    <div>
                      <span>{t("상태")}</span>
                      <b>{experiment.status}</b>
                    </div>
                    <div>
                      <span>Revision</span>
                      <b>r{experiment.dataset_revision}</b>
                    </div>
                    <div>
                      <span>Cases</span>
                      <b>
                        {experiment.completed_case_count +
                          experiment.failed_case_count}{" "}
                        / {experiment.case_count}
                      </b>
                    </div>
                    <div>
                      <span>Duration</span>
                      <b>{experimentDuration(experiment)}</b>
                    </div>
                  </div>
                  <ExperimentCaseTable
                    key={experiment.experiment_id}
                    experiment={experiment}
                  />
                </>
              ) : null}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function ExperimentCaseTable({ experiment }: { experiment: Experiment }) {
  const t = useT();
  const caseColumns = useMemo<ReorderableColumnDef[]>(
    () => [
      { id: "input", label: "Input", width: 275 },
      { id: "expected_output", label: "Expected Output", width: 275 },
      { id: "output", label: "Output", width: 275 },
      { id: "metadata", label: "Metadata", width: 250 },
      ...experiment.evaluators.map((evaluator) => ({
        id: `evaluator:${evaluator.experiment_evaluator_id}`,
        label: evaluator.name,
        width: 130,
      })),
      { id: "duration", label: "Duration", width: 125 },
    ],
    [experiment.evaluators],
  );
  const columns = useReorderableColumns(caseColumns);
  const sortAccessors = useMemo<
    Record<string, (experimentCase: ExperimentCase) => string | number>
  >(() => {
    const accessors: Record<
      string,
      (experimentCase: ExperimentCase) => string | number
    > = {
      input: (experimentCase) => valuePreview(experimentCase.input),
      expected_output: (experimentCase) =>
        valuePreview(experimentCase.expected_output),
      output: (experimentCase) => valuePreview(experimentCase.output),
      metadata: (experimentCase) => jsonPreview(experimentCase.metadata),
      duration: (experimentCase) => experimentCase.duration_us ?? -1,
    };
    for (const evaluator of experiment.evaluators) {
      accessors[`evaluator:${evaluator.experiment_evaluator_id}`] = (
        experimentCase,
      ) =>
        formatEvaluatorValue(
          experimentCase.evaluator_results.find(
            (result) => result.evaluator_key === evaluator.key,
          ),
          evaluator.data_type,
          t,
        );
    }
    return accessors;
  }, [experiment.evaluators, t]);
  const sortedCases = useMemo(
    () => sortRows(experiment.cases, columns.sort, sortAccessors),
    [experiment.cases, columns.sort, sortAccessors],
  );

  return (
    <section className="table-shell">
      <table>
        <colgroup>
          {columns.order.map((id) => (
            <col key={id} style={{ width: columns.widths[id] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.order.map((id) => {
              const def = caseColumns.find((c) => c.id === id)!;
              return (
                <ColumnHeaderCell
                  key={id}
                  id={id}
                  label={t(def.label)}
                  columns={columns}
                />
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedCases.map((experimentCase) => {
            const cell: Record<string, ReactNode> = {
              input: valuePreview(experimentCase.input),
              expected_output: valuePreview(experimentCase.expected_output),
              output: valuePreview(experimentCase.output),
              metadata: jsonPreview(experimentCase.metadata),
              duration:
                experimentCase.duration_us === null
                  ? "—"
                  : formatDuration(experimentCase.duration_us),
            };
            for (const evaluator of experiment.evaluators) {
              cell[`evaluator:${evaluator.experiment_evaluator_id}`] =
                evaluatorCell(
                  experimentCase.evaluator_results.find(
                    (result) => result.evaluator_key === evaluator.key,
                  ),
                  evaluator.data_type,
                  t,
                );
            }
            return (
              <tr key={experimentCase.experiment_case_id}>
                {columns.order.map((id) => (
                  <td key={id} className={id === "duration" ? "mono" : undefined}>
                    {cell[id]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
