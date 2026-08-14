from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Annotated, Literal, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    status,
)
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from starlette.background import BackgroundTask

from langfeather_server import __version__
from langfeather_server.api_models import (
    AnnotationPutRequest,
    AnnotationQueueAddItemsRequest,
    AnnotationQueueCompleteRequest,
    AnnotationQueueCreateRequest,
    AnnotationQueueEditRequest,
    AnnotationQueueItemResponse,
    AnnotationQueueListResponse,
    AnnotationQueuePatchRequest,
    AnnotationQueueResponse,
    AnnotationResponse,
    BatchIngestRequest,
    BatchIngestResponse,
    BatchItemError,
    BatchItemResult,
    DashboardResponse,
    DatasetCreateRequest,
    DatasetExampleInput,
    DatasetExamplePatchRequest,
    DatasetListResponse,
    DatasetPatchRequest,
    DatasetResponse,
    DatasetTraceAddRequest,
    ExperimentCaseResponse,
    ExperimentCaseResultRequest,
    ExperimentCreateRequest,
    ExperimentFinishRequest,
    ExperimentListResponse,
    ExperimentResponse,
    ExperimentResumeRequest,
    HealthResponse,
    ObservationDetail,
    ResetRequest,
    ScoreConfigResponse,
    ScoreCreateRequest,
    ScoreListResponse,
    ScorePatchRequest,
    TraceDetail,
    TraceListResponse,
    TraceMemoPutRequest,
    TraceMemoResponse,
)
from langfeather_server.contracts import (
    CompletedEnvelopeContract,
    TraceStatus,
)
from langfeather_server.database import (
    Database,
    backup_live_database,
    create_database,
    exclusive_sqlite_lock,
    sqlite_database_path,
)
from langfeather_server.migrations import current_revision, upgrade_database
from langfeather_server.repository import (
    InvalidAnnotationError,
    InvalidCursorError,
    ObservationIdConflictError,
    ResourceConflictError,
    ResourceNotFoundError,
    TraceRepository,
)

DEFAULT_DATABASE_URL = "sqlite:////data/langfeather.db"
DATABASE_URL_ENV = "LANGFEATHER_DATABASE_URL"
STATIC_DIR_ENV = "LANGFEATHER_STATIC_DIR"
TRUSTED_HOSTS_ENV = "LANGFEATHER_TRUSTED_HOSTS"
DEFAULT_TRUSTED_HOSTS = ("localhost", "127.0.0.1")


def _require_json_content_type(request: Request) -> None:
    content_type = request.headers.get("content-type", "").partition(";")[0].lower()
    if content_type != "application/json":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Content-Type must be application/json",
        )


def _repository(request: Request) -> TraceRepository:
    return cast(TraceRepository, request.app.state.trace_repository)


def _database(request: Request) -> Database:
    return cast(Database, request.app.state.database)


RepositoryDependency = Annotated[TraceRepository, Depends(_repository)]
DatabaseDependency = Annotated[Database, Depends(_database)]
TraceLimit = Annotated[int, Query(ge=1, le=200)]
TracePage = Annotated[int | None, Query(ge=1)]
TraceStatusFilter = Annotated[TraceStatus | None, Query(alias="status")]
TraceFrom = Annotated[datetime | None, Query(alias="from")]
TraceTo = Annotated[datetime | None, Query(alias="to")]
DashboardScoreIds = Query(default_factory=list, alias="score_id")
DashboardToolNames = Query(default_factory=list, alias="tool_name")


def _dashboard_timestamp(value: str, *, parameter: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{parameter} must be a UTC ISO 8601 timestamp",
        ) from error
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{parameter} must be a UTC ISO 8601 timestamp",
        )
    return parsed.astimezone(timezone.utc)


def _dashboard_timezone(value: str) -> None:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="timezone must be an IANA timezone",
        ) from error


