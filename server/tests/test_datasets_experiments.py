from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import event
from sqlalchemy.engine import Engine

from langfeather_server.app import create_app
from langfeather_server.models import TraceRow


@pytest.fixture
def api(tmp_path: Path) -> Iterator[TestClient]:
    application = create_app(database_url=f"sqlite:///{tmp_path / 'evaluation.db'}")
    with TestClient(application, base_url="http://localhost") as client:
        yield client


def test_dataset_snapshot_and_experiment_results_are_immutable(api: TestClient) -> None:
    created = api.post(
        "/api/v1/datasets",
        json={
            "name": "RAG regression",
            "description": "Small fixed cases",
            "examples": [
                {
                    "input": {"question": "지원 대상은?"},
                    "expected_output": {"answer": "청년"},
                    "metadata": {"category": "eligibility"},
                    "source_trace_id": "tr_source_deleted_later",
                }
            ],
        },
    )
    assert created.status_code == 201
    dataset = cast(dict[str, Any], created.json())
    assert dataset["revision"] == 1
    example_id = dataset["examples"][0]["dataset_example_id"]

    experiment_response = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "baseline",
            "target_metadata": {"release": "abc123"},
            "evaluators": [
                {"key": "exact", "name": "Exact", "data_type": "boolean"},
                {"key": "quality", "name": "Quality", "data_type": "number"},
            ],
        },
    )
    assert experiment_response.status_code == 201
    experiment = cast(dict[str, Any], experiment_response.json())
    assert experiment["dataset_revision"] == 1
    case = experiment["cases"][0]
    assert case["expected_output"] == {"answer": "청년"}

    changed = api.patch(
        f"/api/v1/datasets/{dataset['dataset_id']}/examples/{example_id}",
        json={"expected_output": {"answer": "대학생"}},
    )
    assert changed.status_code == 200
    assert changed.json()["revision"] == 2

    recorded = api.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{case['experiment_case_id']}",
        json={
            "status": "completed",
            "output": {"answer": "청년"},
            "error": None,
            "duration_us": 42,
            "trace_id": "tr_experiment_trace",
            "evaluator_results": [
                {"evaluator_key": "exact", "value": True},
                {"evaluator_key": "quality", "value": 0.75},
            ],
        },
    )
    assert recorded.status_code == 200
    assert recorded.json()["evaluator_results"] == [
        {
            "evaluator_key": "exact",
            "value": True,
            "error_message": None,
            "rationale": None,
        },
        {
            "evaluator_key": "quality",
            "value": 0.75,
            "error_message": None,
            "rationale": None,
        },
    ]

    finished = api.post(
        f"/api/v1/experiments/{experiment['experiment_id']}/finish",
        json={"status": "completed"},
    )
    assert finished.status_code == 200
    detail = finished.json()
    assert detail["completed_case_count"] == 1
    assert detail["cases"][0]["expected_output"] == {"answer": "청년"}


def test_dataset_name_is_unique_and_can_be_found_exactly(api: TestClient) -> None:
    created = api.post("/api/v1/datasets", json={"name": "rag-regression"})
    assert created.status_code == 201

    duplicate = api.post("/api/v1/datasets", json={"name": "rag-regression"})
    assert duplicate.status_code == 409

    found = api.get("/api/v1/datasets", params={"name": "rag-regression"})
    assert found.status_code == 200
    assert [item["dataset_id"] for item in found.json()["items"]] == [
        created.json()["dataset_id"]
    ]

    missing = api.get("/api/v1/datasets", params={"name": "other"})
    assert missing.status_code == 200
    assert missing.json() == {"items": []}


def test_experiment_validates_evaluator_type_and_keeps_case_failures(
    api: TestClient,
) -> None:
    dataset = api.post(
        "/api/v1/datasets",
        json={"name": "One case", "examples": [{"input": "question"}]},
    ).json()
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "target failure",
            "evaluators": [{"key": "pass", "name": "Pass", "data_type": "boolean"}],
        },
    ).json()
    case = experiment["cases"][0]

    invalid = api.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{case['experiment_case_id']}",
        json={
            "status": "completed",
            "output": "answer",
            "duration_us": 1,
            "evaluator_results": [{"evaluator_key": "pass", "value": 1}],
        },
    )
    assert invalid.status_code == 409

    failed = api.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{case['experiment_case_id']}",
        json={
            "status": "failed",
            "error": {"__type__": "RuntimeError", "repr": "broken"},
            "duration_us": 1,
            "trace_id": "tr_missing_is_allowed",
        },
    )
    assert failed.status_code == 200
    assert failed.json()["status"] == "failed"


