import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { setViewportMatches } from "./test/setup";

const api = vi.hoisted(() => ({
  addAnnotationQueueItems: vi.fn(),
  addDatasetExample: vi.fn(),
  addTraceToDataset: vi.fn(),
  archiveScore: vi.fn(),
  completeAnnotationQueueItem: vi.fn(),
  createAnnotationQueue: vi.fn(),
  createScore: vi.fn(),
  deleteAnnotation: vi.fn(),
  deleteAnnotationQueue: vi.fn(),
  deleteAnnotationQueueItem: vi.fn(),
  deleteScore: vi.fn(),
  deleteTrace: vi.fn(),
  downloadBackup: vi.fn(),
  getAnnotationQueue: vi.fn(),
  getAnnotationQueues: vi.fn(),
  getDashboard: vi.fn(),
  getDataset: vi.fn(),
  getDatasets: vi.fn(),
  getExperiment: vi.fn(),
  getExperiments: vi.fn(),
  getObservation: vi.fn(),
  getScores: vi.fn(),
  getTrace: vi.fn(),
  getTraces: vi.fn(),
  putAnnotation: vi.fn(),
  putTraceMemo: vi.fn(),
  resetAllData: vi.fn(),
  updateScore: vi.fn(),
}));

vi.mock("./api/client", () => api);

const startedAt = "2026-08-02T01:00:00.000Z";
const trace = {
  trace_id: "tr_001",
  name: "Policy answer",
  started_at: startedAt,
  ended_at: "2026-08-02T01:00:01.000Z",
  duration_us: 1_000_000,
  status: "completed" as const,
  session_id: "session_01",
  user_id: null,
  release: null,
  environment: "local",
  tags: [],
  observation_count: 1,
  input_preview: "청년 정책 알려줘",
  output_preview: "지원 조건을 확인하세요.",
  total_tokens: 1_374,
  time_to_first_token_us: 2_960_000,
};

const score = {
  score_config_id: "score_001",
  name: "정확성",
  description: null,
  data_type: "boolean" as const,
  boolean_true_label: "좋음",
  boolean_false_label: "나쁨",
  number_min: null,
  number_max: null,
  categorical_selection_mode: null,
  options: [],
  created_at: startedAt,
  updated_at: startedAt,
  archived_at: null,
  has_annotations: false,
  is_used: false,
};

