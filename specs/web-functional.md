# Web 기능 명세

이 문서는 LangFeather `0.3.2` Web UI가 보존해야 하는 사용자 기능을 정의한다. 시각
디자인, DOM 구조, component 이름, CSS class, 화면 분할 방식은 계약이 아니다. API와
data 의미는 `specs/data-contract.md`가 우선한다.

## 현재 상태

`web/src`가 이 문서와 `web-interaction-contract.md`, `web-api-map.md`,
`web-acceptance.md`를 구현한 현재 제품 UI다. 이 문서를 바꾸지 않고 동작을 바꾸는
작업은 규모가 크면 먼저 이 문서를 갱신한다.

## 공통 제품 범위

- 제품명은 `LangFeather`다.
- 사용자는 local collector를 혼자 사용하는 Python 개발자다.
- top-level 기능은 Overview, Traces, Evaluate, Settings 네 개다.
- 기본 진입 기능은 Overview다. 기획서 04절은 Traces를 기본으로 적었지만, 써 보고
  나서 기간 추이를 먼저 보고 들어가는 쪽으로 되돌렸다. 되돌리는 비용은 `url.ts`의
  `DEFAULT_VIEW` 한 곳이다.
- 네 기능이 흡수하는 화면은 다음과 같다. 화면의 기능 자체는 바뀌지 않고 어디에서
  접근하는지만 바뀐다.

| top-level | 흡수하는 화면                         | 내부 구성                                         |
| --------- | ------------------------------------- | ------------------------------------------------- |
| Traces    | Traces                                | 목록, 실행 graph, payload (3분할)                 |
| Overview  | Overview                              | 기간 filter, chart board, 최근 trace              |
| Scores    | Scores                                | score 목록, 생성/보관                             |
| Queues    | Annotation Queues                     | 큐 목록, 라벨링                                   |
| Evaluate  | Evaluation                            | Examples / Experiments 세그먼트                   |
| Settings  | Local Data                            | 백업, 초기화                                      |

- Evaluate의 세그먼트는 dataset의 하위인 Examples와 Experiments 둘뿐이다. Queues와
  Scores는 dataset과 무관한 화면이라 Evaluate 아래에 두면 dataset의 하위처럼 읽혀
  top-level로 둔다. dataset 안에 다시 탭을 두면 같은 여정이 두 겹으로 갈라지므로,
  Examples와 Experiments는 세그먼트로 올린다. 어느 dataset을 보고
  있는지는 상단의 dataset context bar가 계속 알리고, 거기서 다른 dataset으로
  바꾼다. dataset을 고르기 전에는 그 자리에 dataset 목록이 온다.
- dataset을 가로지르는 experiment 목록은 지금 없는 표면이므로 이 재편에 포함하지
  않는다. Experiments 세그먼트도 선택된 dataset의 experiment만 보여준다.
  재편은 되돌릴 수 있어야 하고, 되돌릴 때 신규 기능이 함께 사라지면 안 된다.
- server-side evaluator 실행, login, RBAC, multi-project 전환 UI를 추가하지 않는다.
- raw payload를 자동 redact, truncate, summarize, sample하지 않는다.
- UI는 callback/runtime evidence가 없는 graph edge를 만들어내지 않는다.
- 목록에 payload를 보여줄 때는 값만 남긴다. 서버가 보내는 preview는 JSON을 그대로
  직렬화한 구조가 아니라 원본에서 마지막 message content를 우선 읽은 한 줄 요약이다.
  원문은 검사기의 Input/Output 탭에 그대로 있으므로 목록에서 접어도 잃는 정보가 없다.
  message 구조가 아니면 일반 JSON leaf 값을 순서대로 보여준다. metadata는 예외다 —
  거기서는 key 자체가 정보다.
- 사용자에게 보이는 주요 문구는 Korean-first를 유지하되 기술 명칭과 API field는
  필요에 따라 영어를 쓸 수 있다.
- 사용자는 light와 dark theme을 전환할 수 있다. 아래 "theme 전환"을 따른다.

### 언어 전환

- 상단 bar 오른쪽, theme 전환 옆에 언어 전환 control을 둔다. 둘 다 "내용"이 아니라
  "보는 방식"에 대한 설정이므로 한 묶음이다.
