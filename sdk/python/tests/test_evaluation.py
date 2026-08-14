from __future__ import annotations

import asyncio
import threading
import time

import pytest

from langfeather import (
    DatasetExample,
    EvaluationScore,
    add_dataset_examples,
    aevaluate,
    create_dataset,
    current_context,
    evaluate,
    evaluator,
    exact_match,
    find_dataset,
    get_dataset,
    get_or_create_dataset,
    resume_experiment,
)
from langfeather import evaluation as evaluation_module


class _Control:
    instances: list[_Control] = []
    datasets: dict[str, dict[str, object]] = {}
    case_count: int = 1
    resume_cases: list[dict[str, object]] = []
    resume_evaluators: list[dict[str, object]] = []

    def __init__(self, endpoint: str | None) -> None:
        self.endpoint = endpoint
        self.puts: list[tuple[str, dict[str, object]]] = []
        self.posts: list[tuple[str, dict[str, object]]] = []
        self._lock = threading.Lock()
        self.__class__.instances.append(self)

    def get(self, path: str) -> dict[str, object]:
        if path == "/api/v1/experiments/exp_1":
            return {
                "experiment_id": "exp_1",
                "dataset_id": "ds_1",
                "evaluators": self.__class__.resume_evaluators,
                "cases": self.__class__.resume_cases,
            }
        if path.startswith("/api/v1/datasets?name="):
            name = path.removeprefix("/api/v1/datasets?name=")
            return {
                "items": [
                    dataset
                    for dataset in self.__class__.datasets.values()
                    if dataset["name"] == name
                ]
            }
        dataset_id = path.rsplit("/", maxsplit=1)[-1]
        return self.__class__.datasets[dataset_id]

    def post(self, path: str, payload: object) -> dict[str, object]:
        self.posts.append((path, {"payload": payload}))
        if path == "/api/v1/datasets":
            request = payload
            assert isinstance(request, dict)
            dataset_id = f"ds_{len(self.__class__.datasets) + 1}"
            examples = request.get("examples", [])
            assert isinstance(examples, list)
            dataset = {
                "dataset_id": dataset_id,
                "name": request["name"],
                "description": request.get("description"),
                "revision": 1,
                "examples": [
                    {
                        **example,
                        "dataset_example_id": f"dse_{index}",
                        "position": index,
                    }
                    for index, example in enumerate(examples)
                ],
            }
            self.__class__.datasets[dataset_id] = dataset
            return dataset
        if path.endswith("/examples"):
            dataset_id = path.split("/")[-2]
            dataset = self.__class__.datasets[dataset_id]
            examples = payload
            assert isinstance(examples, list)
            existing = dataset["examples"]
            assert isinstance(existing, list)
            existing.extend(
                {
                    **example,
                    "dataset_example_id": f"dse_{len(existing) + index}",
                    "position": len(existing) + index,
                }
                for index, example in enumerate(examples)
            )
            revision = dataset["revision"]
            assert isinstance(revision, int)
            dataset["revision"] = revision + 1
            return dataset
        request = payload
        assert isinstance(request, dict)
        if path == "/api/v1/experiments":
            return {
                "experiment_id": "exp_1",
                "dataset_id": "ds_1",
                "cases": [
                    {
                        "experiment_case_id": f"ec_{index + 1}",
                        "dataset_example_id": f"dse_{index + 1}",
                        "input": {"question": "hello"},
                        "expected_output": {"answer": "hello"},
                        "metadata": {"kind": "smoke"},
                    }
                    for index in range(self.__class__.case_count)
                ],
            }
        if path == "/api/v1/experiments/exp_1/resume":
            return {
                "experiment_id": "exp_1",
                "dataset_id": "ds_1",
                "status": "running",
                "evaluators": self.__class__.resume_evaluators,
                "cases": self.__class__.resume_cases,
            }
        return {
            "experiment_id": "exp_1",
            "status": request["status"],
            "case_count": 1,
            "completed_case_count": 1,
            "failed_case_count": 0,
        }

    def put(self, path: str, payload: object) -> dict[str, object]:
        assert isinstance(payload, dict)
        with self._lock:
            self.puts.append((path, payload))
        return {}


@pytest.fixture(autouse=True)
def fake_control(monkeypatch: pytest.MonkeyPatch) -> None:
    _Control.instances = []
    _Control.datasets = {}
    _Control.case_count = 1
    _Control.resume_cases = []
    _Control.resume_evaluators = []
    monkeypatch.setattr(evaluation_module, "_ControlClient", _Control)
    monkeypatch.setattr(evaluation_module, "flush_transport", lambda timeout: True)
    monkeypatch.setattr("langfeather._observe.enqueue_envelope", lambda envelope: None)


