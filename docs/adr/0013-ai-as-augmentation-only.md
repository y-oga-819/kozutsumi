# ADR 0013: AI 機能は augmentation のみ、core 機能は AI なしで完結する

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §1.1 / [ADR 0012](./0012-ai-call-via-route-handler.md)

## Context

Phase 3 で AI（Gemini）依存の機能（タスク自動分解 / 依存関係推論 / 見積もり補正 / `task_category` ラベリング）を入れる。同時に以下のリスクがある:

1. **Gemini 無料枠の持続性リスク**（旧 `open-questions.md` 項目）。2025 年 12 月に 50〜80% 削減の前例。将来停止 / 大幅有料化される可能性。
2. **AI 呼び出しの失敗・遅延**: quota exceeded / network timeout / model unavailable / 解析不能なレスポンス。
3. **e2e の決定性**: LLM 応答は非決定的。e2e で AI を踏むと flaky 化する。

`docs/design/architecture.md` §1.1 の 2 層価値モデルでは、表層（タスク管理ツールとしての即時的価値）は AI なしで成立することが kozutsumi の継続利用の前提。コールドスタート問題もここで解いている。

つまり「AI が落ちても止まらない設計」は vision 由来の制約であり、Phase 3 で AI を入れる時点でその境界を ADR として明示する必要がある。

## Decision

AI 機能は **augmentation（添え物）として実装する**。以下を Phase 3 以降の不変条件とする:

1. **core path は AI に依存しない**。タスク CRUD / Stack 並び替え・push・pop / イベント駆動スタック表示 / Calendar 同期 / 行動ログ書き込みは AI 呼び出しの成否に関係なく完結する。
2. **AI 呼び出しは fire-and-forget 寄りに扱う**。失敗・timeout・quota exceeded はユーザー操作を止めない。例:
   - タスク追加時の自動分解が失敗 → 元のタスクだけスタックに入る（分解結果なし）
   - `task_category` ラベリング失敗 → category は null のまま（後で再試行 / 人手 override）
   - 補正後見積もりの計算失敗 → ユーザー入力の見積もりをそのまま使う
3. **`AI_ENABLED` env switch で AI 呼び出し全体を disable できる**。すべての `/api/ai/*` Route Handler は `AI_ENABLED !== "true"` のとき early return する。これは以下の用途で使う:
   - Gemini 停止 / 障害時の即時 kill-switch
   - e2e の決定性確保（ADR 0014 で詳細）
   - dev 環境で quota を消費しないようにする
4. **AI 失敗時の UX は「黙って劣化」を基本とする**。エラートーストは出すが、user 操作は止めない。
   - 例外: 補正後見積もりや AI 分解の前提でユーザーが操作した場合に、結果が変わる旨を見せる必要があるケースは個別判断。

## Consequences

### 肯定的影響

- **Gemini 無料枠停止に耐える**。最悪のケースでも core 機能は動く。プロダクト化検討時に「AI provider 独立性」を確保する基盤になる。
- **e2e がシンプル**。`AI_ENABLED=false` で AI 経路は全面 stub できる（ADR 0014）。LLM mock を CI で背負わなくていい。
- **vision の 2 層モデルと整合**。表層の価値が AI 抜きで成立し続ける。
- **dev での quota 消費を制御できる**。実装中はデフォルト off、検証時だけ on にする運用が可能。

### 否定的影響・トレードオフ

- **AI ありき設計の機能を作りにくい**。例えば「AI 分解を必ず通す前提のオンボーディング」は採れない。常に「AI が無くても成立する形」を考える制約が乗る。
- **黙って劣化させる UX は user に変化が見えにくい**。「今 AI が動いていない」ことに気付かない可能性。明示するかは個別判断（オフ時のバナー等）。
- **AI 失敗時の挙動を機能ごとに設計する必要がある**。共通ハンドラだけでは済まない。

## Alternatives considered

- **AI 必須・落ちたらブロック**: 「AI 提案を見ないと next action が決まらない」UI にすると確かに学習データは溜まる。だが Gemini 無料枠停止 / 障害で kozutsumi 自体が止まる。vision の 2 層モデル自体を否定するので不採用。
- **AI 専用の別モード（"AI モード" トグル）**: ユーザーが明示的に AI を on/off する。判断負荷をユーザーに乗せるのは「育っている感を意識させない」vision に反する。不採用。
- **kill-switch を持たない（常に AI on 前提）**: 障害時に運用で対応するしかなくなる。e2e も AI mock を抱える必要が出てコストが嵩む。不採用。

## Notes

- `open-questions.md` の「Gemini 無料枠の持続性リスク」項目は本 ADR で決着。同 file から削除する。
- `AI_ENABLED` の env 名 / Vercel secret 設定 / 既定値は実装 issue で確定する（ADR にしない）。
- 「黙って劣化」の例外（user に明示すべきケース）が積み上がったら、共通の degradation banner を別 ADR で検討する。
- LLM provider の切替（Gemini → 他社）が現実味を帯びたら、provider 抽象化の ADR を別途起こす。本 ADR は「provider に依存しない core path」までを決めており、provider 抽象化レイヤの設計は対象外。