- 선택지는 한국어와 English 둘이고 기본은 한국어다. 저장 위치와 실패 시 동작은
  `web-interaction-contract.md`의 "client 저장 state"를 따른다.
- **기술 용어는 번역하지 않는다.** trace, observation, session, dataset, example,
  experiment, evaluator, score, annotation, queue, retriever, tool, chain,
  runnable, payload, input/output, metadata, revision, snapshot, latency, p95,
  kind, status는 한국어 문장 안에서도 영어 원어로 둔다. API field와 SDK 함수와의
  연결이 끊기면 디버깅 도구로서 쓸모가 없다.
- **번역하는 것**은 사용자가 행동하거나 상태를 이해하기 위한 문구다. 버튼 동사,
  상태 문구, 오류 메시지, 확인 대화의 설명, 빈 화면 안내, 화면 제목.
- **사용자 데이터는 어느 쪽도 아니다.** trace name, session ID, dataset 이름,
  JSON payload, evaluator key는 언어를 바꿔도 손대지 않는다. 화면에 보이는 값과
  저장된 값이 달라지는 순간 디버깅 도구로서 신뢰를 잃는다.
- 영어 라벨은 한국어보다 길다("완료" 2자 -> "Complete" 8자). 버튼, 표 header, 탭에
  고정 px 폭을 쓰지 않는다.
- 번역이 없는 문구는 한국어로 남는다. 화면이 깨지는 것보다 낫다.

### theme 전환

- 상단 bar 오른쪽에 theme 전환 control을 둔다. 어느 기능에서도 화면을 옮기지 않고
  전환할 수 있다. 값이 둘뿐이므로 목록을 여는 select가 아니라 두 값을 모두 보여주는
  전환 control을 쓴다. 언어 전환도 같다.
- 선택지는 `light`와 `dark` 둘이다. 고른 적이 없으면 `prefers-color-scheme`으로
  첫 값을 정한다. 셋 중 하나를 고르게 하면 `system`이 무엇으로 보일지 고르기 전에는
  알 수 없어, 값이 둘뿐인 전환보다 판단이 한 단계 더 든다.
- 선택은 기기에 저장되어 새로고침과 탭 이동 뒤에도 유지된다. 저장 위치와 실패 시
  동작은 `web-interaction-contract.md`의 "client 저장 state"를 따른다.
- theme은 색만 바꾼다. 기능, 문구, layout, 컬럼 폭, 표의 정보량은 바뀌지 않는다.
- 두 theme 모두에서 text는 배경 대비 4.5:1, chart series와 상태 표시는 3:1을
  만족한다. 눈으로 확인하지 않고 `make check-contrast`로 검증한다.
- 색만으로 의미를 전달하는 표시를 새로 만들지 않는다. dark에서 색이 눌려도 상태를
  읽을 수 있어야 한다.

### 표 공통 동작

Traces, Annotation Queue item 목록, Scores, Evaluation Examples/Experiments 표는
같은 상호작용을 공유한다.

- 컬럼 header를 가로로 드래그해 순서를 바꿀 수 있다. 드래그 중 다른 header는
  실시간으로 자리를 비켜주고, header는 세로로는 움직이지 않는다.
- 컬럼 header 오른쪽 경계를 드래그해 폭을 조절할 수 있다.
- 컬럼 header의 정렬 아이콘을 눌러 해당 컬럼 기준 오름차순/내림차순/정렬 해제를
  순환한다.
- checkbox가 있는 표는 checkbox 선택 시 나타나는 toolbar action(Delete 등)으로
  일괄 작업을 처리한다. dataset처럼 카드로 나열하는 목록은 각 카드 오른쪽의 `⋯`
  메뉴로 개별 작업을 처리한다.
- 20개를 넘는 목록(Traces, annotation queue의 trace 목록, dataset example 목록)은
  page당 20개로 나누고 이전/다음 이동과 `N / M` 표시를 제공한다. 검색이나 필터를
  바꾸면 1page로 돌아간다.

## Overview

### 목적

선택한 기간과 trace population에서 요청량, latency, error, LLM/tool 호출,
feedback 추이를 빠르게 확인한다. Overview의 filter state는 Traces와 독립적이다.

### 조회 조건

