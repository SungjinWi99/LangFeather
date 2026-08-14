# Web API map

Web client의 base path는 `/api/v1`이다. ID와 cursor는 opaque value로 취급하고 URL path
segment는 encode한다. GET은 `Accept: application/json`, mutation은 JSON body와
`Content-Type: application/json`을 사용한다. non-2xx는 status를 보존한 `ApiError`로
처리한다.

## Trace와 dashboard

| 사용자 동작 | method/path | request 또는 query | response |
| --- | --- | --- | --- |
| trace 목록 | `GET /traces` | `page`, `limit`, `status`, `from`, `to`, `tag`, `session_id`, `query`(과거 `cursor` 기반 무한 scroll도 여전히 지원되지만 web client는 `page`만 쓴다) | `TraceListResponse`(`items`, `next_cursor`, `total_count`) |
| session trace 목록 | `GET /sessions/{session_id}/traces` | trace query에서 `session_id` 제외 | `TraceListResponse` |
| trace detail | `GET /traces/{trace_id}` | 없음 | `TraceDetail`(session이 있으면 `previous_trace_id`/`next_trace_id`와 `session_position`/`session_total` 포함) |
| observation payload | `GET /observations/{observation_id}` | 없음 | `Observation` |
| dashboard | `GET /dashboard` | `DashboardQuery`; `score_id`, `tool_name`은 repeated parameter | `DashboardResponse` |
| trace 삭제 | `DELETE /traces/{trace_id}` | 없음 | `204` |
| 전체 초기화 | `POST /admin/reset` | `{"confirmation":"RESET"}` | `204` |

dashboard query는 `from`, `to`, `timezone`이 필수다. 빈 optional 값은 보내지 않는다.
array query는 comma string이 아니라 같은 key를 여러 번 append한다.

## Scores와 annotation

| 사용자 동작 | method/path | body | response |
| --- | --- | --- | --- |
| score 목록 | `GET /scores` | `include_archived=true` optional query | `ScoreListResponse` |
| score 생성 | `POST /scores` | `ScoreCreateRequest` | `ScoreConfig` |
| score 수정 | `PATCH /scores/{score_config_id}` | partial `ScoreCreateRequest` | `ScoreConfig` |
| score 삭제 | `DELETE /scores/{score_config_id}` | 없음 | `204` |
| score archive | `POST /scores/{score_config_id}/archive` | `{}` | `ScoreConfig` |
| annotation 저장 | `PUT /traces/{trace_id}/annotations/{score_config_id}` | `{"value": AnnotationValue}` | `Annotation` |
| annotation 삭제 | `DELETE /traces/{trace_id}/annotations/{score_config_id}` | 없음 | `204` |
| memo 저장/비우기 | `PUT /traces/{trace_id}/memo` | `{"content": string}` | `TraceMemo` 또는 `null` |

## Annotation Queues

| 사용자 동작 | method/path | body | response |
| --- | --- | --- | --- |
| queue 목록 | `GET /annotation-queues` | 없음 | `AnnotationQueueListResponse` |
| queue detail | `GET /annotation-queues/{queue_id}` | 없음 | `AnnotationQueue` |
| queue 생성 | `POST /annotation-queues` | name, description, score_config_ids, trace_ids | `AnnotationQueue` |
| queue 수정 | `PATCH /annotation-queues/{queue_id}` | name/description/score_config_ids 중 일부 | `AnnotationQueue` |
| item 추가 | `POST /annotation-queues/{queue_id}/items` | `{"trace_ids":[...]}` | `AnnotationQueue` |
| item 제거 | `DELETE /annotation-queues/{queue_id}/items/{item_id}` | 없음 | `204` |
| queue 삭제 | `DELETE /annotation-queues/{queue_id}` | 없음 | `204` |
| completed item 재편집 | `POST /annotation-queues/{queue_id}/items/{item_id}/edit` | `{}` | `AnnotationQueueItem` |
| review 완료 | `POST /annotation-queues/{queue_id}/items/{item_id}/complete` | annotations와 optional memo | `AnnotationQueueItem` |

review 완료 body:

```json
{
  "annotations": [
    {
      "score_config_id": "opaque-id",
      "value": true
    }
  ],
  "memo": "optional text"
}
```

memo가 정의되지 않았으면 field 자체를 생략한다.

## Datasets와 experiments

| 사용자 동작 | method/path | body | response |
| --- | --- | --- | --- |
| dataset 목록 | `GET /datasets` | 없음 | `DatasetListResponse` |
| dataset detail | `GET /datasets/{dataset_id}` | 없음 | `Dataset` |
| dataset 생성 | `POST /datasets` | name, optional description | `Dataset` |
| example 추가 | `POST /datasets/{dataset_id}/examples` | example object 하나를 담은 JSON array | `Dataset` |
| example 수정 | `PATCH /datasets/{dataset_id}/examples/{example_id}` | input/expected_output/metadata 중 일부 | `Dataset` |
| example 삭제 | `DELETE /datasets/{dataset_id}/examples/{example_id}` | 없음 | `204` |
| trace snapshot 추가 | `POST /datasets/{dataset_id}/traces` | trace_id, `use_trace_output_as_expected:false` | `Dataset` |
| dataset 삭제 | `DELETE /datasets/{dataset_id}` | 없음 | `204`; history가 있으면 `409` |
| experiment 목록 | `GET /experiments` | 없음 | `ExperimentListResponse` |
| experiment detail | `GET /experiments/{experiment_id}` | 없음 | `Experiment` |
| experiment 재개 | `POST /experiments/{experiment_id}/resume` | `retry_failed:false` | `Experiment` |
| experiment 삭제 | `DELETE /experiments/{experiment_id}` | 없음 | `204` |

example input은 모든 JSON value를 허용한다. metadata는 object여야 한다.
`expected_output`은 null일 수 있다. dataset/example mutation의 `Dataset` response가
새 revision과 최신 examples의 source of truth다.

## 보존해야 하는 client contract

- GET은 optional `AbortSignal`을 받는다.
- `204` mutation은 `undefined`로 정상 처리한다.
- server response type 변경은 `api/types.ts`, server model, canonical fixture,
  contract test를 같은 변경에서 갱신한다.
- dashboard array parameter 직렬화와 schema v1 envelope validation은 executable
  tests로 계속 고정한다.
