/**
 * 한/영 전환. 계약은 `specs/web-functional.md`의 "언어 전환"에 있다.
 *
 * key는 한국어 원문 그대로다. key를 새로 짓지 않으므로 호출부가 읽히고,
 * 번역이 없으면 한국어가 그대로 나온다 — 화면이 깨지는 것보다 낫다.
 *
 * 기술 용어(trace, observation, dataset, payload, latency …)는 두 언어 모두에서
 * 영어 원어로 둔다. API field와 SDK 함수와의 연결이 끊기면 안 된다.
 */

export type Language = "ko" | "en";

export const LANGUAGE_STORAGE_KEY = "langfeather.language";

const LANGUAGES: Language[] = ["ko", "en"];

export function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

export function readLanguage(): Language {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return "ko";
  }
  return isLanguage(raw) ? raw : "ko";
}

export function writeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 저장할 수 없어도 그 세션 동안은 선택을 유지한다.
  }
}

/** `{name}` 자리에 값을 넣는다. 값은 사용자 데이터일 수 있으므로 번역하지 않는다. */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** 날짜와 숫자 서식에 쓰는 locale. 문구 번역과 같은 선택을 따른다. */
export function localeOf(language: Language): string {
  return language === "en" ? "en-US" : "ko-KR";
}

export function translate(
  language: Language,
  korean: string,
  params?: Record<string, string | number>,
): string {
  const text = language === "en" ? (EN[korean] ?? korean) : korean;
  return params === undefined ? text : interpolate(text, params);
}

/**
 * 한국어 원문 -> 영어. 없는 항목은 한국어로 남는다.
 *
 * 번역하는 것은 사용자가 행동하거나 상태를 이해하기 위한 문구뿐이다. 기술 용어는
 * 양쪽 모두 영어이므로 여기 넣을 필요가 없다.
 */
