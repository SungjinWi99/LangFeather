from __future__ import annotations

import copy
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from langfeather_server.app import create_app
from langfeather_server.database import Database


def make_envelope(
    *,
    trace_id: str = "tr_api_01",
    root_id: str = "obs_api_root",
    child_id: str = "obs_api_child",
    started_at: str = "2026-07-25T12:00:00.000000Z",
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "trace": {
            "trace_id": trace_id,
            "name": "student-graph",
            "started_at": started_at,
            "ended_at": "2026-07-25T12:00:01.500000Z",
            "duration_us": 1_500_000,
            "status": "completed",
            "input": {"question": "왜 이 노드를 다시 실행했나요?"},
            "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
            "error": None,
            "session_id": "thread-7",
            "tags": ["quickstart"],
            "metadata": {"source": "test"},
        },
        "observations": [
            {
                "observation_id": root_id,
                "trace_id": trace_id,
                "parent_observation_id": None,
                "sequence": 0,
                "name": "student-graph",
                "kind": "runnable",
                "started_at": started_at,
                "ended_at": "2026-07-25T12:00:01.500000Z",
                "duration_us": 1_500_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"question": "왜 이 노드를 다시 실행했나요?"},
                "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
                "error": None,
                "model": None,
                "usage": None,
                "metadata": {"langgraph_step": 0},
            },
            {
                "observation_id": child_id,
                "trace_id": trace_id,
                "parent_observation_id": root_id,
                "sequence": 1,
                "name": "answer",
                "kind": "chain",
                "started_at": "2026-07-25T12:00:00.100000Z",
                "ended_at": "2026-07-25T12:00:01.400000Z",
                "duration_us": 1_300_000,
                "time_to_first_token_us": None,
                "status": "completed",
                "input": {"attempt": 2},
                "output": {"answer": "조건부 edge가 loop를 만들었습니다."},
                "error": None,
                "model": None,
                "usage": {
                    "input_tokens": 11,
                    "output_tokens": 8,
                    "total_tokens": 19,
                    "provider": "test",
                    "raw": {},
                },
                "metadata": {"langgraph_node": "answer", "langgraph_step": 1},
            },
        ],
    }


@pytest.fixture
def api(
    tmp_path: Path,
) -> Iterator[tuple[TestClient, Path]]:
    database_path = tmp_path / "langfeather.db"
    application = create_app(database_url=f"sqlite:///{database_path}")
    with TestClient(application, base_url="http://localhost") as client:
        yield client, database_path


def test_health_reports_applied_migration(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "server_version": "0.3.2",
        "supported_schema_versions": [1],
        "database_migration_version": "0006_experiment_result_rationale",
    }


def test_batch_2xx_is_visible_from_a_new_database_connection(
    api: tuple[TestClient, Path],
) -> None:
    client, database_path = api

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [make_envelope()]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "trace_id": "tr_api_01",
                "status": "stored",
                "error": None,
            }
        ]
    }
    with sqlite3.connect(database_path) as connection:
        stored_name = connection.execute(
            "SELECT name FROM traces WHERE trace_id = ?",
            ("tr_api_01",),
        ).fetchone()
        observation_count = connection.execute(
            "SELECT COUNT(*) FROM observations WHERE trace_id = ?",
            ("tr_api_01",),
        ).fetchone()
    assert stored_name == ("student-graph",)
    assert observation_count == (2,)


