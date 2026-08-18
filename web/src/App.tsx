import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { QueuesView } from "./annotations/QueuesView";
import { APP_TITLE } from "./constants";
import { EvaluationView } from "./evaluation/EvaluationView";
import { useLanguage, useT } from "./i18n/context";
import { type Language } from "./i18n/i18n";
import { LanguageProvider } from "./i18n/LanguageContext";
import { OverviewView } from "./overview/OverviewView";
import { ScoresView } from "./scores/ScoresView";
import { LocalDataView } from "./settings/LocalDataView";
import { OverviewTraceDrawer, TracesView } from "./traces/TracesView";
import { applyTheme, readTheme, writeTheme, type Theme } from "./theme";
import {
  readAppUrlState,
  replaceAppUrlState,
  type AppUrlState,
  type AppView,
  type EvaluateSection,
  type EvaluationUrlState,
  type OverviewUrlState,
} from "./url";
import logo from "./assets/logo.png";
import "./styles.css";

/**
 * 값이 둘뿐인 선택. select는 목록을 여는 클릭이 한 번 더 들고 고르기 전까지
 * 다른 값을 감춘다. 둘을 나란히 두고 현재 값 아래로 thumb가 미끄러진다.
 */
function Switch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string; title: string }>;
  onChange: (value: T) => void;
}) {
  const index = options.findIndex((option) => option.id === value);
  return (
    <div
      className="lf-switch"
      role="group"
      aria-label={label}
      style={{ "--switch-index": Math.max(index, 0) } as CSSProperties}
    >
      {options.map((option) => (
        <button
          className="lf-switch-option"
          key={option.id}
          type="button"
          title={option.title}
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 언어 이름은 그 언어로 적는다. 번역 대상이 아니다. */
const LANGUAGE_OPTIONS: ReadonlyArray<{
  id: Language;
  label: string;
  title: string;
}> = [
  { id: "ko", label: "KO", title: "한국어" },
  { id: "en", label: "EN", title: "English" },
];

function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <Switch
      label={t("언어")}
      value={language}
      options={LANGUAGE_OPTIONS}
      onChange={setLanguage}
    />
  );
}

function ThemeSwitch() {
  const t = useT();
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <Switch
      label={t("테마")}
      value={theme}
      options={[
        { id: "light", label: t("라이트"), title: t("라이트") },
        { id: "dark", label: t("다크"), title: t("다크") },
      ]}
      onChange={(next) => {
        writeTheme(next);
        setTheme(next);
      }}
    />
  );
}

const NAVIGATION: ReadonlyArray<{ id: AppView; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "traces", label: "Traces" },
  { id: "scores", label: "Scores" },
  { id: "queues", label: "Queues" },
  { id: "evaluate", label: "Evaluate" },
  { id: "settings", label: "Settings" },
];

const EVALUATE_SEGMENTS: ReadonlyArray<{
  id: EvaluateSection;
  label: string;
}> = [
  { id: "examples", label: "Examples" },
  { id: "experiments", label: "Experiments" },
];

/** Provider는 App 안에 둔다. test가 <App />을 직접 render하기 때문이다. */
export function App() {
  return (
    <LanguageProvider>
      <AppShell />
    </LanguageProvider>
  );
}

function AppShell() {
  const t = useT();
  const [urlState, setUrlState] = useState<AppUrlState>(() =>
    readAppUrlState(),
  );

  useEffect(() => {
    const restore = () => setUrlState(readAppUrlState());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const commit = useCallback((next: AppUrlState) => {
    setUrlState(next);
    replaceAppUrlState(next);
  }, []);

  const selectView = useCallback((view: AppView) => {
    setUrlState((current) => {
      const next = {
        ...current,
        view,
        traceId: view === "traces" ? current.traceId : null,
      };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const selectSection = useCallback((section: EvaluateSection) => {
    setUrlState((current) => {
      const next = { ...current, section };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const setOverview = useCallback((overview: OverviewUrlState) => {
    setUrlState((current) => {
      const next = { ...current, overview };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const setEvaluation = useCallback((evaluation: EvaluationUrlState) => {
    setUrlState((current) => {
      const next = { ...current, evaluation };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const openTrace = useCallback((traceId: string) => {
    setUrlState((current) => {
      const next = { ...current, view: "traces" as const, traceId };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const openOverviewTrace = useCallback((traceId: string) => {
    setUrlState((current) => {
      const next = { ...current, traceId };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  const closeOverviewTrace = useCallback(() => {
    setUrlState((current) => {
      const next = { ...current, traceId: null };
      replaceAppUrlState(next);
      return next;
    });
  }, []);

  return (
    <div className={`lf-shell surface-${urlState.view}`}>
      <a className="lf-skip" href="#lf-main">
        {t("본문으로 건너뛰기")}
      </a>
      <header className="lf-topbar">
        {/* 기본 진입이 Overview로 바뀌었다. 로고는 그 집으로 돌아간다. */}
        <button
          className="lf-brand"
          type="button"
          onClick={() => selectView("overview")}
          aria-label={`${APP_TITLE} Overview 열기`}
        >
          <img className="lf-mark" src={logo} alt="" aria-hidden="true" />
          <span className="lf-wordmark">{APP_TITLE}</span>
        </button>
        <nav className="lf-nav" aria-label={t("주요 영역")}>
          {NAVIGATION.map((item) => (
            <button
              className="lf-nav-link"
              key={item.id}
              type="button"
              aria-current={urlState.view === item.id ? "page" : undefined}
              onClick={() => selectView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <span className="lf-topbar-spacer" />
        <LanguageSwitch />
        <ThemeSwitch />
      </header>

      {urlState.view === "overview" ? (
        <>
          <OverviewView
            state={urlState.overview}
            onChange={setOverview}
            selectedTraceId={urlState.traceId}
            onOpenTrace={openOverviewTrace}
          />
          <OverviewTraceDrawer
            selectedTraceId={urlState.traceId}
            onClose={closeOverviewTrace}
          />
        </>
      ) : null}
      {urlState.view === "traces" ? (
        <TracesView
          selectedTraceId={urlState.traceId}
          onSelectTrace={openTrace}
          onClearTrace={() => commit({ ...urlState, traceId: null })}
        />
      ) : null}
      {urlState.view === "evaluate" ? (
        <>
          <nav className="lf-segments" aria-label="Evaluate">
            {EVALUATE_SEGMENTS.map((segment) => (
              <button
                className="lf-segment"
                key={segment.id}
                type="button"
                aria-current={
                  urlState.section === segment.id ? "page" : undefined
                }
                onClick={() => selectSection(segment.id)}
              >
                {segment.label}
              </button>
            ))}
          </nav>
          <EvaluationView
            section={urlState.section}
            state={urlState.evaluation}
            onChange={setEvaluation}
            onSection={selectSection}
          />
        </>
      ) : null}
      {urlState.view === "queues" ? <QueuesView /> : null}
      {urlState.view === "scores" ? <ScoresView /> : null}
      {urlState.view === "settings" ? (
        <LocalDataView
          onReset={() => commit({ ...urlState, view: "traces", traceId: null })}
        />
      ) : null}
    </div>
  );
}
