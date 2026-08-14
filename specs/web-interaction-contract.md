# Web interaction 계약

이 문서는 새 UI의 형태가 아니라 상태 소유권과 전이를 고정한다.

## application URL state

| 소유 기능  | URL key                | 값                                                                    |
| ---------- | ---------------------- | --------------------------------------------------------------------- |
| shell      | `view`                 | `traces`, `insights`, `evaluate`, `settings`                          |
| Evaluate   | `section`              | `examples`, `experiments`, `queues`, `scores`; `examples`는 생략 가능 |
| Traces     | `trace`                | selected trace ID 또는 없음                                           |
| Overview   | `overview_from`        | ISO timestamp                                                         |
| Overview   | `overview_to`          | ISO timestamp                                                         |
| Overview   | `overview_range`       | `1h`, `24h`, `7d`, `30d`                                              |
| Overview   | `overview_timezone`    | IANA timezone                                                         |
| Overview   | `overview_bucket`      | `hour`, `day`, `week`, `month`; `auto`는 생략 가능                    |
| Overview   | `overview_query`       | text query                                                            |
| Overview   | `overview_tag`         | tag                                                                   |
| Overview   | `overview_session`     | session ID                                                            |
| Overview   | `overview_release`     | release                                                               |
| Overview   | `overview_environment` | environment                                                           |
| Overview   | `overview_user`        | user ID                                                               |
| Overview   | `overview_scores`      | comma-separated ordered score IDs, 최대 4개                           |
| Overview   | `overview_tools`       | comma-separated ordered tool names                                    |
| Evaluation | `dataset`              | dataset ID                                                            |
| Evaluation | `experiments`          | comma-separated ordered experiment IDs                                |
| Evaluation | `metrics`              | comma-separated evaluator keys                                        |
| Evaluation | `case`                 | dataset example ID                                                    |

- URL에 `view`가 없거나 허용되지 않은 값이면 Traces를 연다.
- 재편 이전 `view` 값은 새 값으로 옮겨 읽는다. 이미 공유된 link를 깨지 않기 위해서다.
  `overview` -> `insights`, `data` -> `settings`, `queues`/`scores`/`datasets` ->
  `evaluate`이고 이때 `section`이 각각 `queues`/`scores`/`examples`가 된다.
  재편 이전 `tab` 값도 같은 방식으로 옮겨 읽는다 — `examples`는 `examples`,
  `experiments`와 `compare`는 `experiments` 세그먼트가 된다. `section`이 함께
  있으면 `section`이 이긴다. URL을 다시 쓸 때는 항상 새 값으로만 쓴다.
- Overview의 filter key는 `overview_` 접두어를 유지한다. tab 이름만 바뀌었을 뿐
  state의 소유자는 같은 화면이고, 접두어를 바꾸면 공유된 link가 전부 깨진다.
- `overview_range`가 있으면 `overview_from`/`overview_to`는 쓰지 않으며, 조회
  시점의 now 기준으로 창을 다시 계산한다 — 그래야 URL을 다시 열거나 polling이
  재조회할 때마다 구간이 최신으로 움직인다. 절대 범위(커스텀)를 고르면
  `overview_range`가 사라지고 기존 `overview_from`/`overview_to` 모드로
  돌아간다. 셋 다 없는 URL은 기본 상대 범위(`7d`)로 읽는다 — 아무 것도 적히지
  않은 첫 진입은 흐르는 대시보드여야 한다.
- Overview filter, Traces filter, Evaluation state는 서로 빌리거나 동기화하지 않는다.
- URL write는 LangFeather가 소유한 key만 교체하고 다른 query parameter는 보존한다.
- state 변화는 history를 무한히 쌓지 않도록 replace semantics를 사용할 수 있다.
- `popstate`에서는 모든 URL-owned state를 다시 읽고 stale detail/payload selection을
  정리한다.
- trace를 Evaluation에서 열었다가 돌아와도 dataset/experiment/metric/case state가
  유지되어야 한다.

## client 저장 state

URL이 아니라 브라우저에 저장하는 state다. 링크로 공유되지 않는다.

| 소유 기능 | 저장 key               | 값              |
| --------- | ---------------------- | --------------- |
| shell     | `langfeather.theme`    | `light`, `dark` |
| shell     | `langfeather.language` | `ko`, `en`      |

- theme은 navigation state가 아니라 기기 취향이므로 URL에 넣지 않는다. 링크를 받은
  사람의 theme을 링크가 덮어쓰지 않아야 한다.
- 저장된 값이 없거나 허용되지 않은 값이면 `prefers-color-scheme`으로 첫 값을 정한다.
  예전에 저장된 `system`도 여기로 떨어진다.
- 고른 뒤에는 OS 설정과 무관하게 고정한다. 선택지가 둘뿐이라 "따라가는" 상태가 없다.
- localStorage를 쓸 수 없는 환경(비공개 모드 등)에서도 UI는 동작해야 한다. 저장에
  실패하면 그 세션 동안만 선택을 유지하고 오류를 표시하지 않는다.