def test_trace_can_be_added_to_dataset_without_assuming_expected_output(
    api: TestClient,
) -> None:
    application = cast(FastAPI, api.app)
    session_factory = application.state.database.session_factory
    with session_factory.begin() as session:
        session.add(
            TraceRow(
                trace_id="tr_dataset_source",
                name="source trace",
                started_at="2026-07-28T00:00:00.000000Z",
                ended_at="2026-07-28T00:00:01.000000Z",
                duration_us=1_000_000,
                status="completed",
                input_json='{"question":"왜 이 노드를 다시 실행했나요?"}',
                output_json='{"answer":"조건부 edge가 loop를 만들었습니다."}',
                error_json="null",
                session_id=None,
                user_id=None,
                release=None,
                environment=None,
                tags_json="[]",
                metadata_json="{}",
                observation_count=1,
                input_preview="source input",
            )
        )
    dataset = api.post("/api/v1/datasets", json={"name": "Trace review"}).json()

    added = api.post(
        f"/api/v1/datasets/{dataset['dataset_id']}/traces",
        json={"trace_id": "tr_dataset_source", "use_trace_output_as_expected": False},
    )

    assert added.status_code == 200
    example = added.json()["examples"][0]
    assert example["input"] == {"question": "왜 이 노드를 다시 실행했나요?"}
    assert example["expected_output"] is None
    assert example["source_trace_id"] == "tr_dataset_source"

    repeated = api.post(
        f"/api/v1/datasets/{dataset['dataset_id']}/traces",
        json={"trace_id": "tr_dataset_source", "use_trace_output_as_expected": False},
    )
    assert repeated.status_code == 200
    assert repeated.json()["revision"] == added.json()["revision"]
    assert len(repeated.json()["examples"]) == 1


@contextmanager
def count_statements() -> Iterator[list[str]]:
    """Record every SQL statement emitted while the block runs."""

    statements: list[str] = []

    def record(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(Engine, "before_cursor_execute", record)


def test_reading_experiments_and_datasets_does_not_scale_queries_with_rows(
    api: TestClient,
) -> None:
    """Reads must stay a fixed number of queries regardless of row counts.

    Rebuilding an evaluator map or a result set per case turns one page view into
    thousands of statements, so the bound is asserted rather than left to review.
    """

    case_count = 25
    dataset = api.post(
        "/api/v1/datasets",
        json={
            "name": "Query budget",
            "examples": [{"input": {"q": index}} for index in range(case_count)],
        },
    ).json()
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "budget run",
            "evaluators": [
                {"key": "exact", "name": "Exact", "data_type": "boolean"},
                {"key": "score", "name": "Score", "data_type": "number"},
            ],
        },
    ).json()
    experiment_id = experiment["experiment_id"]
    for case in experiment["cases"]:
        api.put(
            f"/api/v1/experiments/{experiment_id}/cases/{case['experiment_case_id']}",
            json={
                "status": "completed",
                "output": {"a": 1},
                "duration_us": 1,
                "evaluator_results": [
                    {"evaluator_key": "exact", "value": True},
                    {"evaluator_key": "score", "value": 0.5},
                ],
            },
        )

    with count_statements() as statements:
        detail = api.get(f"/api/v1/experiments/{experiment_id}")
    assert detail.status_code == 200
    assert len(detail.json()["cases"]) == case_count
    assert len(statements) <= 8, statements

    with count_statements() as statements:
        listed = api.get("/api/v1/experiments")
    assert listed.json()["items"][0]["completed_case_count"] == case_count
    assert len(statements) <= 4, statements

    with count_statements() as statements:
        datasets = api.get("/api/v1/datasets")
    assert datasets.json()["items"][0]["example_count"] == case_count
    assert len(statements) <= 4, statements

    with count_statements() as statements:
        detail = api.get(f"/api/v1/datasets/{dataset['dataset_id']}")
    assert len(detail.json()["examples"]) == case_count
    assert len(statements) <= 4, statements


