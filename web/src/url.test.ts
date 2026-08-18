import {beforeEach, describe, expect, it} from "vitest";

import {readAppUrlState, replaceAppUrlState, type AppUrlState} from "./url";

function baseState(overrides: Partial<AppUrlState> = {}): AppUrlState {
  const current = readAppUrlState("");
  return {...current, ...overrides};
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("shell URL state", () => {
  it("view가 없으면 Overview를 연다", () => {
    expect(readAppUrlState("").view).toBe("overview");
  });

  it("허용되지 않은 view는 Overview로 떨어진다", () => {
    expect(readAppUrlState("?view=nope").view).toBe("overview");
  });

  it("새 view 값을 그대로 읽는다", () => {
    expect(readAppUrlState("?view=overview").view).toBe("overview");
    expect(readAppUrlState("?view=evaluate").view).toBe("evaluate");
    expect(readAppUrlState("?view=queues").view).toBe("queues");
    expect(readAppUrlState("?view=scores").view).toBe("scores");
    expect(readAppUrlState("?view=settings").view).toBe("settings");
  });

  // 이미 공유된 link를 깨지 않는다. 재편 이전 값이 대응하는 새 화면을 연다.
  it.each([
    // Insights는 재편 중 잠깐 쓰던 이름이다. Overview로 되돌렸다.
    ["?view=insights", "overview", "examples"],
    ["?view=traces", "traces", "examples"],
    // Datasets 세그먼트는 사라졌다. dataset 선택은 Examples의 context bar가 맡는다.
    ["?view=datasets", "evaluate", "examples"],
    ["?view=data", "settings", "examples"],
  ])("구 URL %s은 %s로 옮겨 읽는다", (search, view, section) => {
    const state = readAppUrlState(search);
    expect(state.view).toBe(view);
    expect(state.section).toBe(section);
  });

  // Queues/Scores는 dataset의 하위가 아니라 top-level이다. 잠깐 세그먼트였던
  // 시절의 link만 읽을 때 올려 준다.
  it("Evaluate 세그먼트였던 queues/scores link는 top-level로 올려 읽는다", () => {
    expect(readAppUrlState("?view=evaluate&section=queues").view).toBe(
      "queues",
    );
    expect(readAppUrlState("?view=evaluate&section=scores").view).toBe(
      "scores",
    );
  });

  it("URL을 다시 쓸 때는 새 값만 쓴다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "experiments"}));
    expect(window.location.search).toContain("view=evaluate");
    expect(window.location.search).toContain("section=experiments");
    replaceAppUrlState(baseState({view: "queues"}));
    expect(window.location.search).toContain("view=queues");
    expect(window.location.search).not.toContain("section=");
  });

  it("기본 section인 examples는 URL에 남기지 않는다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "examples"}));
    expect(window.location.search).not.toContain("section=");
  });

  it("재편 이전 tab 값은 세그먼트로 옮겨 읽는다", () => {
    // compare는 experiments 안에서 그리던 화면이라 그쪽으로 접는다.
    expect(readAppUrlState("?view=evaluate&tab=compare").section).toBe(
      "experiments",
    );
    expect(readAppUrlState("?view=evaluate&tab=examples").section).toBe(
      "examples",
    );
    // section이 있으면 그쪽이 이긴다.
    expect(
      readAppUrlState("?view=evaluate&section=examples&tab=compare").section,
    ).toBe("examples");
  });

  it("Evaluate가 아닌 화면에서는 section을 쓰지 않는다", () => {
    replaceAppUrlState(baseState({view: "traces", section: "experiments"}));
    expect(window.location.search).not.toContain("section=");
  });

  it("view와 section이 round-trip한다", () => {
    replaceAppUrlState(baseState({view: "evaluate", section: "experiments"}));
    const restored = readAppUrlState();
    expect(restored.view).toBe("evaluate");
    expect(restored.section).toBe("experiments");
  });
});