export const EN: Record<string, string> = {
  // shell
  "본문으로 건너뛰기": "Skip to content",
  "주요 영역": "Primary areas",
  테마: "Theme",
  언어: "Language",
  라이트: "Light",
  다크: "Dark",

  // 공통 동사와 상태
  저장: "Save",
  "저장 중…": "Saving…",
  삭제: "Delete",
  취소: "Cancel",
  생성: "Create",
  추가: "Add",
  적용: "Apply",
  초기화: "Reset",
  선택: "Select",
  완료: "Complete",
  수정: "Edit",
  닫기: "Close",
  "다시 시도": "Retry",
  전체: "All",
  성공: "Success",
  실패: "Failed",
  대기: "Pending",
  요약: "Summary",
  검색: "Search",
  상태: "Status",
  기간: "Period",
  태그: "Tag",
  시작: "Start",
  종료: "End",
  지연: "Latency",
  수집: "Collected",
  이름: "Name",
  설명: "Description",
  값: "Value",
  대상: "Target",
  "이전 요청": "Previous request",
  "다음 요청": "Next request",
  "상세 닫기": "Close detail",
  "그래프 상세 수준": "Graph detail level",
  "Payload 탭": "Payload tabs",
  반환값: "Return value",
  응답: "Response",
  복사: "Copy",

  // 기간 preset
  "1시간": "1 hour",
  "24시간": "24 hours",
  "최근 7일": "Last 7 days",
  "30일": "30 days",
  커스텀: "Custom",

  // Traces
  "실행 흐름": "Execution flow",
  "실행 observation이 없습니다.": "No runtime observations.",
  "실제 실행 경로 그래프": "Actual execution path graph",
  "그래프 확대와 축소": "Zoom the graph",
  "Trace ID 또는 input 검색": "Search trace ID or input",
  "목록에서 trace를 고르세요.": "Pick a trace from the list.",
  "그래프에서 observation을 선택하세요.": "Select an observation in the graph.",
  "Trace 상세를 불러오는 중…": "Loading trace detail…",
  "Payload를 불러오는 중…": "Loading payload…",
  "선택한 observation payload를 불러오지 못했습니다.":
    "Could not load the selected observation payload.",
  "Trace 상세": "Trace detail",
  "Trace 작업": "Trace actions",
  "검토 메모": "Review memo",
  "실패한 노드": "Failed node",
  "실행 오류": "Execution error",
  "오류 메시지가 없습니다.": "No error message.",
  "전체 traceback은 Error 탭에 있습니다.":
    "The full traceback is on the Error tab.",
  "오류 없이 끝났습니다.": "Finished without an error.",
  "이 trace와 연결된 observations, annotations를 삭제합니다.":
    "This deletes the observations and annotations linked to this trace.",
  "Trace 목록": "Trace list",
  "단 전환": "Switch pane",
  목록: "List",
  검사기: "Inspector",
  "목록 접기": "Collapse list",
  "Queue에 추가": "Add to queue",
  "Dataset에 추가": "Add to dataset",
  "{n}개 선택": "{n} selected",
  "{id} 미리보기": "Preview {id}",
  "목록 펼치기": "Expand list",
  "Trace 목록을 불러오는 중…": "Loading traces…",
  "Trace 목록을 불러오지 못했습니다.": "Could not load the trace list.",
  "Trace 상세를 불러오지 못했습니다.": "Could not load the trace detail.",
  "Trace를 삭제하지 못했습니다.": "Could not delete the trace.",
  "선택한 Trace를 모두 삭제하지 못했습니다.":
    "Could not delete every selected trace.",
  "추가할 대상을 불러오지 못했습니다.": "Could not load the targets to add to.",
  "추가 요청을 완료하지 못했습니다.": "Could not complete the add request.",
  "Annotations와 메모를 저장했습니다.": "Saved annotations and memo.",
  "Annotations를 저장하지 못했습니다.": "Could not save annotations.",
  "{n}개 trace를 queue에 추가했습니다.": "Added {n} traces to the queue.",
  "{n}개 trace를 dataset에 추가했습니다.": "Added {n} traces to the dataset.",
  "선택한 Trace를 추가할 대상을 고르세요.":
    "Pick where to add the selected traces.",
  "선택한 trace를 삭제할까요?": "Delete the selected traces?",
  "{n}개 trace와 연결된 observations, annotations도 삭제됩니다.":
    "The observations and annotations linked to {n} traces are deleted too.",
  "추가할 score가 없습니다.": "No scores available to add.",
  "추가된 score가 없습니다.": "No scores added yet.",
  "{name} 값": "{name} value",
  "{name} 제거": "Remove {name}",
  "{n}건": "{n}",

  // 공통 component
  "불러오는 중…": "Loading…",
  "이전 페이지": "Previous page",
  "다음 페이지": "Next page",
  "{label} 기준 정렬": "Sort by {label}",
  "{n}초 전": "{n}s ago",
  "{n}분 전": "{n}m ago",
  "{n}시간 전": "{n}h ago",
  "{n}일 전": "{n}d ago",

  // runtime graph
  "전체 실행": "Full run",
  "실행 노드 {name}": "Node {name}",
  "순서 {n}": "Step {n}",
  "하위 {kind} {count}개": "{count} nested {kind}",
  복사됨: "Copied",

  // Retrieval
  "검색 결과": "Retrieved documents",
  "답변에 사용됨": "Used in answer",
  미사용: "Unused",
  "문서 {total}건": "{total} documents",
  "문서 {total}건 중 {used}건이 답변에 사용됨":
    "{used} of {total} documents used in the answer",

  // kind별 renderer
  "LLM 호출": "LLM call",
  "Tool 호출": "Tool call",

  // Overview
  "그룹: 전체": "Group: all",
  필터: "Filter",
  "해당 기간에 tool 호출이 없습니다.": "No tool calls in this period.",
  "값 없음": "No value",
  "요약 수치": "Summary metrics",
  "총 요청": "Total requests",
  오류율: "Error rate",
  "LLM 호출 수": "LLM calls",
  "Overview 필터": "Overview filters",
  "조회 기간": "Time range",
  "Chart 바로가기": "Jump to chart",
  "최근 Trace": "Recent traces",
  "조건에 맞는 Trace가 없습니다.": "No traces match these filters.",
  "Overview를 불러오는 중…": "Loading overview…",
  "Overview 데이터를 불러오지 못했습니다.": "Could not load overview data.",
  "최근 Trace를 불러오지 못했습니다.": "Could not load recent traces.",
  "이 기간에 표시할 {title} 데이터가 없습니다.":
    "No {title} data to show for this period.",
  "{title} 시계열. 화살표 키로 시점 이동":
    "{title} time series. Use arrow keys to move between points.",
  "{title} 차트로 이동": "Moved to the {title} chart",
  "{id} 상세 열기": "Open detail for {id}",
  // chart 단위. 영어에는 접미어를 두지 않는다.
  건: "",

  // Scores
  "Score 검색": "Search scores",
  "Score 이름": "Score name",
  "Score 생성": "Create score",
  "Scores를 불러오는 중…": "Loading scores…",
  "Score 목록을 불러오지 못했습니다.": "Could not load the score list.",
  "Score를 저장하지 못했습니다.": "Could not save the score.",
  "선택한 Score를 처리하지 못했습니다.":
    "Could not process the selected scores.",
  "모든 score 선택": "Select all scores",
  "Score를 삭제할까요? ({n})": "Delete scores? ({n})",
  "이미 사용된 score는 이름과 설명만 수정할 수 있습니다.":
    "A score already in use allows editing only its name and description.",
  "아직 사용되지 않은 score는 영구 삭제됩니다. 이미 사용 중이거나 annotation이 있는 score는 기존 annotation의 의미를 보존하기 위해 대신 보관 처리됩니다.":
    "Scores not yet used are deleted permanently. Scores already in use or with annotations are archived instead, so existing annotations keep their meaning.",
  타입: "Type",
  "선택 방식": "Selection mode",
  옵션: "Option",
  "옵션 삭제": "Remove option",
  "+ 옵션 추가": "+ Add option",
  "선택 사항": "Optional",
  "예: Success": "e.g. Success",
  보관됨: "Archived",
  "사용 중": "In use",
  "검색 결과가 없습니다.": "No search results.",
  "처리 중…": "Processing…",
  "{n}개": "{n}",
  "{name} 선택": "Select {name}",

  // Annotation Queues
  "Queue 검색": "Search queues",
  "Annotation Queues를 불러오는 중…": "Loading annotation queues…",
  "Queue 상세를 불러오는 중…": "Loading queue detail…",
  "Annotation Queue 목록을 불러오지 못했습니다.":
    "Could not load the annotation queue list.",
  "Queue 상세를 불러오지 못했습니다.": "Could not load the queue detail.",
  "Queue를 생성하지 못했습니다.": "Could not create the queue.",
  "Queue를 삭제하지 못했습니다.": "Could not delete the queue.",
  "선택한 Queue를 모두 삭제하지 못했습니다.":
    "Could not delete every selected queue.",
  "선택한 Queue item을 제거하지 못했습니다.":
    "Could not remove the selected queue items.",
  "Review trace를 불러오지 못했습니다.": "Could not load the review trace.",
  "Review를 저장하지 못했습니다.": "Could not save the review.",
  "모든 queue 선택": "Select all queues",
  "모든 trace 선택": "Select all traces",
  "전체 선택": "Select all",
  "필터 접기": "Hide filters",
  "설명 없음": "No description",
  "큐에서 제거": "Remove from queue",
  "Queue를 삭제할까요?": "Delete queue?",
  "선택한 Queue를 삭제할까요?": "Delete the selected queues?",
  "선택한 trace를 큐에서 뺄까요?": "Remove the selected traces from the queue?",
  "큐와 큐에 속한 항목 연결만 삭제됩니다. 원본 trace는 유지됩니다.":
    "Only the queue and its item links are deleted. The original traces stay.",
  "{n}개 큐와 큐에 속한 항목 연결만 삭제됩니다. 원본 trace는 유지됩니다.":
    "Only {n} queues and their item links are deleted. The original traces stay.",
  "원본 trace와 저장된 annotations는 유지됩니다.":
    "The original traces and saved annotations stay.",
  "예: Release review": "e.g. Release review",
  "생성 중…": "Creating…",
  "삭제 중…": "Deleting…",
  "제거 중…": "Removing…",
  수정됨: "Edited",
  "{id} 선택": "Select {id}",

  // Datasets와 Experiments
  "Dataset 검색": "Search datasets",
  "Example 검색": "Search examples",
  "Experiment 검색": "Search experiments",
  "Datasets를 불러오는 중…": "Loading datasets…",
  "Dataset 상세를 불러오는 중…": "Loading dataset detail…",
  "Experiment 상세를 불러오는 중…": "Loading experiment detail…",
  "Dataset과 experiment 목록을 불러오지 못했습니다.":
    "Could not load the dataset and experiment lists.",
  "Dataset 상세를 불러오지 못했습니다.": "Could not load the dataset detail.",
  "Experiment 상세를 불러오지 못했습니다.":
    "Could not load the experiment detail.",
  "Dataset을 생성하지 못했습니다.": "Could not create the dataset.",
  "Dataset을 삭제하지 못했습니다.": "Could not delete the dataset.",
  "Experiment 기록이 있는 dataset은 삭제할 수 없습니다.":
    "A dataset with experiment history cannot be deleted.",
  "Example을 저장하지 못했습니다.": "Could not save the example.",
  "Example을 추가하지 못했습니다.": "Could not add the example.",
  "선택한 Example을 삭제하지 못했습니다.":
    "Could not delete the selected examples.",
  "선택한 Experiment를 삭제하지 못했습니다.":
    "Could not delete the selected experiments.",
  "Input이 올바른 JSON이 아닙니다.": "Input is not valid JSON.",
  "Reference output이 올바른 JSON이 아닙니다.":
    "Reference output is not valid JSON.",
  "Metadata는 JSON object여야 합니다.": "Metadata must be a JSON object.",
  "Metadata가 올바른 JSON이 아닙니다.": "Metadata is not valid JSON.",
  "최대 4개까지 비교할 수 있습니다.": "You can compare at most 4.",
  "같은 dataset revision만 함께 비교할 수 있습니다.":
    "Only experiments on the same dataset revision can be compared.",
  "동일 dataset revision의 experiment를 최대 4개 비교할 수 있습니다.":
    "Compare up to 4 experiments on the same dataset revision.",
  "같은 revision의 experiment를 2–4개 선택하세요.":
    "Select 2–4 experiments on the same revision.",
  "Dataset 작업 메뉴": "Dataset actions",
  "JSONL 작업 메뉴": "JSONL actions",
  "JSONL 가져오기": "Import JSONL",
  "JSONL 파일을 읽지 못했습니다.": "Could not read the JSONL file.",
  "Example {n}개를 JSONL로 내보냈습니다.": "Exported {n} examples as JSONL.",
  "JSONL import: {n}개를 추가했습니다.": "JSONL import: added {n}.",
  "JSONL import: {n}개 추가, 실패한 줄 {lines}.":
    "JSONL import: added {n}, failed lines {lines}.",
  "모든 example 선택": "Select all examples",
  "Example 선택": "Select example",
  "Example 수정": "Edit example",
  "등록된 Example이 없습니다.": "No examples yet.",
  "기록된 Experiment가 없습니다.": "No experiments recorded.",
  "선택한 Example을 삭제할까요?": "Delete the selected examples?",
  "선택한 Experiment를 삭제할까요?": "Delete the selected experiments?",
  '"{name}" dataset을 삭제할까요?': 'Delete the "{name}" dataset?',
  "Dataset과 포함된 모든 example이 영구 삭제됩니다.":
    "The dataset and all its examples are deleted permanently.",
  "{n}개 example이 영구 삭제되며, dataset revision이 올라갑니다.":
    "{n} examples are deleted permanently and the dataset revision advances.",
  "{n}개 experiment와 기록된 case 결과가 영구 삭제됩니다.":
    "{n} experiments and their recorded case results are deleted permanently.",
  "Reference output (JSON, 선택 사항)": "Reference output (JSON, optional)",
  "Metadata (JSON object, 선택 사항)": "Metadata (JSON object, optional)",
  "예: PolicyRAGEval": "e.g. PolicyRAGEval",
  "추가 중…": "Adding…",
  "오류: {message}": "Error: {message}",

  // Settings
  설정: "Settings",
  백업: "Backup",
  "SQLite 백업": "SQLite backup",
  "현재 데이터베이스를 다운로드합니다.": "Downloads the current database.",
  "백업 다운로드": "Download backup",
  "로컬 데이터 초기화": "Reset local data",
  "계속하려면 RESET 입력": "Type RESET to continue",
  "로컬 데이터를 초기화할까요?": "Reset local data?",
  "다운로드 중…": "Downloading…",
  "초기화 중…": "Resetting…",
  "SQLite 백업을 다운로드했습니다.": "Downloaded the SQLite backup.",
  "SQLite 백업을 다운로드하지 못했습니다.":
    "Could not download the SQLite backup.",
  "로컬 데이터를 초기화했습니다. 빈 Trace 목록으로 이동합니다.":
    "Local data reset. Returning to an empty trace list.",
  "로컬 데이터를 초기화하지 못했습니다. 데이터는 유지됩니다.":
    "Could not reset local data. Your data is unchanged.",
  "모든 traces, observations, annotations, queues, scores와 datasets가 삭제됩니다.":
    "All traces, observations, annotations, queues, scores and datasets will be deleted.",
  "이 작업은 되돌릴 수 없습니다. 초기화 후 빈 Trace 목록으로 이동합니다.":
    "This cannot be undone. After the reset you return to an empty trace list.",
};