- 기본 기간은 `1시간`/`24시간`/`최근 7일`/`30일` 중 하나를 고르는 상대 범위이며
  기본값은 최근 7일이다. 상대 범위를 고르면 조회 시점의 현재 시각 기준으로 창이
  다시 계산되어, URL을 나중에 다시 열거나 새로고침해도 그 시점의 최근 구간을
  보여준다. 시작/종료 시각을 직접 입력하는 커스텀 기간을 고르면 그 절대 구간에
  고정된다.
- 상대 범위를 보는 동안은 5초마다 자동으로 다시 조회해 화면이 최신 상태를
  따라간다. 앞선 조회가 아직 끝나지 않았으면 그 주기는 건너뛴다. 커스텀(절대)
  기간에서는 자동 갱신하지 않는다.
- 기본 timezone은 browser의 IANA timezone이며 얻을 수 없으면 `UTC`다.
- bucket은 `auto`, `hour`, `day`, `week`, `month` 중 하나다.
- 시작과 종료 시각, timezone, bucket을 변경할 수 있다.
- query, tag, session ID, release, environment, user ID로 좁힐 수 있다.
- feedback score는 동시에 최대 4개를 선택할 수 있다.
- tool은 server가 돌려준 available tool 중 여러 개를 선택할 수 있다.
- 변경 중인 draft filter는 적용 전까지 조회 결과와 URL을 바꾸지 않는다.
- 적용은 새 query를 실행하고 URL state를 갱신한다.
- 초기화는 최근 7일, local timezone, auto bucket, 빈 filter로 복귀한다.

### 결과

- total trace count
- latency p50, p95, p99
- failed/total과 error rate
- LLM call count
- tool call total과 tool별 시계열
- completed, failed, cancelled 요청 시계열
- 선택한 feedback score의 시계열과 annotation 표본 수

boolean/categorical feedback의 비율과 number feedback의 평균은 서로 다른 scale로
표현한다. number 값에 percent formatting을 적용하지 않는다. 값이 없는 bucket은
0으로 꾸미지 않고 missing/null로 취급한다.

tool call total이 0이면 `__others__ = 0` 같은 가짜 series를 그리지 않고 해당 기간에
tool 호출이 없음을 설명한다. 선택한 feedback에 기록이 없을 때도 명시적인 empty
state를 제공한다.

### 상태

- 최초 및 filter 적용 중 loading
- 성공했지만 trace/tool/feedback이 없는 부분별 empty state
- dashboard 또는 score 목록 조회 실패
- 동일한 조건을 다시 요청하는 retry

## Traces

### 목록

- trace 목록은 detail을 미리 가져오지 않고 summary만 조회한다.
- query, status, from, to, tag, session ID filter를 지원한다.
- filter draft는 적용 또는 초기화 전까지 현재 결과를 바꾸지 않는다.
- 목록은 page당 20개이며 server가 계산한 `total_count`를 기준으로 총 page 수를
  보여준다. 이전/다음 버튼으로 page를 이동한다.
- filter가 적용되거나 초기화되면 1page로 돌아간다.
- 상단 타이틀 옆 건수는 현재 page의 표시 개수가 아니라 필터에 일치하는 전체
  `total_count`다.
- loading, filtered/unfiltered empty, error, retry 상태를 구분한다.
- 필터 줄의 수동 새로고침은 목록만 다시 요청하며 loading 중 disabled다. error에서도 같은
  action이 retry 역할을 하고, 자동 polling이나 새 trace badge는 제공하지 않는다.
- 컬럼 순서/폭 조절, 정렬은 "표 공통 동작"을 따른다. 수집 시각 컬럼은 상대 시간이
  아니라 `MM/DD H:MM AM/PM` 형식의 정확한 시각을 보여준다.
- 넓은 화면의 trace 카드에는 provider가 제공한 trace 전체 token 합계와 trace 시작
  기준 first token 시간을 값이 있을 때만 보여준다. 누락된 값은 0으로 채우지 않는다.
- trace 카드를 펼치면 ID를 반복하지 않고 input/output message의 앞부분만 한 줄로
  보여준다. `human:`과 `ai:` 역할 접두어는 걷어내며 전체 원문은 오른쪽 detail에서
  확인한다.

### 선택과 deep link

- trace 선택 시에만 trace detail을 조회한다.
- `trace` URL parameter가 있으면 새로고침 후 해당 trace를 실제 선택하고 조회한다.
- 선택한 trace ID는 URL에 반영한다.
- detail을 닫거나 삭제하면 trace selection을 비운다.
- text input, textarea, select, contenteditable에 focus가 없고 modifier key가 없을 때
  `J`는 session의 next trace, `K`는 previous trace를 연다.
