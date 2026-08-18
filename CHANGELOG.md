# 변경 이력

사용자와 개발자에게 영향을 주는 변경 사항을 이 문서에 기록합니다. 형식은
[Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며, LangFeather가
`0.x` 버전인 동안에는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.

## [Unreleased]

### 변경됨

- 상단 navigation을 Overview / Traces / Scores / Queues / Evaluate / Settings로
  다시 나눴습니다. Scores와 Annotation Queues는 dataset과 무관한 화면인데 Evaluate
  안의 세그먼트로 묶여 있어 dataset의 하위처럼 읽혔습니다. Evaluate 아래에는
  dataset에 매달린 Examples와 Experiments만 남습니다. 기존 링크는 `?view=queues`,
  `?view=scores`는 물론 `?view=evaluate&section=queues|scores` 형태까지 새 화면으로
  이어집니다

## [0.3.2] - 2026-08-04

### 추가됨

- Python SDK `langfeather.log_feedback()`으로 특정 trace에 feedback score를 기록.
  이름으로 활성 score를 찾고 없으면 boolean/number score를 만들며, categorical
  score는 option label로 값을 전달. UI에서 사람이 매긴 점수와 같은 annotation이라
  trace 상세와 Overview score 추이에 함께 나타남 (SDK)

### 변경됨

- 화면 전체를 1.25배로 확대하던 방식을 걷어내고 각 구성 요소의 크기를 그만큼
  키웠습니다. 화면상 크기는 그대로지만, 확대 때문에 어긋나던 좌표 계산이 함께
  정리됐습니다
- 표의 컬럼 폭 조절과 상세 popup 폭 조절이 이제 커서를 정확히 따라옵니다. 이전에는
  마우스보다 25% 더 많이 움직였습니다
- `compose.yaml`의 `LANGFEATHER_TRUSTED_HOSTS`에 `host.docker.internal`을 추가해,
  다른 컨테이너에서 실행하는 application이 collector로 trace를 보낼 수 있습니다

### 수정됨

- UI 개편 과정에서 사라졌던 Dataset 상세의 JSONL 입출력 복원. 예제 목록의 `⋯`
  메뉴에서 `Import`/`Export`를 실행합니다. export는 `input`/`expected_output`/
  `metadata`만 쓰고, import는 빈 줄을 건너뛰며 줄 단위로 저장한 뒤 실패한 원본 줄
  번호를 알려 줌
- Overview 차트의 세로 점선이 커서보다 앞서 나가고 오른쪽 끝에서 멈춰 있던 문제.
  화면 확대 배율이 반영되지 않은 너비로 커서 위치를 계산하고 있었습니다
- Overview 차트의 세부 수치 popup이 커서와 무관하게 가운데 위에 고정돼 있던 문제.
  이제 점선과 커서 높이를 따라가며, 오른쪽 끝에서는 반대편으로 접힙니다
- Evaluation의 metric 비교 막대그래프 popup도 같은 이유로 커서에서 벗어나 있던 문제

## [0.3.1] - 2026-08-03

### 변경됨

- Trace 상세 실행 흐름 그래프를 node 단위 view 하나로 정리하고(Runnable View
  toggle 제거) 그 공간만큼 canvas 높이를 확대
- 그래프 node의 kind 태그를 node 자신의 kind 대신, 접혀 있는 하위 실행 중
  주목할 만한 kind(LLM, Retriever, Tool 등)와 개수로 표시. 우측 입출력 panel
  header도 같은 규칙을 따름
- 같은 부모 아래 형제 실행을 흐름 형태로 연결. 순차 실행은 이어서, 병렬 분기는
  직전 실행에서 갈라져 나오고, 분기가 모두 끝난 뒤 실행된 node로 합류하도록 표시
- 입출력 JSON을 접기/펼치기 가능한 tree로 표시하고, 토글 가능한 필드에 삼각형
  표시와 section별 복사 버튼을 제공. 긴 문자열을 자르지 않고 전부 표시
- LangChain prompt와 output parser 단계를 `runnable` kind로 분류해 workflow
  node와 구분 (SDK)

### 수정됨

- 그래프 edge가 node handle에서 어긋나 그려지던 문제. 전역 `body { zoom: 1.25 }`가
  React Flow의 node 측정에는 반영되고 edge 계산에는 반영되지 않아 생긴 어긋남
- LangGraph가 dispatch된 분기의 모든 하위 관측값에 dispatch 출처를 상속시켜,
  분기 내부 실행까지 dispatch node에서 부챗살처럼 연결되던 문제

## [0.3.0] - 2026-08-03

### 추가됨

- 모든 주요 데이터 표(Traces, Annotation Queue trace 목록, Scores, Evaluation
  Examples/Experiments)에 드래그로 컬럼 순서 변경, 컬럼 폭 조절, 컬럼별
  정렬(오름차순/내림차순) 기능
- Traces, Annotation Queue trace 목록, Dataset Examples 목록에 page당 20개
  pagination
- Traces 상세 popup에서 같은 session의 다른 trace로 이동할 때 `N / M` 형식의
  위치 표시
- Traces 수집 시각 컬럼을 상대 시간 대신 정확한 `MM/DD H:MM AM/PM` 시각으로 표시
- Dataset 카드에 `⋯` 메뉴로 개별 dataset 삭제
- Dataset Examples 목록에 검색창과 "+ Add Example", 행 클릭 시 열리는 편집 popup
- Evaluation Experiments tab에 검색창과 checkbox 기반 experiment 삭제
  (`DELETE /experiments/{id}`)
- Metric 비교 카드에서 여러 metric을 동시에 그래프로 비교(metric별 그룹, 같은
  experiment는 항상 같은 색), 그래프 hover 시 정확한 값을 보여주는 tooltip,
  metric×experiment 값 행렬 표
- Overview 시각화 그래프와 metric 비교 그래프에 y축 눈금 표시
- Annotation Queue 목록에 Pending/Total 대신 진행률 bar와 "완료 / 전체 runs"
  표시
- 완료된 queue item을 다시 저장하면 "수정됨" 표시(`was_edited`)
- 실행 흐름 그래프 node를 순서·kind(header) / 이름(본문) / 상태·latency(footer)
  구조로 재구성
- 전체 UI를 25% 확대해 기본 가독성 개선

### 변경됨

- Traces 목록을 opaque cursor 기반 무한 scroll에서 server가 계산한
  `total_count`를 사용하는 번호 pagination으로 전환(`GET /traces`에 `page` 지원
  추가)
- Annotation Queue item을 다시 완료할 때 별도 "Review" 화면 대신 최초 완료와
  동일한 popup·완료 버튼을 사용하도록 통일
- Evaluation의 "Compare"를 별도 tab에서 Experiments tab 안의 카드로 통합
- 표 기반 목록(Annotation Queues, Scores)의 개별 작업을 행마다 있던 `⋯` 메뉴에서
  checkbox 선택 + toolbar action(Delete/Edit)으로 통일
- Trace 상세의 Input/Output panel 제목에서 불필요한 "Input/Output" 문구를 지우고
  대신 observation kind를 tag로 표시
- 상세 popup(drawer)의 최대 폭을 960px에서 1300px로 확장

### 수정됨

- Annotation Queue 상세의 Trace ID 컬럼에 `overflow`/`ellipsis` 처리가 없어
  컬럼을 넓혀도 옆 컬럼을 침범하던 문제

## [0.2.0] - 2026-07-30

### 추가됨

- 선택한 기간과 trace 필터를 기준으로 trace 수, 지연 시간 백분위수, 오류율,
  LLM/tool 호출, feedback score 추이를 보여주는 모니터링 Overview
- 사용자 정의 불리언, 유한 숫자, 단일/복수 선택 범주형 score 정의
- trace 단위 구조화 annotation과 trace당 공유 메모
- 명시적 완료/수정 흐름을 갖는 고정 수동 annotation queue
- Datasets 화면에서 dataset과 dataset example 삭제
- 같은 dataset revision의 experiment 두 개에서 네 개와 evaluator 네 개까지 선택해
  불리언 통과율과 유한 숫자 평균을 비교하는 evaluation workspace. evaluator 오류와
  값이 없는 case 수를 함께 표시

### 변경됨

- 배포 준비 버전을 `0.2.0`으로 올렸고 Python distribution metadata와 배포 artifact에
  Apache-2.0 license를 선언·포함
- 상단 navigation을 Traces, Annotation Queues, Scores, Evaluation, Local Data로
  분리. Evaluation은 선택한 dataset을 공유하는 Compare, Experiments, Examples tab을
  제공하며 example 생성은 Add example dialog로 이동
- queue 완료 상태는 score 작성 여부와 독립적으로 관리
- 사용된 score 구조는 삭제하지 않고 변경 불가능한 보관 상태로 전환

### 제거됨

- 기존 범용 feedback API, database table, SDK type, fixture

## [0.1.0] - 2026-07-27

초기 local-first 릴리스 기준입니다. GitHub/PyPI/GHCR publication은 별도
Phase 6 release-hardening 단계로 남아 있습니다.

### 추가됨

- `wrap_runnable()`, `@observe`, `span()`, ASGI capture를 포함한 Python SDK
- runtime에서 보이는 Runnable, LLM, retriever, tool 실행을 수집하는
  LangChain/LangGraph callback capture
- trace inspection, feedback, backup, reset, offline restore를 제공하는 FastAPI,
  SQLite, Alembic 기반 local collector
- React runtime graph와 lazy input/output inspector
- Docker Compose local installation과 실행 가능한 LangGraph example

### 수정됨

- LangGraph `Send` fan-out은 callback parent 관계를 추론하지 않고 실제로 관측한
  dispatch edge만 render

### 알려진 제약

- local single-user installation만 지원하며 authentication이나 cloud collector 없음
- trace delivery는 bounded in-memory best-effort 방식
- 원본 diagnostic payload를 자동 redaction하지 않고 local에 보관

[Unreleased]: https://github.com/SungjinWi99/LangFeather/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/SungjinWi99/LangFeather/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/SungjinWi99/LangFeather/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/SungjinWi99/LangFeather/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/SungjinWi99/LangFeather/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SungjinWi99/LangFeather/releases/tag/v0.1.0