- 첫 paint 전에 theme이 적용되어 light에서 dark로 번쩍이지 않아야 한다.

## async read 규칙

- component unmount 또는 selection/query 변경 시 이전 GET을 AbortController로
  취소한다.
- AbortError는 사용자 오류 상태로 표시하지 않는다.
- list와 detail, detail과 payload는 독립적인 load state를 가진다.
- load state의 최소 집합은 `idle`, `loading`, `error`, `success`다.
- 같은 URL/query의 retry는 revision 또는 동등한 mechanism으로 실제 요청을 다시
  실행한다.
- 늦게 끝난 응답은 요청을 시작할 때의 ID/cursor와 현재 state가 일치할 때만
  적용한다.

## Traces 상태 전이

```text
app start
  -> list loading
  -> list success | list error

trace select
  -> detail loading
  -> detail success
     -> failed observation 또는 root 선택
     -> payload loading
     -> payload success | payload error
  -> detail error

filter apply/reset
  -> trace/observation selection clear
  -> page reset to 1
  -> list loading

manual refresh
  -> list loading
  -> list success | list error

trace delete success
  -> trace/observation selection clear
  -> list reload
```

- 같은 trace를 다시 선택했고 detail이 error가 아니면 중복 요청하지 않아도 된다.
- 같은 observation을 다시 선택했고 payload가 error가 아니면 중복 요청하지 않아도
  된다.
- detail 또는 payload error의 retry는 현재 selection을 유지한다.
- manual refresh는 URL-owned `trace` selection을 유지하며, 목록 checkbox selection은
  목록 effect와 같이 비워도 된다.

## overlay와 focus

- menu/popover/dialog trigger는 accessible name을 가진다.
- Escape는 열린 overlay를 닫는다.
- overlay 밖 pointer interaction도 닫을 수 있다.
- 닫은 뒤 trigger가 존재하면 focus를 돌려준다.
- pending destructive mutation 중에는 dialog를 닫거나 같은 action을 중복 실행하지
  않는다.
- destructive action은 대상과 영향 범위를 포함한 별도 confirmation을 거친다.

## Evaluation tab 규칙

- tab은 Examples, Experiments 순서다("Compare"는 별도 tab이 아니라 Experiments
  tab 안의 metric 비교 카드다).
- ArrowRight/ArrowLeft는 순환 이동한다.
- Home은 첫 tab, End는 마지막 tab으로 이동한다.
- keyboard로 이동한 tab에 focus를 옮긴다.
- tab을 바꿔도 selected dataset context는 유지한다.
- dataset 변경 시 experiment/metric selection은 초기화한다.

## 비교 계산 규칙

각 experiment와 evaluator key에 대해 다음 count를 별도로 유지한다.

- `caseCount`: 전체 case
- `scoredCount`: 유효 boolean 또는 finite number value가 있는 case
- `errorCount`: evaluator error가 있는 case
- `missingCount`: evaluator result가 없거나 value가 null/invalid인 case
- `targetFailedCount`: target execution 자체가 failed인 case

boolean value는 `true` 개수 / `scoredCount`, number value는 유효 값의 arithmetic mean을
사용한다. 내부적으로는 첫 번째 선택된 experiment를 baseline으로 두고
candidate - baseline delta를 계산하지만(어느 한쪽이 null이면 delta도 null),
현재 UI는 이 delta를 표시하지 않고 metric×experiment 행렬 표와 그래프로 절대
값만 보여준다.

## runtime graph 규칙

graph layout은 presentation 구현이 바뀌어도 다음 의미를 유지한다.

- observation ID가 node identity다.
- sequence와 microsecond timestamp가 stable ordering의 근거다.
- 같은 parent의 sibling 중 interval이 모두 실제로 겹치는 집합만 한 parallel row다.
- 단순한 transitive overlap만으로 한 row에 합치지 않는다.
- dispatch evidence가 callback parent보다 우선한다.
- 누락된 target/source를 보완하는 추론 edge를 만들지 않는다.
- root는 `parent_observation_id === null` evidence로만 식별하고, 현재 표시된 하위
  node를 감싸는 점선 실행 경계로 그린다. root는 경계 좌상단에 같은 점선 테두리로
  겹쳐 이름과 latency만 표시하는 fit-content index tab이며 focus 가능한 payload
  selection action이다.
  root-to-child callback은 별도 edge 없이 containment로 표현한다.
- root를 제외한 node badge와 aria label의 순서 번호는 현재 `model.nodes` render
  order의 1-based index로 맞춘다. root index에는 순서 badge를 표시하지 않는다.

## 접근성 상태

- loading은 `aria-live` 또는 동등한 status semantics로 알린다.
- error는 alert semantics와 retry action을 가진다.
- chart는 시각적 line만 제공하지 않고 time label과 focus 가능한 point의 값 설명을
  제공한다.
- graph node는 이름, kind, status, duration, parallel 여부를 keyboard 사용자가
  확인할 수 있어야 한다.
- JSON section과 truncated evidence는 keyboard로 펼칠 수 있다.
