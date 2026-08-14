# Dataset, Experiment, Evaluator 가이드

이 문서는 Python SDK로 dataset과 experiment를 실행하는 방법을 설명합니다. UI에서
monitoring과 annotation을 사용하는 방법은 repository의
[Monitoring과 평가 가이드](https://github.com/SungjinWi99/LangFeather/blob/main/docs/guides/monitoring-and-evaluation.md)를 참고하세요.

LangFeather의 evaluation 기능은 debugging 중 확인한 사례를 regression dataset으로
고정하고, 같은 사례에 대한 application 변경 전후 결과를 local에서 비교하기 위한
가벼운 loop다.

```text
failed or reviewed trace → dataset example → local Python experiment → result comparison
```

Server는 dataset, snapshot, result만 저장한다. target과 evaluator Python 코드는
`evaluate()` 또는 `aevaluate()`를 호출한 process에서만 실행된다.

## 빠른 흐름

1. LangFeather server/UI를 실행하고 trace를 확인한다.
2. trace 상세의 `… → Add to Dataset`으로 root input을 dataset example에 추가한다.
3. 상단 navigation의 `Evaluation`에서 dataset을 열어 expected output과 metadata를
   검토한다.
4. application code 또는 별도 regression script에서 `langfeather.evaluate()`를 실행한다.
5. dataset 상세의 `Experiments` tab에서 case별 output, score, trace와 같은 revision의
   experiment를 나란히 비교한다.

`Add to Dataset`은 trace input만 저장한다. 관찰한 output은 정답이 아닐 수 있으므로
expected output을 자동으로 채우지 않는다. 같은 trace를 같은 dataset에 다시 추가해도
example은 중복 생성하지 않는다.

## Dataset 만들기

UI에서 **Evaluation → New Dataset**을 선택해 빈 dataset을 만든 뒤 상세 화면의
**Add example**로 example을 추가할 수 있다. API를 직접 사용할 때는 다음과 같다.

```bash
curl -X POST http://127.0.0.1:4319/api/v1/datasets \
  -H 'content-type: application/json' \
  -d '{
    "name": "rag-regression",
    "description": "검토가 끝난 retrieval 실패 사례",
    "examples": [{
      "input": {"question": "지원 대상은?"},
      "expected_output": {"answer": "청년"},
      "metadata": {"category": "eligibility"}
    }]
  }'
```

Dataset example은 `input`, nullable `expected_output`, optional `metadata`,
optional `source_trace_id`를 가진다. example을 추가·수정·삭제하면 dataset revision이
증가한다.

## Dataset과 example 삭제

dataset 상세의 example 행 메뉴에서 `영구 삭제`를 선택하면 해당 example만 지워지고
revision이 증가한다. 이미 실행한 experiment는 시작 시점 snapshot을 보관하므로 영향을
받지 않는다.

dataset 목록의 행 메뉴에서 `영구 삭제`를 선택하면 dataset과 모든 example을 지운다.
단, experiment 기록이 있는 dataset은 regression evidence를 보존하기 위해 삭제할 수
없고 server가 409를 반환한다.

Application code에서 dataset을 관리할 때는 SDK helper를 사용할 수 있다. Dataset
name은 server/database에서 unique하므로 `get_or_create_dataset()`은 startup script나
CI regression job에서 안전하게 재사용할 수 있다.

```python
import langfeather

dataset = langfeather.get_or_create_dataset(
    name="rag-regression",
    examples=[
        langfeather.DatasetExample(
            input={"question": "지원 대상은?"},
            expected_output={"answer": "청년"},
        )
    ],
)

# 이름으로 찾을 때는 없으면 None, stable ID 조회는 없으면 control API error다.
same_dataset = langfeather.find_dataset("rag-regression")
detail = langfeather.get_dataset(dataset.dataset_id)

langfeather.add_dataset_examples(
    dataset.dataset_id,
    [langfeather.DatasetExample(input={"question": "제외 대상은?"})],
)
```

`get_or_create_dataset()`이 동시에 실행돼 create가 충돌하면 unique constraint가
중복 생성을 막고 기존 dataset을 다시 조회한다. 이미 존재하는 dataset을 반환할 때는
전달한 `examples`나 `description`을 변경하지 않는다.

## Experiment 실행

먼저 collector와 SDK endpoint를 같은 local server로 설정한다.

```python
import langfeather

langfeather.configure(endpoint="http://127.0.0.1:4319")

def answer(item: dict[str, str]) -> dict[str, str]:
    return {"answer": "청년" if item["question"] == "지원 대상은?" else "확인 필요"}

run = langfeather.evaluate(
    dataset="ds_your_dataset_id",
    name="retrieval-v2",
    target=answer,
    evaluators=[
        langfeather.json_field("answer"),
        langfeather.exact_match(key="whole_response"),
    ],
    target_metadata={"git_sha": "abc123", "retriever": "hybrid-v2"},
)

print(run.experiment_id, run.completed_case_count, run.failed_case_count)
```

`target`은 JSON-compatible input 하나를 받는 callable이거나 `invoke()`를 가진
LangChain/LangGraph-like object다. `aevaluate()`는 async callable 또는 `ainvoke()`를
가진 object에 사용한다. `max_concurrency` 기본값은 `1`이고 더 큰 양의 정수로 bounded
case concurrency를 요청할 수 있다.

각 case는 normal trace를 생성하며 trace metadata에 `experiment_id`, `dataset_id`,
`dataset_example_id`, `experiment_case_id`를 남긴다. target failure와 evaluator
failure는 해당 case result로 저장하고 다음 case를 계속 실행한다. 반면 experiment
생성·결과 저장 같은 control API 호출 실패는 incomplete run을 성공으로 보이지 않도록
`EvaluationError`를 raise한다.

## Evaluator

기본 evaluator는 다음 셋이다.

- `exact_match()`: output과 expected output 전체가 같은지 boolean으로 기록
- `contains()`: string expected output이 output에 포함되는지, 그 외에는 전체 동등성 확인
- `json_field("answer")`: output과 expected output object의 지정 field가 같은지 확인

Custom evaluator는 boolean 또는 finite number를 반환해야 한다. 판정 근거가 필요하면
public frozen dataclass `EvaluationScore`를 반환한다. rationale은 raw diagnostic text라
LangFeather가 redact, truncate, summarize하지 않는다.

```python
@langfeather.evaluator(key="answer_length", name="Answer length", data_type="number")
def answer_length(*, input, output, expected_output, metadata) -> float:
    del input, expected_output, metadata
    if not isinstance(output, dict):
        return 0.0
    return float(len(str(output.get("answer", ""))))

@langfeather.evaluator(key="judge", name="Judge")
def judge(*, input, output, expected_output, metadata):
    return langfeather.EvaluationScore(True, "retrieved source supports the answer")
```

Evaluator function은 `input`, `output`, `expected_output`, `metadata` keyword
arguments를 받는다. `aevaluate()`에서는 async evaluator도 사용할 수 있다.

## Snapshot과 비교 규칙

Experiment를 만들면 해당 시점 dataset revision의 example input, expected output,
metadata, evaluator 선언을 case로 복사한다. 이후 dataset을 편집해도 이미 실행한
experiment history는 변하지 않는다. UI의 comparison selector는 같은 dataset과 같은
revision을 가진 experiment만 보여 준다.

Dataset example의 `source_trace_id`와 experiment case의 `trace_id`는 soft reference다.
원래 trace를 삭제해도 dataset과 experiment history는 유지된다.

## Case 결과 기록 규칙

Case 결과는 한 번만 기록한다. `PUT /api/v1/experiments/{id}/cases/{case_id}`는
pending case만 받으며, 이미 기록된 case에 다시 쓰면 같은 내용이라도 409다. 마찬가지로
이미 끝난 experiment에 `finish`를 다시 호출해도 409다. 기록된 결과를 고치는 방법은
없다. 다만 `resume_experiment()`는 running/cancelled experiment의 pending case만 이어서
실행한다. `retry_failed=True`일 때만 failed case의 stored output/error/duration/trace/result를
비운 뒤 다시 실행하며, completed history와 dataset/evaluator snapshot은 바꾸지 않는다.

```text
PUT .../cases/{case_id}   1회차 → 200
PUT .../cases/{case_id}   2회차 → 409 experiment case is no longer pending
```

`status`가 `completed`인 case는 experiment에 선언된 evaluator를 **전부** 보고해야 한다.
evaluator가 실패했다면 `error_message`로 보고하며, 이것도 보고한 것으로 친다. 일부만
보내면 409다. 완료 집계(`completed_case_count`)가 비어 있는 점수 칸을 가리키지 않도록
하기 위한 제약이다. 반면 `status`가 `failed`인 case는 target이 output을 만들지 못해
evaluator를 돌릴 수 없었으므로 결과 없이 기록한다.

```text
evaluators: [exact, quality]

completed + [exact]                    → 409 (quality 누락)
completed + [exact, quality(error)]    → 200
failed    + []                         → 200
```

## 중단과 재개

`KeyboardInterrupt` 또는 async cancellation이 오면 새 case 제출을 멈추고 experiment를
`cancelled`로 끝낸다. sync worker thread는 Python에서 강제 종료할 수 없어 이미 시작한
case가 result를 저장할 때까지 기다린다; 아직 시작하지 않은 case는 pending으로 남는다.

```python
run = langfeather.resume_experiment(
    experiment_id="exp_existing",
    target=answer,
    evaluators=[langfeather.exact_match()],
    retry_failed=False,
    max_concurrency=2,
)
```

재개 전 SDK는 stored evaluator snapshot의 key와 data type이 caller가 준 evaluator와 정확히
일치하는지 확인한다. local single-user 경계이므로 abandoned running experiment에 lease나
lock은 없고, 같은 experiment를 동시에 재개하지 않는 것은 caller 책임이다.

## 현재 범위

- single project, single user, local installation만 지원한다.
- Server-side Python execution, worker, scheduler, queue/broker는 제공하지 않는다.
- Automatic evaluator 결과는 boolean과 finite number만 지원한다.
- categorical automatic evaluator, managed LLM judge, prompt management, 비용 계산은
  제공하지 않는다.
- Dataset 상세의 `Import JSONL`과 `Export JSONL`로 example을 옮길 수 있다.
  한 줄에는 `input`, nullable `expected_output`, optional `metadata`를 가진 JSON
  object 하나를 작성한다. import는 유효한 줄을 순서대로 추가하고 실패한 줄 번호를
  알려 주므로 일부 줄만 저장될 수 있다. `source_trace_id`는 내보내지 않는다.
