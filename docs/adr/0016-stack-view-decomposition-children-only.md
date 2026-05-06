# ADR 0016: AI 分解後の Stack View は子フラット + Top 上下 2 ゾーン + 行カード 3 行構成 (Variant E) で描く

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §1.7 / §1.9 / §2.4 / [ADR 0013](./0013-ai-as-augmentation-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0018](./0018-keep-parent-task-id-for-ai-decomposition.md)

## Context

Phase 3 で AI (Gemini) がタスクを子タスクに分解する機能を入れる。schema には `tasks.parent_task_id` が既にあり (ADR 0018 で保持を決定)、AI 呼び出しは非同期で行う (ADR 0017)。

ここで決着が必要なのは **「親をデータ上残しつつ Stack View にどう表現するか」**。

`docs/design/architecture.md` §1.9 で Stack View は「次に何をやるかを 1 つだけ見せる」、Tree View は「過去の活動を振り返る」と役割分担している。`docs/design/vision.md` は「AI を育てている自覚を持たせない / 普通に便利だから使っていたら、いつの間にか提案精度が上がっている」体験を狙う。`docs/design/architecture.md` §1.7 は暗黙的フィードバックを核に据え「AI が分解した結果はそのままスタックに挿入される。承認ステップは挟まない」とする。

最初に検討した候補は A〜D の 4 案:

- **A. 子のみスタック / 親は Tree View だけ**
- **B. 子フラット + 親バッジ / グループ化**
- **C. 親をスタックに残し、展開で子を表示 (折りたたみ式)**
- **D. breadcrumb 表示**

これらを `src/features/stack-view/__experiments__/` にプロトタイプ実装し、Vercel preview で実機比較した。比較の結果、A〜D いずれも単独では破綻する弱点があり、それぞれの長所を組み合わせた **ハイブリッド案 (Variant E)** を別途設計してプロトタイプ化、再検討の上で採用した。

A〜D の touchable artifact は採用後に削除した (経緯は本 ADR と git history に残る)。

## Decision

**Variant E (ハイブリッド) を採用する**。具体仕様:

### 1. Stack 行 = 子のみフラット (linearity 維持)

- 分解済み (`decomposed`) の親は Stack に出さない。子だけがフラットに並ぶ。
- 未分解 / 分解中 / 分解不要 (`none` / `decomposing` / `skipped`) の親は親自身が Stack 行になる (子がまだ無い、または永遠に無いため)。

### 2. Top カードを上下 2 ゾーン構造

「Top カードの役割 (= 次にやる 1 つ / 着手対象)」と「タスクカードの役割 (= 一覧の構成要素 / 比較対象 / 並び替え対象)」が異なるので、Top には特別な表示を持たせる。一方で「同じ情報が同じ位置にある」認知負荷低減の観点から、共通参照部分は揃える:

- **上ゾーン (Top 専用 / 着手集中)**: project header + 着手状態 badge (`active` 時の elapsed pill / `paused` 時の pause reason pill) + タスクタイトル (大) + Timer Controls (開始 / 中断 / 再開) + body preview + 自タスク見積もり
- **下ゾーン (行カードと共通参照)**: dep event (右詰) + ⤷ 親タスク名 (左) + 合計時間 (中, Top のみ) + 進捗バー | 分解状態 pill (右詰)

下ゾーンは行カードの Row 2-3 と「同じ位置・同じスタイル」で揃える。

### 3. 行カードは 3 行構成

タイトルが親バッジや dep バッジに圧迫されて省略される問題を解消するため、行カードは縦に 3 行に分割する:

- **Row 1**: Grip + ProjectDot + タイトル (左, `flex-1 truncate`) + 自タスク見積もり (右)
- **Row 2**: dep event (右詰)
- **Row 3**: ⤷ 親タスク名 (左, truncate) + 進捗バー (右詰)

### 4. AI 分解状態と進捗バーは同じ「分解状態スロット」

下ゾーン Row 3 右詰のスロットは、親の `decomposeStatus` で表示が切り替わる:

- `decomposed` → 平行四辺形プログレス (子の進捗)
- `decomposing` → "AI 分解中" pill (`role=status` + `aria-live=polite`)
- `skipped` → "分解不要" pill
- `none` → "未分解" pill

「親の AI 分解状態」というひとつの意味軸を、ひとつの位置で表現する。

### 5. 平行四辺形プログレス (skewX) で完了境界と Stack 上の自分を可視化

数字併記 (`残り 3/3` + `1/3` + `合計 45m`) は重複が多かったので、進捗を **平行四辺形セグメント** で集約する。

