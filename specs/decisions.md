# 현재 제품 결정

이 문서는 현재 구현 판단을 제한하는 결정만 기록한다. 과거 논의와 완료된 phase 기록은
`CHANGELOG.md`에만 남긴다.

| 영역 | 현재 결정 |
| --- | --- |
| 배포 범위 | `0.3.2`은 local-first, single-project, single-user다. 기본 bind는 `127.0.0.1:4319`이며 login이 없다. |
| package | Python SDK는 PyPI에, collector image는 GHCR에 `0.3.2` artifact로 공개한다. public 문서는 실제 artifact install/pull로 확인한 version만 안내한다. |
| SDK | Python 3.10 이상, framework-independent core, optional LangChain/LangGraph integration을 사용한다. |
| 계측 | `wrap_runnable()`으로 최상위 compiled graph를 한 번 감싼다. 자동 수집은 `invoke`, `ainvoke`, `stream`, `astream`의 callback-visible run에 한정한다. |
| trace model | trace는 container이며 실행은 observation이다. root observation은 하나이고 실제 runtime parent 관계만 표시한다. |
| 전송 | bounded in-memory queue, background batch HTTP, 짧은 retry의 best-effort 방식이다. tracing 실패가 application 결과를 바꾸면 안 된다. |
| 데이터 | raw diagnostic payload는 자동 redaction, truncation, sampling 없이 local SQLite에 저장한다. 매우 큰/끝나지 않는 stream은 memory를 소진할 수 있다. |
| server | FastAPI, SQLAlchemy 2.0, SQLite, Alembic, single process/single writer를 사용한다. write API는 commit 뒤에만 성공한다. |
| UI | top-level은 Overview / Traces / Scores / Queues / Evaluate / Settings 여섯이고 기본 진입은 Overview다. Evaluate 안의 세그먼트는 dataset에 매달린 Examples / Experiments 둘뿐이고, dataset과 무관한 Queues와 Scores는 top-level에 둔다. UI는 확인된 runtime evidence만 보여 준다. |
| evaluation | target/evaluator는 SDK를 호출한 사용자 Python process에서 실행하고 server는 dataset, snapshot, result만 저장한다. |
| license | Apache-2.0을 사용하며 root와 Python distribution에 LICENSE를 포함한다. |

새 결정이 현재 행을 바꾸면 이유, 영향 범위, migration 필요 여부를 PR에 적고 사용자
승인을 받는다.
