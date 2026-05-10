---
name: kozutsumi-html-design-doc
description: 複雑な設計トピックを「上から下に読み下す単一 HTML ドキュメント」として `docs/views/` に書く運用。milestone 計画 / 設計コンセプト explainer / 機能仕様 explainer の 3 用途。stock の正は ADR (markdown) で、HTML はそこに収まらない人間用ビューに限る。raw.githack 経由で配信。
when_to_use: |
  - ADR / Issue 群が分散していて全体像が頭に入らない、1 枚で見通したい
  - milestone 計画の options / trade-offs / risks / open questions を一気に展開したい
  - 抽象的な設計コンセプトを比喩・対比・図で説明したい
  - 機能の挙動を TL;DR → 実装 → 注意点 → FAQ で段階的に explain したい
  - `docs/views/` 配下の HTML を書く / 編集する
  - 「設計書を読み下したい」「全体像を 1 枚にまとめたい」「思考の場が欲しい」「raw.githack で開きたい」が出た
---

# kozutsumi HTML 設計書ドキュメント運用

このリポジトリでは、ADR (markdown) を stock の正としつつ、
**ADR 群を読み下すのが大変**な複雑トピック（milestone 計画 / 設計コンセプト / 機能仕様）について、
**人間が 1 枚を上から下に読み下して頭に入れる用の HTML ビュー**を `docs/views/` に置く。