- trace가 session에 속하면 detail header에 해당 session 안에서의 위치를
  `N / M`(N번째 trace, 총 M개)으로 보여주고, 이전/다음 버튼으로 같은 session의
  다른 trace로 이동한다. session이 없으면 `1 / 1`이며 이동 버튼은 비활성이다.
- 넓은 화면에서는 detail이 목록을 덮지 않는다. 목록과 detail이 좌우로 자리를
  나누고, 그 안에서 실행 graph와 payload가 다시 좌우로 나뉘어 **목록 / graph /
  payload 3분할**이 된다. 디버깅은 목록과 상세를 계속 오가는 작업이라 덮으면
  맥락이 끊긴다.
- 목록은 280–360px이다. 이 화면의 주인공은 목록이 아니라 실행 증거이므로 남는
  폭은 graph와 payload가 나눠 갖는다. 목록을 접으면 graph와 payload가 화면을 다
  쓰고, 접고 펴는 동안 폭이 흐른다.
- 3분할의 두 단 사이에는 고랑을 두고 오른쪽 단도 하나의 판으로 그린다. 두 단의
  폭은 사용자가 조절하지 않는다 — 범위가 이미 좁아 조절할 여지가 없고, 경계에
  걸린 handle은 무엇을 끄는지 알 수 없었다.
- **좁은 화면에서도 detail은 목록을 덮지 않는다.** 3분할 대신 목록 / 실행 흐름 /
  검사기 세 단을 하나씩 보여주고 상단에 단 전환 control을 둔다. 덮으면 맥락이
  끊기는 것은 넓은 화면과 같다. trace를 고르면 실행 흐름 단으로 넘어간다.
- 어느 폭에서도 detail은 dialog가 아니다. 닫을 것이 없으므로 닫기 버튼을 두지
  않고, 목록으로 돌아가는 길은 단 전환이다.
- `trace`가 지정되지 않았다면 목록의 첫 trace를 자동으로 선택한다. 기본 진입이
  Traces인 이유가 방금 돌린 실행을 보기 위해서다. 좁은 화면에서도 목록 단에
  머무르므로 자동 선택이 목록을 가리지 않는다.

### detail

- 이름, status, started/ended time, duration, trace ID, session ID, user ID, release,
  environment, tags와 observation count를 확인할 수 있다.
- observation summary와 실제 runtime graph를 제공한다.
- detail 조회 직후 failed observation 중 sequence가 가장 빠른 항목을 우선 선택한다.
- failed observation이 없으면 parent가 없는 root observation을 선택한다.
- 선택할 observation이 없으면 payload inspector는 idle 상태다.
- observation payload는 observation을 선택한 뒤 별도 API로 lazy-load한다.
- observation 선택, payload loading/error/retry는 trace detail loading/error와
  독립적이다.
- selected observation과 graph selection과 inspector selection은 하나의 state를
  공유한다.

### runtime graph

- node는 observation instance 단위이며 같은 이름도 합치지 않는다.
- callback edge는 존재하는 `parent_observation_id` evidence로만 만든다.
- `dispatch_source_observation_id`가 있으면 callback parent 대신 명시적 dispatch
  edge를 사용한다.
- parent/dispatch source가 현재 graph에 없으면 edge를 추론하지 않는다.
- 시간 구간이 실제로 겹치는 sibling만 parallel row로 취급한다.
- microsecond precision을 유지한다.
- 알려진 kind는 chain, llm, retriever, tool, function, http, runnable, custom이며
  그 외 kind는 generic으로 안전하게 표시한다.
- summary mode가 있다면 root, root의 직접 child, 명시적 dispatch가 있는 실행을
  중심으로 접을 수 있지만 원본 observation 관계를 바꾸지 않는다.
- root observation은 일반 실행 node가 아니라 현재 표시된 하위 node를 감싸는 점선
  실행 경계로 그린다. root selection action은 경계 좌상단에 겹치고 점선이 하단을
  지나는 같은 점선 테두리의 index tab으로 배치하며 observation 이름과 latency만
  내용 폭에 맞춰 보여준다.
  keyboard로 선택하면 같은 selection state를 통해 전체 input/output payload를 연다.