def test_evaluate_records_target_and_evaluator_results() -> None:
    @evaluator(key="length", name="Answer length", data_type="number")
    def answer_length(**kwargs: object) -> float:
        return 1.0

    run = evaluate(
        dataset="ds_1",
        name="sync baseline",
        target=lambda _: {"answer": "hello"},
        evaluators=[exact_match(), answer_length],
        endpoint="http://collector.test",
    )

    assert run.experiment_id == "exp_1"
    assert run.status == "completed"
    control = _Control.instances[0]
    _, payload = control.puts[0]
    assert payload["status"] == "completed"
    assert payload["trace_id"] is not None
    assert payload["evaluator_results"] == [
        {"evaluator_key": "exact_match", "value": True},
        {"evaluator_key": "length", "value": 1.0},
    ]


def test_aevaluate_accepts_async_target() -> None:
    async def target(_: object) -> dict[str, str]:
        return {"answer": "hello"}

    run = asyncio.run(
        aevaluate(
            dataset="ds_1",
            name="async baseline",
            target=target,
            evaluators=[exact_match()],
        )
    )

    assert run.status == "completed"
    assert _Control.instances[0].puts[0][1]["status"] == "completed"


def test_evaluation_score_persists_raw_rationale() -> None:
    @evaluator(key="judge", name="Judge")
    def judge(**kwargs: object) -> EvaluationScore:
        return EvaluationScore(True, "raw judge diagnostic\nsecond line")

    evaluate(
        dataset="ds_1",
        name="rationale",
        target=lambda _: {"answer": "hello"},
        evaluators=[judge],
    )

    assert _Control.instances[0].puts[0][1]["evaluator_results"] == [
        {
            "evaluator_key": "judge",
            "value": True,
            "rationale": "raw judge diagnostic\nsecond line",
        }
    ]


def test_evaluate_runs_at_the_requested_bounded_concurrency() -> None:
    _Control.case_count = 4
    lock = threading.Lock()
    started = threading.Event()
    trace_ids: set[str] = set()
    active = 0
    peak = 0

    def target(_: object) -> dict[str, str]:
        nonlocal active, peak
        context = current_context()
        assert context is not None
        with lock:
            trace_ids.add(context.trace_id)
            active += 1
            peak = max(peak, active)
            if active == 2:
                started.set()
        started.wait(timeout=0.5)
        time.sleep(0.01)
        with lock:
            active -= 1
        return {"answer": "hello"}

    run = evaluate(
        dataset="ds_1",
        name="bounded sync",
        target=target,
        evaluators=[exact_match()],
        max_concurrency=2,
    )

    assert run.status == "completed"
    assert peak == 2
    assert len(_Control.instances[0].puts) == 4
    assert {payload["trace_id"] for _, payload in _Control.instances[0].puts} == trace_ids


def test_aevaluate_runs_at_the_requested_bounded_concurrency() -> None:
    _Control.case_count = 4

    async def run() -> tuple[evaluation_module.ExperimentRun, int]:
        lock = asyncio.Lock()
        started = asyncio.Event()
        active = 0
        peak = 0

        async def target(_: object) -> dict[str, str]:
            nonlocal active, peak
            async with lock:
                active += 1
                peak = max(peak, active)
                if active == 2:
                    started.set()
            await asyncio.wait_for(started.wait(), timeout=0.5)
            await asyncio.sleep(0.01)
            async with lock:
                active -= 1
            return {"answer": "hello"}

        result = await aevaluate(
            dataset="ds_1",
            name="bounded async",
            target=target,
            evaluators=[exact_match()],
            max_concurrency=2,
        )
        return result, peak

    result, peak = asyncio.run(run())

    assert result.status == "completed"
    assert peak == 2
    assert len(_Control.instances[0].puts) == 4


@pytest.mark.parametrize("max_concurrency", [0, -1, True, 1.5])
def test_evaluate_rejects_invalid_max_concurrency(max_concurrency: object) -> None:
    with pytest.raises(ValueError, match="max_concurrency"):
        evaluate(
            dataset="ds_1",
            name="invalid concurrency",
            target=lambda _: {"answer": "hello"},
            evaluators=[exact_match()],
            max_concurrency=max_concurrency,  # type: ignore[arg-type]
        )
    assert _Control.instances == []


