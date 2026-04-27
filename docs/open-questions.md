# 未解決の論点

設計・実装・運用上まだ決着していない事項。現時点の方針と、再検討のトリガーを併記する。

## AI並列作業のトラッキング

Claude Code等の並列作業での「人間時間」「AI駆動時間」「AI待ち時間」の区別。kozutsumi のスコープ外とし将来の拡張として検討。

## 階層の運用コスト

project + taskの2階層で始め、epic/storyの必要性は実運用で検証。

## iOS PWAの制約

個人利用では問題としない。プロダクト化時にFlutterネイティブ化を検討。

## スコアリングの冷え込み問題

初期はヒューリスティック重みで「まあまあの提案」を出しつつLLM検証で補正。表層の価値で継続利用を確保し、裏側でデータを蓄積する。

## 行動データのプライバシー

行動ログには個人の思考パターンや弱点が含まれる。プロダクト化時にはデータの所有権・削除権・暗号化が重要な設計要件になる。個人ツールの段階ではSupabaseのRow Level Securityで対応。

## LLM 選定の再評価

Phase 3 着手時点 (2026-04) の確定事項:

- Gemini 2.5 Flash は無料枠で利用可 (RPM/RPD は 2025-12 の 50〜80% 削減後の値で安定。具体値は AI Studio dashboard で要確認)
- Pro 系は 2026-04-01 から有料 tier 専用に。Phase 4 の LLM 妥当性検証で Pro を使う場合は課金前提
- Gemini 3 Flash (preview) / Gemini 3.1 Pro / 3.1 Flash-Lite がリリース済。Phase 3 は ADR 0012 のとおり 2.5 Flash を採用するが、安定版が出たら Flash の選定を再評価
- サブスクリプション (Anthropic Pro/Max・Google AI Pro 等) を SDK 経由でプログラマティックに叩く運用は規約上 NG。kozutsumi のような個人ツールから LLM を呼ぶ正攻法は API key + 従量課金 (または Gemini のような無料枠の API)

再評価トリガー: Gemini 3 Flash の安定版リリース / 無料枠の追加削減 / quota が日常運用で逼迫 / Phase 4 で Pro 相当の妥当性検証が必須になる。決着したら ADR 化して本項目を削除する。
