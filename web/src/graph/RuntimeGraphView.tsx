import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState, type CSSProperties } from "react";

/** `.runtime-node`의 CSS 크기다. 축선을 root 중심에 맞추는 데만 쓴다. */
const NODE_WIDTH = 184;
const NODE_MIN_HEIGHT = 92;
const ROOT_FRAME_PADDING = 24;
const ROOT_FRAME_HEADER_HEIGHT = 68;
const ROOT_FRAME_MIN_WIDTH = NODE_WIDTH + ROOT_FRAME_PADDING * 2;
const ROOT_FRAME_MIN_HEIGHT = 130;

import type { ObservationSummary, TraceStatus } from "../api/types";
import { formatDuration } from "../components";
import { useT, type Translate } from "../i18n/context";
import {
  buildRuntimeGraph,
  isNotableRuntimeKind,
  runtimeKindLabel,
  type RuntimeGraphDetail,
  type RuntimeGraphEdge,
  type RuntimeGraphNode,
} from "./runtimeGraph";

const STATUS_LABEL: Record<TraceStatus, string> = {
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};

const EDGE_STYLE: Record<
  RuntimeGraphEdge["relation"],
  { stroke: string; dash?: string }
> = {
  callback: { stroke: "var(--graph-edge)" },
  dispatch: { stroke: "var(--violet)", dash: "5 4" },
  join: { stroke: "var(--graph-edge)" },
};

interface RuntimeObservationNodeData extends Record<string, unknown> {
  graphNode: RuntimeGraphNode;
  displayIndex: number;
}

interface RuntimeRootNodeData extends Record<string, unknown> {
  graphNode: RuntimeGraphNode;
  selected: boolean;
  onSelect: (observationId: string | null) => void;
}

type RuntimeObservationFlowNode = Node<
  RuntimeObservationNodeData,
  "runtimeObservation"
>;
type RuntimeRootFlowNode = Node<RuntimeRootNodeData, "runtimeRoot">;
type RuntimeFlowNode = RuntimeObservationFlowNode | RuntimeRootFlowNode;

function RuntimeObservationNode({
  data,
  selected,
}: NodeProps<RuntimeObservationFlowNode>) {
  const t = useT();
  const { displayIndex, graphNode } = data;
  const { observation } = graphNode;

  return (
    <div
      className="runtime-node"
      data-kind={graphNode.displayKind}
      data-status={observation.status}
      data-selected={selected}
    >
      <Handle
        className="runtime-handle"
        type="target"
        position={Position.Top}
      />
      <div className="runtime-node-heading">
        <span className="runtime-sequence">
          {String(displayIndex).padStart(2, "0")}
        </span>
        <span className="runtime-node-tags">
          {isNotableRuntimeKind(observation.kind) && (
            <span className="runtime-kind">
              {runtimeKindLabel(observation.kind)}
            </span>
          )}
          {graphNode.childKinds.map(({ kind, count }) => (
            <span className="runtime-child-kind" data-kind={kind} key={kind}>
              {runtimeKindLabel(kind)}
              {count > 1 && <em>{count}</em>}
            </span>
          ))}
        </span>
      </div>
      <strong>{observation.name}</strong>
      <div className="runtime-node-meta">
        <span className="runtime-node-status">
          <span aria-hidden="true" />
          {t(STATUS_LABEL[observation.status])}
        </span>
        <span>{formatDuration(observation.duration_us)}</span>
      </div>
      {graphNode.displayKind === "generic" && (
        <span className="raw-kind">kind: {observation.kind}</span>
      )}
      <Handle
        className="runtime-handle"
        type="source"
        position={Position.Bottom}
      />
    </div>
  );
}

function RuntimeRootNode({ data }: NodeProps<RuntimeRootFlowNode>) {
  const t = useT();
  const { observation } = data.graphNode;

  return (
    <div
      className="runtime-root-frame"
      data-selected={data.selected}
      data-status={observation.status}
    >
      <button
        className="runtime-root-trigger"
        type="button"
        aria-label={[
          t("전체 실행"),
          observation.name,
          t(STATUS_LABEL[observation.status]),
          formatDuration(observation.duration_us),
          `ID ${observation.observation_id}`,
        ].join(", ")}
        aria-pressed={data.selected}
        onClick={(event) => {
          event.stopPropagation();
          data.onSelect(data.selected ? null : observation.observation_id);
        }}
      >
        <strong className="runtime-root-title">{observation.name}</strong>
        <span className="runtime-root-latency">
          {formatDuration(observation.duration_us)}
        </span>
      </button>
    </div>
  );
}