def test_dataset_helpers_create_find_reuse_and_append_examples() -> None:
    created = create_dataset(
        name="rag-regression",
        description="reviewed cases",
        examples=[DatasetExample(input={"question": "hello"})],
    )
    assert created.name == "rag-regression"
    assert created.examples[0].dataset_example_id == "dse_0"

    assert find_dataset("rag-regression") == created
    assert get_dataset(created.dataset_id) == created

    reused = get_or_create_dataset(
        name="rag-regression",
        examples=[DatasetExample(input={"question": "not added"})],
    )
    assert reused == created

    updated = add_dataset_examples(
        created.dataset_id,
        [DatasetExample(input={"question": "second"})],
    )
    assert updated.revision == 2
    assert [item.input for item in updated.examples] == [
        {"question": "hello"},
        {"question": "second"},
    ]


def test_interrupt_in_target_stops_the_run_instead_of_failing_one_case() -> None:
    _Control.case_count = 3
    attempts: list[str] = []

    def target(_: object) -> dict[str, str]:
        attempts.append("call")
        if len(attempts) == 2:
            raise KeyboardInterrupt
        return {"answer": "hello"}

    with pytest.raises(KeyboardInterrupt):
        evaluate(
            dataset="ds_1",
            name="interrupted",
            target=target,
            evaluators=[exact_match()],
        )

    control = _Control.instances[0]
    # The third case must never run, and the interrupted case is not recorded.
    assert len(attempts) == 2
    assert [path for path, _ in control.puts] == [
        "/api/v1/experiments/exp_1/cases/ec_1"
    ]
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_interrupt_in_evaluator_stops_the_run() -> None:
    _Control.case_count = 2

    @evaluator(key="interrupting", name="Interrupting")
    def interrupting(**kwargs: object) -> bool:
        raise KeyboardInterrupt

    with pytest.raises(KeyboardInterrupt):
        evaluate(
            dataset="ds_1",
            name="interrupted evaluator",
            target=lambda _: {"answer": "hello"},
            evaluators=[interrupting],
        )

    control = _Control.instances[0]
    assert control.puts == []
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_parallel_interrupt_stops_new_cases_and_keeps_completed_results() -> None:
    _Control.case_count = 4
    second_started = threading.Event()
    attempts: list[int] = []
    lock = threading.Lock()

    def target(_: object) -> dict[str, str]:
        with lock:
            attempt = len(attempts) + 1
            attempts.append(attempt)
        if attempt == 1:
            assert second_started.wait(timeout=0.5)
            raise KeyboardInterrupt
        second_started.set()
        return {"answer": "hello"}

    with pytest.raises(KeyboardInterrupt):
        evaluate(
            dataset="ds_1",
            name="parallel interrupted",
            target=target,
            evaluators=[exact_match()],
            max_concurrency=2,
        )

    control = _Control.instances[0]
    assert attempts == [1, 2]
    assert len(control.puts) == 1
    assert control.puts[0][0].rsplit("/", maxsplit=1)[-1] in {"ec_1", "ec_2"}
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_async_cancellation_stops_the_run() -> None:
    _Control.case_count = 3
    attempts: list[str] = []

    async def target(_: object) -> dict[str, str]:
        attempts.append("call")
        if len(attempts) == 2:
            raise asyncio.CancelledError
        return {"answer": "hello"}

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            aevaluate(
                dataset="ds_1",
                name="cancelled",
                target=target,
                evaluators=[exact_match()],
                max_concurrency=2,
            )
        )

    control = _Control.instances[0]
    assert len(attempts) == 2
    assert len(control.puts) == 1
    assert control.posts[-1] == (
        "/api/v1/experiments/exp_1/finish",
        {"payload": {"status": "cancelled"}},
    )


def test_resume_experiment_validates_snapshot_then_runs_only_pending_cases() -> None:
    _Control.resume_evaluators = [
        {"key": "exact_match", "name": "Exact match", "data_type": "boolean"}
    ]
    _Control.resume_cases = [
        {
            "experiment_case_id": "ec_completed",
            "dataset_example_id": "dse_completed",
            "input": {"question": "done"},
            "expected_output": {"answer": "hello"},
            "metadata": {},
            "status": "completed",
        },
        {
            "experiment_case_id": "ec_pending",
            "dataset_example_id": "dse_pending",
            "input": {"question": "retry"},
            "expected_output": {"answer": "hello"},
            "metadata": {},
            "status": "pending",
        },
    ]

    run = resume_experiment(
        experiment_id="exp_1",
        target=lambda _: {"answer": "hello"},
        evaluators=[exact_match()],
        endpoint="http://collector.test",
        max_concurrency=2,
    )

    control = _Control.instances[0]
    assert run.status == "completed"
    assert [path for path, _ in control.puts] == [
        "/api/v1/experiments/exp_1/cases/ec_pending"
    ]
    assert [path for path, _ in control.posts] == [
        "/api/v1/experiments/exp_1/resume",
        "/api/v1/experiments/exp_1/finish",
    ]
