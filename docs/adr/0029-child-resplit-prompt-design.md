# ADR 0029: 子の再分解 prompt は既存 buildDecomposePrompt を siblings 引数で拡張する

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related**: [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0022](./0022-task-category-labeling-per-generation-path.md) / [ADR 0027](./0027-child-resplit-flatten.md) / Issue #121

## Context

ADR 0027 で「子を再分解した結果を flatten で同じ親の子として配置する」と決めた。実装上、AI に渡す prompt をどう設計するかが論点になる。

選択肢:

- (A) 既存 `buildDecomposePrompt` を拡張して兄弟 title を渡す
- (B) 再分解専用の `buildResplitPrompt` を新設する
- (C) prompt は同じ、再分解時も親分解と同じ prompt を流用する

体験品質の論点として「再分解の結果が他の兄弟と粒度が乖離するリスク」がある。例えば兄弟が `["導入部の構成を決める (10min)", "本文を書く (30min)", "最終確認 (5min)"]` のとき、「本文を書く」を再分解すると、b1/b2/b3 の粒度が他の兄弟と揃う必要がある。AI 側で兄弟文脈を把握できなければ、ばらつきが発生する。

ただし「兄弟 title を渡したからといって本当に粒度が揃うか」は AI の挙動依存。事前に断定できないので、実装時にプロトタイプ検証する余地を残しておく必要がある。

## Decision

既存の **`buildDecomposePrompt` を拡張** し、`DecomposeInput` 型に **`siblings?: string[]` を optional 追加** する。再分解時のみ兄弟 title を配列で渡し、prompt 内で「以下の兄弟タスクと粒度を合わせること」のセクションを差し込む。新規分解時は `siblings` を渡さず、prompt は現状と同等になる。

### 1. 型シグネチャ拡張

```ts
// 改修後
type DecomposeInput = {
  title: string;
  body: string;
  estimatedMinutes: number | null;
  siblings?: string[]; // 再分解時のみ。削除対象自身は含まない兄弟 title
};
```

### 2. prompt の差分

`siblings?.length > 0` のとき、既存 prompt の「# 親タスク」セクションの後に「# 既存の兄弟タスク (これらと同じ粒度感で分解する)」セクションを挿入し、各 title を `- ${title}` 形式で listing する。

`siblings` が undefined / 空配列のときは section を挿入しない (= 現状の prompt と完全に同一)。

### 3. parser は変更しない

`parseDecomposeResponse` は出力形式 (JSON 配列) を変えないため変更不要。

### 4. プロトタイプ検証の余地

実装フェーズ (Phase 3) で「兄弟あり / なしで AI 応答の粒度がどう変わるか」をプロトタイプで定性評価する。改善が見られない場合は **`siblings` interface は残しつつ、再分解時に渡さない** 選択肢を許容する (実装定数として `RESPLIT_PASSES_SIBLINGS = false` 等で切り替え可能にする)。

## Consequences

### 肯定的影響

- **prompt の 90% を共有できる**。新規分解と再分解で出力契約 (ADR 0017 / 0022 の MIN_CHILDREN / MAX_CHILDREN / 子タイトルの自立性等) を維持しやすい
- **ユニットテストもまとめられる**。`buildDecomposePrompt` のテストに siblings 分岐を追加するだけで、別関数のテスト体系を作らない
- **プロトタイプ検証が同じ関数で踏める**。siblings あり / なしを引数で切り替えるだけなので比較が容易
- **新規分解には影響ゼロ**。`siblings` は optional なので既存呼び出し側は変更不要

### 否定的影響・トレードオフ

- **関数の責務がやや複雑になる**。オプション引数で挙動が変わるため、関数の cognitive load が上がる
- **prompt の差分箇所が増える**。`siblings?.length > 0` 分岐の中で section を挿入するので、prompt 構築ロジックの読みづらさがやや増える
- **「兄弟ありが粒度を改善する」を事前に保証できない**。AI の挙動依存なので、プロトタイプ検証を実装フェーズで踏む必要がある (検証問いとして要求定義に明記済み)
- **AI 呼び出しの token 消費がわずかに増える**。siblings の title 数 × 平均 title 長 ぶん。MAX_CHILDREN=7 / 平均 title 30 文字なら最大 210 文字程度で許容範囲

## Alternatives considered

- **新 `buildResplitPrompt` 関数を分離**:
  - 関数の責務が明確
  - prompt の 90% を 2 箇所に同期維持する保守コスト
  - 出力契約 (MIN_CHILDREN / MAX_CHILDREN / category 値域 / parser 期待形式) を 2 箇所で揃え続ける必要がある
  - ユニットテストも 2 系統に分かれる
  - **不採用**

- **prompt は同じ、siblings を渡さない (現状の `buildDecomposePrompt` をそのまま再利用)**:
  - 最もシンプル
  - 兄弟との粒度ばらつきリスクが残る
  - プロトタイプ検証の機会が消える
  - **不採用**。検証の余地を残しつつ、改善しない場合に「siblings を渡さない」選択を実装定数で取れる本 ADR の方が柔軟

- **AI を介さずヒューリスティックに分割**:
  - kozutsumi の差別化 (vision §「差別化の核」) は AI による意味的理解。ヒューリスティックでは粒度判断ができない
  - ADR 0013 (AI as augmentation only) の augmentation の意義が薄れる
  - **不採用**

## Notes

- プロトタイプ検証で「siblings ありが粒度を改善する」が確認できた場合、`RESPLIT_PASSES_SIBLINGS = true` のまま本実装。改善が見られない場合は `false` で interface だけ残す。どちらにせよ DB / API の変更は無いので、実装後の切り替えコストは低い
- siblings の order は `stack_order` 昇順で渡す (= Stack View 上での表示順と一致)。これにより AI が「直前の兄弟」「直後の兄弟」の粒度感を取りやすくする想定 (実装パラメータ)
- 兄弟 title の取得タイミングは `resplitChildTask` 冒頭の DB fetch 内で実施する。partial failure (兄弟 fetch エラー) でも空配列で続行し、AI 呼び出しを止めない (フェイルソフト、ADR 0013 と整合)
- 本 ADR を supersede する trigger:
  - **siblings を渡しても粒度が改善しない / 悪化する**現象が観測され、prompt 設計を別方針 (例えば構造化された context、few-shot example) に切り替える
  - **再分解専用の prompt 構造が必要になる** (例: 元の子が `task_started` で着手痕跡があるケースで、進捗を考慮した再分解を求めたい等)
  - **AI モデルの変更** (Gemini 以外 / 別モデル) で prompt 形式が大きく変わる場合
- 本 ADR は「prompt の siblings 拡張」のみを決める。flatten 方針は ADR 0027、stack_order は ADR 0028、action_log は ADR 0030 で別途記録する
