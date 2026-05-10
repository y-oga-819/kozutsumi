import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-static";

const TITLE_OVERRIDE_BY_KEY: Record<string, string> = {};

function listViewFiles(): string[] {
  const dir = path.join(process.cwd(), "public", "views");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".html") && f !== "index.html")
      .sort();
  } catch {
    return [];
  }
}

function humanizeKey(key: string): string {
  return TITLE_OVERRIDE_BY_KEY[key] ?? key.replace(/-/g, " ");
}

export default function ViewsIndexPage() {
  const files = listViewFiles();

  return (
    <main className="px-4 py-8">
      <header className="mb-8">
        <p className="mb-2 text-xs uppercase tracking-wider text-fg-subtle">
          kozutsumi-html-design-doc
        </p>
        <h1 className="mb-2 font-jp text-xl font-medium text-fg-strong">設計書 HTML view</h1>
        <p className="text-sm leading-relaxed text-fg-muted">
          milestone 計画 / 設計コンセプト / 機能仕様を 1 枚で読み下す用。preview と local
          開発でのみ閲覧可能（production は 404）。PR マージ前に HTML ファイルは削除する運用。
        </p>
      </header>

      {files.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          まだ view がありません。
          <code className="rounded bg-bg-elevated px-1.5 py-0.5">public/views/</code> に{" "}
          <code className="rounded bg-bg-elevated px-1.5 py-0.5">&lt;kebab&gt;.html</code>{" "}
          を置くとここに並びます。
        </p>
      ) : (
        <ul className="divide-y divide-bg-divider border-y border-bg-divider">
          {files.map((f) => {
            const key = f.replace(/\.html$/, "");
            return (
              <li key={f}>
                <a
                  href={`/views/${f}`}
                  className="flex items-baseline justify-between gap-3 py-3 text-fg-default transition-colors hover:text-fg-strong"
                >
                  <span className="font-jp text-sm">{humanizeKey(key)}</span>
                  <span className="text-xs text-fg-subtle">{f}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