def test_duplicate_trace_is_success_and_does_not_overwrite(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    original = make_envelope()
    changed = copy.deepcopy(original)
    changed["trace"]["name"] = "overwritten-name"
    changed["observations"][1]["output"] = {"answer": "overwritten"}

    first = client.post("/api/v1/traces/batch", json={"items": [original]})
    duplicate = client.post("/api/v1/traces/batch", json={"items": [changed]})

    assert first.json()["results"][0]["status"] == "stored"
    assert duplicate.status_code == 200
    assert duplicate.json()["results"][0]["status"] == "duplicate"
    trace = client.get("/api/v1/traces/tr_api_01").json()
    payload = client.get("/api/v1/observations/obs_api_child").json()
    assert trace["name"] == "student-graph"
    assert payload["output"] == {"answer": "조건부 edge가 loop를 만들었습니다."}


def test_invalid_envelope_does_not_poison_valid_batch_item(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    rejected = make_envelope(trace_id="tr_bad")
    rejected["schema_version"] = 2
    accepted = make_envelope(
        trace_id="tr_good",
        root_id="obs_good_root",
        child_id="obs_good_child",
    )

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [rejected, accepted]},
    )

    assert response.status_code == 200
    results = response.json()["results"]
    assert results[0]["trace_id"] == "tr_bad"
    assert results[0]["status"] == "rejected"
    assert results[0]["error"]["code"] == "validation_error"
    assert results[1] == {
        "trace_id": "tr_good",
        "status": "stored",
        "error": None,
    }
    assert client.get("/api/v1/traces/tr_bad").status_code == 404
    assert client.get("/api/v1/traces/tr_good").status_code == 200


def test_observation_id_collision_rejects_only_new_trace(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    first = make_envelope()
    collision = make_envelope(
        trace_id="tr_collision",
        root_id="obs_collision_root",
        child_id="obs_api_child",
    )
    assert (
        client.post("/api/v1/traces/batch", json={"items": [first]}).json()["results"][
            0
        ]["status"]
        == "stored"
    )

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [collision]},
    )

    assert response.status_code == 200
    result = response.json()["results"][0]
    assert result["trace_id"] == "tr_collision"
    assert result["status"] == "rejected"
    assert result["error"]["code"] == "validation_error"
    assert client.get("/api/v1/traces/tr_collision").status_code == 404


