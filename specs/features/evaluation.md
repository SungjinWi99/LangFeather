# 평가 기능 계약

평가 기능은 debugging 중 확인한 사례를 regression dataset으로 고정하고, 같은 사례에서
application 변경 전후를 비교하는 local loop다.

```text
reviewed trace → dataset example → local Python experiment → comparison
```

## 경계

- dataset은 수정 가능한 example 모음이다.
- experiment를 시작하면 input, expected output, metadata, evaluator 선언을 revision과
  함께 snapshot하고 이후 case 결과는 immutable history로 저장한다.
- target과 evaluator callable은 `evaluate()`/`aevaluate()`를 호출한 Python process에서
  실행한다. server는 이를 import하거나 실행하지 않는다.
- evaluator 값은 boolean 또는 finite number다. `EvaluationScore(value, rationale=None)`로
  raw rationale을 함께 저장할 수 있지만 evaluator error에는 rationale을 붙이지 않는다.
  categorical 자동 평가와 managed LLM judge는 제공하지 않는다.
- trace 삭제는 dataset/experiment history를 삭제하지 않는다. source trace는 soft
  reference다.

## 실행과 재개

- `evaluate()`와 `aevaluate()`는 `max_concurrency`를 받고 기본값 `1`로 기존 순차 실행을
  유지한다. target/evaluator와 case trace context는 호출자 process에서 각각 독립 실행한다.
- sync interrupt는 제출 전 case를 취소하고 이미 시작한 thread가 끝나 result를 저장할 때까지
  기다린 뒤 experiment를 `cancelled`로 끝낸다. Python thread는 강제 종료할 수 없다.
- `resume_experiment()`는 `running` 또는 `cancelled` experiment만 재개하며 completed
  history를 다시 실행하지 않는다. snapshot의 evaluator key와 data type은 caller가 준
  callable과 실행 전에 정확히 일치해야 한다.
- 재개는 기존 pending case만 실행한다. `retry_failed=true`일 때만 failed case를 pending으로
  되돌리고 output/error/duration/trace/completed_at 및 기존 result rows를 함께 비운다.
- local single-user 경계에서는 abandoned running experiment에 lease나 lock을 추가하지
  않는다. 같은 experiment를 동시에 재개하지 않는 것은 호출자의 책임이다.

## 비교 규칙

- 같은 dataset revision의 experiment만 비교한다.
- 사용자가 experiment 2~4개와 evaluator 최대 4개를 고른다.
- boolean은 통과율, finite number는 평균을 표시한다.
- 전체 case, 정상 값, evaluator 오류, 값 없음, target 실패 수를 숨기지 않는다.

사용 방법은 [평가 가이드](../../sdk/python/docs/evaluation.md)를, API 필드는
[data contract](../data-contract.md)를 따른다.
