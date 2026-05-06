/**
 * 一時プレビュー: ParallelogramProgress 大量分解時 UX (#166)
 * ADR-0051 採用後の実物確認用。マージ後に削除する。
 */
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

const COLOR = "#2563eb";

const cases = [
  { total: 5, doneCount: 2, currentIndex: 3, label: "N=5" },
  { total: 10, doneCount: 4, currentIndex: 5, label: "N=10" },
  { total: 18, doneCount: 8, currentIndex: 9, label: "N=18" },
  { total: 32, doneCount: 17, currentIndex: 18, label: "N=32" },
  { total: 38, doneCount: 12, currentIndex: 13, label: "N=38" },
  { total: 60, doneCount: 25, currentIndex: 26, label: "N=60" },
];

function Frame({
  width,
  label,
  children,
}: {
  width: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] tabular-nums text-fg-faint">
        {label} (container={width}px)
      </p>
      <div className="rounded border border-bg-border bg-bg-elevated p-2" style={{ width }}>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[9px] text-fg-muted">合計 1h</span>
          <div className="flex min-w-0 flex-1 justify-end">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function ParallelogramPreviewPage() {
  return (
    <main className="space-y-6 px-4 py-6">
      <header>
        <h1 className="mb-2 text-[16px] font-bold">
          ParallelogramProgress (#166 / ADR-0051) 実装確認
        </h1>
        <p className="text-[11px] leading-relaxed text-fg-muted">
          固定 segment 幅 (md=12×8px / sm=8×5px) + flex-wrap で多行折り返し。 container 幅は
          md=360px (TopTaskCard 想定), sm=240px (TaskRow / モバイル想定) を用意。 N が小さいケースは
          1 行のまま、N が大きく container を溢れるケースは複数行に折り返す。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">
          size="md" (TopTaskCard 想定 / 360px container)
        </h2>
        {cases.map((c) => (
          <Frame key={`md-${c.total}`} width={360} label={c.label}>
            <ParallelogramProgress {...c} color={COLOR} size="md" />
          </Frame>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-[13px] font-semibold">size="sm" (TaskRow 想定 / 240px container)</h2>
        {cases.map((c) => (
          <Frame key={`sm-${c.total}`} width={240} label={c.label}>
            <ParallelogramProgress {...c} color={COLOR} size="sm" />
          </Frame>
        ))}
      </section>
    </main>
  );
}
