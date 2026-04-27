# ADR 0017: AI タスク分解は非同期で実行する (タスク追加は即時、結果は後追い)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §1.7 / [ADR 0012](./0012-ai-call-via-route-handler.md) / [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md)

## Context

Phase 3 で AI (Gemini, ADR 0012) によるタスク自動分解を入れる。タスク追加 (AddPanel から `tasks` 行を作る操作) と AI 分解呼び出しの timing には 2 案がある:

1. **同期**: タスク追加時に AI 分解を呼び、結果が返ってきてから 1 回で Stack に push する。ユーザーは「タスクを追加する」操作が完了すると Stack に細かい子が並んでいる状態を見る。
2. **非同期**: タスク追加で元タスクが即時 Stack に乗る。AI 分解は裏側で走り、返ってきたら Stack を後追いで更新する。

同期は「AddPanel を閉じた瞬間に分解結果が見える」分かりやすさがある一方、Gemini レイテンシ (1〜3s、長 prompt で Vercel 関数の 10s 上限近くまで届くこともある — ADR 0012) が直接 UX に乗る。AI 失敗時はタスク追加自体が遅延 / 失敗したように見える。

`docs/design/vision.md` は「AI を育てている自覚を持たせない / 普通に便利だから使っていたら、いつの間にか提案精度が上がっている」体験を狙う。`docs/design/architecture.md` §1.7 は「AI が分解した結果はそのままスタックに挿入される。承認ステップは挟まない」と暗黙的フィードバックを核に据える。

ADR 0013 で AI は augmentation only と決めており、core path (タスク CRUD / Stack 並び替え) は AI 失敗で止まらない不変条件がある。同期に倒すとこの境界が曖昧になる (タスク追加の体感成功条件が AI 成否に引きずられる)。

## Decision

タスク追加と AI 分解は **非同期** で実行する。

1. ユーザーが AddPanel でタスクを追加したら、**即座に元タスクを Stack に push する** (`tasks.parent_task_id = null` で 1 行)。
2. **AI 分解呼び出しは fire-and-forget で別 Route Handler (`/api/ai/decompose`) に投げる**。タスク追加トランザクションには含めない。
3. **分解結果が返ってきたら**、子タスクを `tasks` に挿入し、親タスクを `decomposed` 状態に更新する (具体的なフラグ列 / 状態管理は実装 issue)。Stack View は ADR 0016 の方針 (子のみ並ぶ) で勝手に再描画される。
4. **AI 失敗 / timeout / `AI_ENABLED=false` の場合は親が Stack に残るだけ**。ユーザー操作は止まらない (ADR 0013)。
5. **「AI 分解中」状態は status pill で示す**。黙ってバックグラウンドで走らせるが、進行中であることは UI で見せる (ADR 0013 の「黙って劣化」は失敗時の話で、成功への過程を示すのは別軸)。

## Consequences

### 肯定的影響

- **タスク追加の体感レイテンシが Gemini に依存しない**。core path が AI から独立する (ADR 0013 と整合)。
- **vision「気づいたら細かくなってる」と整合する**。「タスクを追加した直後にバラされる」という能動的体験ではなく、「あとで気づいたら細かくなっていた」という受動的体験になる。
- **失敗時の UX が単純**。AI 失敗 = 親がそのまま Stack に残るだけ。エラーリカバリ UI を作り込む必要がない。
- **e2e (ADR 0014) との整合**。`AI_ENABLED=false` なら fire-and-forget の呼び出しが no-op で返り、結果として「親だけが Stack に乗る」状態になる。本番と e2e のコードパスが揃う。
- **Vercel 関数の 10s 上限を気にせず長い prompt が許容される** (限度はあるが、UX 上 timeout してもユーザー操作は止まらない)。

### 否定的影響・トレードオフ

- **ユーザーは「分解中」状態を一定時間目にする**。Gemini 1〜3s + ネットワーク往復で実質数秒。pill 表示で許容するが、頻繁にタスク追加するときは複数の「分解中」が並ぶ可能性がある。
- **親が active 化された後に分解結果が到着する race condition がある**。Stack の最上位に乗った親をユーザーが着手し始めたあと、分解結果で親が消えて子に置き換わると混乱する。これは派生判断 (実装 issue) で扱う: 候補方針は「active になった親は分解対象から外す」。
- **`action_log` の順序が「親作成 → 子作成」に分かれる**。分解結果到着までの間隔がログに残る。これは Phase 4 の暗黙フィードバック分析でむしろ有用 (分解 latency と着手タイミングの関係が取れる) なので欠点ではないが、運用で把握しておく必要がある。
- **`task_decomposed` / `decomposition_modified` のような新 ACTION_TYPE を追加する判断**が派生する。本 ADR ではしない (ADR 0001 の延長で実装 issue が決める)。

## Alternatives considered

- **同期分解 (タスク追加で AI を待つ)**: AddPanel 送信 → AI 分解 → 1 回で子を Stack に push。
  - 不採用理由:
    - Gemini レイテンシが直接 UX に乗る (1〜3s でも体感は遅い)
    - Vercel 関数の 10s 上限 (ADR 0012) に引っかかると追加自体が失敗する
    - AI 失敗時の UX 設計が複雑になる (「タスク追加そのもの」をリトライするのか、「分解だけリトライ」するのか)
    - vision「気づいたら細かくなってる」と矛盾する。能動的に AI を待つ体験になる
- **分解確認ステップを挟む**: AI が結果を返したら user に見せ、承認ステップを経て初めて Stack に反映する。
  - 不採用理由:
    - `architecture.md` §1.7 「承認ステップは挟まない」と矛盾する
    - 暗黙的フィードバックの設計が崩れる (削除 / 書き換えがフィードバックなのに、承認ステップでは「明示的拒否」が混ざる)
    - 判断負荷をユーザーに乗せるのは vision「育てている自覚を持たせない」に反する
- **クライアント主導でローカル分解後に server 同期**: Gemini API を client で叩く。
  - 不採用理由: ADR 0012 で却下済み (API key を client に出す / 本ユーザーの Gemini quota を消費する)

## Notes

- 「分解結果到着までの暫定 status pill 表示時間が長すぎる場合のバナー / 取消し UI」の必要性は実装後の運用で判断する。本 ADR では決めない。
- race condition (親 active 化中に分解結果が到着) の具体的解決策は実装 issue で確定する。本 ADR は「非同期にする」までしか決めない。
- 将来見直す条件:
  - Gemini が streaming で部分結果を返せるようになり、同期 UX のレイテンシ感が許容できる
  - タスク追加 + 分解の一気通貫が UX 上強く望まれるユースケースが出てくる
