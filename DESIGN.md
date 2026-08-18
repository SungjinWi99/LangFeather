# LangFeather Light Observatory — design reference

## Status

`web/src`의 구현이 승인된 visual source of truth다. 이 문서는 그 구현이 따르는
색·타이포·구조 결정을 기록한 참고 문서이며, 구현과 이 문서가 다르면 실제 동작하는
`web/src`를 기준으로 이 문서를 갱신한다.

과거 `design-explorations/v2/*-light.html` 여섯 화면(Overview, Traces, Annotation
Queues, Scores, Evaluation, Setting)을 출발점으로 만들었으나, 구현이 끝난 뒤 참고
목적을 다해 삭제했다. 새 화면을 추가하거나 크게 바꿀 때는 아래 원칙과 기존
`web/src/styles.css` token을 먼저 찾아 재사용한다.

## Visual thesis

LangFeather는 화려한 SaaS analytics가 아니라, 밝은 작업대 위에서 runtime evidence를
정밀하게 읽는 local debugging observatory다. 장식적인 dashboard card wall 대신
얇은 구분선, 밀도 높은 표, 넓게 이어지는 chart와 drawer 중심 workspace를 사용한다.

## Token 구조

`web/src/styles.css`의 token은 세 층이다. hex는 primitive 층에만 쓰고, component
규칙은 semantic 층만 참조한다. theme을 추가할 때는 semantic 층만 다시 정의한다.

```text
primitive  --c-teal-700: #1d6b74
semantic   --accent: var(--c-teal-700)
component  --radius: 10px
```

## Palette

brand는 logo의 청록에서 왔다. 원본은 `web/public/langfeather-mark.png`이며 상단바
mark와 favicon이 이 파일을 그대로 쓴다. path로 옮겨 그리면 형태가 어긋나므로
다시 그리지 않는다.
logo 색 `#2fabb9`는 흰 배경 대비가 2.75:1이라 mark에만 쓰고, text와 interaction에는
대비를 확보한 어두운 단계를 쓴다.

| 역할 | token | 값 | 흰 배경 대비 |
| --- | --- | --- | --- |
| page | `--page` | `#f4f7f8` | — |
| surface | `--surface` | `#ffffff` | — |
| surface alternate | `--surface-alt` | `#eef3f4` | — |
| table header | `--surface-head` | `#f9fbfb` | — |
| line | `--line` | `#dbe5e7` | — |
| strong line | `--strong` | `#c3d2d6` | — |
| ink | `--ink` | `#0f2129` | 16.54 |
| muted | `--muted` | `#4d6873` | 5.93 |
| quiet | `--quiet` | `#567480` | 4.99 |
| accent | `--accent` | `#1d6b74` | 6.16 |
| 제목 | `--ink-title` | `#12383d` | 12.66 |
| accent hover | `--accent-hover` | `#165157` | 8.94 |
| accent soft | `--accent-soft` | `#e4f2f4` | — |
| accent faint | `--accent-faint` | `#f0f7f8` | — |
| accent border | `--accent-border` | `#8fc0c7` | — |
| logo mark | `--accent-mark` | `#2fabb9` | 2.75 (mark 전용) |
| success | `--green` | `#0f7a52` | 5.35 |
| danger | `--red` | `#c0392f` | 5.43 |
| warning | `--orange` | `#9a6212` | 5.08 |
| llm tint | `--violet` | `#6b4fd8` | 5.62 |
| retriever tint | `--blue` | `#2c5c99` | 6.78 |

chart series는 `--series-1` `#258590`, `--series-2` `#5566d6`, `--series-3`
`#c07a10`, `--series-4` `#c94f7c`이며 전부 흰 배경 대비 3:1 이상이다.

text로 쓰는 색은 WCAG AA(4.5:1)를 만족하고 chart series는 3:1을 만족한다. 눈으로는
확인할 수 없으므로 `make check-contrast`가 `styles.css`의 token을 직접 읽어 계산한다.
색을 바꾸거나 theme을 추가하면 이 명령을 실행한다. 상태 색은 의미를 전달할 때만 쓴다.
선택 상태와 주요 작업은 `--selection-*`, `--primary`, `--on-primary` semantic token을
사용한다. light에서는 기존 accent를 가리키고 dark에서는 neutral slate를 가리킨다.
retriever tint를 accent와 다른 색으로 두는 이유는 선택 상태와 구분하기 위해서다.

