# ADR 0051: 大量分解時の進捗バーは平行四辺形 segment を固定幅 + wrap で表示する

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: `docs/design/vision.md` / Issue #166 / [ADR 0016](./0016-stack-view-decomposition-children-only.md) §5 (partial supersede) / [ADR 0049](./0049-remove-ai-decompose-children-count-limit.md)

## Context

[ADR 0049](./0049-remove-ai-decompose-children-count-limit.md) で AI 分解の件数上限 (`MIN_CHILDREN` / `MAX_CHILDREN`) を撤廃し、章立てのある本 / 複数手順タスク / 旅程など数十件規模の分解が現実的に発生するようになった。

これにより [ADR 0016](./0016-stack-view-decomposition-children-only.md) §5 で決めた進捗バー (`ParallelogramProgress`) の振る舞い「セグメント幅は子数に応じて 3 段階で自動縮小 (~5 / ~9 / 10+)、10 子でも 480px に収まる」が破綻する。N=18 / 38 / 60 などのケースで、モバイル幅 (max-w-[480px]) のカード内で segment が container を溢れる。

issue #166 で次の表示戦略を検討した:

- **案 X (auto-fit + 数字併記)**: 全件 segment を `width: calc((100% - 3px*(N-1)) / N)` で auto-fit + 末尾に `12 / 38` を併記。N=38 で segment が ~5px まで縮み、平行四辺形の skew が視認できなくなる。「平行四辺形を横に潰してメモリみたいにするのはイメージと違う」というフィードバック。
- **案 Y (auto-fit のみ)**: 案 X から数字を外す。N が大きいときに「あと何件」が読み取れない。
- **案 Z (10件チャンクの展開モード)**: 完了 / 未完了の chunk は「大きい平行四辺形 1 個」に集約、現在 chunk のみ 10 個に展開。情報密度は高いが「現在 chunk 以外の進捗」が大きい平行四辺形 1 個に潰れて、子の境界感が失われる。
- **案 V (折り返し / wrap)**: segment の固定幅は維持したまま、container を超えたら次の行に折り返す。平行四辺形の視認性が N によらず保たれる。

Vercel preview (`/preview/parallelogram`) で 5 種を実機比較した結果、**案 V (wrap)** を採用する。

## Decision

進捗バーの大量分解時挙動を以下に変更する:

- segment 幅は **N に依存せず固定** (md=12px / sm=8px、ADR 0016 §5 の 3 段階自動縮小は廃止)
- bar に **size ごとの max-width** を設定し、`flex-wrap` で次の行に折り返す。1 行に並ぶ件数は size ごとの定数 (md=15 件 / sm=10 件) で決まる。container がこれより狭い場合は container 幅でさらに早く折り返す
- 完了 / 現在 / 未完了の塗り分け、a11y 属性 (`role="progressbar"` / `aria-valuenow` / `aria-label="進捗 X/N、現在 M/N"`) は ADR 0016 §5 のまま継続
- 数字併記は **しない** (ADR 0016 §5 の「数字併記の重複を避ける」方針を継続)

ADR 0016 §5 のうち「セグメント幅は子数に応じて 3 段階で自動縮小 (~5 / ~9 / 10+)、10 子でも 480px に収まる」の段だけを本 ADR で **partial supersede** する。それ以外の §5 (セグメント数 = 親の全子数 / 完了・現在・未完了の塗り分け / a11y 仕様) はそのまま有効。

## Consequences

### 肯定的影響

- **平行四辺形の視認性が N によらず一定**。N=8 でも N=38 でも 1 segment あたりの大きさが同じで、「子の完了境界」「自分の番」が常に同じ密度感で読める。
- **数字併記を新たに導入する必要がない**。ADR 0016 §5 の「数字併記の重複を避ける」設計思想が維持される。
- **実装変更が最小**。`segmentSize` の 3 段階縮小ロジックを削除し、container に `flex-wrap` を足すだけ。a11y / API は変えなくてよいので既存の 3 callers (TopTaskCard / TaskRow / DoneList) と既存テストが無修正で通る。
- **モバイル幅で破綻しない**。container 幅が 280px であっても segment が wrap して縦に積まれるので、横方向の overflow が起きない。

### 否定的影響・トレードオフ

- **進捗エリアの高さが N で変動する**。N=8 なら 1 行、N=38 なら 3〜4 行になる。TopTaskCard 下ゾーンや TaskRow Row 3 / DoneList Row 2 の縦寸が可変になる (周辺レイアウトの flex/grid 設計次第で許容)。
- **「あと何件」を一目で読み取りづらい**。segment 数を目視で数える必要がある。aria-label には正確な数が入るので screen reader は OK だが、視覚的な数値補助は無い。
- **N が極端に大きい (例: N=100+) と wrap が散らかる**。実用上は AI 分解で N=100 を超えるケースは稀と想定して受容するが、出てきたら別 ADR で再検討する。

## Alternatives considered

- **案 X (auto-fit + 数字併記)** → 不採用。N=38 で 1 segment ~5px まで縮み平行四辺形の skew が視認できなくなり「メモリのよう」になる。`ParallelogramProgress` の象徴性 (= 子の境界 + 自分の番を skewX で示す) が失われる。
- **案 Y (auto-fit のみ)** → 不採用。X と同じ視認性問題に加え、「あと何件」が読めなくなる。
- **案 Z (10件チャンクの展開モード)** → 不採用。情報密度は高いが、現在 chunk 以外の進捗を「大きい平行四辺形 1 個」に潰すため子の境界感が失われる。展開 / 集約のルール (現在 chunk のみ展開する vs 完了 chunk もすべて展開する等) で表現の一貫性が崩れやすい。
- **現状維持 + container 側で hidden / overflow 抑制** → 不採用。N>10 のときに segment が物理的に消えるか溢れるかの二択になり、進捗が読めなくなる。

## Notes

- 実装パラメータ (固定 segment 幅 12px / 8px、gap 3px、segment height 8px / 5px、1 行あたり最大件数 md=15 / sm=10 等) は ADR ではなく code の constant として置く。
- N=100 を超える分解が現実的に発生するケースが観測されたら、その時点で本 ADR を見直す (chunking や階層表示の検討)。
- 関連 issue: #166 (本判断の起票元) / #215 + ADR 0049 (件数上限撤廃)
- preview ページ (`src/app/preview/parallelogram/page.tsx`) は本実装の PR で削除する。
- ADR 0016 §5 の「3 段階で自動縮小」段は本 ADR で部分的に置き換わる。ADR 0016 全体の Status は `Accepted` のまま、Notes に partial supersede の旨を追記する。