- セグメント数 = 親の全子数 (固定)。子に固有順序は無く、Stack 出現順で「自分のセグメント」が決まる。
- **完了**: 親色で塗り
- **現在 (= 自分の番、未完了)**: 親色の枠強調 (1.5px) + 中抜き
- **未完了**: 薄い親色の枠 (alpha 0.55) + 中抜き

`currentIndex = doneCount + (Stack 残中の同親子における自分の位置)`。done が増えると自分のセグメントが右へオフセットする。

セグメント幅は子数に応じて 3 段階で自動縮小 (~5 / ~9 / 10+)、10 子でも 480px に収まる。

a11y: `role="progressbar"` + `aria-valuenow/min/max` + `aria-label="進捗 X/N、現在 M/N"`。セグメント自体は `aria-hidden="true"`。

### 6. 親由来の dep event を子に継承

親に紐付いていた依存イベント (例: 「明日 14:00 Dirbato 最終面接」) を、分解後の各子からも参照できるようにする (Top では下ゾーン Row 2 に常時表示、行カードでは imminent のみ amber pill で強調)。これにより「いつまでにこの親グループの子をすべて消化すれば良いか」が子目線でも見える。

### 7. 完了は Top カードからのみ (上から消化の原則)

行カードの右端からは完了チェックボックスを外し、代わりに左端に Grip (DnD ハンドル) を置く。Top カードの完了ボタンを押すと当該タスクが Done リストへ移動し、次の pending が Top に昇格する。

### 8. 完了タスクは Done リストへ落とす

完了済みタスクは Stack から Done リストへ移動し、行カードと同じレイアウトを `opacity-50` + line-through で薄表示する。「戻す」ボタンで Stack 末尾に復元 (上から消化の原則を崩さない)。

Done セクション内の進捗バーは current 強調なし (`currentIndex=0`) で、Stack 側の current と被らないようにする。

### 9. 派生する設計判断 (本 ADR の対象外、実装 issue)

- 子タスクが親の `project_id` / `dependsOnEventId` / 見積もり継承をどう扱うか
- 分解結果到着前に親が active 化された時の race condition
- `task_decomposed` / `decomposition_modified` 等の新 ACTION_TYPE 追加判断
- 分解中 → 分解済みの遷移演出 (静かなクロスフェード等)
- 補正後見積もり / AI 提案メモ等 Phase 3+ で Top の上ゾーンに追加される情報

## Consequences

### 肯定的影響

- **vision「気づいたら細かくなってる」と整合する**。Stack 上で「次の 1 つ」が常に最小単位 (子) になる。
- **Top の特別性が立つ**。上ゾーンの構造 (project header + state badge + 大タイトル + body preview + Timer Controls) は行カードに無い要素なので、「これが次にやる 1 つ」が一目で分かる。
- **下ゾーンの位置揃えで認知負荷が下がる**。dep / 親 / 進捗の右詰位置が Top と行カードで完全一致する。
- **暗黙的フィードバック (architecture.md §1.7 / §2.4) が最大化する**。子レベルでの並べ替え / 削除 / 書き換え / 統合・再分割が 1:1 で観測できる。
- **AI 分解状態を「進捗バーと同じ位置」で見せる**ことで、「分解 → 進捗管理 → 完了」というひとつの意味軸として理解できる。
- **architecture.md §1.9 の 2 ビュー分担がクリーン**。Stack = 未来 / 1 つ、Tree = 過去 / 階層、と役割が綺麗に切れる。
- **ADR 0013 (augmentation only) と相性が良い**。AI 失敗 / `AI_ENABLED=false` の場合、親が `none` / `decomposing` 状態のまま Stack に並ぶだけで縮退する。e2e バイパス (ADR 0014) でも同じコードパスで動く。
- **DnD 並び替えで進捗バーの current 位置が動的に再計算される**。「子に固有順序は無い」という性質が UI で素直に表現される。

### 否定的影響・トレードオフ

- **行カードが 3 行構成になる**ぶん縦に伸びる。スクロール 1 視野に収まる件数が減る (1 行 2 行構成より縦が約 +20px)。
- **Top カードが上下 2 ゾーンで縦長になる**。Goal box / body preview / Timer Controls を全部出すと 5〜6 行分の高さ。1 視野に Top + 2〜3 行カードが入る程度。
- **Top に乗る情報が増えると上ゾーンが肥大化する**リスク。Phase 3+ で AI 提案メモ / 補正後見積もり等を追加する際は上ゾーンの情報設計を再評価する必要がある (本 ADR の見直し条件)。
- **子タイトルの自立性が AI プロンプトに依存する**。子タイトルだけで意味が読める短い独立した文言を AI に作らせる責務が発生する。これは AI プロンプト設計 (実装パラメータ) で吸収する。
- **下ゾーン共通レイアウトの維持コスト**。今後行カードのレイアウト変更が入ると、Top 下ゾーンも追従する必要がある。実装側で共通 component 化して維持する。

