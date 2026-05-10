<!--
書き終えたらセルフチェック（運用ルールは `.claude/skills/kozutsumi-adr/SKILL.md`）:
- [x] この ADR 1 枚を Deprecated にした時、他の判断はクリーンに残るか
- [x] 判断以外（パラメータ・閾値・実装詳細）が混ざっていないか
- [x] 依存する他の ADR を Related に書いたか
- [x] Status / Date を埋めたか
-->

# ADR 0057: 操作モデルは 3 動詞 (start / stop / complete) と stack top auto-bind の timer に固定する

- **Status**: Proposed
- **Date**: 2026-05-10
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §1.2-1.4 / [ADR-0003](./0003-event-driven-stack-as-core.md) / [ADR-0004](./0004-time-entry-state-machine.md) / Issue #234

## Context

Issue #234 のリサーチ（学術 / 書籍 / ゲーミフィケーション / 異分野）を踏まえると、kozutsumi の差別化軸は「行動データの深さ」であると同時に、**着手の壁 (Wall of Awful)** を構造的に下げる体験設計でなければならないことが浮かび上がった。具体的には次の 3 点が揃って初めて「日常的に使い続けられる prosthesis（脳の外付け）」として機能する:

1. **判断点の最小化**: 「次に何をやる」と「今やっていることに対して何をする」を user に問わない。stack top に自動 bind された timer がその両方を吸収する
2. **stop に罰を与えない**: 中断は失敗ではなく「今は別のことをやる」という neutral な操作。Davis の "morally neutral" 概念と整合
3. **complete から次への摩擦をゼロにする**: 完了 → 次タスク選択 → start というクリック連鎖が起きると、「完了直後の余韻」で離脱する

現在の実装は 4 動詞（start / pause / resume / complete）+ `PauseReasonModal` で動いている。pause / resume の区別は内部の time entry 状態機械（ADR-0004）には必要だが、user が触る UI 動詞として晒すと「なぜ pause したか」を毎回問うことになり、Wall of Awful を強化する。

`docs/design/architecture.md` §1.2-1.4 の「スタック」「割り込み」「現在のタスク」概念は本決定の前提だが、user が触る動詞の数と「timer は何に bind されるか」は明示されていなかった。

## Decision

kozutsumi の操作モデルを次の 4 つの不変条件として確立する:

1. **user が触る動詞は start / stop / complete の 3 つのみ**。これ以外の動詞（pause / resume 等）を UI に出さない
2. **timer は常に stack top の task に bind される**。「current task」は stack top と等しく、別概念ではない
3. **stop は完了ではない**。stack 順は維持され、同じ task に start で戻る経路が残る
4. **complete は次 task への自動切替を起こす**。stack top が次の task に置き換わり、timer が auto start する

内部 API（`useTaskTimer` / time entry の state machine）は ADR-0004 通り pause / resume を保持してよい。本 ADR が固定するのは **user に晒す動詞の数と timer の bind 先**である。

## Consequences

### 肯定的影響

- 判断点が「どの task に集中するか」の 1 点に集約される。「current task が何か」「timer が誰に紐づくか」を user が考えずに済む
- complete → 次 task 自動切替 + auto start で「完了直後に止まる」摩擦を消す。連続着手の慣性を維持しやすい
- stop に reason を求めないことで Wall of Awful を増幅しない。stop は中立操作になる
- vision「育てている自覚を持たせない」と整合する。user は道具の存在を忘れて作業に没入できる

### 否定的影響・トレードオフ

- pause / resume と stop の意味的区別が UI から消えるため、「短い中断」と「task 切替」が同じ動詞に潰れる。内部 API では区別が残るが、user 体験としては「stop して別 task を start」と「stop して同じ task に start で戻る」が同じ操作経路になる
- complete 後の auto start は「完了直後にひと息つきたい」場面で煩わしい可能性がある。明示的な「stack を空にする」「全 task に手をつけない」状態は別の操作で表現する必要が出る（本 ADR の対象外、実装 issue で扱う）
- `PauseReasonModal` 廃止により、pause reason の手動分類データが失われる。ただし pause reason は trigger（meeting auto-stop / interruption / voluntary stop）から自動判定可能なので、行動データの欠損ではない（ADR-0061 / ADR-0062 で trigger ごとの reason 自動付与を扱う）

## Alternatives considered

- **4 動詞 (start / pause / resume / complete) のまま `PauseReasonModal` も残す**: 内部状態と UI 動詞が 1:1 で素直だが、判断点が増え Wall of Awful を強化する。user が pause reason を毎回選ぶコストが学習データの価値を上回らない。不採用
- **timer を current task として独立概念にする（stack top と分離）**: 「stack 並び替え中も timer は止めない」等の柔軟性は出るが、「current task は何か」「stack top は何か」の 2 概念を user が把握する必要が生まれ、判断点が増える。kozutsumi のコア体験「stack top だけ見る」と矛盾する。不採用
- **complete 後に next task 確認モーダルを挟む**: 「本当に次に進む？」を user に問うことで暴発防止になるが、完了直後の慣性を切ってしまう。Wall of Awful の再生成。不採用

## Notes

- 本 ADR は user に晒す動詞の固定であり、ADR-0004 の time entry state machine（idle ↔ active ↔ paused）とは別レイヤーの判断。内部 API は ADR-0004 のまま
- complete 直後の「ひと息つきたい」シナリオの UX は実装 issue で扱う（候補: stack が空のときは auto start しない / 明示的「pause stack」操作を加える等）
- 将来見直す条件:
  - pause / resume の手動区別が学習信号として強く必要になった（passive 観測なしでは意図が捕捉できないと判明した）
  - 3 動詞では表現できない user 操作（例: 「30 分後に再開」予約）が core 体験として必要になった
  - timer を stack top から外す体験（複数並列 timer 等）が core になった
