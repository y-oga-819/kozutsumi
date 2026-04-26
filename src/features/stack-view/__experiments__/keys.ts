/**
 * 体験比較 variant の key と presentation 用ラベル。
 * server / client 両方から参照するので "use client" を付けない。
 */
export const VARIANTS = [
  { key: "A", label: "A: 子のみ" },
  { key: "B", label: "B: フラット+バッジ" },
  { key: "C", label: "C: 折りたたみ" },
  { key: "D", label: "D: breadcrumb" },
] as const;

export type VariantKey = (typeof VARIANTS)[number]["key"];

export function isVariantKey(value: string): value is VariantKey {
  return VARIANTS.some((v) => v.key === value);
}