## Alternatives considered

### A. 子のみスタック / 親は Tree View だけ

分解済み親を完全に Stack から消し、子だけを並べる。最初の Accepted 候補だったが、実機で触った結果以下が問題に:

- **子タイトルだけ見て「何のため?」が即答できない** (例: 「志望動機パターンA作成」だけだと文脈不明)
- **当初やりたかったゴールが「終わる」感覚を持てない** (親の完了境界が見えない)
- **粒度混在** (`decomposing/skipped/none` の親と分解済みの子が同居)

→ E では Top カードに Goal 行 (`⤷ 親 + 進捗 + 合計`) を、行カードに `⤷ 親バッジ + 進捗` を追加することでこれを解消。

### B. 子フラット + 親バッジ / グループ化

連続する同親子を縦線でまとめ、各子に親名バッジを付ける案。

- **DnD 並び替えで同親グループが分断されたとき、縦線がブツ切りになる**
- **分断後のグルーピングはむしろ意味が薄くなる**

→ E では同親グループの縦線は廃止し、親情報は各行に小さく付与するだけにとどめた (グルーピングは強調しない)。

### C. 親をスタックに残し、展開で子を表示 (折りたたみ式)

- **「次にやる 1 つ」が親なのか展開した子の先頭なのか曖昧化**する
- **`architecture.md` §1.9 「Stack View は次に何をやるかを 1 つだけ見せる」と矛盾**
- **「親削除 = 子全削除なのか / 親だけ削除か」のセマンティクスが曖昧**で行動ログ解釈が分岐する

→ E では Stack 行は子のまま (linearity 維持) を選び、親情報は Top の Goal 行と行カードの親バッジに移した。「上から消化」の原則も Top-only complete で守る。

### D. breadcrumb 表示

タイトル上に「project / 親」のパス表示を出す案。

- **Top カードの情報量が他の行と均質になり、「次にやる 1 つ」の特別感が薄れる**
- **dep event が他の bagde と並列になり「いつまでに?」の優先度が見えにくい**
- **多階層 (project → epic → story → task) でパスが長くなりやすい**

→ E では Top カードを上下 2 ゾーンに分けて Top の特別性を担保し、dep event は専用の amber pill で右詰にして優先度を保った。

## Notes

- §5 の **「セグメント幅は子数に応じて 3 段階で自動縮小 (~5 / ~9 / 10+)、10 子でも 480px に収まる」** の段は [ADR 0055](./0055-parallelogram-progress-wrap-for-large-n.md) で **partial supersede** された。N>10 の挙動は固定幅 + `flex-wrap` に変わる。それ以外の §5 (セグメント数 = 親の全子数、完了・現在・未完了の塗り分け、a11y 仕様) は本 ADR が引き続き有効。
- プロトタイプ (`src/features/stack-view/__experiments__/` + `/experiments/adr-0016` ルート + `src/shared/supabase/middleware.ts` の `/experiments` PUBLIC_PATHS 追加) は **Phase 3 の本実装が落ち着いたタイミング**で削除する。
- 平行四辺形プログレスや 3 行行カードの実装は `__experiments__/VariantE.tsx` を Phase 3 issue で本物の `src/features/task-stack/` に移植する想定。共通 component (`ParallelogramProgress`, `bodyPreview`, etc.) は移植時に shared レイヤへ昇格する。
- Top の上ゾーンに将来追加されうる情報 (AI 提案メモ / 補正後見積もり / 依存タスク注意) は本 ADR の対象外。情報量が肥大化したら、上ゾーンの再構造化を別 ADR で検討する。
- 本 ADR を覆す trigger (見直し条件):
  - 行カードの 3 行構成が「縦長すぎる」と判断され、より凝縮した表現が必要になる
  - Top の上ゾーンに乗る情報が肥大化し、現在の構造で収まらなくなる
  - 多階層 (epic / story) を Stack View で扱う必要が出てくる
  - 子タイトルの自立性が低く「親文脈なしでは意味が取れない」フィードバックが蓄積する
