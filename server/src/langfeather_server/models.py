from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TraceRow(Base):
    __tablename__ = "traces"

    trace_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(27), nullable=False, index=True)
    ended_at: Mapped[str] = mapped_column(String(27), nullable=False)
    duration_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    output_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_json: Mapped[str] = mapped_column(Text, nullable=False)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    release: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    environment: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        index=True,
    )
    tags_json: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    observation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    input_preview: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index(
            "ix_traces_started_at_trace_id",
            started_at.desc(),
            trace_id.desc(),
        ),
    )


class ObservationRow(Base):
    __tablename__ = "observations"

    observation_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    trace_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "traces.trace_id",
            name="fk_observations_trace",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    parent_observation_id: Mapped[str | None] = mapped_column(
        String(128),
        ForeignKey(
            "observations.observation_id",
            name="fk_observations_parent",
            ondelete="CASCADE",
            deferrable=True,
            initially="DEFERRED",
        ),
        nullable=True,
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(27), nullable=False, index=True)
    ended_at: Mapped[str] = mapped_column(String(27), nullable=False)
    duration_us: Mapped[int] = mapped_column(BigInteger, nullable=False)
    time_to_first_token_us: Mapped[int | None] = mapped_column(
        BigInteger,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    output_json: Mapped[str] = mapped_column(Text, nullable=False)
    error_json: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    usage_json: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "trace_id",
            "sequence",
            name="uq_observations_trace_sequence",
        ),
    )


class ScoreConfigRow(Base):
    __tablename__ = "score_configs"

    score_config_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_type: Mapped[str] = mapped_column(String(32), nullable=False)
    boolean_true_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    boolean_false_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    number_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    number_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    categorical_selection_mode: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)
    archived_at: Mapped[str | None] = mapped_column(String(27), nullable=True)


class ScoreOptionRow(Base):
    __tablename__ = "score_options"

    score_option_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    score_config_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "score_configs.score_config_id",
            name="fk_score_options_config",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)
    archived_at: Mapped[str | None] = mapped_column(String(27), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "score_config_id",
            "position",
            name="uq_score_options_config_position",
        ),
    )


class AnnotationRow(Base):
    __tablename__ = "annotations"

    annotation_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    score_config_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "score_configs.score_config_id",
            name="fk_annotations_score_config",
            ondelete="RESTRICT",
        ),
        nullable=False,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(String(32), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    trace_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "traces.trace_id",
            name="fk_annotations_trace",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    boolean_value: Mapped[bool | None] = mapped_column(nullable=True)
    number_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "score_config_id",
            "target_type",
            "target_id",
            name="uq_annotations_score_target",
        ),
    )


class AnnotationSelectedOptionRow(Base):
    __tablename__ = "annotation_selected_options"

    annotation_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "annotations.annotation_id",
            name="fk_annotation_options_annotation",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    score_option_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "score_options.score_option_id",
            name="fk_annotation_options_option",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )


class TraceMemoRow(Base):
    __tablename__ = "trace_memos"

    trace_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "traces.trace_id",
            name="fk_trace_memos_trace",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)


class AnnotationQueueRow(Base):
    __tablename__ = "annotation_queues"

    annotation_queue_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)


class AnnotationQueueScoreRow(Base):
    __tablename__ = "annotation_queue_scores"

    annotation_queue_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "annotation_queues.annotation_queue_id",
            name="fk_annotation_queue_scores_queue",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    score_config_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "score_configs.score_config_id",
            name="fk_annotation_queue_scores_config",
            ondelete="RESTRICT",
        ),
        primary_key=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class AnnotationQueueItemRow(Base):
    __tablename__ = "annotation_queue_items"

    annotation_queue_item_id: Mapped[str] = mapped_column(
        String(128),
        primary_key=True,
    )
    annotation_queue_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "annotation_queues.annotation_queue_id",
            name="fk_annotation_queue_items_queue",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    trace_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "traces.trace_id",
            name="fk_annotation_queue_items_trace",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)
    completed_at: Mapped[str | None] = mapped_column(String(27), nullable=True)
    was_edited: Mapped[bool] = mapped_column(nullable=False, default=False)

    __table_args__ = (
        UniqueConstraint(
            "annotation_queue_id",
            "trace_id",
            name="uq_annotation_queue_items_queue_trace",
        ),
    )


class DatasetRow(Base):
    __tablename__ = "datasets"

    dataset_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)


class DatasetExampleRow(Base):
    __tablename__ = "dataset_examples"

    dataset_example_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "datasets.dataset_id",
            name="fk_dataset_examples_dataset",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    expected_output_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    source_trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[str] = mapped_column(String(27), nullable=False)
    updated_at: Mapped[str] = mapped_column(String(27), nullable=False)

    __table_args__ = (
        UniqueConstraint("dataset_id", "position", name="uq_dataset_examples_position"),
    )


class ExperimentRow(Base):
    __tablename__ = "experiments"

    experiment_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "datasets.dataset_id", name="fk_experiments_dataset", ondelete="RESTRICT"
        ),
        nullable=False,
        index=True,
    )
    dataset_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    target_metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    started_at: Mapped[str] = mapped_column(String(27), nullable=False)
    ended_at: Mapped[str | None] = mapped_column(String(27), nullable=True)


class ExperimentEvaluatorRow(Base):
    __tablename__ = "experiment_evaluators"

    experiment_evaluator_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "experiments.experiment_id",
            name="fk_experiment_evaluators_experiment",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    data_type: Mapped[str] = mapped_column(String(16), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("experiment_id", "key", name="uq_experiment_evaluators_key"),
    )


class ExperimentCaseRow(Base):
    __tablename__ = "experiment_cases"

    experiment_case_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    experiment_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "experiments.experiment_id",
            name="fk_experiment_cases_experiment",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    dataset_example_id: Mapped[str] = mapped_column(String(128), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    expected_output_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    output_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_us: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    completed_at: Mapped[str | None] = mapped_column(String(27), nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "experiment_id", "dataset_example_id", name="uq_experiment_cases_example"
        ),
    )


class ExperimentResultRow(Base):
    __tablename__ = "experiment_results"

    experiment_result_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    experiment_case_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "experiment_cases.experiment_case_id",
            name="fk_experiment_results_case",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    experiment_evaluator_id: Mapped[str] = mapped_column(
        String(128),
        ForeignKey(
            "experiment_evaluators.experiment_evaluator_id",
            name="fk_experiment_results_evaluator",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )
    boolean_value: Mapped[bool | None] = mapped_column(nullable=True)
    number_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    rationale: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "experiment_case_id",
            "experiment_evaluator_id",
            name="uq_experiment_results_case_evaluator",
        ),
    )
