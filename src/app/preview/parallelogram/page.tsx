/**
 * 一時プレビュー: ParallelogramProgress 大量分解時 UX (#166)
 * 設計判断確定後に削除する。
 */
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

const COLOR = "#2563eb";

type Bar = { total: number; doneCount: number; currentIndex: number };

const cases: Bar[] = [
  { total: 3, doneCount: 1, currentIndex: 2 },
  { total: 8, doneCount: 3, currentIndex: 4 },
  { total: 18, doneCount: 8, currentIndex: 9 },
  { total: 38, doneCount: 12, currentIndex: 13 },
];

function AutoFitBar({ total, doneCount, currentIndex, height }: Bar & { height: number }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-[3px]">
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const isDone = idx <= doneCount;
        const isCurrent = idx === currentIndex && !isDone;
        const borderColor = isCurrent ? COLOR : `${COLOR}55`;
        const borderWidth = isCurrent ? 1.5 : 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: `calc((100% - 3px * ${total - 1}) / ${total})`,
              height,
              transform: "skewX(-20deg)",
              background: isDone ? COLOR : "transparent",
              border: `${borderWidth}px solid ${borderColor}`,
              borderRadius: 1,
              flexShrink: 1,
              minWidth: 0,
            }}
          />
        );
      })}
    </div>
  );
}

function Frame({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded bg-[#fafafa] px-2 py-1.5" style={{ width }}>
      {children}
    </div>
  );
}

function Section({
  title,
  render,
}: {
  title: string;
  render: (c: Bar, frameWidth: number, height: number) => React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-3 border-b border-[#e5e5e5] pb-1 text-[14px] font-semibold">{title}</h2>
      <div className="space-y-2">
        {cases.map((c) => (
          <div key={`md-${c.total}`} className="flex items-center gap-3 text-[11px]">
            <span className="w-[110px] tabular-nums text-[#666]">N={c.total} (md, 360px)</span>
            {render(c, 360, 9)}
          </div>
        ))}
        {cases
          .filter((c) => c.total >= 8)
          .map((c) => (
            <div key={`sm-${c.total}`} className="flex items-center gap-3 text-[11px]">
              <span className="w-[110px] tabular-nums text-[#666]">N={c.total} (sm, 200px)</span>
              {render(c, 200, 6)}
            </div>
          ))}
      </div>
    </section>
  );
}

export default function ParallelogramPreviewPage() {
  return (
    <main className="mx-auto max-w-[460px] px-4 py-6 text-[#1a1a1a]">
      <h1 className="mb-2 text-[16px] font-bold">ParallelogramProgress 比較プレビュー (#166)</h1>
      <p className="mb-3 text-[11px] leading-relaxed text-[#666]">
        現状 = 既存 component (固定 segment 幅 / N≤9 までしか考慮されていない)。
        <br />
        案 X = 全件 segment auto-fit + 常に数字併記。
        <br />
        案 Y = 全件 segment auto-fit のみ (数字なし)。
        <br />枠 = container 幅。md=360px (TopTaskCard 想定) / sm=200px (TaskRow / モバイル想定)。
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-3 text-[11px] text-[#555]">
        <span className="flex items-center gap-1">
          <span
            className="inline-block"
            style={{
              width: 14,
              height: 8,
              transform: "skewX(-20deg)",
              background: COLOR,
              border: `1px solid ${COLOR}55`,
              borderRadius: 1,
            }}
          />
          完了
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block"
            style={{
              width: 14,
              height: 8,
              transform: "skewX(-20deg)",
              background: "transparent",
              border: `1.5px solid ${COLOR}`,
              borderRadius: 1,
            }}
          />
          現在
        </span>
        <span className="flex items-center gap-1">
          <span
            className="inline-block"
            style={{
              width: 14,
              height: 8,
              transform: "skewX(-20deg)",
              background: "transparent",
              border: `1px solid ${COLOR}55`,
              borderRadius: 1,
            }}
          />
          未完了
        </span>
      </div>

      <Section
        title="現状 (既存 ParallelogramProgress)"
        render={(c, w, h) => (
          <Frame width={w}>
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <ParallelogramProgress
                total={c.total}
                doneCount={c.doneCount}
                currentIndex={c.currentIndex}
                color={COLOR}
                size={h === 9 ? "md" : "sm"}
              />
            </div>
          </Frame>
        )}
      />

      <Section
        title="案 X: auto-fit + 常に数字併記"
        render={(c, w, h) => (
          <Frame width={w}>
            <AutoFitBar
              total={c.total}
              doneCount={c.doneCount}
              currentIndex={c.currentIndex}
              height={h}
            />
            <span className="shrink-0 text-[11px] tabular-nums text-[#444]">
              {c.doneCount} / {c.total}
            </span>
          </Frame>
        )}
      />

      <Section
        title="案 Y: auto-fit のみ (数字なし)"
        render={(c, w, h) => (
          <Frame width={w}>
            <AutoFitBar
              total={c.total}
              doneCount={c.doneCount}
              currentIndex={c.currentIndex}
              height={h}
            />
          </Frame>
        )}
      />

      <p className="mt-6 text-[11px] leading-relaxed text-[#888]">
        メモ: 「現状」セクションでは N=18 / N=38 などで segment が枠から溢れる (現状実装は N≤9
        を想定した固定幅のため)。これが #166 で解決したい破綻ポイント。
      </p>
    </main>
  );
}