## Theme

light와 dark 두 theme이 있다. dark는 `:root[data-theme="dark"]`에서 semantic 층만
다시 정의하고 component 규칙은 손대지 않는다. 이것이 3층 token 구조를 만든 이유다.

선택지도 `light`와 `dark` 둘뿐이라, localStorage `langfeather.theme`에 저장한 값이
그대로 `data-theme`에 들어간다. 해석 단계가 없다. 고른 적이 없을 때만
`prefers-color-scheme`으로 첫 값을 정한다. 계약은
`specs/web-interaction-contract.md`의 "client 저장 state"에 있다.

첫 paint 전에 theme을 정해야 번쩍이지 않으므로 `index.html`의 inline script가
`data-theme`을 붙인다. 첫 값 규칙이 `web/src/theme.ts`와 두 곳에 있으니 함께 고친다.

`color-scheme`을 두 theme 모두에 선언한다. scrollbar와 select 드롭다운처럼 CSS가
그리지 않는 native UI는 이것이 없으면 dark에서 흰색으로 남는다.

dark의 주요 값이다. 대비는 surface(`#26282c`) 기준이다.

바닥은 검정으로 내리지 않는다. page를 `#0b171b`까지 내렸을 때는 surface와의
차이도 card 경계도 눌려, 층이 있다는 것이 눈에 남지 않았다.

**dark의 중성색에는 brand 청록을 섞지 않는다.** light의 neutral은 청록 기운을
옅게 섞어 brand와 같은 계열에 두지만, dark에서 같은 채도를 쓰면 어두운 색이
훨씬 넓은 면적을 덮어 화면 전체에 청록기가 돈다. 남긴 5–7%는 청록이 아니라
아주 옅은 한기다 — 완전한 무채색은 청록 accent 옆에서 누렇게 읽힌다.
청록은 logo, chart series, 상태·종류 표식, keyboard focus처럼 작은 signal에만 남긴다.
화면 제목, 선택 면과 글자, 주요 버튼은 주변 surface와 조화되는 neutral slate를 쓴다.

| 역할 | 값 | 대비 |
| --- | --- | --- |
| page | `#1e2023` | — |
| surface | `#26282c` | — |
| line | `#43474d` | — |
| ink | `#ebedef` | 12.58 |
| muted | `#c9ccd1` | 9.17 |
| quiet | `#b0b4ba` | 7.09 |
| accent | `#a3d9e0` | 9.53 |
| success | `#5cc98f` | 7.18 |
| danger | `#f0837a` | 5.79 |
| warning | `#ddab4a` | 7.03 |

dark의 선택 상태는 `selection-ink #ebedef`, `selection-border #595e66`,
`selection-soft #33363b`, `selection-faint #2c2f33`이다. 주요 버튼은
`primary #c9ccd1` 위에 `on-primary #1e2023`을 쓴다. `make check-contrast`는 대비와
함께 이 token들의 saturation이 12% 이하인지 확인한다.

`make check-contrast`는 두 theme을 모두 계산한다. 색을 바꾸면 실행한다.

화면마다 token을 다르게 tint하던 `.surface-*` override는 제거했다. 같은 제품이
화면에 따라 다른 색과 다른 접근성 등급을 갖게 만들었기 때문이다. 다시 넣지 않는다.

## Typography

- UI: Pretendard, SF Pro Text, Inter, Apple SD Gothic Neo, system sans
- ID, JSON, timestamp, measurement: `ui-monospace` 우선. OS 기본 mono로 해석되므로
  별도 webfont를 bundle하지 않는다.
- body는 18px/1.45, page title 30px/700, section title 20px/700을 기본으로 한다.
- label과 table heading은 11–12px를 유지하며 과한 letter spacing을 쓰지 않는다.
- font-size는 11 / 12 / 13 / 14 / 15 / 16 / 18 / 20 / 24 / 30px만 쓰고,
  font-weight는 400과 700만 쓴다.

## Structure