const NODE_TYPES = {
  runtimeObservation: RuntimeObservationNode,
  runtimeRoot: RuntimeRootNode,
};

function layoutRootFrame(modelNodes: RuntimeGraphNode[]): {
  root: RuntimeGraphNode | null;
  steps: RuntimeGraphNode[];
  frame: {
    position: { x: number; y: number };
    width: number;
    height: number;
  } | null;
} {
  const root =
    modelNodes.find(
      ({ observation }) => observation.parent_observation_id === null,
    ) ?? null;
  if (root === null) {
    return { root, steps: modelNodes, frame: null };
  }

  const rawSteps = modelNodes.filter((node) => node.id !== root.id);
  if (rawSteps.length === 0) {
    return {
      root,
      steps: [],
      frame: {
        position: root.position,
        width: ROOT_FRAME_MIN_WIDTH,
        height: ROOT_FRAME_MIN_HEIGHT,
      },
    };
  }

  const firstStepY = Math.min(...rawSteps.map(({ position }) => position.y));
  const yOffset = root.position.y + ROOT_FRAME_HEADER_HEIGHT - firstStepY;
  const steps = rawSteps.map((node) => ({
    ...node,
    position: { x: node.position.x, y: node.position.y + yOffset },
  }));
  const left =
    Math.min(...steps.map(({ position }) => position.x)) - ROOT_FRAME_PADDING;
  const right =
    Math.max(...steps.map(({ position }) => position.x + NODE_WIDTH)) +
    ROOT_FRAME_PADDING;
  const bottom =
    Math.max(...steps.map(({ position }) => position.y + NODE_MIN_HEIGHT)) +
    ROOT_FRAME_PADDING;

  return {
    root,
    steps,
    frame: {
      position: { x: left, y: root.position.y },
      width: Math.max(ROOT_FRAME_MIN_WIDTH, right - left),
      height: Math.max(ROOT_FRAME_MIN_HEIGHT, bottom - root.position.y),
    },
  };
}

function nodeAriaLabel(
  graphNode: RuntimeGraphNode,
  displayIndex: number,
  t: Translate,
): string {
  const { observation } = graphNode;
  return [
    // observation 이름과 ID는 사용자 데이터다. 번역하지 않는다.
    t("실행 노드 {name}", { name: observation.name }),
    t("순서 {n}", { n: displayIndex }),
    t(STATUS_LABEL[observation.status]),
    ...graphNode.childKinds.map(({ kind, count }) =>
      t("하위 {kind} {count}개", { kind: runtimeKindLabel(kind), count }),
    ),
    `ID ${observation.observation_id}`,
  ].join(", ");
}