- 선택한 일반 node는 카드 테두리와 함께 순서 표시의 accent 채움으로 구분한다. 이
  강조는 badge의 layout 크기를 바꾸지 않는다. 선택한 root index는 tab 테두리와 점선
  실행 경계 색으로 구분한다.
- 나머지 node는 현재 그래프에서 정렬된 위치의 1-based 번호와 kind label을 header에,
  observation 이름을 본문에,
  status(완료/실패/취소)와 latency를 footer 좌우에 보여준다. 실패 node는 header
  배경 색으로 구분한다.

### payload inspector

- panel 제목은 선택한 observation 이름이며, 오른쪽에 그 observation의 kind를
  tag로 표시한다("Input/Output" 같은 부가 문구는 붙이지 않는다).
- Input과 Output은 항상 확인할 수 있다.
- Error가 있으면 핵심 보기에서도 확인할 수 있다.
- 전체 보기에서는 Usage와 Metadata도 확인할 수 있다.
- nested JSON object와 array는 접고 펼칠 수 있다.
- 선택한 JSON section을 원문 JSON으로 복사할 수 있다.
- 실패 payload가 structured diagnostic이면 error type, message, 마지막 traceback
  frame을 요약하되 전체 raw error도 계속 접근 가능해야 한다.
- payload가 매우 길어도 browser main thread를 불필요하게 막지 않아야 한다.

### Retrieval view

`kind`가 `retriever`인 observation은 일반 JSON tree 대신 검색 결과를 읽는 화면을
보여준다. RAG 디버깅의 질문은 "어떤 문서가 몇 점으로 검색됐고, 그중 무엇이 실제로
답변에 쓰였나"인데 JSON을 펼쳐서는 답이 나오지 않는다. 저장된 payload를 다르게
그리는 것뿐이고 SDK, 서버, API, DB schema는 바뀌지 않는다.

- output이 array면 각 항목을 rank 순서대로 문서 카드로 보여준다. rank는 array
  순서다.
- 카드는 본문 snippet을 보여주고, score와 source는 payload에 있을 때만 보여준다.
  없는 값을 추정해서 채우지 않는다.
- 문서 본문은 `page_content`, `text`, `content` 중 있는 것을 쓰고, 항목이 문자열
  자체면 그 문자열을 쓴다. 어느 것도 아니면 그 항목은 카드로 만들지 않는다.
- score는 `score`, `relevance_score`, `metadata.score` 중 있는 것을 쓴다.
  source는 `metadata.source`, `metadata.file_path`, `id` 중 있는 것을 쓴다.
- 같은 trace 안에서 이 observation보다 뒤에 실행된 `llm` observation의 input에
  문서 본문이 포함되어 있으면 "답변에 사용됨" 배지를 붙인다. 판정은 문자열
  대조이며, **대조할 하류 llm input을 얻지 못하면 어떤 카드에도 배지를 붙이지
  않는다.** 근거 없이 추론하지 않는다.
- 배지를 붙일 수 있을 때만 "N건 중 M건이 답변에 사용됨" 요약 한 줄을 보여준다.
- output이 array가 아니거나 카드로 만들 항목이 없으면 일반 JSON tree로 되돌린다.
- 원문 JSON은 `Input`/`Output` 탭에서 계속 볼 수 있어야 한다. 다르게 그리는
  것이지 가리는 것이 아니다.
- 문서 본문 중 하류 llm input에 그대로 실린 구간은 하이라이트한다. 대조로 확인한
  만큼만 칠하고, 어림잡아 넓히지 않는다.

### graph 상세 수준

- runtime graph는 요약과 전체를 전환할 수 있다. 요약은 root의 직계와 dispatch만
  그리고, 전체는 모든 observation을 그린다.
- LangGraph 앱에서 실제 `llm`과 `tool` 실행은 node보다 깊이 있다. 전체로 바꿀 수
  없으면 그 payload를 아예 선택할 수 없고 kind별 renderer에 닿지 못한다.
- 기본은 요약이다. 처음 열었을 때 실행 흐름이 한눈에 들어와야 한다.

### kind별 renderer

`retriever` 외에 `llm`과 `tool`도 전용 renderer를 가진다. Retrieval view와 같은
원칙이다 — 저장된 payload를 다르게 그릴 뿐이고, 읽어낼 수 없으면 일반 JSON tree로
되돌리며, 원문은 `Input`/`Output` 탭에서 계속 볼 수 있다.