- 상단 bar는 고정 높이의 wordmark와 여섯 navigation item(Overview / Traces /
  Scores / Queues / Evaluate / Settings), 그리고 오른쪽 끝에 언어와 theme 전환 control을 가진다.
  둘 다 값이 둘뿐이므로 select가 아니라 두 값을 나란히 보여주는 전환 control이고,
  고른 쪽으로 thumb가 미끄러진다. wordmark는 레퍼런스 로고의 비율을 따른다 —
  png의 투명 여백을 음수 여백으로 걷어내야 눈에 보이는 깃털을 기준으로 정렬된다. Evaluate
  안에서는 Examples / Experiments 세그먼트로 나누고, 그 아래에
  어느 dataset을 보고 있는지 알리는 context bar를 둔다. dataset 안에 다시 탭을
  두지 않는다 — 같은 여정이 두 겹으로 갈라진다.
- desktop content는 최대폭 없이 diagnostic evidence에 필요한 가로 공간을 사용한다.
- page header 아래에 filter/action strip을 두고, data surface는 불필요한 중첩 card 없이
  border로 구획한다.
- Traces는 넓은 화면(1200px 이상)에서 목록(280–360px) / 실행 graph / payload
  3분할이며, 목록은 표가 아니라 카드다 — 7열 표는 그 폭에 들어가지 않는다.
  카드는 상태 점, trace name, `시각 · 지연 · N obs`, trace ID 순으로 담고
  checkbox 선택은 그대로 남긴다. 카드마다 펼치기 control이 있어 input/output
  미리보기를 목록에서 바로 읽을 수 있고, 여러 카드를 동시에 펼 수 있다. 카드는
  스케치대로 두 줄이며(상태 점 + name, 메타) trace ID는 펼쳤을 때 나온다.
  카드 안은 선택 | 정보 | 펼치기 세 열이다. 셋이 각자 열을 가져야 name과 메타가
  같은 선에서 시작하고, 펼치기가 name 길이를 따라 흔들리지 않는다. 목록
  header는 30px 제목이 아니라 `TRACES · N` 한 줄이고, 필터는 접혀 있을 때
  검색 입력 하나만 남는다.
  선택 bulk action은 page header가 아니라 목록 안 선택 바에 둔다 — header에
  두면 280–360px 단에서 버튼 라벨이 세로로 쪼개지고 옆 pane에 가린다.
  목록을 접으면 48px 레일과 다시 펼 버튼만 남고, 폭이 240ms 동안 흐르는 동안
  내용은 흐려지며 잘려 나간다 — `display:none`은 폭이 줄기도 전에 단을 비워
  화면이 한 번 껌뻑였다. 두 단 사이에는 20px 고랑을 두고 오른쪽 단도 하나의 판으로
  그린다. 맞붙은 1px 선은 두 단이 한 덩어리인지 아닌지를 알려주지 못했다.
  3분할에서 두 단의 폭은 사용자가 조절하지 않는다 — 목록이 280–360px로 이미
  묶여 있어 조절할 여지가 없고, 경계에 걸린 handle은 무엇을 끄는지 알 수 없었다. 1200px 미만에서는 목록 단이 화면 전체를 쓰므로
  표로 돌아가 열 순서·폭·정렬을 계속 쓴다. graph와 payload는 1.154 : 1로 나눈다 — 축을 따라 갈라지는 형제
  노드가 잘리지 않으려면 실행 흐름이 더 넓어야 한다. 덮는 대신 자리를 나눈다. 이 제품은 dashboard가 아니라 debugger이고,
  디버깅은 목록과 상세를 계속 오가는 작업이다. 1200px 미만에서는 세 단을 하나씩
  보여주고 상단에 단 전환 control을 둔다 — 좁아도 덮지 않는다.
- review, experiment, dataset example detail은 오른쪽에서 슬라이드되는 drawer를
  쓴다. 기본폭은 화면마다 560–760px이고, 왼쪽 가장자리를 드래그해 420px에서
  1300px까지 사용자가 직접 조절할 수 있다. mobile에서는 viewport 전체를 사용한다.