export function RuntimeGraphView({
  observations,
  selectedObservationId,
  onSelect,
}: {
  observations: ObservationSummary[];
  selectedObservationId: string | null;
  onSelect: (observationId: string | null) => void;
}) {
  // 요약은 root의 직계와 dispatch만 그린다. LangGraph 앱에서 실제 llm과 tool
  // 실행은 그보다 깊이 있어, 전체로 바꾸지 않으면 kind별 renderer에 닿을 수 없다.
  const t = useT();
  const [detail, setDetail] = useState<RuntimeGraphDetail>("summary");
  const model = useMemo(
    () => buildRuntimeGraph(observations, detail),
    [observations, detail],
  );
  const rootLayout = useMemo(() => layoutRootFrame(model.nodes), [model.nodes]);
  const nodes = useMemo<RuntimeFlowNode[]>(() => {
    const stepNodes: RuntimeObservationFlowNode[] = rootLayout.steps.map(
      (graphNode, index) => ({
        id: graphNode.id,
        type: "runtimeObservation",
        position: graphNode.position,
        data: { graphNode, displayIndex: index + 1 },
        // No width/height: React Flow measures the rendered card instead, so the
        // handles (and the edges that end on them) sit on its real edges even
        // when the kind badges wrap to a second line.
        selected: graphNode.id === selectedObservationId,
        draggable: false,
        connectable: false,
        selectable: true,
        focusable: true,
        ariaRole: "button",
        ariaLabel: nodeAriaLabel(graphNode, index + 1, t),
        domAttributes: {
          "aria-pressed": graphNode.id === selectedObservationId,
        },
      }),
    );
    if (rootLayout.root === null || rootLayout.frame === null) {
      return stepNodes;
    }
    const rootNode: RuntimeRootFlowNode = {
      id: rootLayout.root.id,
      type: "runtimeRoot",
      position: rootLayout.frame.position,
      data: {
        graphNode: rootLayout.root,
        selected: rootLayout.root.id === selectedObservationId,
        onSelect,
      },
      style: {
        width: rootLayout.frame.width,
        height: rootLayout.frame.height,
      },
      selected: false,
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
    };
    return [rootNode, ...stepNodes];
  }, [onSelect, rootLayout, selectedObservationId, t]);
  const edges = useMemo<Edge[]>(
    () =>
      model.edges
        .filter(
          (edge) =>
            edge.source !== rootLayout.root?.id &&
            edge.target !== rootLayout.root?.id,
        )
        .map((edge) => {
          const { stroke, dash } = EDGE_STYLE[edge.relation];
          return {
            ...edge,
            type: "smoothstep",
            focusable: false,
            selectable: false,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: stroke,
              width: 16,
              height: 16,
            },
            style: { stroke, strokeDasharray: dash, strokeWidth: 1.6 },
          };
        }),
    [model.edges, rootLayout.root?.id],
  );

  // 기획서 01절의 "축과 가지". root의 세로 중심선을 rachis로 그려 형제 노드가
  // 어느 축에서 갈라졌는지 눈으로 잡히게 한다. viewport 안에 그리므로 pan/zoom을
  // 함께 따라간다. 노드가 하나뿐이면 축이 의미가 없어 그리지 않는다.
  const axis = useMemo(() => {
    if (rootLayout.steps.length < 2) return null;
    const top = Math.min(...rootLayout.steps.map((node) => node.position.y));
    const bottom = Math.max(...rootLayout.steps.map((node) => node.position.y));
    const first = rootLayout.steps.reduce((best, node) =>
      node.position.y < best.position.y ? node : best,
    );
    return {
      x: first.position.x + NODE_WIDTH / 2,
      top,
      height: bottom - top + NODE_MIN_HEIGHT,
    };
  }, [rootLayout.steps]);

  if (observations.length === 0) {
    return <p className="graph-empty">{t("실행 observation이 없습니다.")}</p>;
  }

  return (
    <div
      className="runtime-graph"
      role="group"
      aria-label={t("실제 실행 경로 그래프")}
      data-testid="runtime-graph"
      data-axis={axis === null ? undefined : ""}
      style={
        axis === null
          ? undefined
          : ({
              "--axis-x": `${axis.x}px`,
              "--axis-top": `${axis.top}px`,
              "--axis-height": `${axis.height}px`,
            } as CSSProperties)
      }
    >
      <div
        className="graph-detail-toggle"
        role="group"
        aria-label={t("그래프 상세 수준")}
      >
        <button
          className={detail === "summary" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "summary"}
          onClick={() => setDetail("summary")}
        >
          {t("요약")}
        </button>
        <button
          className={detail === "all" ? "selected" : undefined}
          type="button"
          aria-pressed={detail === "all"}
          onClick={() => setDetail("all")}
        >
          {t("전체")}
        </button>
      </div>
      <ReactFlow<RuntimeFlowNode, Edge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 0.92 }}
        minZoom={0.3}
        maxZoom={1.5}
        panOnScroll
        zoomOnDoubleClick={false}
        onNodeClick={(_event, node) => {
          if (node.type === "runtimeRoot") return;
          onSelect(node.id === selectedObservationId ? null : node.id);
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color="var(--line)"
          gap={22}
          size={1}
          variant={BackgroundVariant.Dots}
        />
        <Controls
          position="bottom-right"
          showInteractive={false}
          aria-label={t("그래프 확대와 축소")}
        />
      </ReactFlow>
    </div>
  );
}