def test_experiment_case_results_follow_evaluator_order(api: TestClient) -> None:
    dataset = api.post(
        "/api/v1/datasets",
        json={"name": "Ordering", "examples": [{"input": "q"}]},
    ).json()
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "ordering run",
            "evaluators": [
                {"key": "first", "name": "First", "data_type": "boolean"},
                {"key": "second", "name": "Second", "data_type": "number"},
                {"key": "third", "name": "Third", "data_type": "boolean"},
            ],
        },
    ).json()
    case_id = experiment["cases"][0]["experiment_case_id"]

    # Reported out of order, and one evaluator fails instead of scoring.
    written = api.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{case_id}",
        json={
            "status": "completed",
            "output": "a",
            "duration_us": 1,
            "evaluator_results": [
                {"evaluator_key": "third", "value": False},
                {"evaluator_key": "second", "error_message": "evaluator raised"},
                {"evaluator_key": "first", "value": True},
            ],
        },
    )
    assert written.status_code == 200
    expected = [
        {
            "evaluator_key": "first",
            "value": True,
            "error_message": None,
            "rationale": None,
        },
        {
            "evaluator_key": "second",
            "value": None,
            "error_message": "evaluator raised",
            "rationale": None,
        },
        {
            "evaluator_key": "third",
            "value": False,
            "error_message": None,
            "rationale": None,
        },
    ]
    assert written.json()["evaluator_results"] == expected

    # The batched read path must agree with the single-case write path.
    reread = api.get(f"/api/v1/experiments/{experiment['experiment_id']}")
    assert reread.json()["cases"][0]["evaluator_results"] == expected


def _dataset_with_one_example(api: TestClient, name: str) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        api.post(
            "/api/v1/datasets",
            json={"name": name, "examples": [{"input": {"q": "a"}}]},
        ).json(),
    )


def _delete(api: TestClient, path: str) -> Response:
    """DELETE with the JSON content type every mutating route requires."""

    return cast(Response, api.delete(path, headers={"content-type": "application/json"}))


