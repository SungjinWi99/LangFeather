export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type TraceStatus = "completed" | "failed" | "cancelled";

export interface Trace {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  input: JsonValue;
  output: JsonValue;
  error: JsonValue;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  metadata: { [key: string]: JsonValue };
}

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  total_tokens?: number | null;
  provider?: string | null;
  raw: { [key: string]: JsonValue };
}

export interface Observation {
  observation_id: string;
  trace_id: string;
  parent_observation_id: string | null;
  sequence: number;
  name: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  time_to_first_token_us: number | null;
  status: TraceStatus;
  input: JsonValue;
  output: JsonValue;
  error: JsonValue;
  model: string | null;
  usage: Usage | null;
  metadata: { [key: string]: JsonValue };
}

export interface TraceListItem {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  observation_count: number;
  input_preview: string;
  output_preview: string;
  total_tokens: number | null;
  time_to_first_token_us: number | null;
}

export interface TraceListResponse {
  items: TraceListItem[];
  next_cursor: string | null;
  total_count: number;
}

export type DashboardBucket =
  "auto" | "minute" | "hour" | "day" | "week" | "month";

export interface DashboardQuery {
  from: string;
  to: string;
  timezone: string;
  bucket?: DashboardBucket;
  query?: string;
  tag?: string;
  session_id?: string;
  release?: string;
  environment?: string;
  user_id?: string;
  score_id?: string[];
  tool_name?: string[];
}

