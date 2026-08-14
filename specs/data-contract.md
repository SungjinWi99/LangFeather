# Data와 HTTP 계약

이 문서는 SDK, server, web이 함께 따르는 현재 계약의 요약이다. 정확한 검증 기준은
`tests/fixtures/schema/v1.json`과 package test에 있다. field를 바꾸면 SDK, server,
web type, fixture, integration test를 같은 변경에서 갱신한다.

## 공통 규칙

- 모든 ID는 client가 생성하는 opaque string이다.
- timestamp는 UTC ISO 8601 string, duration은 microsecond 정수다.
- payload는 JSON-compatible diagnostic value다.
- envelope는 `schema_version: 1`을 포함한다.
- trace ID와 observation ID 재전송은 first-write-wins다.

## trace envelope

```json
{
  "schema_version": 1,
  "trace": {
    "trace_id": "tr_example",
    "name": "support-agent",
    "started_at": "2026-07-30T00:00:00Z",
    "ended_at": "2026-07-30T00:00:01Z",
    "duration_us": 1000000,
    "status": "completed",
    "input": {},
    "output": {},
    "error": null,
    "session_id": "optional-session",
    "tags": [],
    "metadata": {}
  },
  "observations": []
}
```

status는 `completed`, `failed`, `cancelled` 중 하나다. observation은
`observation_id`, `trace_id`, `parent_observation_id`, `sequence`, `name`, `kind`,
시간, status, input/output/error, optional model/usage/metadata를 가진다. root
observation의 parent는 `null`이다.

serializer marker, error, usage의 정확한 모양은 schema fixture를 따른다. serializer는
Pydantic, dataclass, LangChain Document/Message, datetime, UUID, Decimal, bytes,
Exception, cycle, unsupported object를 JSON diagnostic marker로 표현한다.

## ingest

```text
POST /api/v1/traces/batch
```

request는 `{ "items": [envelope, ...] }`다. batch는 network batching일 뿐이며 각
envelope는 독립적으로 validate·commit한다. JSON request 자체가 잘못되면 `422`이고,
형식이 맞는 batch는 item별 `stored`, `duplicate`, `rejected` 결과를 `200`으로 반환한다.

## 조회 API

| endpoint | 역할 |
| --- | --- |
| `GET /api/v1/traces` | cursor list. 기본 50, 최대 200, trace ID/name/input/output text와 filter 지원 |
| `GET /api/v1/traces/{trace_id}` | trace와 observation summary, annotation, memo |
| `GET /api/v1/observations/{observation_id}` | 선택 observation의 전체 payload |
| `DELETE /api/v1/traces/{trace_id}` | trace와 관련 observation/annotation/queue item 삭제 |
| `GET /api/v1/sessions/{session_id}/traces` | 같은 session trace 조회 |

list cursor는 `(started_at, trace_id)`를 담은 opaque token이다. filter나 검색어가 바뀌면
client는 cursor를 버리고 첫 page부터 다시 시작한다. detail은 summary만 주고 payload는
lazy-load한다.

trace 목록 item의 `input_preview`와 `output_preview`는 저장된 원본 payload에서 마지막
message content를 우선 읽은 한 줄 요약이다. 원본 payload는 변경하지 않는다. 목록 item은
모든 LLM observation에 provider `total_tokens`가 있을 때만 합계를 `total_tokens`로 주고,
실제 token callback이 있으면 trace 시작부터 가장 이른 first token까지의 시간을
`time_to_first_token_us`로 준다. 없는 값은 `null`이며 추정하지 않는다.

## Overview API

```text
GET /api/v1/dashboard
```

필수 query는 `from`, `to`, `timezone`이고 `bucket`(`auto`, `hour`, `day`, `week`,
`month`)과 trace filter를 선택할 수 있다. 같은 filter를 통과한 owning trace만 집계한다.

- request count: completed/failed/cancelled 각각
- latency: duration p50/p95/p99
- error rate: `failed / (completed + failed + cancelled)`
- LLM/tool call: `kind="llm"`/`kind="tool"` observation 수
- feedback: trace annotation의 boolean true 비율, number 평균, categorical option 비율

빈 bucket의 count는 `0`이지만 latency, error rate, feedback value는 `null`이다.
experiment evaluator 결과는 Overview에 포함하지 않는다.

## score, annotation, queue

score type은 boolean, finite number, categorical single/multiple이다. 사용 전 score는
구조 수정/삭제가 가능하지만, annotation에 사용된 뒤에는 이름/설명만 수정하고 archive한다.
memo는 score가 아니라 trace당 하나이며 queue가 달라도 공유한다.

annotation queue는 사용자가 trace를 명시적으로 넣는 고정 목록이다. item의 `pending`과
`completed`는 annotation 존재 여부가 아니라 사용자의 완료 action으로 바뀐다.

Python SDK의 `log_feedback()`도 UI와 같은 annotation을 쓴다. 이름으로 활성 score를 찾고
없으면 boolean/number score만 만들며, categorical score는 option이 값에서 나오지 않으므로
미리 있어야 한다. 대상 trace가 이미 저장돼 있어야 하므로 `flush()` 이후에만 성공한다.

## dataset과 experiment

dataset은 mutable example 모음이고, experiment 시작 시 dataset revision과 evaluator 선언을
case에 snapshot한다. target/evaluator 실행은 SDK caller process의 책임이며 server는 결과만
저장한다. evaluator result는 boolean/finite number와 nullable raw `rationale` 또는
`error_message` 하나를 가진다. `POST /api/v1/experiments/{experiment_id}/resume`은
`running`/`cancelled` experiment만 받고 `retry_failed`가 true일 때 failed case result를
pending으로 비운다. 자세한 기능 계약은 [evaluation spec](features/evaluation.md)을 따른다.

## 관리 API

| endpoint | 역할 |
| --- | --- |
| `GET /api/v1/admin/backup` | online SQLite backup download |
| `POST /api/v1/admin/reset` | `{ "confirmation": "RESET" }`로 전체 초기화 |
| `GET /api/v1/health` | product version, schema, migration 상태 |

restore는 HTTP API가 아니다. server를 중지한 뒤 `langfeather-server restore <backup.db>`를
실행한다. CLI는 integrity와 migration을 확인하고 안전 복사본 뒤 atomic replace를 수행한다.
