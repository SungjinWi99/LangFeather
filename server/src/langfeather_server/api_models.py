from __future__ import annotations

import math
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator

from langfeather_server.contracts import (
    TraceStatus,
    UsageContract,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BatchIngestRequest(ApiModel):
    items: list[JsonValue]


class BatchItemError(ApiModel):
    code: Literal["validation_error"]
    message: str


class BatchItemResult(ApiModel):
    trace_id: str | None
    status: Literal["stored", "duplicate", "rejected"]
    error: BatchItemError | None = None


class BatchIngestResponse(ApiModel):
    results: list[BatchItemResult]


class TraceSummary(ApiModel):
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    status: TraceStatus
    session_id: str | None
    user_id: str | None
    release: str | None
    environment: str | None
    tags: list[str]
    observation_count: int
    input_preview: str
    output_preview: str
    total_tokens: int | None
    time_to_first_token_us: int | None


class TraceListResponse(ApiModel):
    items: list[TraceSummary]
    next_cursor: str | None = None
    total_count: int = 0


class DashboardLatency(ApiModel):
    p50: int | None
    p95: int | None
    p99: int | None


class DashboardError(ApiModel):
    failed: int
    total: int
    rate: float | None


class DashboardTotals(ApiModel):
    trace_count: int
    latency_us: DashboardLatency
    error: DashboardError
    llm_calls: int
    tool_calls: int


class DashboardTool(ApiModel):
    name: str
    count: int


class DashboardOptionRate(ApiModel):
    score_option_id: str
    label: str
    rate: float | None
    selection_count: int


class DashboardFeedback(ApiModel):
    score_config_id: str
    name: str
    data_type: Literal["boolean", "number", "categorical"]
    value: float | None
    annotation_count: int
    option_rates: list[DashboardOptionRate] = Field(default_factory=list)


class DashboardRequests(ApiModel):
    completed: int
    failed: int
    cancelled: int


class DashboardBucket(ApiModel):
    started_at: str
    ended_at: str
    requests: DashboardRequests
    latency_us: DashboardLatency
    error: DashboardError
    llm_calls: int
    tool_calls: dict[str, int]
    feedback: list[DashboardFeedback] = Field(default_factory=list)


class DashboardResponse(ApiModel):
    from_: str = Field(serialization_alias="from")
    to: str
    timezone: str
    bucket: Literal["minute", "hour", "day", "week", "month"]
    totals: DashboardTotals
    available_tools: list[DashboardTool]
    buckets: list[DashboardBucket]


class ObservationSummary(ApiModel):
    observation_id: str
    trace_id: str
    parent_observation_id: str | None
    sequence: int
    name: str
    kind: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    time_to_first_token_us: int | None
    status: TraceStatus
    model: str | None
    dispatch_count: int = 0
    dispatch_source_observation_id: str | None = None


ScoreDataType = Literal["boolean", "number", "categorical"]
CategoricalSelectionMode = Literal["single", "multiple"]
QueueItemStatus = Literal["pending", "completed"]
AnnotationValue = bool | int | float | list[str]
EvaluatorDataType = Literal["boolean", "number"]
ExperimentStatus = Literal["running", "completed", "cancelled"]
ExperimentCaseStatus = Literal["pending", "completed", "failed"]


class ScoreOptionCreate(ApiModel):
    label: str = Field(min_length=1, max_length=255)


class ScoreOptionResponse(ApiModel):
    score_option_id: str
    label: str
    position: int
    archived_at: datetime | None = None


class ScoreCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    data_type: ScoreDataType
    boolean_true_label: str | None = None
    boolean_false_label: str | None = None
    number_min: float | None = None
    number_max: float | None = None
    categorical_selection_mode: CategoricalSelectionMode | None = None
    options: list[ScoreOptionCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_type_configuration(self) -> ScoreCreateRequest:
        if self.data_type == "boolean":
            if (
                self.number_min is not None
                or self.number_max is not None
                or self.categorical_selection_mode is not None
                or self.options
            ):
                raise ValueError("boolean score has incompatible configuration")
        elif self.data_type == "number":
            if (
                self.boolean_true_label is not None
                or self.boolean_false_label is not None
                or self.categorical_selection_mode is not None
                or self.options
            ):
                raise ValueError("number score has incompatible configuration")
            if self.number_min is not None and not math.isfinite(self.number_min):
                raise ValueError("number_min must be finite")
            if self.number_max is not None and not math.isfinite(self.number_max):
                raise ValueError("number_max must be finite")
            if (
                self.number_min is not None
                and self.number_max is not None
                and self.number_min > self.number_max
            ):
                raise ValueError("number_min cannot exceed number_max")
        else:
            if (
                self.boolean_true_label is not None
                or self.boolean_false_label is not None
                or self.number_min is not None
                or self.number_max is not None
            ):
                raise ValueError("categorical score has incompatible configuration")
            if self.categorical_selection_mode is None:
                raise ValueError("categorical score requires a selection mode")
            if not self.options:
                raise ValueError("categorical score requires at least one option")
            labels = [option.label for option in self.options]
            if len(labels) != len(set(labels)):
                raise ValueError("categorical option labels must be unique")
        return self


class ScorePatchRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    boolean_true_label: str | None = None
    boolean_false_label: str | None = None
    number_min: float | None = None
    number_max: float | None = None
    categorical_selection_mode: CategoricalSelectionMode | None = None
    options: list[ScoreOptionCreate] | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> ScorePatchRequest:
        if not self.model_fields_set:
            raise ValueError("score patch must include at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("score name cannot be null")
        for field_name in ("number_min", "number_max"):
            value = getattr(self, field_name)
            if value is not None and not math.isfinite(value):
                raise ValueError(f"{field_name} must be finite")
        if self.options is not None:
            labels = [option.label for option in self.options]
            if not labels or len(labels) != len(set(labels)):
                raise ValueError("categorical options must be non-empty and unique")
        return self


class ScoreConfigResponse(ApiModel):
    score_config_id: str
    name: str
    description: str | None
    data_type: ScoreDataType
    boolean_true_label: str | None
    boolean_false_label: str | None
    number_min: float | None
    number_max: float | None
    categorical_selection_mode: CategoricalSelectionMode | None
    options: list[ScoreOptionResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None = None
    has_annotations: bool = False
    is_used: bool = False


class ScoreListResponse(ApiModel):
    items: list[ScoreConfigResponse]


class AnnotationPutRequest(ApiModel):
    value: AnnotationValue


class AnnotationResponse(ApiModel):
    annotation_id: str
    score_config_id: str
    target_type: Literal["trace"]
    target_id: str
    trace_id: str
    value: AnnotationValue
    created_at: datetime
    updated_at: datetime


class TraceMemoPutRequest(ApiModel):
    content: str


class TraceMemoResponse(ApiModel):
    trace_id: str
    content: str
    created_at: datetime
    updated_at: datetime


class TraceDetail(ApiModel):
    trace_id: str
    name: str
    started_at: datetime
    ended_at: datetime
    duration_us: int
    status: TraceStatus
    session_id: str | None
    user_id: str | None
    release: str | None
    environment: str | None
    tags: list[str]
    observation_count: int
    observations: list[ObservationSummary]
    score_configs: list[ScoreConfigResponse] = Field(default_factory=list)
    annotations: list[AnnotationResponse] = Field(default_factory=list)
    memo: TraceMemoResponse | None = None
    previous_trace_id: str | None = None
    next_trace_id: str | None = None
    session_position: int | None = None
    session_total: int | None = None


class AnnotationQueueCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    score_config_ids: list[str] = Field(default_factory=list)
    trace_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_unique_members(self) -> AnnotationQueueCreateRequest:
        if len(self.score_config_ids) != len(set(self.score_config_ids)):
            raise ValueError("queue score IDs must be unique")
        if len(self.trace_ids) != len(set(self.trace_ids)):
            raise ValueError("queue trace IDs must be unique")
        return self


class AnnotationQueuePatchRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    score_config_ids: list[str] | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> AnnotationQueuePatchRequest:
        if not self.model_fields_set:
            raise ValueError("queue patch must include at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("queue name cannot be null")
        if self.score_config_ids is not None and len(self.score_config_ids) != len(
            set(self.score_config_ids)
        ):
            raise ValueError("queue score IDs must be unique")
        return self


class AnnotationQueueAddItemsRequest(ApiModel):
    trace_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_traces(self) -> AnnotationQueueAddItemsRequest:
        if len(self.trace_ids) != len(set(self.trace_ids)):
            raise ValueError("queue trace IDs must be unique")
        return self


class AnnotationQueueItemResponse(ApiModel):
    annotation_queue_item_id: str
    annotation_queue_id: str
    trace_id: str
    trace_name: str
    input_preview: str
    output_preview: str
    duration_us: int
    status: QueueItemStatus
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    was_edited: bool = False


class AnnotationQueueResponse(ApiModel):
    annotation_queue_id: str
    name: str
    description: str | None
    score_config_ids: list[str]
    items: list[AnnotationQueueItemResponse]
    created_at: datetime
    updated_at: datetime


class AnnotationQueueListResponse(ApiModel):
    items: list[AnnotationQueueResponse]


class QueueCompletionAnnotation(ApiModel):
    score_config_id: str
    value: AnnotationValue


class AnnotationQueueCompleteRequest(ApiModel):
    annotations: list[QueueCompletionAnnotation] = Field(default_factory=list)
    memo: str | None = None

    @model_validator(mode="after")
    def require_unique_scores(self) -> AnnotationQueueCompleteRequest:
        score_ids = [annotation.score_config_id for annotation in self.annotations]
        if len(score_ids) != len(set(score_ids)):
            raise ValueError("completion annotations must have unique scores")
        return self


class AnnotationQueueEditRequest(ApiModel):
    pass


class DatasetExampleInput(ApiModel):
    input: JsonValue
    expected_output: JsonValue | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    source_trace_id: str | None = Field(default=None, max_length=128)


class DatasetExamplePatchRequest(ApiModel):
    input: JsonValue | None = None
    expected_output: JsonValue | None = None
    metadata: dict[str, JsonValue] | None = None
    source_trace_id: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def require_a_change(self) -> DatasetExamplePatchRequest:
        if not self.model_fields_set:
            raise ValueError("dataset example patch must include at least one field")
        return self


class DatasetExampleResponse(DatasetExampleInput):
    dataset_example_id: str
    position: int
    created_at: datetime
    updated_at: datetime


class DatasetCreateRequest(ApiModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    examples: list[DatasetExampleInput] = Field(default_factory=list)


class DatasetPatchRequest(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None

    @model_validator(mode="after")
    def require_a_change(self) -> DatasetPatchRequest:
        if not self.model_fields_set:
            raise ValueError("dataset patch must include at least one field")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("dataset name cannot be null")
        return self


class DatasetSummary(ApiModel):
    dataset_id: str
    name: str
    description: str | None
    revision: int
    example_count: int
    created_at: datetime
    updated_at: datetime


class DatasetResponse(DatasetSummary):
    examples: list[DatasetExampleResponse] = Field(default_factory=list)


class DatasetListResponse(ApiModel):
    items: list[DatasetSummary]


class DatasetTraceAddRequest(ApiModel):
    trace_id: str
    use_trace_output_as_expected: bool = False


class ExperimentEvaluatorInput(ApiModel):
    key: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    data_type: EvaluatorDataType


class ExperimentCreateRequest(ApiModel):
    dataset_id: str
    name: str = Field(min_length=1, max_length=255)
    target_metadata: dict[str, JsonValue] = Field(default_factory=dict)
    evaluators: list[ExperimentEvaluatorInput] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_evaluators(self) -> ExperimentCreateRequest:
        keys = [evaluator.key for evaluator in self.evaluators]
        if len(keys) != len(set(keys)):
            raise ValueError("experiment evaluator keys must be unique")
        return self


class ExperimentEvaluatorResponse(ExperimentEvaluatorInput):
    experiment_evaluator_id: str
    position: int


class ExperimentResultInput(ApiModel):
    evaluator_key: str = Field(min_length=1, max_length=128)
    value: bool | int | float | None = None
    error_message: str | None = None
    rationale: str | None = None

    @model_validator(mode="after")
    def require_result_or_error(self) -> ExperimentResultInput:
        has_value = "value" in self.model_fields_set
        if has_value == (self.error_message is not None):
            raise ValueError(
                "evaluator result requires exactly one of value or error_message"
            )
        if isinstance(self.value, float) and not math.isfinite(self.value):
            raise ValueError("evaluator result must be finite")
        if self.rationale is not None and (not has_value or self.value is None):
            raise ValueError("evaluator rationale requires a successful value")
        return self


class ExperimentCaseResultRequest(ApiModel):
    status: Literal["completed", "failed"]
    output: JsonValue | None = None
    error: JsonValue | None = None
    duration_us: int = Field(ge=0)
    trace_id: str | None = Field(default=None, max_length=128)
    evaluator_results: list[ExperimentResultInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_case_result(self) -> ExperimentCaseResultRequest:
        if self.status == "completed" and self.error is not None:
            raise ValueError("completed experiment case cannot include error")
        if self.status == "failed" and self.error is None:
            raise ValueError("failed experiment case requires error")
        keys = [result.evaluator_key for result in self.evaluator_results]
        if len(keys) != len(set(keys)):
            raise ValueError("experiment case evaluator keys must be unique")
        return self


class ExperimentResultResponse(ApiModel):
    evaluator_key: str
    value: bool | float | None = None
    error_message: str | None = None
    rationale: str | None = None


class ExperimentCaseResponse(ApiModel):
    experiment_case_id: str
    dataset_example_id: str
    position: int
    input: JsonValue
    expected_output: JsonValue | None = None
    metadata: dict[str, JsonValue]
    status: ExperimentCaseStatus
    output: JsonValue | None = None
    error: JsonValue | None = None
    duration_us: int | None = None
    trace_id: str | None = None
    completed_at: datetime | None = None
    evaluator_results: list[ExperimentResultResponse] = Field(default_factory=list)


class ExperimentFinishRequest(ApiModel):
    status: Literal["completed", "cancelled"]


class ExperimentResumeRequest(ApiModel):
    retry_failed: bool = False


class ExperimentSummary(ApiModel):
    experiment_id: str
    dataset_id: str
    dataset_revision: int
    name: str
    status: ExperimentStatus
    started_at: datetime
    ended_at: datetime | None = None
    case_count: int
    completed_case_count: int
    failed_case_count: int


class ExperimentResponse(ExperimentSummary):
    target_metadata: dict[str, JsonValue]
    evaluators: list[ExperimentEvaluatorResponse]
    cases: list[ExperimentCaseResponse]


class ExperimentListResponse(ApiModel):
    items: list[ExperimentSummary]


class ObservationDetail(ObservationSummary):
    input: JsonValue
    output: JsonValue
    error: JsonValue
    usage: UsageContract | None
    metadata: dict[str, JsonValue]


class HealthResponse(ApiModel):
    status: Literal["ok"]
    server_version: str
    supported_schema_versions: list[int]
    database_migration_version: str | None


class ResetRequest(ApiModel):
    confirmation: Literal["RESET"]
