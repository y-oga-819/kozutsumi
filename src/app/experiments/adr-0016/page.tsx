import { isVariantKey } from "@/features/stack-view/__experiments__/keys";
import { Playground } from "@/features/stack-view/__experiments__/Playground";

/**
 * ADR 0016 (AI 分解後の Stack View 親子表現) の体験比較プレイグラウンド。
 *
 * 認証なしで開ける (middleware の PUBLIC_PATHS に `/experiments` を入れている)。
 * 本番コードからは import されない (`__experiments__` 配下を参照しているのは
 * このページだけ)。ADR 決着後にプレイグラウンド本体ごと削除する。
 *
 * `?variant=A|B|C|D` を server で受け取り、初期表示の variant を切り替える。
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant } = await searchParams;
  const initialKey = variant && isVariantKey(variant) ? variant : "A";
  return <Playground initialKey={initialKey} />;
}