- `llm`: prompt를 message 역할별로 나눠 보여준다. 역할은 `system`, `human`,
  `ai`, `tool`이며 payload의 message type에서 읽는다. content가 block 배열이면
  text block만 이어 붙인다. 응답 text와 token 수(input/output/total)를 함께
  보여준다. token 수는 payload에 있을 때만 보여준다.
- `tool`: 호출을 `name(arg=value, ...)` 시그니처 한 줄로 보여주고 반환값을 그
  아래에 둔다. 반환값이 JSON 문자열이면 파싱해서 보여주되 파싱에 실패하면
  문자열 그대로 둔다.
- 어느 쪽도 값을 추정해 채우지 않는다. 없는 token 수를 0으로 표시하지 않는다.

### trace action

- 선택한 trace를 기존 Annotation Queue에 추가할 수 있다.
- 선택한 trace를 기존 Dataset에 추가할 수 있다.
- queue/dataset 목록을 검색할 수 있다.
- action surface는 Escape 및 외부 클릭으로 닫히고 trigger focus를 복원한다.
- trace 삭제 전에는 trace, observations, feedback이 함께 삭제된다는 확인을 받는다.
- 삭제 성공 후 selection과 detail/payload state를 비우고 목록을 다시 조회한다.

## Scores와 trace annotation

### score 설정

- archived score를 포함한 전체 score 목록을 관리할 수 있다.
- 이름과 설명으로 score를 찾을 수 있다.
- boolean, number, categorical score를 생성한다.
- boolean은 true/false label을 가진다.
- number는 optional minimum/maximum을 가진다.
- categorical은 single/multiple selection mode와 ordered options를 가진다.
- score 이름과 설명을 수정할 수 있다.
- 아직 사용되지 않은 score는 type별 설정도 수정할 수 있다.
- 이미 사용된 score는 과거 annotation 의미를 보호하기 위해 이름과 설명만 바꾼다.
- 사용된 score를 제거하면 archive하고, 사용되지 않은 score는 확인 후 영구 삭제한다.
- create/edit/delete/archive의 pending, error, success feedback을 제공한다.

### trace annotation

- trace detail에서 사용할 score를 추가한다.
- score type에 맞는 annotation value를 입력한다.
- 기존 annotation을 수정하거나 삭제한다.
- trace memo를 score 값과 함께 저장할 수 있다.
- 저장은 annotation과 memo 요청 결과를 모두 반영한 뒤 detail을 새로 조회한다.
- 저장 실패를 성공처럼 표시하지 않는다.

## Annotation Queues

### queue 관리

- queue 목록을 조회하고 이름/설명으로 검색한다.
- 이름, optional 설명, 연결할 score 목록으로 queue를 생성한다.
- trace가 하나도 없는 빈 queue도 생성할 수 있다.
- queue의 이름, 설명, score 구성을 수정할 수 있다.
- queue 목록 표는 Pending/Total 대신 완료 비율을 보여주는 Progress bar와
  "완료 / 전체 runs" 텍스트를 한 컬럼에 함께 보여준다.
- queue 선택은 checkbox로 하며, 선택 시 나타나는 toolbar의 Delete로 일괄 삭제한다.
- trace detail에서 기존 queue에 trace를 추가할 수 있다.
- queue item을 제거할 수 있다.
- queue의 trace item 목록은 page당 20개로 나눈다.
- loading, empty, error와 mutation pending/error 상태를 제공한다.

### review와 편집

- item 상태(대기/완료)를 상태 배지로 보여준다.
- 완료된 뒤 다시 수정된 item은 상태 배지 옆에 "수정됨"을 추가로 표시한다.
- item을 열면(대기든 완료든 같은 detail popup) trace detail을 조회하고 root
  observation payload를 lazy-load한다. 완료/대기를 구분하는 별도 "Review" 진입
  경로나 목록 컬럼은 없다 — 행을 클릭하면 항상 같은 popup이 열린다.
- graph에서 observation을 선택하면 해당 payload를 조회한다.
- queue에 연결된 score 값과 memo를 한 번에 제출한다. 제출 버튼은 처음 완료할
  때와 이미 완료된 item을 다시 저장할 때 모두 같은 "완료" 버튼이다.