def test_dataset_example_edits_advance_the_revision(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Editable")
    dataset_id = dataset["dataset_id"]
    example_id = dataset["examples"][0]["dataset_example_id"]
    assert dataset["revision"] == 1

    patched = api.patch(
        f"/api/v1/datasets/{dataset_id}/examples/{example_id}",
        json={"expected_output": {"a": "b"}, "metadata": {"tag": "edited"}},
    )
    assert patched.status_code == 200
    assert patched.json()["revision"] == 2
    example = patched.json()["examples"][0]
    assert example["expected_output"] == {"a": "b"}
    assert example["metadata"] == {"tag": "edited"}
    assert example["input"] == {"q": "a"}  # untouched fields survive

    removed = _delete(api, f"/api/v1/datasets/{dataset_id}/examples/{example_id}")
    assert removed.status_code == 204
    assert api.get(f"/api/v1/datasets/{dataset_id}").json()["revision"] == 3


def test_dataset_example_edits_reject_unknown_ids_and_empty_patches(
    api: TestClient,
) -> None:
    dataset = _dataset_with_one_example(api, "Guarded")
    dataset_id = dataset["dataset_id"]
    example_id = dataset["examples"][0]["dataset_example_id"]
    other = _dataset_with_one_example(api, "Other")

    assert (
        api.patch(
            f"/api/v1/datasets/{dataset_id}/examples/dse_missing",
            json={"input": "x"},
        ).status_code
        == 404
    )
    # An example belonging to another dataset must not be reachable.
    assert (
        api.patch(
            f"/api/v1/datasets/{other['dataset_id']}/examples/{example_id}",
            json={"input": "x"},
        ).status_code
        == 404
    )
    assert (
        _delete(api, f"/api/v1/datasets/{dataset_id}/examples/dse_missing").status_code
        == 404
    )
    assert (
        api.patch(
            f"/api/v1/datasets/{dataset_id}/examples/{example_id}", json={}
        ).status_code
        == 422
    )
    assert (
        api.post(f"/api/v1/datasets/{dataset_id}/examples", json=[]).status_code == 422
    )


def test_dataset_patch_rejects_empty_and_null_name(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Renamable")
    taken = _dataset_with_one_example(api, "Taken")

    assert (
        api.patch(f"/api/v1/datasets/{dataset['dataset_id']}", json={}).status_code
        == 422
    )
    assert (
        api.patch(
            f"/api/v1/datasets/{dataset['dataset_id']}", json={"name": None}
        ).status_code
        == 422
    )
    assert (
        api.patch(
            f"/api/v1/datasets/{dataset['dataset_id']}", json={"name": taken["name"]}
        ).status_code
        == 409
    )
    renamed = api.patch(
        f"/api/v1/datasets/{dataset['dataset_id']}", json={"name": "Renamed"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed"
    # Renaming is not an example change, so the revision holds.
    assert renamed.json()["revision"] == dataset["revision"]


def test_dataset_with_experiment_history_cannot_be_deleted(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Referenced")
    dataset_id = dataset["dataset_id"]
    api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset_id,
            "name": "keeps history",
            "evaluators": [{"key": "k", "name": "K", "data_type": "boolean"}],
        },
    )

    blocked = _delete(api, f"/api/v1/datasets/{dataset_id}")
    assert blocked.status_code == 409
    assert api.get(f"/api/v1/datasets/{dataset_id}").status_code == 200

    unused = _dataset_with_one_example(api, "Unused")
    assert _delete(api, f"/api/v1/datasets/{unused['dataset_id']}").status_code == 204
    assert _delete(api, f"/api/v1/datasets/{unused['dataset_id']}").status_code == 404


def test_experiment_requires_examples_and_a_known_dataset(api: TestClient) -> None:
    empty = api.post("/api/v1/datasets", json={"name": "Empty"}).json()
    request = {
        "name": "no cases",
        "evaluators": [{"key": "k", "name": "K", "data_type": "boolean"}],
    }

    assert (
        api.post(
            "/api/v1/experiments", json={**request, "dataset_id": empty["dataset_id"]}
        ).status_code
        == 409
    )
    assert (
        api.post(
            "/api/v1/experiments", json={**request, "dataset_id": "ds_missing"}
        ).status_code
        == 404
    )
    assert (
        api.post(
            "/api/v1/experiments",
            json={**request, "dataset_id": empty["dataset_id"], "evaluators": []},
        ).status_code
        == 422
    )
    # Duplicate evaluator keys would make results ambiguous.
    assert (
        api.post(
            "/api/v1/experiments",
            json={
                **request,
                "dataset_id": empty["dataset_id"],
                "evaluators": [
                    {"key": "k", "name": "One", "data_type": "boolean"},
                    {"key": "k", "name": "Two", "data_type": "number"},
                ],
            },
        ).status_code
        == 422
    )


def test_recorded_cases_and_finished_experiments_reject_further_writes(
    api: TestClient,
) -> None:
    dataset = _dataset_with_one_example(api, "Write once")
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "write once",
            "evaluators": [{"key": "k", "name": "K", "data_type": "boolean"}],
        },
    ).json()
    experiment_id = experiment["experiment_id"]
    case_path = (
        f"/api/v1/experiments/{experiment_id}"
        f"/cases/{experiment['cases'][0]['experiment_case_id']}"
    )
    result = {
        "status": "completed",
        "output": "a",
        "duration_us": 1,
        "evaluator_results": [{"evaluator_key": "k", "value": True}],
    }

    assert api.put(case_path, json=result).status_code == 200
    # Results are write-once: replaying the same payload must not overwrite them.
    assert api.put(case_path, json=result).status_code == 409

    unknown_evaluator = api.put(
        f"/api/v1/experiments/{experiment_id}/cases/ec_missing", json=result
    )
    assert unknown_evaluator.status_code == 404

    assert (
        api.post(
            f"/api/v1/experiments/{experiment_id}/finish", json={"status": "completed"}
        ).status_code
        == 200
    )
    assert (
        api.post(
            f"/api/v1/experiments/{experiment_id}/finish", json={"status": "cancelled"}
        ).status_code
        == 409
    )
    assert (
        api.post(
            "/api/v1/experiments/exp_missing/finish", json={"status": "completed"}
        ).status_code
        == 404
    )


def test_case_results_reject_evaluators_outside_the_experiment(
    api: TestClient,
) -> None:
    dataset = _dataset_with_one_example(api, "Evaluator scope")
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "scoped",
            "evaluators": [{"key": "mine", "name": "Mine", "data_type": "boolean"}],
        },
    ).json()
    case_path = (
        f"/api/v1/experiments/{experiment['experiment_id']}"
        f"/cases/{experiment['cases'][0]['experiment_case_id']}"
    )

    foreign = api.put(
        case_path,
        json={
            "status": "completed",
            "output": "a",
            "duration_us": 1,
            "evaluator_results": [{"evaluator_key": "theirs", "value": True}],
        },
    )
    assert foreign.status_code == 409
    # The rejected write must leave the case pending.
    detail = api.get(f"/api/v1/experiments/{experiment['experiment_id']}").json()
    assert detail["cases"][0]["status"] == "pending"


