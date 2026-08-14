import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ObservationSummary } from "../api/types";
import { RuntimeGraphView } from "./RuntimeGraphView";

vi.mock("@xyflow/react", async () => {
  return {
    Background: () => null,
    BackgroundVariant: { Dots: "dots" },
    Controls: () => null,
    Handle: () => null,
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Top: "top", Bottom: "bottom" },
    ReactFlow: ({
      edges,
      nodes,
      nodeTypes,
    }: {
      edges: Array<{ id: string; source: string; target: string }>;
      nodes: Array<{
        id: string;
        type: string;
        data: unknown;
        selected: boolean;
        ariaLabel?: string;
        style?: CSSProperties;
      }>;
      nodeTypes: Record<
        string,
        ComponentType<{ data: unknown; selected: boolean }>
      >;
    }) => (
      <div>
        {edges.map((edge) => (
          <i data-flow-edge={`${edge.source}-${edge.target}`} key={edge.id} />
        ))}
        {nodes.map((node) => {
          const Node = nodeTypes[node.type]!;
          return (
            <div
              aria-label={node.ariaLabel}
              data-flow-node={node.id}
              key={node.id}
              style={node.style}
            >
              <Node data={node.data} selected={node.selected} />
            </div>
          );
        })}
      </div>
    ),
  };
});

function observation(
  overrides: Partial<ObservationSummary> & {
    observation_id: string;
    sequence: number;
    name: string;
  },
): ObservationSummary {
  return {
    trace_id: "tr_runtime",
    parent_observation_id: "obs_root",
    kind: "runnable",
    started_at: "2026-08-09T00:00:00Z",
    ended_at: "2026-08-09T00:00:01Z",
    duration_us: 1_000_000,
    time_to_first_token_us: null,
    status: "completed",
    model: null,
    ...overrides,
  };
}

describe("RuntimeGraphView", () => {
  it("frames the root and numbers only the rendered execution steps", () => {
    const onSelect = vi.fn();
    render(
      <RuntimeGraphView
        observations={[
          observation({
            observation_id: "obs_root",
            parent_observation_id: null,
            sequence: 0,
            name: "whole graph",
            kind: "evaluation",
          }),
          observation({
            observation_id: "obs_child",
            sequence: 7,
            name: "first visible step",
            kind: "retriever",
          }),
          observation({
            observation_id: "obs_child_2",
            sequence: 11,
            name: "second visible step",
            kind: "llm",
          }),
        ]}
        selectedObservationId={null}
        onSelect={onSelect}
      />,
    );

    const rootTrigger = screen.getByRole("button", {
      name: /전체 실행, whole graph/,
    });
    expect(rootTrigger.closest(".runtime-root-frame")).toBeInTheDocument();
    expect(rootTrigger).toHaveTextContent("whole graph");
    expect(rootTrigger).toHaveTextContent("1.00s");
    expect(rootTrigger.querySelector(".runtime-sequence")).not.toBeInTheDocument();
    expect(rootTrigger.querySelector(".runtime-node-tags")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/first visible step.*순서 1/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/second visible step.*순서 2/),
    ).toBeInTheDocument();
    const stepSequences = document.querySelectorAll(
      ".runtime-node .runtime-sequence",
    );
    expect(
      document.querySelectorAll(".runtime-node .runtime-node-tags"),
    ).toHaveLength(2);
    expect(stepSequences).toHaveLength(2);
    expect(stepSequences[0]).toHaveTextContent("01");
    expect(stepSequences[1]).toHaveTextContent("02");
    expect(
      document.querySelector('[data-flow-edge="obs_root-obs_child"]'),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-flow-edge="obs_root-obs_child_2"]'),
    ).not.toBeInTheDocument();
    expect(document.querySelector('[data-flow-node="obs_root"]')).toHaveStyle({
      width: "512px",
      height: "184px",
    });

    fireEvent.click(rootTrigger);
    expect(onSelect).toHaveBeenCalledWith("obs_root");
  });
});