stock = ADR。HTML は **思考の場 + 読み下し用ビュー**。AI ではなく人間のための表現形式。
配信は **[raw.githack.com](https://raw.githack.com/) 経由** — アプリ本体に組み込まず、
GitHub の raw ファイルを正しい Content-Type で返してくれる CDN プロキシで素のまま開く。
push するだけでスマホからも URL でアクセスできる。

---

## 1. HTML と ADR の役割分担（最重要）

| 形式 | 役割 | 寿命 | 読み手 |
|---|---|---|---|
| **ADR** (`docs/adr/NNNN-*.md`) | **stock の正**。1 判断 = 1 ファイル | 長期。supersede されるまで | AI + 人間 |
| **HTML view** (`docs/views/*.html`) | **人間用ビュー**。思考の場 / 全体像の読み下し | 中期。議論が落ち着くまで or アーカイブ | 人間 |

**HTML に書いてはいけないこと**:

- 単独で完結する設計判断（→ ADR 1 本に切り出す）
- パラメータ / 実装詳細（→ コードの constant or issue 本文）
- 機能仕様の決定（→ コードが仕様）

**HTML に書いてよいこと**:

- 複数 ADR を横断する議論の流れ（problem → options → decision → consequences の連なり）
- 図解で初めて伝わる構造（データフロー / 状態遷移 / コンポーネント関係）
- 抽象概念の比喩・対比による説明（テキストだけでは頭に入らないもの）
- milestone 全体の見取り図（マイルストーン × リスク × open questions）

---

## 2. いつ書くか（トリガー）

### Trigger A: milestone 計画の思考の場として

milestone を切る前に、議論の全景を 1 枚に展開したい時。

ワークフロー:
1. 本 skill で `docs/views/<topic>-plan.html` を起こし、options / trade-offs / decision / risks / open questions を書く
2. 議論が固まったら **「Decision」セクションの各判断を `kozutsumi-adr` skill で個別 ADR に distill する**
3. ADR 起票後、HTML 内の Decision セクションは ADR への参照リンクに置き換える（重複させない）
4. `kozutsumi-flow` skill で Milestone + issue を起票
5. HTML はアーカイブとして残す（誰がいつ何を考えたかの履歴になる）

### Trigger B: 設計コンセプト explainer

「なぜこのアーキにするか」を抽象的に説明したい時。比喩 / 対比 / 図が要る時。

例: 「行動パターン分析の学習ループ」「ユーザー意図と AI 提案の責任境界」のような、
ADR 1 本では伝わらない概念。

### Trigger C: 機能仕様 explainer

複雑な機能の挙動（リクエスト経路 / 状態遷移 / 設定方法 / 注意点）を新メンバー視点で explain したい時。
コードを読めば分かるが、**最初に全体像を頭に入れたい**人向け。

### 書かない判断

以下のケースでは HTML を書かない:

- 1 判断で完結する設計トピック → ADR 1 本で十分
- 機能の小さな挙動説明 → コードコメント or PR 本文で十分
- フロー作業 (issue 起票 / PR 作成) → `kozutsumi-flow` で十分

**「ADR や issue の本文に収まらないか？」を最初に問う**。収まるなら HTML は書かない。

---

## 3. ファイル配置と命名

```
docs/views/<kebab-title>.html
```

- **配置**: `docs/views/` 直下にフラットに置く（用途別サブディレクトリは作らない）
- **命名**: `<kebab-title>.html`。日付プレフィックスや通し番号は付けない（HTML は stock ではないので時系列管理しない）
- **タイトル例**:
  - `phase-2-calendar-sync-plan.html`（milestone 計画）
  - `behavior-pattern-learning-loop.html`（コンセプト explainer）
  - `task-comment-feature.html`（機能 explainer）

更新時はファイルを上書き。古い議論を残したい場合のみ `<kebab-title>-v1.html` のように suffix を付ける。

### 閲覧手順 (raw.githack 経由)

1. ブランチに push する
2. URL を組み立てる:
   ```
   https://raw.githack.com/y-oga-819/kozutsumi/<branch-name>/docs/views/<file>.html
   ```
   例: `https://raw.githack.com/y-oga-819/kozutsumi/claude/foo-W8Ra0/docs/views/phase-2-calendar-sync-plan.html`
3. スマホでもデスクトップでも URL 直叩きで開ける（認証なし、即時反映 / cache 1 分）
4. push 後、commit message か PR description に **生成された raw.githack URL を 1 行残す** と
   人間が再度開きたい時に探さずに済む

公開範囲: branch 名の hash (`claude/...-W8Ra0`) が URL に入るため第三者が辿り着く可能性は実質ゼロ。
検索 index は `template.html` の `<meta name="robots" content="noindex, nofollow">` で除外済み。

### PR マージ前に HTML を削除する

HTML view は **PR の作業期間中だけ存在する一時的なビュー**として扱う。main には残さない。

```
1. ブランチで docs/views/<kebab>.html を作る → push → raw.githack URL で読む
2. 議論が固まる → Decision を ADR に distill (kozutsumi-adr skill)
3. PR をマージ準備するタイミングで docs/views/<kebab>.html を削除する commit を追加
4. PR マージ → main には HTML が残らない
```

理由:
- Claude が自動で push するワークフローでは、誤って個人情報 / 内部情報を含めるリスクがある
- main の git history に永続するのは避けたい（public repo なのでログ全文も公開される）
- そもそも HTML は「議論の場」なので、議論が ADR に落ちたら役目は終わり

履歴を残したい場合: PR description / commit message に key insight を要約として残す。

---

## 4. 論理構造 — 上から下に読み下す

すべての HTML は **問題提起 → 文脈 → 選択肢 → 決定 → 詳細 → 残り課題** の順で書く。
読者がスクロールしながら「抽象 → 具体」「Why → What → How」と段階的に理解できるようにする。

### 共通スケルトン

```
1. Eyebrow + H1 + 一行サマリー    （これは何の文書か）
2. TL;DR ボックス                （3〜5 行で結論）
3. Why now / 問題提起            （なぜ今これを考えるか）
4. Context / 制約                （前提・現状・関連 ADR）
5. Body（用途別、§5 参照）
6. Risks & Mitigations           （何が壊れうるか）
7. Open Questions                （未決定 + decide-with）
8. Related                       （関連 ADR / Issue / PR / 外部リンク）
```

各セクションは `<section>` タグで囲い、`.sec-head` に番号 + 見出しを置く。

---

## 5. 用途別の Body 構造

### 5.1 Plan（milestone / 実装計画）

```
5a. Options explored          （検討した道、3〜5 案）
5b. Trade-offs                （対比表で軸別比較）
5c. Decision                  （選んだ案 + ADR への参照）
5d. Mechanism                 （SVG フロー図でデータ / 制御の流れ）
5e. Milestones                （タイムラインで段階分割）
```

Decision には **必ず ADR への参照リンクを置く**（HTML 単独で判断を確定させない）。

### 5.2 Concept explainer（設計コンセプト）

```
5a. Metaphor                  （比喩 1 つで掴ませる）
5b. Mechanism                 （動く図 / SVG / 対話的デモ）
5c. Compare                   （既存パターンとの対比表）
5d. Where it lives in kozutsumi （実際のどこに現れるか）
```

抽象から具体へ。最初は「これは○○のようなものだ」、最後は「コードのこの関数に当たる」。

### 5.3 Feature explainer（機能仕様）

```
5a. Request path / 状態遷移   （4〜6 ステップで処理経路）
5b. Configuration             （タブで設定例 + 実装例 + 期待値）
5c. Gotchas                   （予期しない挙動の警告）
5d. FAQ                       （<dl> で Q&A）
```

「コードを読めば分かる」を前提に、**最初に全体像を頭に入れる用**として書く。

---

## 6. デザイントークン（共通）

すべての HTML view は `template.html` の `<style>` をコピーして始める。
カラー / フォント / spacing は統一し、文書間で違和感なく行き来できるようにする。

| トークン | 値 | 用途 |
|---|---|---|
| `--ivory` | `#FAF9F5` | 背景 |
| `--paper` | `#FFFFFF` | カード |
| `--slate` | `#141413` | テキスト主色 |
| `--clay` | `#D97757` | アクセント / 強調 / 警告 |
| `--olive` | `#788C5D` | 成功 / done |
| `--oat` | `#E3DACC` | セカンダリ背景 |
| `--g100`〜`--g700` | グレー段階 | 階層化 |
| `--serif` | `ui-serif, Georgia` | 見出し |
| `--sans` | `system-ui` | 本文 |
| `--mono` | `ui-monospace` | コード / メタ |

`template.html` をコピーして使うこと。CDN / 外部 CSS / フレームワークは使わない（self-contained 単一ファイル）。

---

## 7. コンポーネント

組み立てパーツの一覧と実物レンダリング・コピペ用 snippet は `components.html` にある。
**書き始める前に必ず `components.html` を開いて、何が用意されているか確認する**。
ここに無いコンポーネントを新規追加する場合は `components.html` にも catalog item を追加すること
（次に書く人が迷わないため）。

### コード例（15 Code example / 16 Diff）の扱い

「コードを読めば分かる」が原則だが、以下のいずれかに該当する時は HTML 内に直接コードを貼ってよい:

- **自然言語よりコードの方が短く正確に記述できる** — 型定義 / 設定値 / API シグネチャ / 1 行の式など
- **Before → After の diff で挙動の変化を見せたい** — 自然言語で「こう変わる」と書くより diff のほうが本質
- **設計判断の根拠が「この行でこうしている」という具体性に依存する** — どの一行が判断の核なのかを示す

逆に書かない:

- 関数全体の引用 / 実装詳細 — Related の GitHub URL リンクに逃がす
- コードを読めば分かる挙動の説明 — コードコメント or Issue 本文で十分

スタイルは `components.html` の **15 Code example** (`pre.code` + `.kw / .str / .cm / .fn`) と
**16 Diff** (`.diff` + `.diff-row.add / .del / .ctx / .hunk`) を流用する。

---

## 8. 関連 ADR / Issue の参照ルール

HTML 内で ADR / Issue / PR を参照する時は **GitHub の絶対 URL を使う**。
HTML は raw.githack ドメイン上で開かれるため、`../adr/...md` への相対リンクは
raw text として配信されて読みづらい（GitHub 上で見れば markdown プレビュー付きで読める）。

- **ADR**: `https://github.com/y-oga-819/kozutsumi/blob/main/docs/adr/NNNN-*.md`
- **Issue / PR**: `https://github.com/y-oga-819/kozutsumi/issues/N` / `pull/N`
- **コード**: `https://github.com/y-oga-819/kozutsumi/blob/main/src/path/to/file.ts#LNN`
  （長期参照したい場合は SHA 固定 `blob/<sha>/...`）
- **行番号のテキスト表記**: `src/path/to/file.ts:42` のように本文中の参照は ASCII で残す
  （IDE で grep しやすくするため）

冒頭の Context セクションと末尾の Related セクションで明示する。

---

## 9. 書き終えた時のセルフチェック

- [ ] 上から下に読んだ時、抽象 → 具体 / Why → What → How になっているか
- [ ] Decision セクションの各判断は ADR に distill されているか（or distill 予定が明記されているか）
- [ ] HTML だけで設計判断を確定させていないか（ADR が正）
- [ ] パラメータ / 実装詳細が紛れ込んでいないか（コード or issue 本文に逃がす）
- [ ] Related セクションに関連 ADR / Issue を列挙したか
- [ ] **PR マージ前**: `docs/views/<kebab>.html` を削除する commit を追加したか (§3 参照)

---

## 10. 関連する skill

- **`kozutsumi-adr`** — 確定した設計判断を ADR に切り出す。HTML の Decision を distill する時に invoke する。
- **`kozutsumi-flow`** — Milestone + issue 起票。HTML で計画が固まった後の flow 化で invoke する。
- **`kozutsumi-frontend-a11y`** — アプリ本体の React component を書く時の skill。本 skill は **`docs/views/` の静的 HTML 専用** で、アプリには組み込まないため a11y skill のスコープ外。