def _resolve_trusted_hosts(value: Sequence[str] | None) -> list[str]:
    if value is not None:
        return list(value)
    configured = os.environ.get(TRUSTED_HOSTS_ENV)
    if configured is None:
        return list(DEFAULT_TRUSTED_HOSTS)
    hosts = [host.strip() for host in configured.split(",") if host.strip()]
    return hosts or list(DEFAULT_TRUSTED_HOSTS)


def _resolve_static_dir(value: Path | None) -> Path | None:
    candidate = value or (
        Path(configured) if (configured := os.environ.get(STATIC_DIR_ENV)) else None
    )
    if candidate is None:
        return None
    resolved = candidate.resolve()
    return resolved if (resolved / "index.html").is_file() else None


def _remove_file(path: Path) -> None:
    path.unlink(missing_ok=True)


def _candidate_trace_id(raw_item: object) -> str | None:
    if not isinstance(raw_item, dict):
        return None
    raw_trace = raw_item.get("trace")
    if not isinstance(raw_trace, dict):
        return None
    trace_id = raw_trace.get("trace_id")
    return trace_id if isinstance(trace_id, str) else None


def create_app(
    *,
    database_url: str | None = None,
    static_dir: Path | None = None,
    trusted_hosts: Sequence[str] | None = None,
) -> FastAPI:
    resolved_database_url = (
        database_url or os.environ.get(DATABASE_URL_ENV) or DEFAULT_DATABASE_URL
    )
    database = create_database(resolved_database_url)
    repository = TraceRepository(database.session_factory)
    database_path = sqlite_database_path(resolved_database_url)

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        with exclusive_sqlite_lock(database_path, blocking=False):
            upgrade_database(database.engine)
            try:
                yield
            finally:
                database.engine.dispose()

    application = FastAPI(
        title="LangFeather Server",
        version=__version__,
        lifespan=lifespan,
    )
    application.state.database = database
    application.state.trace_repository = repository
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=_resolve_trusted_hosts(trusted_hosts),
    )

    @application.exception_handler(ResourceNotFoundError)
    async def resource_not_found_handler(
        _request: Request,
        error: ResourceNotFoundError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": str(error)},
        )

    @application.exception_handler(ResourceConflictError)
    async def resource_conflict_handler(
        _request: Request,
        error: ResourceConflictError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": str(error)},
        )

    @application.exception_handler(InvalidAnnotationError)
    async def invalid_annotation_handler(
        _request: Request,
        error: InvalidAnnotationError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": str(error)},
        )

    @application.post(
        "/api/v1/traces/batch",
        response_model=BatchIngestResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def ingest_batch(
        request_body: BatchIngestRequest,
        store: RepositoryDependency,
    ) -> BatchIngestResponse:
        results: list[BatchItemResult] = []
        for raw_item in request_body.items:
            trace_id = _candidate_trace_id(raw_item)
            try:
                envelope = CompletedEnvelopeContract.model_validate(raw_item)
                trace_id = envelope.trace.trace_id
                item_status = store.ingest(envelope)
            except (ValidationError, ObservationIdConflictError) as error:
                results.append(
                    BatchItemResult(
                        trace_id=trace_id,
                        status="rejected",
                        error=BatchItemError(
                            code="validation_error",
                            message=str(error),
                        ),
                    )
                )
                continue
            results.append(
                BatchItemResult(
                    trace_id=trace_id,
                    status=item_status,
                )
            )
        return BatchIngestResponse(results=results)

    @application.get(
        "/api/v1/traces",
        response_model=TraceListResponse,
    )
    def list_traces(
        store: RepositoryDependency,
        limit: TraceLimit = 50,
        cursor: str | None = None,
        page: TracePage = None,
        status_filter: TraceStatusFilter = None,
        from_time: TraceFrom = None,
        to_time: TraceTo = None,
        tag: str | None = None,
        session_id: str | None = None,
        query: str | None = None,
    ) -> TraceListResponse:
        try:
            result = store.list_traces(
                limit=limit,
                cursor=cursor,
                page=page,
                status=status_filter,
                from_time=from_time,
                to_time=to_time,
                tag=tag,
                session_id=session_id,
                query=query,
            )
        except InvalidCursorError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cursor is invalid",
            ) from error
        return TraceListResponse(
            items=result.items,
            next_cursor=result.next_cursor,
            total_count=result.total_count,
        )

    @application.get(
        "/api/v1/sessions/{session_id}/traces",
        response_model=TraceListResponse,
    )
    def list_session_traces(
        session_id: str,
        store: RepositoryDependency,
        limit: TraceLimit = 50,
        cursor: str | None = None,
    ) -> TraceListResponse:
        try:
            result = store.list_traces(
                limit=limit,
                cursor=cursor,
                session_id=session_id,
            )
        except InvalidCursorError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cursor is invalid",
            ) from error
        return TraceListResponse(
            items=result.items,
            next_cursor=result.next_cursor,
            total_count=result.total_count,
        )

    @application.get(
        "/api/v1/dashboard",
        response_model=DashboardResponse,
    )
    def get_dashboard(
        store: RepositoryDependency,
        from_value: str = Query(alias="from"),
        to_value: str = Query(alias="to"),
        timezone_name: str = Query(alias="timezone", min_length=1),
        bucket: Literal["auto", "minute", "hour", "day", "week", "month"] = "auto",
        query: str | None = None,
        tag: str | None = None,
        session_id: str | None = None,
        release: str | None = None,
        environment: str | None = None,
        user_id: str | None = None,
        score_ids: list[str] = DashboardScoreIds,
        tool_names: list[str] = DashboardToolNames,
    ) -> DashboardResponse:
        from_time = _dashboard_timestamp(from_value, parameter="from")
        to_time = _dashboard_timestamp(to_value, parameter="to")
        if from_time >= to_time:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="from must be before to",
            )
        _dashboard_timezone(timezone_name)
        if len(score_ids) > 4:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="at most four score_id values are allowed",
            )
        duration = to_time - from_time
        resolved_bucket: Literal["minute", "hour", "day", "week", "month"]
        if bucket == "auto":
            if duration <= timedelta(hours=2):
                resolved_bucket = "minute"
            elif duration <= timedelta(hours=48):
                resolved_bucket = "hour"
            elif duration <= timedelta(days=90):
                resolved_bucket = "day"
            elif duration <= timedelta(days=365 * 2):
                resolved_bucket = "week"
            else:
                resolved_bucket = "month"
        else:
            resolved_bucket = bucket
        return store.dashboard(
            from_time=from_time,
            to_time=to_time,
            timezone_name=timezone_name,
            bucket=resolved_bucket,
            query=query,
            tag=tag,
            session_id=session_id,
            release=release,
            environment=environment,
            user_id=user_id,
            score_ids=score_ids,
            tool_names=tool_names,
        )

    @application.get(
        "/api/v1/traces/{trace_id}",
        response_model=TraceDetail,
    )
    def get_trace(
        trace_id: str,
        store: RepositoryDependency,
    ) -> TraceDetail:
        trace = store.get_trace(trace_id)
        if trace is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trace not found",
            )
        return trace

    @application.delete(
        "/api/v1/traces/{trace_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_trace(
        trace_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_trace(trace_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trace not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get("/api/v1/scores", response_model=ScoreListResponse)
    def list_scores(
        store: RepositoryDependency,
        include_archived: bool = False,
    ) -> ScoreListResponse:
        return ScoreListResponse(
            items=store.list_scores(include_archived=include_archived)
        )

    @application.post(
        "/api/v1/scores",
        response_model=ScoreConfigResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_require_json_content_type)],
    )
    def create_score(
        request_body: ScoreCreateRequest,
        store: RepositoryDependency,
    ) -> ScoreConfigResponse:
        return store.create_score(request_body)

    @application.get(
        "/api/v1/scores/{score_config_id}",
        response_model=ScoreConfigResponse,
    )
    def get_score(
        score_config_id: str,
        store: RepositoryDependency,
    ) -> ScoreConfigResponse:
        score = store.get_score(score_config_id)
        if score is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Score not found",
            )
        return score

    @application.patch(
        "/api/v1/scores/{score_config_id}",
        response_model=ScoreConfigResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def update_score(
        score_config_id: str,
        patch: ScorePatchRequest,
        store: RepositoryDependency,
    ) -> ScoreConfigResponse:
        return store.update_score(score_config_id, patch)

    @application.delete(
        "/api/v1/scores/{score_config_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_score(
        score_config_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_score(score_config_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Score not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/scores/{score_config_id}/archive",
        response_model=ScoreConfigResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def archive_score(
        score_config_id: str,
        _request: AnnotationQueueEditRequest,
        store: RepositoryDependency,
    ) -> ScoreConfigResponse:
        return store.archive_score(score_config_id)

    @application.put(
        "/api/v1/traces/{trace_id}/annotations/{score_config_id}",
        response_model=AnnotationResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def put_annotation(
        trace_id: str,
        score_config_id: str,
        request_body: AnnotationPutRequest,
        store: RepositoryDependency,
    ) -> AnnotationResponse:
        return store.put_annotation(trace_id, score_config_id, request_body)

    @application.delete(
        "/api/v1/traces/{trace_id}/annotations/{score_config_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_annotation(
        trace_id: str,
        score_config_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_annotation(trace_id, score_config_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.put(
        "/api/v1/traces/{trace_id}/memo",
        response_model=TraceMemoResponse | None,
        dependencies=[Depends(_require_json_content_type)],
    )
    def put_trace_memo(
        trace_id: str,
        request_body: TraceMemoPutRequest,
        store: RepositoryDependency,
    ) -> TraceMemoResponse | None:
        return store.put_memo(trace_id, request_body.content)

    @application.delete(
        "/api/v1/traces/{trace_id}/memo",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_trace_memo(
        trace_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_memo(trace_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Trace memo not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get(
        "/api/v1/annotation-queues",
        response_model=AnnotationQueueListResponse,
    )
    def list_annotation_queues(
        store: RepositoryDependency,
    ) -> AnnotationQueueListResponse:
        return AnnotationQueueListResponse(items=store.list_annotation_queues())

    @application.post(
        "/api/v1/annotation-queues",
        response_model=AnnotationQueueResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_require_json_content_type)],
    )
    def create_annotation_queue(
        request_body: AnnotationQueueCreateRequest,
        store: RepositoryDependency,
    ) -> AnnotationQueueResponse:
        return store.create_annotation_queue(request_body)

    @application.get(
        "/api/v1/annotation-queues/{queue_id}",
        response_model=AnnotationQueueResponse,
    )
    def get_annotation_queue(
        queue_id: str,
        store: RepositoryDependency,
    ) -> AnnotationQueueResponse:
        queue = store.get_annotation_queue(queue_id)
        if queue is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation queue not found",
            )
        return queue

    @application.patch(
        "/api/v1/annotation-queues/{queue_id}",
        response_model=AnnotationQueueResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def update_annotation_queue(
        queue_id: str,
        patch: AnnotationQueuePatchRequest,
        store: RepositoryDependency,
    ) -> AnnotationQueueResponse:
        return store.update_annotation_queue(queue_id, patch)

    @application.delete(
        "/api/v1/annotation-queues/{queue_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_annotation_queue(
        queue_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_annotation_queue(queue_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation queue not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/annotation-queues/{queue_id}/items",
        response_model=AnnotationQueueResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def add_annotation_queue_items(
        queue_id: str,
        request_body: AnnotationQueueAddItemsRequest,
        store: RepositoryDependency,
    ) -> AnnotationQueueResponse:
        return store.add_annotation_queue_items(queue_id, request_body.trace_ids)

    @application.delete(
        "/api/v1/annotation-queues/{queue_id}/items/{item_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_annotation_queue_item(
        queue_id: str,
        item_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_annotation_queue_item(queue_id, item_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation queue item not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/annotation-queues/{queue_id}/items/{item_id}/edit",
        response_model=AnnotationQueueItemResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def edit_annotation_queue_item(
        queue_id: str,
        item_id: str,
        _request: AnnotationQueueEditRequest,
        store: RepositoryDependency,
    ) -> AnnotationQueueItemResponse:
        return store.edit_annotation_queue_item(queue_id, item_id)

    @application.post(
        "/api/v1/annotation-queues/{queue_id}/items/{item_id}/complete",
        response_model=AnnotationQueueItemResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def complete_annotation_queue_item(
        queue_id: str,
        item_id: str,
        request_body: AnnotationQueueCompleteRequest,
        store: RepositoryDependency,
    ) -> AnnotationQueueItemResponse:
        return store.complete_annotation_queue_item(
            queue_id,
            item_id,
            request_body,
        )

    @application.get("/api/v1/datasets", response_model=DatasetListResponse)
    def list_datasets(
        store: RepositoryDependency,
        name: str | None = Query(default=None, min_length=1, max_length=255),
    ) -> DatasetListResponse:
        return DatasetListResponse(items=store.list_datasets(name=name))

    @application.post(
        "/api/v1/datasets",
        response_model=DatasetResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_require_json_content_type)],
    )
    def create_dataset(
        request_body: DatasetCreateRequest,
        store: RepositoryDependency,
    ) -> DatasetResponse:
        return store.create_dataset(request_body)

    @application.get("/api/v1/datasets/{dataset_id}", response_model=DatasetResponse)
    def get_dataset(dataset_id: str, store: RepositoryDependency) -> DatasetResponse:
        dataset = store.get_dataset(dataset_id)
        if dataset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        return dataset

    @application.patch(
        "/api/v1/datasets/{dataset_id}",
        response_model=DatasetResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def update_dataset(
        dataset_id: str,
        request_body: DatasetPatchRequest,
        store: RepositoryDependency,
    ) -> DatasetResponse:
        return store.update_dataset(dataset_id, request_body)

    @application.delete(
        "/api/v1/datasets/{dataset_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_dataset(dataset_id: str, store: RepositoryDependency) -> Response:
        if not store.delete_dataset(dataset_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/datasets/{dataset_id}/examples",
        response_model=DatasetResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def add_dataset_examples(
        dataset_id: str,
        request_body: list[DatasetExampleInput],
        store: RepositoryDependency,
    ) -> DatasetResponse:
        if not request_body:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="at least one dataset example is required",
            )
        return store.add_dataset_examples(dataset_id, request_body)

    @application.post(
        "/api/v1/datasets/{dataset_id}/traces",
        response_model=DatasetResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def add_trace_to_dataset(
        dataset_id: str,
        request_body: DatasetTraceAddRequest,
        store: RepositoryDependency,
    ) -> DatasetResponse:
        return store.add_trace_to_dataset(dataset_id, request_body)

    @application.patch(
        "/api/v1/datasets/{dataset_id}/examples/{example_id}",
        response_model=DatasetResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def update_dataset_example(
        dataset_id: str,
        example_id: str,
        request_body: DatasetExamplePatchRequest,
        store: RepositoryDependency,
    ) -> DatasetResponse:
        return store.update_dataset_example(dataset_id, example_id, request_body)

    @application.delete(
        "/api/v1/datasets/{dataset_id}/examples/{example_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_dataset_example(
        dataset_id: str,
        example_id: str,
        store: RepositoryDependency,
    ) -> Response:
        if not store.delete_dataset_example(dataset_id, example_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset example not found",
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.post(
        "/api/v1/experiments",
        response_model=ExperimentResponse,
        status_code=status.HTTP_201_CREATED,
        dependencies=[Depends(_require_json_content_type)],
    )
    def create_experiment(
        request_body: ExperimentCreateRequest,
        store: RepositoryDependency,
    ) -> ExperimentResponse:
        return store.create_experiment(request_body)

    @application.get("/api/v1/experiments", response_model=ExperimentListResponse)
    def list_experiments(store: RepositoryDependency) -> ExperimentListResponse:
        return ExperimentListResponse(items=store.list_experiments())

    @application.get(
        "/api/v1/experiments/{experiment_id}",
        response_model=ExperimentResponse,
    )
    def get_experiment(
        experiment_id: str,
        store: RepositoryDependency,
    ) -> ExperimentResponse:
        experiment = store.get_experiment(experiment_id)
        if experiment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found"
            )
        return experiment

    @application.delete(
        "/api/v1/experiments/{experiment_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def delete_experiment(experiment_id: str, store: RepositoryDependency) -> Response:
        if not store.delete_experiment(experiment_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found"
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.put(
        "/api/v1/experiments/{experiment_id}/cases/{case_id}",
        response_model=ExperimentCaseResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def put_experiment_case_result(
        experiment_id: str,
        case_id: str,
        request_body: ExperimentCaseResultRequest,
        store: RepositoryDependency,
    ) -> ExperimentCaseResponse:
        return store.put_experiment_case_result(experiment_id, case_id, request_body)

    @application.post(
        "/api/v1/experiments/{experiment_id}/finish",
        response_model=ExperimentResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def finish_experiment(
        experiment_id: str,
        request_body: ExperimentFinishRequest,
        store: RepositoryDependency,
    ) -> ExperimentResponse:
        return store.finish_experiment(experiment_id, request_body.status)

    @application.post(
        "/api/v1/experiments/{experiment_id}/resume",
        response_model=ExperimentResponse,
        dependencies=[Depends(_require_json_content_type)],
    )
    def resume_experiment(
        experiment_id: str,
        request_body: ExperimentResumeRequest,
        store: RepositoryDependency,
    ) -> ExperimentResponse:
        return store.resume_experiment(
            experiment_id, retry_failed=request_body.retry_failed
        )

    @application.get("/api/v1/admin/backup")
    def download_backup(
        database_state: DatabaseDependency,
    ) -> FileResponse:
        with NamedTemporaryFile(suffix=".db", delete=False) as backup_file:
            backup_path = Path(backup_file.name)
        try:
            backup_live_database(database_state.engine, backup_path)
        except Exception:
            _remove_file(backup_path)
            raise
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        return FileResponse(
            backup_path,
            media_type="application/x-sqlite3",
            filename=f"langfeather-backup-{timestamp}.db",
            background=BackgroundTask(_remove_file, backup_path),
        )

    @application.post(
        "/api/v1/admin/reset",
        status_code=status.HTTP_204_NO_CONTENT,
        dependencies=[Depends(_require_json_content_type)],
    )
    def reset_data(
        _request: ResetRequest,
        store: RepositoryDependency,
    ) -> Response:
        store.reset()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @application.get(
        "/api/v1/observations/{observation_id}",
        response_model=ObservationDetail,
    )
    def get_observation(
        observation_id: str,
        store: RepositoryDependency,
    ) -> ObservationDetail:
        observation = store.get_observation(observation_id)
        if observation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Observation not found",
            )
        return observation

    @application.get(
        "/api/v1/health",
        response_model=HealthResponse,
    )
    def health(
        database_state: DatabaseDependency,
    ) -> HealthResponse:
        return HealthResponse(
            status="ok",
            server_version=__version__,
            supported_schema_versions=[1],
            database_migration_version=current_revision(database_state.engine),
        )

    resolved_static_dir = _resolve_static_dir(static_dir)
    if resolved_static_dir is not None:
        assets_dir = resolved_static_dir / "assets"
        if assets_dir.is_dir():
            application.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="assets",
            )

        @application.get("/{path:path}", include_in_schema=False)
        def serve_spa(path: str) -> FileResponse:
            if path == "api" or path.startswith("api/"):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
            requested = (resolved_static_dir / path).resolve()
            if requested.is_relative_to(resolved_static_dir) and requested.is_file():
                return FileResponse(requested)
            return FileResponse(resolved_static_dir / "index.html")

    return application


app = create_app()