def test_list_is_latest_first_and_excludes_full_payload(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    older = make_envelope()
    newer = make_envelope(
        trace_id="tr_api_02",
        root_id="obs_api_02_root",
        child_id="obs_api_02_child",
        started_at="2026-07-25T13:00:00.000000Z",
    )
    newer["trace"]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    newer["observations"][0]["ended_at"] = "2026-07-25T13:00:01.500000Z"

    stored = client.post(
        "/api/v1/traces/batch",
        json={"items": [older, newer]},
    )
    response = client.get("/api/v1/traces")

    assert [item["status"] for item in stored.json()["results"]] == [
        "stored",
        "stored",
    ]
    assert response.status_code == 200
    body = response.json()
    assert [item["trace_id"] for item in body["items"]] == [
        "tr_api_02",
        "tr_api_01",
    ]
    assert body["next_cursor"] is None
    assert "input_preview" in body["items"][0]
    assert "조건부 edge가 loop를 만들었습니다." in body["items"][0]["output_preview"]
    assert {"input", "output", "error", "metadata"}.isdisjoint(body["items"][0])


def test_list_preview_prefers_the_last_langchain_message_before_truncating(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    envelope = make_envelope()
    envelope["trace"]["input"] = {
        "messages": [
            {
                "__type__": "langchain_core.messages.human.HumanMessage",
                "fields": {
                    "content": "은행이 파산하면 예금은 얼마나 보호되나요?",
                    "type": "human",
                    "response_metadata": {},
                },
            }
        ],
        "streaming": True,
    }
    envelope["trace"]["output"] = {
        "messages": [
            {
                "__type__": "langchain_core.messages.human.HumanMessage",
                "fields": {"content": "이전 질문", "type": "human"},
            },
            {
                "__type__": "langchain_core.messages.ai.AIMessage",
                "fields": {
                    "content": "최대 5천만원까지 보호됩니다.",
                    "type": "ai",
                    "response_metadata": {"noise": "x" * 400},
                },
            },
        ]
    }

    stored = client.post("/api/v1/traces/batch", json={"items": [envelope]})
    response = client.get("/api/v1/traces")

    assert stored.json()["results"][0]["status"] == "stored"
    item = response.json()["items"][0]
    assert item["input_preview"] == (
        "human: 은행이 파산하면 예금은 얼마나 보호되나요?"
    )
    assert item["output_preview"] == "ai: 최대 5천만원까지 보호됩니다."


def test_list_aggregates_complete_llm_tokens_and_trace_first_token(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    envelope = make_envelope()
    first_llm = envelope["observations"][1]
    first_llm["kind"] = "llm"
    first_llm["time_to_first_token_us"] = 200_000
    second_llm = copy.deepcopy(first_llm)
    second_llm.update(
        {
            "observation_id": "obs_api_second_llm",
            "sequence": 2,
            "started_at": "2026-07-25T12:00:00.400000Z",
            "ended_at": "2026-07-25T12:00:01.300000Z",
            "duration_us": 900_000,
            "time_to_first_token_us": 100_000,
            "usage": {
                "input_tokens": 5,
                "output_tokens": 2,
                "total_tokens": 7,
                "provider": "test",
                "raw": {},
            },
        }
    )
    envelope["observations"].append(second_llm)

    stored = client.post("/api/v1/traces/batch", json={"items": [envelope]})
    response = client.get("/api/v1/traces")

    assert stored.json()["results"][0]["status"] == "stored"
    item = response.json()["items"][0]
    assert item["total_tokens"] == 26
    assert item["time_to_first_token_us"] == 300_000


def test_list_does_not_invent_a_partial_trace_token_total(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    envelope = make_envelope()
    first_llm = envelope["observations"][1]
    first_llm["kind"] = "llm"
    second_llm = copy.deepcopy(first_llm)
    second_llm.update(
        {
            "observation_id": "obs_api_second_llm",
            "sequence": 2,
            "usage": None,
        }
    )
    envelope["observations"].append(second_llm)

    client.post("/api/v1/traces/batch", json={"items": [envelope]})
    item = client.get("/api/v1/traces").json()["items"][0]

    assert item["total_tokens"] is None


def test_list_filters_and_uses_an_exclusive_opaque_cursor(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    oldest = make_envelope(
        trace_id="tr_api_01",
        root_id="obs_api_01_root",
        child_id="obs_api_01_child",
        started_at="2026-07-25T12:00:00.000000Z",
    )
    oldest["trace"]["tags"] = ["policy"]
    oldest["trace"]["session_id"] = "session-filter"
    matching = make_envelope(
        trace_id="tr_api_02",
        root_id="obs_api_02_root",
        child_id="obs_api_02_child",
        started_at="2026-07-25T13:00:00.000000Z",
    )
    matching["trace"]["tags"] = ["policy", "review"]
    matching["trace"]["session_id"] = "session-filter"
    matching["trace"]["name"] = "policy-search"
    matching["observations"][0]["name"] = "policy-search"
    matching["trace"]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    matching["observations"][0]["ended_at"] = "2026-07-25T13:00:01.500000Z"
    newest = make_envelope(
        trace_id="tr_api_03",
        root_id="obs_api_03_root",
        child_id="obs_api_03_child",
        started_at="2026-07-25T14:00:00.000000Z",
    )
    newest["trace"]["tags"] = ["other"]
    newest["trace"]["session_id"] = "session-filter"
    newest["trace"]["ended_at"] = "2026-07-25T14:00:01.500000Z"
    newest["observations"][0]["ended_at"] = "2026-07-25T14:00:01.500000Z"

    response = client.post(
        "/api/v1/traces/batch",
        json={"items": [oldest, matching, newest]},
    )
    assert [item["status"] for item in response.json()["results"]] == [
        "stored",
        "stored",
        "stored",
    ]

    first_page = client.get("/api/v1/traces?limit=1")
    assert first_page.status_code == 200
    first_body = first_page.json()
    assert [item["trace_id"] for item in first_body["items"]] == ["tr_api_03"]
    assert isinstance(first_body["next_cursor"], str)

    second_page = client.get(
        "/api/v1/traces",
        params={"limit": 1, "cursor": first_body["next_cursor"]},
    )
    assert second_page.status_code == 200
    assert [item["trace_id"] for item in second_page.json()["items"]] == ["tr_api_02"]

    filtered = client.get(
        "/api/v1/traces",
        params={
            "tag": "review",
            "session_id": "session-filter",
            "query": "policy-search",
            "from": "2026-07-25T12:30:00Z",
            "to": "2026-07-25T13:30:00Z",
        },
    )
    assert filtered.status_code == 200
    assert [item["trace_id"] for item in filtered.json()["items"]] == ["tr_api_02"]

    session_traces = client.get("/api/v1/sessions/session-filter/traces")
    assert [item["trace_id"] for item in session_traces.json()["items"]] == [
        "tr_api_03",
        "tr_api_02",
        "tr_api_01",
    ]
    middle = client.get("/api/v1/traces/tr_api_02").json()
    assert middle["previous_trace_id"] == "tr_api_01"
    assert middle["next_trace_id"] == "tr_api_03"

    invalid_cursor = client.get("/api/v1/traces?cursor=not-a-cursor")
    assert invalid_cursor.status_code == 400


def test_trace_id_query_matches_partial_ids_and_escapes_like_wildcards(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    literal_id = "tr_issue20_%_literal"
    wildcard_match = make_envelope(
        trace_id=literal_id,
        root_id="obs_issue20_literal_root",
        child_id="obs_issue20_literal_child",
    )
    near_match = make_envelope(
        trace_id="tr_issue20_xxliteral",
        root_id="obs_issue20_near_root",
        child_id="obs_issue20_near_child",
    )
    stored = client.post(
        "/api/v1/traces/batch", json={"items": [wildcard_match, near_match]}
    )
    assert [item["status"] for item in stored.json()["results"]] == [
        "stored",
        "stored",
    ]

    partial = client.get("/api/v1/traces", params={"query": "issue20"})
    literal = client.get("/api/v1/traces", params={"query": literal_id})
    dashboard = client.get(
        "/api/v1/dashboard",
        params={
            "from": "2026-07-25T11:00:00Z",
            "to": "2026-07-25T13:00:00Z",
            "timezone": "UTC",
            "query": literal_id,
        },
    )

    assert {item["trace_id"] for item in partial.json()["items"]} == {
        literal_id,
        "tr_issue20_xxliteral",
    }
    assert [item["trace_id"] for item in literal.json()["items"]] == [literal_id]
    assert dashboard.json()["totals"]["trace_count"] == 1


def _create_experiment(client: TestClient, *, example_count: int = 1) -> dict[str, Any]:
    dataset = client.post(
        "/api/v1/datasets",
        json={
            "name": "evaluation-api-test",
            "examples": [
                {
                    "input": {"case": index},
                    "expected_output": {"answer": "ok"},
                    "metadata": {},
                }
                for index in range(example_count)
            ],
        },
    )
    assert dataset.status_code == 201
    experiment = client.post(
        "/api/v1/experiments",
        json={
            "dataset_id": dataset.json()["dataset_id"],
            "name": "evaluation-api-test",
            "evaluators": [
                {"key": "judge", "name": "Judge", "data_type": "boolean"}
            ],
        },
    )
    assert experiment.status_code == 201
    return cast(dict[str, Any], experiment.json())


def test_experiment_result_rationale_round_trips_without_mutation(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    experiment = _create_experiment(client, example_count=2)
    case_id = experiment["cases"][0]["experiment_case_id"]
    pending_case_id = experiment["cases"][1]["experiment_case_id"]

    stored = client.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{case_id}",
        json={
            "status": "completed",
            "output": {"answer": "ok"},
            "duration_us": 1,
            "evaluator_results": [
                {
                    "evaluator_key": "judge",
                    "value": True,
                    "rationale": "raw judge diagnostic\nwith a second line",
                }
            ],
        },
    )

    assert stored.status_code == 200
    assert stored.json()["evaluator_results"] == [
        {
            "evaluator_key": "judge",
            "value": True,
            "error_message": None,
            "rationale": "raw judge diagnostic\nwith a second line",
        }
    ]
    detail = client.get(f"/api/v1/experiments/{experiment['experiment_id']}")
    assert detail.json()["cases"][0]["evaluator_results"][0]["rationale"] == (
        "raw judge diagnostic\nwith a second line"
    )

    invalid = client.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{pending_case_id}",
        json={
            "status": "completed",
            "output": {"answer": "ok"},
            "duration_us": 1,
            "evaluator_results": [
                {
                    "evaluator_key": "judge",
                    "error_message": "judge failed",
                    "rationale": "must not persist with an error",
                }
            ],
        },
    )
    assert invalid.status_code == 422

    null_score = client.put(
        f"/api/v1/experiments/{experiment['experiment_id']}/cases/{pending_case_id}",
        json={
            "status": "completed",
            "output": {"answer": "ok"},
            "duration_us": 1,
            "evaluator_results": [
                {
                    "evaluator_key": "judge",
                    "value": None,
                    "rationale": "must not persist without a score",
                }
            ],
        },
    )
    assert null_score.status_code == 422


def test_resume_experiment_keeps_history_and_only_resets_failed_cases_on_request(
    api: tuple[TestClient, Path],
) -> None:
    client, database_path = api
    experiment = _create_experiment(client, example_count=2)
    experiment_id = cast(str, experiment["experiment_id"])
    first_case, failed_case = experiment["cases"]

    assert (
        client.put(
            f"/api/v1/experiments/{experiment_id}/cases/{first_case['experiment_case_id']}",
            json={
                "status": "completed",
                "output": {"answer": "ok"},
                "duration_us": 1,
                "trace_id": "tr_completed",
                "evaluator_results": [{"evaluator_key": "judge", "value": True}],
            },
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/experiments/{experiment_id}/cases/{failed_case['experiment_case_id']}",
            json={
                "status": "failed",
                "error": {"type": "target"},
                "duration_us": 2,
                "trace_id": "tr_failed",
                "evaluator_results": [
                    {"evaluator_key": "judge", "error_message": "judge failed"}
                ],
            },
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/v1/experiments/{experiment_id}/finish", json={"status": "cancelled"}
        ).status_code
        == 200
    )

    without_retry = client.post(
        f"/api/v1/experiments/{experiment_id}/resume", json={"retry_failed": False}
    )
    assert without_retry.status_code == 200
    before_retry = {
        item["experiment_case_id"]: item for item in without_retry.json()["cases"]
    }
    assert without_retry.json()["status"] == "running"
    assert without_retry.json()["ended_at"] is None
    assert before_retry[first_case["experiment_case_id"]]["status"] == "completed"
    assert before_retry[failed_case["experiment_case_id"]]["status"] == "failed"

    with_retry = client.post(
        f"/api/v1/experiments/{experiment_id}/resume", json={"retry_failed": True}
    )
    assert with_retry.status_code == 200
    after_retry = {
        item["experiment_case_id"]: item for item in with_retry.json()["cases"]
    }
    assert after_retry[first_case["experiment_case_id"]]["status"] == "completed"
    assert after_retry[failed_case["experiment_case_id"]] == {
        **after_retry[failed_case["experiment_case_id"]],
        "status": "pending",
        "output": None,
        "error": None,
        "duration_us": None,
        "trace_id": None,
        "completed_at": None,
        "evaluator_results": [],
    }
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM experiment_results").fetchone() == (
            1,
        )

    assert (
        client.post(
            f"/api/v1/experiments/{experiment_id}/finish", json={"status": "completed"}
        ).status_code
        == 200
    )
    assert (
        client.post(f"/api/v1/experiments/{experiment_id}/resume", json={}).status_code
        == 409
    )


def test_trace_detail_and_observation_payload_are_separate(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    stored = client.post(
        "/api/v1/traces/batch",
        json={"items": [make_envelope()]},
    )
    assert stored.json()["results"][0]["status"] == "stored"

    trace_response = client.get("/api/v1/traces/tr_api_01")
    observation_response = client.get("/api/v1/observations/obs_api_child")

    assert trace_response.status_code == 200
    trace = trace_response.json()
    assert {"input", "output", "error", "metadata"}.isdisjoint(trace)
    assert len(trace["observations"]) == 2
    assert trace["annotations"] == []
    assert trace["memo"] is None
    assert {"input", "output", "error", "usage", "metadata"}.isdisjoint(
        trace["observations"][1]
    )
    assert trace["observations"][1]["dispatch_count"] == 0
    assert trace["observations"][1]["dispatch_source_observation_id"] is None

    assert observation_response.status_code == 200
    observation = observation_response.json()
    assert observation["input"] == {"attempt": 2}
    assert observation["output"] == {"answer": "조건부 edge가 loop를 만들었습니다."}
    assert observation["error"] is None
    assert observation["usage"]["total_tokens"] == 19
    assert observation["metadata"] == {
        "langgraph_node": "answer",
        "langgraph_step": 1,
    }


def test_trace_detail_exposes_explicit_dispatch_evidence(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    envelope = make_envelope()
    root, child = envelope["observations"]
    root["metadata"]["langfeather_dispatches"] = [{"target": "answer", "index": 0}]
    child["metadata"]["langfeather_dispatch_source_observation_id"] = root[
        "observation_id"
    ]

    response = client.post("/api/v1/traces/batch", json={"items": [envelope]})

    assert response.status_code == 200
    detail = client.get("/api/v1/traces/tr_api_01").json()
    summaries = {item["observation_id"]: item for item in detail["observations"]}
    assert summaries["obs_api_root"]["dispatch_count"] == 1
    assert summaries["obs_api_child"]["dispatch_source_observation_id"] == (
        "obs_api_root"
    )


def test_delete_trace_removes_observations_annotations_and_memo(
    api: tuple[TestClient, Path],
) -> None:
    client, database_path = api
    assert (
        client.post(
            "/api/v1/traces/batch", json={"items": [make_envelope()]}
        ).status_code
        == 200
    )
    score = client.post(
        "/api/v1/scores",
        json={
            "name": "Success",
            "data_type": "boolean",
            "boolean_true_label": "Success",
            "boolean_false_label": "Failure",
        },
    ).json()
    assert (
        client.put(
            f"/api/v1/traces/tr_api_01/annotations/{score['score_config_id']}",
            json={"value": True},
        ).status_code
        == 200
    )
    assert (
        client.put(
            "/api/v1/traces/tr_api_01/memo",
            json={"content": "delete me"},
        ).status_code
        == 200
    )

    deleted = client.delete(
        "/api/v1/traces/tr_api_01",
        headers={"content-type": "application/json"},
    )

    assert deleted.status_code == 204
    assert client.get("/api/v1/traces/tr_api_01").status_code == 404
    with sqlite3.connect(database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM observations").fetchone() == (
            0,
        )
        assert connection.execute("SELECT COUNT(*) FROM annotations").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM trace_memos").fetchone() == (0,)


def test_batch_requires_json_and_rejects_malformed_request_shape(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api

    wrong_content_type = client.post(
        "/api/v1/traces/batch",
        content="{}",
        headers={"content-type": "text/plain"},
    )
    invalid_shape = client.post(
        "/api/v1/traces/batch",
        json={"items": "not-a-list"},
    )

    assert wrong_content_type.status_code == 415
    assert invalid_shape.status_code == 422


def test_sqlite_safety_pragmas_are_enabled(
    api: tuple[TestClient, Path],
) -> None:
    client, _ = api
    application = cast(FastAPI, client.app)
    database = cast(Database, application.state.database)

    with database.engine.connect() as connection:
        journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar()
        synchronous = connection.exec_driver_sql("PRAGMA synchronous").scalar()
        foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
        busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar()

    assert journal_mode == "wal"
    assert synchronous == 2
    assert foreign_keys == 1
    assert busy_timeout == 5_000
