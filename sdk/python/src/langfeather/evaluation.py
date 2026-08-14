"""Local dataset evaluation runner.

Evaluator code always runs in the caller's Python process. The LangFeather server
stores datasets, experiment snapshots, and result records; it never imports or
executes user evaluator code.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor, wait
from dataclasses import dataclass
from typing import Literal, Protocol, cast

from ._context import use_root_trace_options
from ._ids import new_trace_id
from ._observe import span
from ._serialization import serialize_error
from ._transport import flush_transport

JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
EvaluatorValue = bool | int | float
EvaluatorDataType = Literal["boolean", "number"]

# Creating an experiment returns every case, so a large dataset makes one control
# request far heavier than a typical local round trip.
_CONTROL_TIMEOUT_SECONDS = 30.0


class EvaluationError(RuntimeError):
    """Raised when the local evaluation control API cannot persist a run."""


class _ControlRequestError(EvaluationError):
    def __init__(self, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True, slots=True)
class EvaluationScore:
    """One evaluator value with optional raw diagnostic rationale."""

    value: EvaluatorValue
    rationale: str | None = None


class EvaluatorCallable(Protocol):
    def __call__(
        self,
        *,
        input: JsonValue,
        output: JsonValue,
        expected_output: JsonValue | None,
        metadata: Mapping[str, JsonValue],
    ) -> EvaluatorValue | EvaluationScore: ...


@dataclass(frozen=True, slots=True)
class Evaluator:
    """One deterministic evaluator executed for each completed experiment case."""

    key: str
    name: str
    data_type: EvaluatorDataType
    function: EvaluatorCallable


@dataclass(frozen=True, slots=True)
class ExperimentRun:
    experiment_id: str
    status: Literal["completed", "cancelled"]
    case_count: int
    completed_case_count: int
    failed_case_count: int


@dataclass(frozen=True, slots=True)
class DatasetExample:
    """One JSON-compatible evaluation input and optional expected output."""

    input: JsonValue
    expected_output: JsonValue | None = None
    metadata: Mapping[str, JsonValue] | None = None
    source_trace_id: str | None = None
    dataset_example_id: str | None = None
    position: int | None = None


@dataclass(frozen=True, slots=True)
class Dataset:
    """A mutable source dataset returned by the local control API."""

    dataset_id: str
    name: str
    description: str | None
    revision: int
    examples: tuple[DatasetExample, ...]


def create_dataset(
    *,
    name: str,
    examples: Sequence[DatasetExample] = (),
    description: str | None = None,
    endpoint: str | None = None,
) -> Dataset:
    """Create one uniquely named dataset with optional initial examples."""

    raw = _ControlClient(endpoint).post(
        "/api/v1/datasets",
        {
            "name": name,
            "description": description,
            "examples": [_dataset_example_payload(example) for example in examples],
        },
    )
    return _dataset(raw)


def get_dataset(dataset_id: str, *, endpoint: str | None = None) -> Dataset:
    """Return a dataset by its stable ID or raise if it does not exist."""

    return _dataset(
        _ControlClient(endpoint).get(
            f"/api/v1/datasets/{urllib.parse.quote(dataset_id, safe='')}"
        )
    )


def find_dataset(name: str, *, endpoint: str | None = None) -> Dataset | None:
    """Return the uniquely named dataset, or ``None`` when it is absent."""

    raw = _ControlClient(endpoint).get(
        f"/api/v1/datasets?name={urllib.parse.quote(name, safe='')}"
    )
    items = _required_list(raw, "items")
    if not items:
        return None
    return get_dataset(_required_string(items[0], "dataset_id"), endpoint=endpoint)


def get_or_create_dataset(
    *,
    name: str,
    examples: Sequence[DatasetExample] = (),
    description: str | None = None,
    endpoint: str | None = None,
) -> Dataset:
    """Return a named dataset, creating it once with a race-safe fallback."""

    existing = find_dataset(name, endpoint=endpoint)
    if existing is not None:
        return existing
    try:
        return create_dataset(
            name=name,
            examples=examples,
            description=description,
            endpoint=endpoint,
        )
    except _ControlRequestError as error:
        if error.status_code != 409:
            raise
    existing = find_dataset(name, endpoint=endpoint)
    if existing is None:
        raise EvaluationError("dataset create conflicted but no dataset was found")
    return existing


def add_dataset_examples(
    dataset_id: str,
    examples: Sequence[DatasetExample],
    *,
    endpoint: str | None = None,
) -> Dataset:
    """Append examples to a dataset and return its incremented revision."""

    if not examples:
        raise ValueError("examples must not be empty")
    raw = _ControlClient(endpoint).post(
        f"/api/v1/datasets/{urllib.parse.quote(dataset_id, safe='')}/examples",
        [_dataset_example_payload(example) for example in examples],
    )
    return _dataset(raw)


def evaluator(
    *,
    key: str,
    name: str | None = None,
    data_type: EvaluatorDataType = "boolean",
) -> Callable[[EvaluatorCallable], Evaluator]:
    """Turn a keyword-only Python function into an experiment evaluator."""

    def decorate(function: EvaluatorCallable) -> Evaluator:
        function_name = getattr(function, "__name__", None)
        return Evaluator(
            key=key,
            name=name or (function_name if isinstance(function_name, str) else key),
            data_type=data_type,
            function=function,
        )

    return decorate


def exact_match(*, key: str = "exact_match", name: str = "Exact match") -> Evaluator:
    """Return a boolean evaluator comparing output with expected output."""

    @evaluator(key=key, name=name)
    def evaluate_exact_match(
        *,
        input: JsonValue,
        output: JsonValue,
        expected_output: JsonValue | None,
        metadata: Mapping[str, JsonValue],
    ) -> bool:
        del input, metadata
        return output == expected_output

    return evaluate_exact_match


def contains(*, key: str = "contains", name: str = "Contains") -> Evaluator:
    """Return a boolean evaluator for expected text or JSON fragments."""

    @evaluator(key=key, name=name)
    def evaluate_contains(
        *,
        input: JsonValue,
        output: JsonValue,
        expected_output: JsonValue | None,
        metadata: Mapping[str, JsonValue],
    ) -> bool:
        del input, metadata
        if expected_output is None:
            return False
        if isinstance(output, str) and isinstance(expected_output, str):
            return expected_output in output
        return expected_output == output

    return evaluate_contains


def json_field(
    field: str,
    *,
    key: str | None = None,
    name: str | None = None,
) -> Evaluator:
    """Return a boolean evaluator comparing one top-level object field."""

    resolved_key = key or f"json_field_{field}"

    @evaluator(key=resolved_key, name=name or f"JSON field: {field}")
    def evaluate_json_field(
        *,
        input: JsonValue,
        output: JsonValue,
        expected_output: JsonValue | None,
        metadata: Mapping[str, JsonValue],
    ) -> bool:
        del input, metadata
        return (
            isinstance(output, dict)
            and isinstance(expected_output, dict)
            and output.get(field) == expected_output.get(field)
        )

    return evaluate_json_field


def evaluate(
    *,
    dataset: str,
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    name: str,
    endpoint: str | None = None,
    target_metadata: Mapping[str, JsonValue] | None = None,
    max_concurrency: int = 1,
) -> ExperimentRun:
    """Run one local experiment and persist every case result.

    ``target`` can be a normal callable or a LangChain/LangGraph-like object with
    an ``invoke`` method. Target and evaluator failures are recorded per case; a
    failed control API request raises :class:`EvaluationError` instead of silently
    presenting an incomplete experiment as successful.

    Only :class:`Exception` counts as a case failure. ``KeyboardInterrupt`` and
    other :class:`BaseException` interrupts stop the run and cancel the
    experiment. ``max_concurrency`` defaults to one; on interruption, queued
    cases are cancelled while already-running threads finish and persist first.
    """

    _validate_max_concurrency(max_concurrency)
    control = _ControlClient(endpoint)
    experiment = control.post(
        "/api/v1/experiments",
        {
            "dataset_id": dataset,
            "name": name,
            "target_metadata": dict(target_metadata or {}),
            "evaluators": [
                {
                    "key": item.key,
                    "name": item.name,
                    "data_type": item.data_type,
                }
                for item in evaluators
            ],
        },
    )
    return _run_experiment_sync(
        control,
        experiment,
        target,
        evaluators,
        max_concurrency=max_concurrency,
    )


def resume_experiment(
    *,
    experiment_id: str,
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    retry_failed: bool = False,
    endpoint: str | None = None,
    max_concurrency: int = 1,
) -> ExperimentRun:
    """Resume a running or cancelled experiment from its stored case snapshot.

    The caller must supply the same evaluator keys and data types captured by the
    experiment. Completed history is not rerun; failed cases are retried only
    when ``retry_failed`` is true.
    """

    _validate_max_concurrency(max_concurrency)
    control = _ControlClient(endpoint)
    snapshot = control.get(
        f"/api/v1/experiments/{urllib.parse.quote(experiment_id, safe='')}"
    )
    _validate_resume_evaluators(snapshot, evaluators)
    experiment = control.post(
        f"/api/v1/experiments/{urllib.parse.quote(experiment_id, safe='')}/resume",
        {"retry_failed": retry_failed},
    )
    return _run_experiment_sync(
        control,
        experiment,
        target,
        evaluators,
        max_concurrency=max_concurrency,
    )


def _run_experiment_sync(
    control: _ControlClient,
    experiment: Mapping[str, object],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    *,
    max_concurrency: int,
) -> ExperimentRun:
    experiment_id = _required_string(experiment, "experiment_id")
    dataset_id = _required_string(experiment, "dataset_id")
    try:
        _run_cases_sync(
            control,
            experiment_id,
            dataset_id,
            _pending_cases(experiment),
            target,
            evaluators,
            max_concurrency=max_concurrency,
        )
    except BaseException:
        _finish_best_effort(control, experiment_id, "cancelled")
        raise
    completed = control.post(
        f"/api/v1/experiments/{experiment_id}/finish",
        {"status": "completed"},
    )
    return _experiment_run(completed)


async def aevaluate(
    *,
    dataset: str,
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    name: str,
    endpoint: str | None = None,
    target_metadata: Mapping[str, JsonValue] | None = None,
    max_concurrency: int = 1,
) -> ExperimentRun:
    """Async counterpart to :func:`evaluate` with bounded case concurrency.

    Like :func:`evaluate`, only :class:`Exception` is recorded as a case failure;
    ``asyncio.CancelledError`` and other interrupts cancel the experiment.
    """

    _validate_max_concurrency(max_concurrency)
    control = _ControlClient(endpoint)
    experiment = await asyncio.to_thread(
        control.post,
        "/api/v1/experiments",
        {
            "dataset_id": dataset,
            "name": name,
            "target_metadata": dict(target_metadata or {}),
            "evaluators": [
                {"key": item.key, "name": item.name, "data_type": item.data_type}
                for item in evaluators
            ],
        },
    )
    return await _run_experiment_async(
        control,
        experiment,
        target,
        evaluators,
        max_concurrency=max_concurrency,
    )


async def _run_experiment_async(
    control: _ControlClient,
    experiment: Mapping[str, object],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    *,
    max_concurrency: int,
) -> ExperimentRun:
    experiment_id = _required_string(experiment, "experiment_id")
    dataset_id = _required_string(experiment, "dataset_id")
    try:
        await _run_cases_async(
            control,
            experiment_id,
            dataset_id,
            _pending_cases(experiment),
            target,
            evaluators,
            max_concurrency=max_concurrency,
        )
    except BaseException:
        await asyncio.to_thread(
            _finish_best_effort, control, experiment_id, "cancelled"
        )
        raise
    completed = await asyncio.to_thread(
        control.post,
        f"/api/v1/experiments/{experiment_id}/finish",
        {"status": "completed"},
    )
    return _experiment_run(completed)


def _pending_cases(experiment: Mapping[str, object]) -> list[Mapping[str, object]]:
    return [
        case
        for case in _required_list(experiment, "cases")
        if case.get("status", "pending") == "pending"
    ]


def _run_cases_sync(
    control: _ControlClient,
    experiment_id: str,
    dataset_id: str,
    cases: Sequence[Mapping[str, object]],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    *,
    max_concurrency: int,
) -> None:
    if max_concurrency == 1:
        for case in cases:
            _run_case_sync(
                control, experiment_id, dataset_id, case, target, evaluators
            )
        return

    executor = ThreadPoolExecutor(max_workers=max_concurrency)
    futures = set()

    try:
        for start in range(0, len(cases), max_concurrency):
            futures = {
                executor.submit(
                    _run_case_sync,
                    control,
                    experiment_id,
                    dataset_id,
                    case,
                    target,
                    evaluators,
                )
                for case in cases[start : start + max_concurrency]
            }
            completed, _ = wait(futures)
            for future in completed:
                future.result()
            futures = set()
    except BaseException:
        for future in futures:
            future.cancel()
        # Python cannot kill a running thread. Wait for it to finish so any
        # completed case write lands before the experiment becomes cancelled.
        executor.shutdown(wait=True, cancel_futures=True)
        raise
    else:
        executor.shutdown(wait=True)


async def _run_cases_async(
    control: _ControlClient,
    experiment_id: str,
    dataset_id: str,
    cases: Sequence[Mapping[str, object]],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
    *,
    max_concurrency: int,
) -> None:
    if max_concurrency == 1:
        for case in cases:
            await _run_case_async(
                control, experiment_id, dataset_id, case, target, evaluators
            )
        return

    for start in range(0, len(cases), max_concurrency):
        tasks = [
            asyncio.create_task(
                _run_case_async(
                    control, experiment_id, dataset_id, case, target, evaluators
                )
            )
            for case in cases[start : start + max_concurrency]
        ]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise


def _validate_max_concurrency(max_concurrency: int) -> None:
    if isinstance(max_concurrency, bool) or not isinstance(max_concurrency, int):
        raise ValueError("max_concurrency must be a positive integer")
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be a positive integer")


def _validate_resume_evaluators(
    experiment: Mapping[str, object], evaluators: Sequence[Evaluator]
) -> None:
    snapshot = {
        (_required_string(item, "key"), _required_string(item, "data_type"))
        for item in _required_list(experiment, "evaluators")
    }
    supplied = {(item.key, item.data_type) for item in evaluators}
    if snapshot != supplied or len(snapshot) != len(evaluators):
        raise EvaluationError(
            "resume evaluators must exactly match the experiment snapshot keys and data types"
        )


def _run_case_sync(
    control: _ControlClient,
    experiment_id: str,
    dataset_id: str,
    case: Mapping[str, object],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
) -> None:
    case_id = _required_string(case, "experiment_case_id")
    input_value = cast(JsonValue, case.get("input"))
    expected_output = cast(JsonValue | None, case.get("expected_output"))
    metadata_raw = case.get("metadata", {})
    metadata = cast(Mapping[str, JsonValue], metadata_raw)
    trace_id = new_trace_id()
    started = time.perf_counter()
    output: JsonValue | None = None
    error: JsonValue | None = None
    status: Literal["completed", "failed"] = "completed"
    with use_root_trace_options(
        trace_id=trace_id,
        metadata={
            "experiment_id": experiment_id,
            "dataset_id": dataset_id,
            "dataset_example_id": _required_string(case, "dataset_example_id"),
            "experiment_case_id": case_id,
        },
    ):
        try:
            output = cast(JsonValue, _call_target(target, input_value))
        except Exception as raised:
            status = "failed"
            error = cast(JsonValue, serialize_error(raised))
    duration_us = int((time.perf_counter() - started) * 1_000_000)
    evaluator_results: list[dict[str, object]] = []
    if status == "completed":
        for item in evaluators:
            try:
                result = _evaluator_result(
                    item,
                    item.function(
                        input=input_value,
                        output=output,
                        expected_output=expected_output,
                        metadata=metadata,
                    ),
                )
                evaluator_results.append(result)
            except Exception as raised:
                evaluator_results.append(
                    {"evaluator_key": item.key, "error_message": str(raised)}
                )
    flush_transport(timeout=2.0)
    control.put(
        f"/api/v1/experiments/{experiment_id}/cases/{case_id}",
        {
            "status": status,
            "output": output,
            "error": error,
            "duration_us": duration_us,
            "trace_id": trace_id,
            "evaluator_results": evaluator_results,
        },
    )


async def _run_case_async(
    control: _ControlClient,
    experiment_id: str,
    dataset_id: str,
    case: Mapping[str, object],
    target: Callable[[JsonValue], object] | object,
    evaluators: list[Evaluator],
) -> None:
    case_id = _required_string(case, "experiment_case_id")
    input_value = cast(JsonValue, case.get("input"))
    expected_output = cast(JsonValue | None, case.get("expected_output"))
    metadata = cast(Mapping[str, JsonValue], case.get("metadata", {}))
    trace_id = new_trace_id()
    started = time.perf_counter()
    output: JsonValue | None = None
    error: JsonValue | None = None
    status: Literal["completed", "failed"] = "completed"
    with use_root_trace_options(
        trace_id=trace_id,
        metadata={
            "experiment_id": experiment_id,
            "dataset_id": dataset_id,
            "dataset_example_id": _required_string(case, "dataset_example_id"),
            "experiment_case_id": case_id,
        },
    ):
        try:
            output = cast(JsonValue, await _call_target_async(target, input_value))
        except Exception as raised:
            status = "failed"
            error = cast(JsonValue, serialize_error(raised))
    duration_us = int((time.perf_counter() - started) * 1_000_000)
    evaluator_results: list[dict[str, object]] = []
    if status == "completed":
        for item in evaluators:
            try:
                value = item.function(
                    input=input_value,
                    output=output,
                    expected_output=expected_output,
                    metadata=metadata,
                )
                if inspect.isawaitable(value):
                    value = await value
                evaluator_results.append(_evaluator_result(item, value))
            except Exception as raised:
                evaluator_results.append(
                    {"evaluator_key": item.key, "error_message": str(raised)}
                )
    flush_transport(timeout=2.0)
    put_task = asyncio.create_task(
        asyncio.to_thread(
            control.put,
            f"/api/v1/experiments/{experiment_id}/cases/{case_id}",
            {
                "status": status,
                "output": output,
                "error": error,
                "duration_us": duration_us,
                "trace_id": trace_id,
                "evaluator_results": evaluator_results,
            },
        )
    )
    try:
        await asyncio.shield(put_task)
    except asyncio.CancelledError:
        await put_task
        raise


def _call_target(
    target: Callable[[JsonValue], object] | object, input_value: JsonValue
) -> object:
    with span("evaluation_case", input=input_value, kind="evaluation") as trace:
        invoke = getattr(target, "invoke", None)
        if callable(invoke):
            output = invoke(input_value)
        elif callable(target):
            output = target(input_value)
        else:
            raise TypeError(
                "evaluation target must be callable or provide invoke(input)"
            )
        trace.set_output(output)
        return output


async def _call_target_async(
    target: Callable[[JsonValue], object] | object,
    input_value: JsonValue,
) -> object:
    with span("evaluation_case", input=input_value, kind="evaluation") as trace:
        ainvoke = getattr(target, "ainvoke", None)
        invoke = getattr(target, "invoke", None)
        if callable(ainvoke):
            output = await ainvoke(input_value)
        elif callable(invoke):
            output = invoke(input_value)
            if inspect.isawaitable(output):
                output = await output
        elif callable(target):
            output = target(input_value)
            if inspect.isawaitable(output):
                output = await output
        else:
            raise TypeError(
                "evaluation target must be callable or provide invoke(input)"
            )
        trace.set_output(output)
        return output


def _validate_evaluator_value(item: Evaluator, value: object) -> None:
    if item.data_type == "boolean" and not isinstance(value, bool):
        raise TypeError(f"{item.key} must return bool")
    if item.data_type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TypeError(f"{item.key} must return a finite number")
        if not math.isfinite(float(value)):
            raise TypeError(f"{item.key} must return a finite number")


def _evaluator_result(item: Evaluator, value: object) -> dict[str, object]:
    score = (
        value
        if isinstance(value, EvaluationScore)
        else EvaluationScore(value=cast(EvaluatorValue, value))
    )
    _validate_evaluator_value(item, score.value)
    if score.rationale is not None and not isinstance(score.rationale, str):
        raise TypeError(f"{item.key} rationale must be a string or None")
    result: dict[str, object] = {"evaluator_key": item.key, "value": score.value}
    if score.rationale is not None:
        result["rationale"] = score.rationale
    return result


def _experiment_run(raw: Mapping[str, object]) -> ExperimentRun:
    return ExperimentRun(
        experiment_id=_required_string(raw, "experiment_id"),
        status=cast(Literal["completed", "cancelled"], _required_string(raw, "status")),
        case_count=_required_int(raw, "case_count"),
        completed_case_count=_required_int(raw, "completed_case_count"),
        failed_case_count=_required_int(raw, "failed_case_count"),
    )


def _dataset_example_payload(example: DatasetExample) -> dict[str, object]:
    return {
        "input": example.input,
        "expected_output": example.expected_output,
        "metadata": dict(example.metadata or {}),
        "source_trace_id": example.source_trace_id,
    }


def _dataset(raw: Mapping[str, object]) -> Dataset:
    examples = tuple(
        DatasetExample(
            input=cast(JsonValue, item.get("input")),
            expected_output=cast(JsonValue | None, item.get("expected_output")),
            metadata=cast(Mapping[str, JsonValue], item.get("metadata", {})),
            source_trace_id=_optional_string(item, "source_trace_id"),
            dataset_example_id=_optional_string(item, "dataset_example_id"),
            position=_optional_int(item, "position"),
        )
        for item in _required_list(raw, "examples")
    )
    description = raw.get("description")
    if description is not None and not isinstance(description, str):
        raise EvaluationError("control API response has invalid dataset description")
    return Dataset(
        dataset_id=_required_string(raw, "dataset_id"),
        name=_required_string(raw, "name"),
        description=description,
        revision=_required_int(raw, "revision"),
        examples=examples,
    )


def _finish_best_effort(
    control: _ControlClient,
    experiment_id: str,
    status: Literal["cancelled"],
) -> None:
    try:
        control.post(f"/api/v1/experiments/{experiment_id}/finish", {"status": status})
    except EvaluationError:
        pass


def _required_string(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    if not isinstance(value, str):
        raise EvaluationError(f"control API response has no string {key}")
    return value


def _optional_string(mapping: Mapping[str, object], key: str) -> str | None:
    value = mapping.get(key)
    return value if isinstance(value, str) else None


def _required_int(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise EvaluationError(f"control API response has no integer {key}")
    return value


def _optional_int(mapping: Mapping[str, object], key: str) -> int | None:
    value = mapping.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _required_list(
    mapping: Mapping[str, object], key: str
) -> list[Mapping[str, object]]:
    value = mapping.get(key)
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise EvaluationError(f"control API response has no object list {key}")
    return cast(list[Mapping[str, object]], value)


class _ControlClient:
    def __init__(self, endpoint: str | None) -> None:
        self._base_url = (
            endpoint
            or os.environ.get("LANGFEATHER_ENDPOINT")
            or "http://127.0.0.1:4319"
        ).rstrip("/")

    def get(self, path: str) -> Mapping[str, object]:
        return self._request("GET", path)

    def post(self, path: str, payload: object) -> Mapping[str, object]:
        return self._request("POST", path, payload)

    def put(self, path: str, payload: object) -> Mapping[str, object]:
        return self._request("PUT", path, payload)

    def _request(
        self,
        method: str,
        path: str,
        payload: object | None = None,
    ) -> Mapping[str, object]:
        request = urllib.request.Request(
            f"{self._base_url}{path}",
            data=(
                None
                if payload is None
                else json.dumps(
                    payload, ensure_ascii=False, separators=(",", ":")
                ).encode("utf-8")
            ),
            headers={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if payload is not None else {}),
            },
            method=method,
        )
        try:
            with urllib.request.urlopen(
                request, timeout=_CONTROL_TIMEOUT_SECONDS
            ) as response:
                raw = json.loads(response.read())
        except urllib.error.HTTPError as error:
            raise _ControlRequestError(
                f"evaluation control API request failed: {error}",
                status_code=error.code,
            ) from error
        except (
            urllib.error.URLError,
            TimeoutError,
            OSError,
            json.JSONDecodeError,
        ) as error:
            raise EvaluationError(
                f"evaluation control API request failed: {error}"
            ) from error
        if not isinstance(raw, dict):
            raise EvaluationError(
                "evaluation control API returned a non-object response"
            )
        return cast(Mapping[str, object], raw)