function mockDefaults() {
  api.getDashboard.mockResolvedValue({
    from: startedAt,
    to: startedAt,
    timezone: "UTC",
    bucket: "day",
    totals: {
      trace_count: 1,
      latency_us: { p50: 1_000, p95: 1_000, p99: 1_000 },
      error: { failed: 0, total: 1, rate: 0 },
      llm_calls: 1,
      tool_calls: 0,
    },
    available_tools: [],
    buckets: [],
  });
  api.getTraces.mockResolvedValue({ items: [trace], next_cursor: null });
  api.getTrace.mockResolvedValue({
    ...trace,
    observations: [
      {
        observation_id: "obs_001",
        trace_id: trace.trace_id,
        parent_observation_id: null,
        sequence: 0,
        name: "answer",
        kind: "llm",
        started_at: startedAt,
        ended_at: trace.ended_at,
        duration_us: 1_000_000,
        time_to_first_token_us: null,
        status: "completed",
        model: null,
      },
    ],
    score_configs: [score],
    annotations: [],
    memo: null,
    previous_trace_id: null,
    next_trace_id: null,
  });
  api.getObservation.mockResolvedValue({
    observation_id: "obs_001",
    trace_id: trace.trace_id,
    parent_observation_id: null,
    sequence: 0,
    name: "answer",
    kind: "llm",
    started_at: startedAt,
    ended_at: trace.ended_at,
    duration_us: 1_000_000,
    time_to_first_token_us: null,
    status: "completed",
    input: { question: "청년 정책" },
    output: { answer: "지원 조건을 확인하세요." },
    error: null,
    model: null,
    usage: null,
    metadata: {},
  });
  api.getAnnotationQueues.mockResolvedValue({ items: [] });
  api.getAnnotationQueue.mockResolvedValue({
    annotation_queue_id: "queue_001",
    name: "Release review",
    description: null,
    score_config_ids: [],
    items: [],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.getScores.mockResolvedValue({ items: [score] });
  api.getDatasets.mockResolvedValue({
    items: [
      {
        dataset_id: "dataset_001",
        name: "Youth policy",
        description: "평가 데이터",
        revision: 3,
        example_count: 1,
        created_at: startedAt,
        updated_at: startedAt,
      },
    ],
  });
  api.getDataset.mockResolvedValue({
    dataset_id: "dataset_001",
    name: "Youth policy",
    description: "평가 데이터",
    revision: 3,
    examples: [
      {
        dataset_example_id: "example_001",
        input: { question: "지원 대상" },
        expected_output: { answer: "청년" },
        metadata: {},
      },
    ],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.getExperiments.mockResolvedValue({ items: [] });
  api.getExperiment.mockResolvedValue(null);
  api.addAnnotationQueueItems.mockResolvedValue({});
  api.addTraceToDataset.mockResolvedValue({});
  api.archiveScore.mockResolvedValue(score);
  api.completeAnnotationQueueItem.mockResolvedValue({});
  api.createAnnotationQueue.mockResolvedValue({
    annotation_queue_id: "queue_002",
    name: "New Queue",
    description: null,
    score_config_ids: [],
    items: [],
    created_at: startedAt,
    updated_at: startedAt,
  });
  api.createScore.mockResolvedValue({
    ...score,
    score_config_id: "score_002",
    name: "새 점수",
  });
  api.deleteAnnotation.mockResolvedValue(undefined);
  api.deleteAnnotationQueue.mockResolvedValue(undefined);
  api.deleteAnnotationQueueItem.mockResolvedValue(undefined);
  api.deleteScore.mockResolvedValue(undefined);
  api.deleteTrace.mockResolvedValue(undefined);
  api.downloadBackup.mockResolvedValue(undefined);
  api.putAnnotation.mockResolvedValue({});
  api.putTraceMemo.mockResolvedValue(null);
  api.resetAllData.mockResolvedValue(undefined);
  api.updateScore.mockResolvedValue(score);
}

/**
 * 기본 진입은 Overview다. Traces를 보는 test는 진입 URL을 직접 정해
 * navigation 클릭 한 단계를 줄인다.
 */
function renderTraces() {
  window.history.replaceState(null, "", "/?view=traces");
  return render(<App />);
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  mockDefaults();
  window.history.replaceState(null, "", "/");
});

describe("V2 presentation", () => {
  it("keeps the four V2 surfaces and opens a trace investigation drawer", async () => {
    const user = userEvent.setup();
    render(<App />);

    // 기본 진입은 Overview다.
    await screen.findByRole("heading", { name: "Overview" });
    expect(screen.getByRole("button", { name: "Overview" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Traces" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Evaluate" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Settings" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    // 기획서 05절: dataset 안에 다시 탭을 두지 않고 세그먼트 넷으로 편다.
    expect(screen.getByRole("button", { name: "Examples" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Experiments" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Queues" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Scores" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Traces" }));
    await screen.findByRole("heading", { name: "Traces" });
    await user.click((await screen.findAllByText("tr_001"))[0]);
    // 상세는 목록을 덮지 않으므로 dialog가 아니다.
    expect(
      await screen.findByRole("complementary", { name: "Trace 상세" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "+ Add scores" }));
    await user.click(screen.getByRole("checkbox", { name: /정확성/ }));
    await user.click(screen.getByRole("button", { name: "추가" }));
    expect(screen.getByText("정확성")).toBeVisible();
  });

  it("opens an Overview recent trace drawer from click and Enter, then restores its trigger", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Overview" }));
    const row = await screen.findByRole("button", {
      name: "tr_001 상세 열기",
    });
    expect(within(row).getByText("지원 조건을 확인하세요.")).toBeInTheDocument();
    expect(within(row).queryByText("상세에서 확인")).toBeNull();
    await user.click(row);

    expect(new URLSearchParams(window.location.search).get("view")).toBe(
      "overview",
    );
    expect(new URLSearchParams(window.location.search).get("trace")).toBe(
      "tr_001",
    );
    expect(
      await screen.findByRole("dialog", { name: "Policy answer" }),
    ).toBeVisible();
    await screen.findByText("answer", { selector: ".io-card-head span" });
    expect(
      screen.getByText("LLM", {
        selector: ".io-card-head .runtime-child-kind",
      }),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: "Annotations" }),
    ).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "저장" });
    await user.click(saveButton);
    await waitFor(() => {
      expect(api.putTraceMemo).toHaveBeenCalledWith("tr_001", "");
    });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());

    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("dialog", { name: "Policy answer" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(row).toHaveFocus());
  });

  it("closes the Add to queue picker and resets its parent action state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Traces" }));
    await screen.findAllByText("tr_001");
    expect(screen.getByText("지원 조건을 확인하세요.")).toBeInTheDocument();
    expect(screen.queryByText("상세에서 확인")).toBeNull();
    await user.click(screen.getAllByText("tr_001")[0]);
    await screen.findByRole("complementary", { name: "Trace 상세" });

    const actionButton = screen.getByRole("button", { name: "Trace 작업" });
    await user.click(actionButton);
    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(
      await screen.findByRole("dialog", { name: "Add to queue" }),
    ).toBeVisible();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Add to queue" }),
      ).not.toBeInTheDocument();
      expect(actionButton).toHaveAttribute("aria-expanded", "false");
    });

    // 상세는 단이라 닫히지 않는다 — Escape가 목록을 비우지 않는다.
    await user.keyboard("{Escape}");
    expect(
      screen.getByRole("complementary", { name: "Trace 상세" }),
    ).toBeVisible();
  });

  it("uses the V2 four-field Traces toolbar while retaining relative-period API bounds", async () => {
    const user = userEvent.setup();
    renderTraces();

    await user.click(screen.getByRole("button", { name: "Traces" }));
    const search = await screen.findByRole("searchbox", { name: "검색" });
    const form = search.closest("form");
    if (!form) throw new Error("Trace filter form is missing");

    expect(within(form).getByRole("combobox", { name: "상태" })).toBeVisible();
    const period = within(form).getByRole("combobox", { name: "기간" });
    expect(within(form).getByRole("textbox", { name: "태그" })).toBeVisible();
    expect(within(form).queryByLabelText("시작")).not.toBeInTheDocument();
    expect(within(form).queryByLabelText("종료")).not.toBeInTheDocument();
    expect(
      within(form).queryByLabelText("Session ID"),
    ).not.toBeInTheDocument();

    await user.selectOptions(period, "24h");
    await user.click(within(form).getByRole("button", { name: "적용" }));
    await waitFor(() => expect(api.getTraces).toHaveBeenCalledTimes(2));
    const query = api.getTraces.mock.calls.at(-1)?.[0];
    expect(query).toEqual(
      expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
        session_id: undefined,
      }),
    );
    expect(Date.parse(query.to) - Date.parse(query.from)).toBe(24 * 60 * 60 * 1_000);
  });

  it("creates a score through the V2 modal", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    await user.click(screen.getByRole("button", { name: "Scores" }));
    await screen.findByRole("button", { name: "+ New Score" });
    await user.click(screen.getByRole("button", { name: "+ New Score" }));
    await user.type(
      screen.getByRole("textbox", { name: "Score 이름" }),
      "새 점수",
    );
    await user.click(screen.getByRole("button", { name: "Score 생성" }));

    await waitFor(() => expect(api.createScore).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("dialog", { name: "New Score" }),
    ).not.toBeInTheDocument();
  });

  it("creates an annotation queue through the V2 queue dialog", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    await user.click(screen.getByRole("button", { name: "Queues" }));
    await user.click(await screen.findByRole("button", { name: "+ New Queue" }));
    await user.type(screen.getByRole("textbox", { name: "이름" }), "릴리스 검토");
    await user.click(screen.getByRole("button", { name: "생성" }));

    await waitFor(() => expect(api.createAnnotationQueue).toHaveBeenCalledOnce());
  });

  it("uses the V2 RESET confirmation before clearing local data", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.type(
      screen.getByRole("textbox", { name: "계속하려면 RESET 입력" }),
      "RESET",
    );
    await user.click(screen.getByRole("button", { name: "초기화" }));
    expect(
      screen.getByRole("dialog", { name: "로컬 데이터를 초기화할까요?" }),
    ).toBeVisible();
    await user.click(
      within(
        screen.getByRole("dialog", { name: "로컬 데이터를 초기화할까요?" }),
      ).getByRole("button", { name: "초기화" }),
    );

    await waitFor(() => expect(api.resetAllData).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("heading", { name: "Traces" }),
    ).toBeVisible();
  });

  it("imports JSONL line by line and reports the failed source lines", async () => {
    const user = userEvent.setup();
    api.addDatasetExample
      .mockResolvedValueOnce({
        dataset_id: "dataset_001",
        name: "Youth policy",
        description: "평가 데이터",
        revision: 4,
        examples: [],
        created_at: startedAt,
        updated_at: startedAt,
      })
      .mockRejectedValueOnce(new Error("write failed"));
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    await user.click(
      await screen.findByRole("button", { name: /Youth policy/ }),
    );
    await user.click(
      await screen.findByRole("button", { name: "JSONL 작업 메뉴" }),
    );
    expect(screen.getByRole("menuitem", { name: "Export" })).toBeEnabled();
    await user.click(screen.getByRole("menuitem", { name: "Import" }));
    await user.upload(
      screen.getByLabelText("JSONL 가져오기"),
      new File(
        [
          '{"input":{"question":"첫 줄"},"metadata":{"source":"jsonl"}}\n',
          '{"input":\n',
          '{"input":{"question":"셋째 줄"},"expected_output":{"answer":"답"}}\n',
        ],
        "examples.jsonl",
        { type: "application/x-ndjson" },
      ),
    );

    expect(
      await screen.findByText("JSONL import: 1개 추가, 실패한 줄 2, 3."),
    ).toHaveAttribute("data-tone", "error");
    expect(api.addDatasetExample).toHaveBeenCalledTimes(2);
    expect(
      api.addDatasetExample.mock.calls.map(([, example]) => example),
    ).toEqual([
      {
        input: { question: "첫 줄" },
        expected_output: null,
        metadata: { source: "jsonl" },
      },
      {
        input: { question: "셋째 줄" },
        expected_output: { answer: "답" },
        metadata: {},
      },
    ]);
  });

  it("Evaluate는 세그먼트 넷이고 dataset context는 그 위에 남는다", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Evaluate" }));
    // 기본 세그먼트는 Examples이고, dataset을 고르기 전에는 목록이 그 자리에 온다.
    expect(screen.getByRole("button", { name: "Examples" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(
      await screen.findByRole("button", { name: /Youth policy/ }),
    );

    // 고른 dataset은 세그먼트를 옮겨도 계속 보인다 — 이중 구조를 편 이유다.
    const context = await screen.findByRole("region", { name: "Dataset" });
    expect(within(context).getByText("Youth policy")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Experiments" }));
    expect(screen.getByRole("button", { name: "Experiments" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(
        await screen.findByRole("region", { name: "Dataset" }),
      ).getByText("Youth policy"),
    ).toBeVisible();

    // context bar에서 다른 dataset으로 돌아갈 수 있다.
    await user.click(screen.getByRole("button", { name: "Dataset 바꾸기" }));
    expect(
      await screen.findByRole("button", { name: /Youth policy/ }),
    ).toBeVisible();
  });

  it("테마는 light와 dark 둘뿐이고 고른 값이 남는다", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    render(<App />);

    const theme = screen.getByRole("group", { name: "테마" });
    // 고른 적이 없으면 OS 설정을 따른다. test 환경은 light다.
    expect(within(theme).getByRole("button", { name: "라이트" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(theme).queryByRole("button", { name: "시스템" })).toBeNull();

    await user.click(within(theme).getByRole("button", { name: "다크" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("langfeather.theme")).toBe("dark");
  });

  describe("Traces 3분할", () => {
    it("넓은 화면에서는 detail이 dialog가 아니라 목록 옆 pane이다", async () => {
      setViewportMatches(true);
      renderTraces();

      // 비어 있는 두 칸을 보여주지 않는다 — 첫 trace가 자동 선택된다.
      await waitFor(() =>
        expect(new URLSearchParams(window.location.search).get("trace")).toBe(
          "tr_001",
        ),
      );
      const pane = await screen.findByRole("complementary", {
        name: "Trace 상세",
      });
      expect(pane).toBeVisible();
      expect(pane).not.toHaveAttribute("aria-modal");
      // pane은 닫는 것이 아니라 자리를 차지한다.
      expect(
        within(pane).queryByRole("button", { name: "상세 닫기" }),
      ).toBeNull();
      expect(screen.queryByRole("dialog", { name: "Policy answer" })).toBeNull();
    });

    it("넓은 화면의 목록은 표가 아니라 name과 메타를 담은 카드다", async () => {
      setViewportMatches(true);
      renderTraces();

      // 기획서 05절 스케치의 왼쪽 단. 표는 280–360px에 들어가지 않는다.
      const list = await screen.findByRole("region", { name: "Trace 목록" });
      expect(within(list).queryByRole("table")).toBeNull();
      const card = within(list).getByRole("button", { name: /Policy answer/ });
      // 표에는 없던 trace name이 제목이고, 메타 줄에 시각·지연·obs 수가 온다.
      expect(within(card).getByText("Policy answer")).toBeVisible();
      expect(within(card).getByText(/1\.00s/)).toBeVisible();
      expect(within(card).getByText(/Tokens 1,374/)).toBeVisible();
      expect(within(card).getByText(/First token 2\.96s/)).toBeVisible();
      // 스케치의 카드는 두 줄이다. ID는 펼쳤을 때만 나온다.
      expect(within(card).queryByText("tr_001")).toBeNull();
      // 선택은 그대로 남는다 — 카드로 바꾸며 bulk action을 잃지 않는다.
      expect(
        within(card).getByRole("checkbox", { name: "tr_001 선택" }),
      ).toBeVisible();
    });

    it("없는 token과 first token을 0으로 꾸미지 않는다", async () => {
      api.getTraces.mockResolvedValue({
        items: [
          {
            ...trace,
            total_tokens: null,
            time_to_first_token_us: null,
          },
        ],
        next_cursor: null,
        total_count: 1,
      });
      setViewportMatches(true);
      renderTraces();

      const list = await screen.findByRole("region", { name: "Trace 목록" });
      const card = within(list).getByRole("button", { name: /Policy answer/ });
      expect(within(card).queryByText(/Tokens/)).toBeNull();
      expect(within(card).queryByText(/First token/)).toBeNull();
    });

    it("bulk action은 목록 안 선택 바에 있고 카드를 가리지 않는다", async () => {
      const user = userEvent.setup();
      setViewportMatches(true);
      renderTraces();

      const list = await screen.findByRole("region", { name: "Trace 목록" });
      // 선택 전에는 action이 없다.
      expect(screen.queryByRole("button", { name: "Queue에 추가" })).toBeNull();

      await user.click(
        within(list).getByRole("checkbox", { name: "모든 trace 선택" }),
      );
      // 목록 안이지 page header가 아니다 — header에 두면 340px 단에서 잘렸다.
      expect(
        within(list).getByRole("button", { name: "Queue에 추가" }),
      ).toBeVisible();
      expect(
        within(list).getByRole("button", { name: "Dataset에 추가" }),
      ).toBeVisible();
      expect(within(list).getByText("1개 선택")).toBeVisible();
    });

    it("카드를 하나씩 펼쳐 input/output을 목록에서 바로 읽는다", async () => {
      const user = userEvent.setup();
      api.getTraces.mockResolvedValue({
        items: [
          {
            ...trace,
            input_preview: "human: 청년 정책 알려줘",
            output_preview: "ai: 지원 조건을 확인하세요.",
          },
        ],
        next_cursor: null,
        total_count: 1,
      });
      setViewportMatches(true);
      renderTraces();

      const list = await screen.findByRole("region", { name: "Trace 목록" });
      const toggle = within(list).getByRole("button", {
        name: "tr_001 미리보기",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(within(list).queryByText("청년 정책 알려줘")).toBeNull();

      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(within(list).getByText("청년 정책 알려줘")).toBeVisible();
      expect(within(list).getByText("지원 조건을 확인하세요.")).toBeVisible();
      expect(within(list).queryByText("tr_001")).toBeNull();
      expect(within(list).queryByText(/^human:/)).toBeNull();
      expect(within(list).queryByText(/^ai:/)).toBeNull();

      // 펼쳐도 카드 선택으로 새지 않는다.
      await user.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("목록을 접으면 다시 펼 버튼만 남는다", async () => {
      const user = userEvent.setup();
      setViewportMatches(true);
      renderTraces();

      await screen.findByRole("region", { name: "Trace 목록" });
      const collapse = screen.getByRole("button", { name: "목록 접기" });
      expect(collapse).toHaveAttribute("aria-expanded", "true");

      await user.click(collapse);
      // 되돌릴 버튼이 남아야 한다. 폭을 0으로 줄이면 이것까지 사라진다.
      const expand = screen.getByRole("button", { name: "목록 펼치기" });
      expect(expand).toHaveAttribute("aria-expanded", "false");

      await user.click(expand);
      expect(
        screen.getByRole("button", { name: "목록 접기" }),
      ).toHaveAttribute("aria-expanded", "true");
    });

    it("좁은 화면에서는 표로 돌아가 열 순서와 정렬을 계속 쓴다", async () => {
      setViewportMatches(false);
      renderTraces();

      const list = await screen.findByRole("region", { name: "Trace 목록" });
      expect(within(list).getByRole("table")).toBeVisible();
    });

    it("좁은 화면에서는 drawer 대신 단 전환으로 목록/그래프/검사기를 오간다", async () => {
      const user = userEvent.setup();
      renderTraces();

      const paneSwitch = await screen.findByRole("navigation", {
        name: "단 전환",
      });
      // 처음에는 목록 단이고, 고를 trace가 없으면 나머지 단은 못 간다.
      expect(
        within(paneSwitch).getByRole("button", { name: "목록" }),
      ).toHaveAttribute("aria-current", "true");

      // 자동 선택은 좁은 화면에서도 일어난다 — 단 전환이 목록을 가리지 않는다.
      await waitFor(() =>
        expect(new URLSearchParams(window.location.search).get("trace")).toBe(
          "tr_001",
        ),
      );

      await user.click(
        within(paneSwitch).getByRole("button", { name: "실행 흐름" }),
      );
      const pane = await screen.findByRole("complementary", {
        name: "Trace 상세",
      });
      expect(pane).not.toHaveAttribute("aria-modal");
      // 단이지 dialog가 아니므로 닫기 버튼이 없다.
      expect(
        within(pane).queryByRole("button", { name: "상세 닫기" }),
      ).toBeNull();
    });
  });
});

describe("Traces manual refresh", () => {
  it("does not hide manual refresh in collapsed split filters", () => {
    // jsdom does not calculate media-query layout or client rects.
    const stylesheet = readFileSync(
      resolve(process.cwd(), "src", "styles.css"),
      "utf8",
    );
    expect(stylesheet).toMatch(
      /\.filter-panel\.is-collapsed\s+\.filter-actions\s+\.lf-btn:is\(\.is-primary, \[type="reset"\]\)\s*\{\s*display:\s*none;/,
    );
  });

  it("retries an errored list, disables while loading, and keeps the URL detail open", async () => {
    const user = userEvent.setup();
    let resolveList:
      | ((value: {
          items: Array<typeof trace>;
          next_cursor: null;
          total_count: number;
        }) => void)
      | undefined;
    api.getTraces
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveList = resolve;
          }),
      );
    window.history.replaceState(null, "", "/?view=traces&trace=tr_001");
    render(<App />);

    await screen.findByRole("alert");
    await screen.findByRole("complementary", {name: "Trace 상세"});
    const refresh = screen.getByRole("button", {name: "Trace 목록 새로고침"});
    expect(refresh).toBeEnabled();

    await user.click(refresh);
    expect(refresh).toBeDisabled();
    resolveList?.({items: [trace], next_cursor: null, total_count: 1});

    await screen.findByText("tr_001");
    expect(screen.getByRole("complementary", {name: "Trace 상세"})).toBeVisible();
    expect(api.getTraces).toHaveBeenCalledTimes(2);
  });
});

describe("Experiment rationale", () => {
  it("keeps raw rationale in an accessible disclosure", async () => {
    const user = userEvent.setup();
    const summary = {
      experiment_id: "exp_rationale",
      dataset_id: "dataset_001",
      dataset_revision: 3,
      name: "Rationale run",
      status: "completed" as const,
      started_at: startedAt,
      ended_at: "2026-08-02T01:00:01.000Z",
      case_count: 1,
      completed_case_count: 1,
      failed_case_count: 0,
    };
    api.getExperiments.mockResolvedValue({items: [summary]});
    api.getExperiment.mockResolvedValue({
      ...summary,
      target_metadata: {},
      evaluators: [
        {
          experiment_evaluator_id: "ee_judge",
          key: "judge",
          name: "Judge",
          data_type: "boolean",
          position: 0,
        },
      ],
      cases: [
        {
          experiment_case_id: "ec_rationale",
          dataset_example_id: "example_001",
          position: 0,
          input: {question: "지원 대상"},
          expected_output: {answer: "청년"},
          metadata: {},
          status: "completed",
          output: {answer: "청년"},
          error: null,
          duration_us: 1,
          trace_id: "tr_001",
          completed_at: "2026-08-02T01:00:01.000Z",
          evaluator_results: [
            {
              evaluator_key: "judge",
              value: true,
              error_message: null,
              rationale: "raw evaluator diagnostic",
            },
          ],
        },
      ],
    });
    window.history.replaceState(
      null,
      "",
      "/?view=evaluate&section=experiments&dataset=dataset_001",
    );
    render(<App />);

    await user.click(await screen.findByText("Rationale run"));
    const rationale = await screen.findByText("근거 보기");
    const disclosure = rationale.closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    await user.click(rationale);
    expect(disclosure).toHaveAttribute("open");
    expect(screen.getByText("raw evaluator diagnostic")).toBeVisible();
  });
});
