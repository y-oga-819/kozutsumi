# ADR 0037: TaskForm 統合 — body 欄追加と単一入口

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0021](./0021-ai-decomposition-failure-visibility.md) / [`docs/open-questions.md`](../open-questions.md) (秘書から相談モード)

## Context

[ADR-0036](./0036-simplify-task-registration-workflow.md) で「入力 IF は単一」を方針化した。具体仕様として、現状の TaskForm が抱える次の不整合を解消する必要がある:

- `src/features/add-forms/TaskForm.tsx` は title / project / 見積もり / 依存イベントのみで `body` 入力欄を持たない
- 一方で `buildDecomposePrompt` (`src/shared/ai/prompts/decompose.ts`) は body を文脈に渡す前提で書かれている
- 登録経路の AI 分解は body 抜きで実行されるため、「サービスレベルマネジメントをなぜやるのかの Notion を書いて公開する。内容はすでにスライドがあるので文書化する」のような構造化された依頼を表現できない
- 「分解依頼」「単発登録」を別 UI に分ける / トグルで切り替える案は ADR-0036 で棄却済み

## Decision

TaskForm を単一の入力経路として保ったまま、`body` 入力欄を追加する。

- `body` は任意の Markdown text area として TaskForm に追加する
- 「分解依頼」と「単発登録」を UI 上区別しない。書く情報量 (body) でのみ分解の入力が変わる
- 分解可否は AI 側で判定する。`parseDecomposeResponse` が 0/1 件を返したら `decompose_status='skipped'` ([ADR-0017](./0017-ai-task-decomposition-async.md) の既存経路を継続)
- 登録直後の無条件 `triggerDecompose` (`src/app/useDashboardMutations.ts:418`) は維持

## Consequences

### 肯定的影響

- 構造化された依頼 (body 数百文字以上) をそのまま `buildDecomposePrompt` に渡せるようになり、登録経路の分解品質が上がる
- ユーザーは「どの画面で何を書くか」を覚えなくてよい。`title + body` を一画面で書き切れる
- 将来「秘書から相談モード」を導入するとき、body をプロンプト / 対話起点に再利用でき、入口を増やさずに済む

### 否定的影響・トレードオフ

- 短文 + 単発タスクのユーザーには body 欄が「書かなければいけない欄」に見える摩擦が出うる。placeholder と任意表示で吸収する (実装側の関心)
- TaskForm の縦長化は `Stack` への即時遷移を遅らせる可能性がある。body 欄の折り畳み / 展開挙動は実装で詰める

## Alternatives considered

- **案A (分離 UI)**: 「分解依頼」と「単発登録」で画面を分ける → ADR-0036 で棄却済み
- **案B (トグル)**: 「これを分解依頼として送る」トグルを TaskForm に置く → ユーザーが毎回モード判定する負荷を増やす。分解可否の判定は AI に倒したほうが一貫する
- **案C (title に長文を許す)**: body を増やさず title に長文を書かせる → 一覧 / 行カード / Stack View での識別性が崩れる。棄却

## Notes

- body 欄の常時展開 / 折り畳み、placeholder の文言、Markdown プレビューの有無は実装の関心であり、本 ADR の判断ではない
- TaskDetailPanel 側の body 編集経路はそのまま残す
- 本 ADR の supersede trigger: 「分解依頼を別 UI に切り出す」と方針転換した場合のみ。body 欄の有無の話に閉じる