- 이미 완료된 item을 다시 저장하면 내부적으로 edit endpoint를 먼저 호출해
  pending으로 되돌린 뒤 즉시 complete를 호출하고, 그 결과 해당 item은 "수정됨"
  표시를 얻는다. 단순히 popup을 열어보기만 하고 저장하지 않으면 상태나
  "수정됨" 표시가 바뀌지 않는다.
- complete 성공 시 item을 completed로 바꾸고 다음 pending item으로 이동한다.
- expected score가 없거나 trace/payload 조회가 실패한 상태를 명확히 처리한다.

## Evaluation

Evaluation은 Dataset 하나를 context로 Examples, Experiments 두 tab을 제공한다.
metric 비교(과거 "Compare")는 별도 tab이 아니라 Experiments tab 안의 카드다.
server는 evaluator를 실행하지 않으며 experiment는 사용자 Python process가 기록한
결과를 읽기만 한다.

### Dataset 선택과 URL

- dataset 목록과 experiment summary 목록을 함께 조회한다.
- dataset 이름과 설명으로 선택지를 검색한다.
- 첫 진입에 URL dataset이 유효하면 복원하고, 없으면 첫 dataset을 선택한다.
- dataset을 바꾸면 experiment/metric/case selection을 비운다.
- 선택한 dataset, tab, ordered experiment IDs, metric keys, case ID를 URL에 기록한다.
- browser back/forward 후 모든 selection을 복원한다.
- 선택한 dataset이 외부에서 삭제되어 detail이 404이면 목록에서 제거하고 최신 목록의
  첫 항목으로 회복한다.
- 느린 mutation refetch가 끝나도 사용자가 그 사이 선택한 다른 dataset을 덮어쓰지
  않는다.

### Dataset 관리

- name과 optional description으로 dataset을 생성한다.
- name은 필수이며 중복 등 API 오류를 설명한다.
- dataset은 카드 목록으로 나열되며, 각 카드 오른쪽의 `⋯` 메뉴에서 Delete를
  선택한다.
- experiment history가 없는 dataset만 확인 후 영구 삭제한다.
- 409이면 experiment 기록 때문에 삭제할 수 없음을 설명한다.
- dataset revision과 example count를 확인할 수 있다.

### Examples

- input은 임의 JSON value다.
- expected output은 optional JSON value다.
- metadata는 JSON object만 허용한다.
- 각 field의 parse error를 field 이름과 함께 표시한다.
- example 목록 위 toolbar에 "+ Add Example" 버튼과 검색창이 있다. 검색은 input,
  expected output, metadata 내용을 모두 대상으로 한다.
- example 행을 클릭하면 오른쪽에서 편집 popup이 열리고 input/expected
  output/metadata를 JSON으로 고쳐 저장할 수 있다.
- example을 checkbox로 선택하면 나타나는 toolbar의 Delete로 확인 후 삭제한다.
- example 목록은 page당 20개로 나눈다.
- example 변경 후 갱신된 dataset revision을 반영한다.
- 과거 experiment snapshot은 example 변경/삭제와 관계없이 유지된다고 설명한다.
- source trace에서 dataset으로 추가할 때 trace output을 expected output으로 자동
  채우지 않는다.

### JSONL

- export는 example마다 `input`, `expected_output`, `metadata`만 한 줄 JSON으로 쓴다.
- `source_trace_id`와 내부 ID/timestamp는 export하지 않는다.
- file name은 dataset name을 안전한 문자로 정규화하고 불가능하면 dataset ID를 쓴다.
- import는 빈 줄을 무시하고 각 줄을 독립적으로 parse/저장한다.
- 한 줄 실패가 나머지 줄 import를 중단하지 않는다.
- 성공 개수와 실패한 원본 line number를 모두 보고한다.

### Experiments

- experiment 목록 위에 검색창이 있고, checkbox로 선택하면 나타나는 toolbar의
  Delete로 확인 후 삭제한다(experiment와 기록된 case 결과가 함께 삭제된다).
- 같은 checkbox는 metric 비교에 포함할 experiment 선택에도 쓰인다(아래
  "Metric 비교").
- experiment summary 목록에서는 detail을 eager-load하지 않는다.
- 행을 클릭하면 오른쪽에서 experiment detail popup이 열린다.
- status, dataset revision, completed/failed case count, duration, evaluator 요약을
  확인할 수 있다.
