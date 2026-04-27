import { Playground } from "@/features/stack-view/__experiments__/Playground";

/**
 * ADR 0016 (AI 分解後の Stack View 親子表現) の体験プレイグラウンド。
 *
 * 認証なしで開ける (middleware の PUBLIC_PATHS に `/experiments` を入れている)。
 * 本番コードからは import されない (`__experiments__` 配下を参照しているのは
 * このページだけ)。Phase 3 の本実装が落ち着いたら playground 全体を削除する。
 *
 * 比較対象だった A〜D は ADR 採用 (Variant E) と同時に削除済み。経緯は
 * `docs/adr/0016-*.md` の Alternatives considered を参照。
 */
export default function Page() {
  return <Playground />;
}
