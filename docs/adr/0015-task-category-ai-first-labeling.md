# ADR 0015: `task_category` は AI が初期ラベル、人間は override で暗黙的フィードバック

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/architecture.md` §1.5 / §1.7 / [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0013](./0013-ai-as-augmentation-only.md)

## Context

`docs/design/architecture.md` §1.5 の見積もり補正エンジンは「タスク種類別の補正倍率」を入力にしている（コーディング系 0.8 倍 / ドキュメント系 2.2 倍 / 調査系ばらつき大）。同 §1.6 の行動パターン分析も「タスクの種類ごと」の集計を前提にしている。

つまり Phase 3 / 4 のコア機能はタスクに **種類分類軸** が必要。現状の `tasks` schema には対応カラムがない。

入力主体の選択肢:

1. **人間がタスク作成時に必須選択**: dropdown で必ず選ばせる。
2. **人間が任意選択**: 入れたい人だけ入れる。
3. **AI が初期ラベル付け、人間は override**: AI が分類、気に入らなければ後から修正。

vision (`docs/design/vision.md`) は「AI を育てている自覚を持たせない」「普通に便利だから使っていたら、いつの間にか提案精度が上がっている」体験を狙っている。`docs/design/architecture.md` §1.7 は暗黙的フィードバックを核に据えている: 「AI が分解した結果はそのままスタックに挿入される。承認ステップは挟まない。ユーザーの操作が暗黙的にフィードバックされ、分解の精度が上がっていく」。

タスク分類はこのパターンとぴったり一致する。ラベリング自体に判断負荷を乗せる必要はない。

## Decision

1. `tasks` テーブルに **`task_category`** カラムを追加する（Phase 3 着手時の migration で）。
2. 入力主体は **AI（Gemini, ADR 0012）が default**。タスク作成時に AI が初期ラベルを付ける。
3. **人間は override のみ**。タスク詳細パネルで category を変更できる UI を持つ。AddPanel には category 入力を出さない（暗黙的フィードバック §1.7 の方針）。
4. **override は `action_log` に記録する**。`task_category_changed` を新 ACTION_TYPE として追加し、`{ from, to }` を metadata に持つ（ADR 0001 の延長線）。これが Phase 3 / 4 のラベリング精度向上のための暗黙フィードバック源になる。
5. **既存タスクは null 許容**。Phase 3 着手時点で過去タスクは `task_category = null`。AI による backfill 戦略は別 issue。
6. **AI ラベリングが失敗した時は null のまま**（ADR 0013 の augmentation only 原則）。後続の補正エンジンは null タスクをグループ化対象から外す形で動く。

値域は初期として `coding` / `doc` / `research` / `admin` / `other` を想定するが、**値の追加・削除・名称変更は本 ADR の supersede ではない**（パラメータ扱い）。値域の運用は実装側で更新する。

## Consequences

### 肯定的影響

- **vision / architecture §1.7 と整合**。ユーザーの判断負荷が増えない。タスク追加体験が AI ありきにならない（ADR 0013 とも整合 — AI が落ちても null で通る）。
- **ラベリング精度の改善ループが自動で回る**。override の `action_log` がそのまま再学習データになる。Phase 4 の暗黙フィードバック設計に直結する。
- **後続機能（補正エンジン / 行動パターン分析）の入力が確保される**。null は除外、AI ラベル / human override は学習対象、で扱える。
- **Phase 3 着手時の migration が 1 本で済む**。「人手入力 UI を Phase 2.2 で先に入れる」案を捨てたので、二度手間が無くなる。

### 否定的影響・トレードオフ

- **Phase 3 で AI が乗るまで全タスク null**。補正エンジンが効かない期間が生じる（最低でも数週間〜数ヶ月の蓄積が必要）。これは Phase 3 の中で許容する（vision の 2 層モデルどおり、表層の価値だけで使い続ける期間）。
- **AI の初期ラベル品質が低いと override コストが user に乗る**。ただし暗黙的フィードバックなのでラベル直しの操作自体が学習データになり、相殺される設計。
- **タスク追加時に AI を必ず叩く設計だと、毎回 latency / quota を消費する**。non-blocking で扱う必要がある（fire-and-forget で後追い更新、ADR 0013 の augmentation 原則）。実装方針は別 issue。

## Alternatives considered

- **人間がタスク作成時に必須選択**: 短期的にラベル品質が一番高い。だが vision §「AI を育てている自覚を持たせない」と「普通に便利だから使う」体験に反する。タスク追加のたびに分類で迷わせるのは UX 上の摩擦が大きい。不採用。
- **人間が任意選択**: 大半が null になり蓄積が始まらない。補正エンジンが永遠に効かない。不採用。
- **AI ラベル + 承認ステップ（user が確認してから保存）**: architecture.md §1.7 の「承認ステップは挟まない」と矛盾する。AI 分解の方針と一貫させたい。不採用。
- **タスク種類軸を導入せず、AI が個別タスクごとに補正計算する**: グループ化ができないので「種類別の補正倍率」が求まらない。architecture.md §1.5 の前提を覆すので、本筋から外れる。不採用。
- **値域を完全にユーザー定義（自由記述タグ）**: 集計の安定性が崩れ、補正エンジン側でクラスタリングが必要になる。Phase 3 のスコープでは過剰。将来の選択肢として残す（次の見直し条件）。

## Notes

- 具体的な値域 (`coding` / `doc` / ...) や enum vs text + CHECK の選択は実装 issue で確定。値域の改訂は ADR ではなく code / migration で行う。
- `task_category_changed` の metadata schema 詳細は ADR 0001 の延長で実装側で確定。
- AI ラベリングを **同期 (タスク作成と一気通貫)** にするか **非同期 (作成後の後追い更新)** にするかは、ADR 0012 / 0013 の制約下で実装 issue が判断する（latency / 失敗時の体験のトレードオフ）。
- 将来 user 定義タグ（自由記述）を入れたくなったら本 ADR を見直す。supersede ではなく「補完軸」として共存できる可能性もあり、その時点で判断する。
- 既存タスクの backfill（過去のタスクに AI ラベルを付ける）は別 issue / 別判断。本 ADR では「null 許容で残す」までしか決めない。