export interface DashboardPercentiles {
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface DashboardErrorRate {
  failed: number;
  total: number;
  rate: number | null;
}

export interface DashboardFeedbackOptionRate {
  score_option_id: string;
  label: string;
  rate: number | null;
  selection_count: number;
}

export interface DashboardFeedback {
  score_config_id: string;
  name: string;
  data_type: ScoreDataType;
  value: number | null;
  annotation_count: number;
  option_rates: DashboardFeedbackOptionRate[];
}

export interface DashboardMetricBucket {
  started_at: string;
  ended_at: string;
  requests: Record<TraceStatus, number>;
  latency_us: DashboardPercentiles;
  error: DashboardErrorRate;
  llm_calls: number;
  tool_calls: Record<string, number>;
  feedback: DashboardFeedback[];
}

export interface DashboardResponse {
  from: string;
  to: string;
  timezone: string;
  bucket: Exclude<DashboardBucket, "auto">;
  totals: {
    trace_count: number;
    latency_us: DashboardPercentiles;
    error: DashboardErrorRate;
    llm_calls: number;
    tool_calls: number;
  };
  available_tools: Array<{ name: string; count: number }>;
  buckets: DashboardMetricBucket[];
}

export interface TraceQuery {
  cursor?: string;
  page?: number;
  limit?: number;
  status?: TraceStatus;
  from?: string;
  to?: string;
  tag?: string;
  session_id?: string;
  query?: string;
}

export interface ObservationSummary {
  observation_id: string;
  trace_id: string;
  parent_observation_id: string | null;
  sequence: number;
  name: string;
  kind: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  time_to_first_token_us: number | null;
  status: TraceStatus;
  model: string | null;
  dispatch_count?: number;
  dispatch_source_observation_id?: string | null;
}

export interface TraceDetail {
  trace_id: string;
  name: string;
  started_at: string;
  ended_at: string;
  duration_us: number;
  status: TraceStatus;
  session_id: string | null;
  user_id: string | null;
  release: string | null;
  environment: string | null;
  tags: string[];
  observation_count: number;
  observations: ObservationSummary[];
  score_configs: ScoreConfig[];
  annotations: Annotation[];
  memo: TraceMemo | null;
  previous_trace_id?: string | null;
  next_trace_id?: string | null;
  session_position?: number | null;
  session_total?: number | null;
}

export interface CompletedEnvelope {
  schema_version: 1;
  trace: Trace;
  observations: Observation[];
}

export type ScoreDataType = "boolean" | "number" | "categorical";
export type CategoricalSelectionMode = "single" | "multiple";
export type AnnotationValue = boolean | number | string[];

export interface ScoreOption {
  score_option_id: string;
  label: string;
  position: number;
  archived_at: string | null;
}

export interface ScoreConfig {
  score_config_id: string;
  name: string;
  description: string | null;
  data_type: ScoreDataType;
  boolean_true_label: string | null;
  boolean_false_label: string | null;
  number_min: number | null;
  number_max: number | null;
  categorical_selection_mode: CategoricalSelectionMode | null;
  options: ScoreOption[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  has_annotations: boolean;
  is_used: boolean;
}

export interface ScoreListResponse {
  items: ScoreConfig[];
}

export interface ScoreCreateRequest {
  name: string;
  description?: string | null;
  data_type: ScoreDataType;
  boolean_true_label?: string | null;
  boolean_false_label?: string | null;
  number_min?: number | null;
  number_max?: number | null;
  categorical_selection_mode?: CategoricalSelectionMode | null;
  options?: Array<{ label: string }>;
}

export interface Annotation {
  annotation_id: string;
  score_config_id: string;
  target_type: "trace";
  target_id: string;
  trace_id: string;
  value: AnnotationValue;
  created_at: string;
  updated_at: string;
}

export interface TraceMemo {
  trace_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface AnnotationQueueItem {
  annotation_queue_item_id: string;
  annotation_queue_id: string;
  trace_id: string;
  trace_name: string;
  input_preview: string;
  output_preview: string;
  duration_us: number;
  status: "pending" | "completed";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  was_edited: boolean;
}

export interface AnnotationQueue {
  annotation_queue_id: string;
  name: string;
  description: string | null;
  score_config_ids: string[];
  items: AnnotationQueueItem[];
  created_at: string;
  updated_at: string;
}

export interface AnnotationQueueListResponse {
  items: AnnotationQueue[];
}

export interface AnnotationQueueCreateRequest {
  name: string;
  description?: string | null;
  score_config_ids: string[];
  trace_ids: string[];
}

export interface DatasetExample {
  dataset_example_id: string;
  position: number;
  input: JsonValue;
  expected_output: JsonValue | null;
  metadata: { [key: string]: JsonValue };
  source_trace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DatasetSummary {
  dataset_id: string;
  name: string;
  description: string | null;
  revision: number;
  example_count: number;
  created_at: string;
  updated_at: string;
}

export interface Dataset extends DatasetSummary {
  examples: DatasetExample[];
}

export interface DatasetListResponse {
  items: DatasetSummary[];
}

export type EvaluatorDataType = "boolean" | "number";
export type ExperimentStatus = "running" | "completed" | "cancelled";
export type ExperimentCaseStatus = "pending" | "completed" | "failed";

export interface ExperimentEvaluator {
  experiment_evaluator_id: string;
  key: string;
  name: string;
  data_type: EvaluatorDataType;
  position: number;
}

export interface ExperimentResult {
  evaluator_key: string;
  value: boolean | number | null;
  error_message: string | null;
  rationale: string | null;
}

export interface ExperimentCase {
  experiment_case_id: string;
  dataset_example_id: string;
  position: number;
  input: JsonValue;
  expected_output: JsonValue | null;
  metadata: { [key: string]: JsonValue };
  status: ExperimentCaseStatus;
  output: JsonValue | null;
  error: JsonValue | null;
  duration_us: number | null;
  trace_id: string | null;
  completed_at: string | null;
  evaluator_results: ExperimentResult[];
}

export interface ExperimentSummary {
  experiment_id: string;
  dataset_id: string;
  dataset_revision: number;
  name: string;
  status: ExperimentStatus;
  started_at: string;
  ended_at: string | null;
  case_count: number;
  completed_case_count: number;
  failed_case_count: number;
}

export interface Experiment extends ExperimentSummary {
  target_metadata: { [key: string]: JsonValue };
  evaluators: ExperimentEvaluator[];
  cases: ExperimentCase[];
}

export interface ExperimentListResponse {
  items: ExperimentSummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= maximum
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isStatus(value: unknown): value is TraceStatus {
  return value === "completed" || value === "failed" || value === "cancelled";
}

function isTrace(value: unknown): value is Trace {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.trace_id, 128) &&
    isNonEmptyString(value.name, 255) &&
    typeof value.started_at === "string" &&
    typeof value.ended_at === "string" &&
    isNonNegativeInteger(value.duration_us) &&
    isStatus(value.status) &&
    isNullableString(value.session_id) &&
    isNullableString(value.user_id) &&
    isNullableString(value.release) &&
    isNullableString(value.environment) &&
    Array.isArray(value.tags)
  );
}

function isObservation(value: unknown): value is Observation {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.observation_id, 128) &&
    isNonEmptyString(value.trace_id, 128) &&
    (value.parent_observation_id === null ||
      isNonEmptyString(value.parent_observation_id, 128)) &&
    isNonNegativeInteger(value.sequence) &&
    isNonEmptyString(value.name, 255) &&
    isNonEmptyString(value.kind, 255) &&
    typeof value.started_at === "string" &&
    typeof value.ended_at === "string" &&
    isNonNegativeInteger(value.duration_us) &&
    (value.time_to_first_token_us === null ||
      isNonNegativeInteger(value.time_to_first_token_us)) &&
    isStatus(value.status)
  );
}

export function isCompletedEnvelope(
  value: unknown,
): value is CompletedEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  const trace = value.trace;
  if (
    value.schema_version !== 1 ||
    !isTrace(trace) ||
    !Array.isArray(value.observations) ||
    value.observations.length === 0 ||
    !value.observations.every(isObservation)
  ) {
    return false;
  }

  const observations = value.observations;
  const roots = observations.filter(
    (observation) => observation.parent_observation_id === null,
  );
  const ids = new Set(
    observations.map((observation) => observation.observation_id),
  );
  const sequences = new Set(
    observations.map((observation) => observation.sequence),
  );
  return (
    roots.length === 1 &&
    roots[0]?.status === trace.status &&
    observations.every(
      (observation) =>
        observation.trace_id === trace.trace_id &&
        (observation.parent_observation_id === null ||
          ids.has(observation.parent_observation_id)),
    ) &&
    ids.size === observations.length &&
    sequences.size === observations.length
  );
}