- payload 검사기는 탭이다. kind 전용 뷰(`Retrieval`/`Messages`/`Tool`)가 첫 탭이고
  그 뒤로 `Input` `Output` `Error` `Metadata`가 온다. 탭 이름은 전부 API field
  이름이라 번역하지 않는다.
- 데이터 표는 checkbox 선택 + toolbar 기반 bulk action(Delete/Edit)으로
  일관되게 통일한다. 카드 형태로 나열하는 목록(dataset 카드 등)만 행마다
  `⋯` 메뉴를 쓴다.

## Components and state

- 간격은 2px 격자 위의 정수 px만 쓴다. border는 1px이다. radius는 기획서 03절대로 세 단계만 쓴다 —
  작은 control과 표식은 6px, 면(카드·패널·표·모달)은 10px, pill은 999px이다.
  원형 표식만 50%를 허용한다. 소수점 px를 새로 만들지 않는다.
- button, field, navigation item, 표의 선택 checkbox, header의 정렬 버튼은 모두
  44px touch target을 가지고, 명확한 border와 `:focus-visible` ring을 가진다.
  checkbox는 보이는 상자만 20px이고 클릭 영역이 44px이다. 이를 위해
  `appearance: none`으로 native 렌더링을 끄고 상자와 체크를 직접 그린다 —
  native checkbox는 보이는 크기와 hit area를 분리할 수 없기 때문이다.
- icon은 glyph 문자가 아니라 SVG로 그린다. glyph는 font fallback에 따라 굵기와
  정렬이 기기마다 달라진다. `components.tsx`의 `Icon` 계열을 재사용한다.
- pointer hover에서만 나타나는 control을 만들지 않는다. touch 기기에는 hover가
  없어서 기능 자체가 사라진다. 평소 낮은 대비로 두고 hover/focus에서 강조한다.
- shell 최상단에 본문으로 건너뛰는 skip link를 둔다. 각 화면의 `<main>`이
  `id="lf-main"`으로 그 착지점이 된다.
- loading, empty, error, disabled, pending mutation은 각 surface 안에서 같은 공간을
  점유해 layout jump를 줄인다.
- destructive action은 danger color만으로 의존하지 않고 영향 설명, 정확한 확인 입력,
  최종 confirmation을 제공한다.
- chart point와 graph node는 pointer와 keyboard 모두 선택할 수 있고 값이 accessible
  name에 포함된다.
- overlay가 닫히면 trigger로 focus를 복원한다.
- 표 header는 드래그로 순서를 바꿀 수 있고(가로축 이동만 허용, 다른 header가
  실시간으로 자리를 비켜준다), 오른쪽 경계를 드래그해 폭을 조절할 수 있으며,
  header의 정렬 아이콘으로 오름차순/내림차순/해제를 순환한다. 이 세 동작은
  `useReorderableColumns` 한 곳에서 구현해 모든 표가 같은 방식으로 동작한다.
- 20개를 넘는 목록(Traces, annotation queue의 trace 목록, dataset example
  목록)은 페이지당 20개로 나누고 이전/다음 버튼과 `N / M` 표시를 쓴다. 새
  검색이나 필터를 적용하면 1페이지로 돌아간다.

## Motion and interaction

- `prefers-reduced-motion`에서는 transform 기반 전환을 제거한다.
- Overview chart card는 drag handle과 keyboard 대체 control로 순서를 바꿀 수 있고,
  resize control로 크기를 조절한다.
- runtime graph는 root의 세로 중심선을 rachis로 그린다. 형제 노드가 어느 축에서
  갈라졌는지 보이게 하는 장식이며 pointer를 받지 않는다. viewport 안에 있어
  pan/zoom을 함께 따라간다.
- runtime graph는 실제 callback/dispatch evidence만 그리며 pan/zoom이 node selection을
  방해하지 않게 한다. 각 node header는 실행 순번과 kind를, body는 이름을, footer는
  상태와 latency를 보여준다.

## Responsive rules

- 긴 ID, trace name, JSON은 `min-width: 0`, wrapping 또는 내부 scroll로 처리하며 page
  자체의 가로 overflow를 만들지 않는다.
- 표는 `table-layout: fixed`와 열별 `overflow: hidden` + ellipsis로 좁은 열에서도
  다른 열을 침범하지 않는다.
