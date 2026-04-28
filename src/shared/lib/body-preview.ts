/**
 * markdown 本文の最初の非見出し行を抽出する。
 * Stack View の Top カード上ゾーンや Variant E プロトで使う 1 行プレビュー。
 *
 * `#` で始まる行はスキップし、空行も除外する。1 行も無ければ空文字。
 */
export function bodyPreview(body: string | null | undefined): string {
  if (!body) return "";
  return body.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
}