def test_failed_case_keeps_output_absent_rather_than_null(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Failure shape")
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "failure",
            "evaluators": [{"key": "k", "name": "K", "data_type": "boolean"}],
        },
    ).json()
    case_path = (
        f"/api/v1/experiments/{experiment['experiment_id']}"
        f"/cases/{experiment['cases'][0]['experiment_case_id']}"
    )

    failed = api.put(
        case_path,
        json={
            "status": "failed",
            "error": {"__type__": "RuntimeError"},
            "duration_us": 5,
        },
    )
    assert failed.status_code == 200
    assert failed.json()["output"] is None
    assert failed.json()["error"] == {"__type__": "RuntimeError"}
    assert failed.json()["evaluator_results"] == []

    summary = api.get("/api/v1/experiments").json()["items"][0]
    assert summary["failed_case_count"] == 1
    assert summary["completed_case_count"] == 0


def test_completed_case_must_report_every_declared_evaluator(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Complete scores")
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "complete scores",
            "evaluators": [
                {"key": "exact", "name": "Exact", "data_type": "boolean"},
                {"key": "quality", "name": "Quality", "data_type": "number"},
            ],
        },
    ).json()
    experiment_id = experiment["experiment_id"]
    case_path = (
        f"/api/v1/experiments/{experiment_id}"
        f"/cases/{experiment['cases'][0]['experiment_case_id']}"
    )
    base = {"status": "completed", "output": "a", "duration_us": 1}

    empty = api.put(case_path, json={**base, "evaluator_results": []})
    assert empty.status_code == 409
    assert "exact" in empty.json()["detail"] and "quality" in empty.json()["detail"]

    partial = api.put(
        case_path,
        json={**base, "evaluator_results": [{"evaluator_key": "exact", "value": True}]},
    )
    assert partial.status_code == 409
    assert "quality" in partial.json()["detail"]

    # A rejected write leaves nothing behind.
    assert (
        api.get(f"/api/v1/experiments/{experiment_id}").json()["cases"][0]["status"]
        == "pending"
    )

    # Reporting an evaluator failure still counts as reporting it.
    complete = api.put(
        case_path,
        json={
            **base,
            "evaluator_results": [
                {"evaluator_key": "exact", "value": True},
                {"evaluator_key": "quality", "error_message": "evaluator raised"},
            ],
        },
    )
    assert complete.status_code == 200


def test_failed_case_needs_no_evaluator_results(api: TestClient) -> None:
    dataset = _dataset_with_one_example(api, "Failed needs none")
    experiment = api.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset["dataset_id"],
            "name": "failed case",
            "evaluators": [
                {"key": "exact", "name": "Exact", "data_type": "boolean"},
                {"key": "quality", "name": "Quality", "data_type": "number"},
            ],
        },
    ).json()
    case_path = (
        f"/api/v1/experiments/{experiment['experiment_id']}"
        f"/cases/{experiment['cases'][0]['experiment_case_id']}"
    )

    # The target never produced an output, so no evaluator could run.
    failed = api.put(
        case_path,
        json={
            "status": "failed",
            "error": {"__type__": "RuntimeError"},
            "duration_us": 1,
            "evaluator_results": [],
        },
    )
    assert failed.status_code == 200
    assert failed.json()["evaluator_results"] == []