- detail popup은 target metadata와, case별 input/expected output/output/
  metadata/evaluator 결과/duration을 컬럼으로 보여주는 표를 제공한다. 이 표도
  "표 공통 동작"(컬럼 순서/폭/정렬)을 따르며, evaluator 컬럼은 experiment마다
  달라 experiment가 바뀌면 컬럼 상태를 새로 초기화한다.
- evaluator result에 raw rationale이 있으면 값 아래 native disclosure `근거 보기`로
  접어 보여 준다. 이 텍스트는 자동 redact, truncate, summarize하지 않는다.
- JSON evidence는 접고 펼치며 복사할 수 있다.
- experiment가 없으면 Python SDK `evaluate` 실행 예제를 복사할 수 있게 제공한다.

### Metric 비교

- 같은 dataset revision의 experiment 2~4개만 비교한다. 서로 다른 revision은
  동시에 선택할 수 없다. 최대 4개 제한 이유를 사용자에게 설명한다.
- "Metrics" 버튼을 누르면 evaluator 목록이 checkbox로 열리고, 0개부터 전체까지
  자유롭게 여러 metric을 켜고 끌 수 있다. 자동으로 하나를 선택하지 않는다.
- 같은 key가 서로 다른 evaluator data type으로 선언되면 같은 metric으로 계산하지
  않는다.
- boolean metric은 valid boolean result의 pass rate다.
- number metric은 valid finite number result의 mean이다.
- evaluator error, missing value, target failed case를 denominator/상태에서 숨기지
  않는다.
- scored value가 없으면 0이 아니라 null/값 없음으로 표시한다.
- 그래프는 선택한 metric마다 그룹을 만들고, 그룹 안에서 experiment별 막대를
  같은 색으로 그린다(같은 experiment는 모든 그룹에서 같은 색). 각 그룹은 그
  그룹 안에서의 최댓값 기준으로 0~100%를 정규화하므로 y축은 상대 백분율
  눈금(0/25/50/75/100%)이다. 막대 위에는 값을 적지 않는다.
- 그래프 위에 마우스를 올리면 커서 근처에 그 metric의 experiment별 정확한
  값을 보여주는 카드가 뜬다. 카드 안 experiment 이름은 줄바꿈 없이 길면 ...으로
  줄인다.
- 오른쪽 표는 행이 선택한 metric, 열이 experiment인 행렬로 각 조합의 정확한
  값을 보여준다.
- 0개 metric을 선택하면 그래프는 빈 상태, 표는 experiment 컬럼 header만 보여준다.
- running, cancelled, failed case, evaluator error, missing metric 경고를 제공한다.
- detail load 실패 시 chart를 성공 상태처럼 표시하지 않고 retry를 제공한다.

### Case 비교 (미구현)

`case` URL parameter와 관련 state는 존재하지만 case 단위 side-by-side 비교
UI(better/equal/worse 정렬, case 목록, case detail)는 아직 구현되지 않았다. 이
기능을 다시 시도할 때는 이 절을 실제 동작으로 교체한다.

## Local Data

- local data 전체 초기화는 별도 top-level 기능이다.
- 사용자가 정확히 `RESET`을 입력하기 전에는 실행할 수 없다.
- 실행 직전 destructive confirmation을 다시 받는다.
- 성공하면 현재 trace/detail/payload selection을 모두 비우고 Traces로 이동해 빈
  목록을 다시 조회한다.
- 실패 시 data가 지워졌다고 표시하지 않는다.

## 비기능 요구

- TypeScript strict mode를 유지한다.
- 모든 remote read에는 loading, empty, error, retry를 설계한다.
- mutation은 pending 중 중복 실행을 막고 성공/실패를 구분한다.
- stale async response가 더 최신 selection을 덮어쓰지 않는다.
- desktop과 약 390px mobile에서 주요 조회와 action이 가능해야 한다.
- 긴 trace name, ID, JSON, option label에서 가로 overflow나 겹침이 없어야 한다.
- semantic landmark, heading, label, button을 사용한다.
- dialog, menu, tab, graph node, chart point는 keyboard로 접근 가능해야 한다.
- focus-visible 표시와 dialog/popover 종료 후 합리적인 focus 복귀를 제공한다.
- loading 변화와 mutation 결과는 필요한 곳에서 assistive technology에 전달한다.
