from __future__ import annotations

import json
import threading
import time
import urllib.request
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
import uvicorn

import langfeather
from langfeather_server.app import create_app


def _get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return cast(dict[str, object], json.loads(response.read()))


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[str]:
    application = create_app(database_url=f"sqlite:///{tmp_path / 'evaluation.db'}")
    server = uvicorn.Server(
        uvicorn.Config(
            application,
            host="127.0.0.1",
            port=0,
            log_level="warning",
            access_log=False,
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 5
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=2)
        pytest.fail("Uvicorn did not start for the integration test")
    port = int(server.servers[0].sockets[0].getsockname()[1])
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        langfeather.shutdown(timeout=2)
        server.should_exit = True
        thread.join(timeout=5)


def test_evaluation_rationale_and_resume_round_trip(live_server: str) -> None:
    dataset = langfeather.create_dataset(
        name="evaluation-round-trip",
        examples=[
            langfeather.DatasetExample(
                input={"case": number}, expected_output={"answer": "ok"}
            )
            for number in range(2)
        ],
        endpoint=live_server,
    )
    attempts = 0

    @langfeather.evaluator(key="judge", name="Judge")
    def judge(**kwargs: object) -> langfeather.EvaluationScore:
        input_value = cast(dict[str, int], kwargs["input"])
        return langfeather.EvaluationScore(
            True, f"raw rationale for case {input_value['case']}"
        )

    def interrupted_target(_: object) -> dict[str, str]:
        nonlocal attempts
        attempts += 1
        if attempts == 2:
            raise KeyboardInterrupt
        return {"answer": "ok"}

    langfeather.configure(endpoint=live_server, request_timeout=2, retry_count=0)
    with pytest.raises(KeyboardInterrupt):
        langfeather.evaluate(
            dataset=dataset.dataset_id,
            name="resume me",
            target=interrupted_target,
            evaluators=[judge],
            endpoint=live_server,
        )
    experiments = cast(
        list[dict[str, object]], _get_json(f"{live_server}/api/v1/experiments")["items"]
    )

    resumed = langfeather.resume_experiment(
        experiment_id=cast(str, experiments[0]["experiment_id"]),
        target=lambda _: {"answer": "ok"},
        evaluators=[judge],
        endpoint=live_server,
        max_concurrency=2,
    )

    assert resumed.status == "completed"
    detail = _get_json(f"{live_server}/api/v1/experiments/{resumed.experiment_id}")
    cases = cast(list[dict[str, object]], detail["cases"])
    assert [case["status"] for case in cases] == ["completed", "completed"]
    assert [
        cast(list[dict[str, object]], case["evaluator_results"])[0]["rationale"]
        for case in cases
    ] == [
        "raw rationale for case 0",
        "raw rationale for case 1",
    ]
