/**
 * 一時プレビュー: ParallelogramProgress 大量分解時 UX (#166)
 * 設計判断確定後に削除する。
 */
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

type Bar = { total: number; doneCount: number; currentIndex: number };

type BarComponent = (props: Bar & { color: string; size: "md" | "sm" }) => React.ReactElement;

// ─────────────────────────────────────────────
// Variants
// ─────────────────────────────────────────────

// V1: 現状 (既存 component) — N>9 で破綻する
const CurrentBar: BarComponent = ({ total, doneCount, currentIndex, color, size }) => (
  <ParallelogramProgress
    total={total}
    doneCount={doneCount}
    currentIndex={currentIndex}
    color={color}
    size={size}
  />
);

// V2/V3: AutoFit (案 X / Y) — container 幅で全件 segment auto-fit
function makeAutoFitBar(withNumber: boolean): BarComponent {
  return function AutoFitBar({ total, doneCount, currentIndex, color, size }) {
    const height = size === "md" ? 9 : 6;
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-[3px]">
          {Array.from({ length: total }).map((_, i) => {
            const idx = i + 1;
            const isDone = idx <= doneCount;
            const isCurrent = idx === currentIndex && !isDone;
            const borderColor = isCurrent ? color : `${color}55`;
            const borderWidth = isCurrent ? 1.5 : 1;
            return (
              <span
                key={i}
                aria-hidden="true"
                style={{
                  width: `calc((100% - 3px * ${total - 1}) / ${total})`,
                  height,
                  transform: "skewX(-20deg)",
                  background: isDone ? color : "transparent",
                  border: `${borderWidth}px solid ${borderColor}`,
                  borderRadius: 1,
                  flexShrink: 1,
                  minWidth: 0,
                }}
              />
            );
          })}
        </div>
        {withNumber && (
          <span
            className="shrink-0 tabular-nums"
            style={{ fontSize: size === "md" ? 10 : 9, color: `${color}cc` }}
          >
            {doneCount} / {total}
          </span>
        )}
      </div>
    );
  };
}

// V4: 10件チャンク — 10 個ごとに 1 つの大きい平行四辺形 + 内部 fill + 数字
const ChunkBar: BarComponent = ({ total, doneCount, currentIndex, color, size }) => {
  const chunkSize = 10;
  const chunkCount = Math.ceil(total / chunkSize);
  const height = size === "md" ? 14 : 9;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-[3px]">
        {Array.from({ length: chunkCount }).map((_, ci) => {
          const startIdx = ci * chunkSize + 1;
          const endIdx = Math.min((ci + 1) * chunkSize, total);
          const capacity = endIdx - startIdx + 1;
          const doneInChunk = Math.max(0, Math.min(capacity, doneCount - (startIdx - 1)));
          const containsCurrent =
            currentIndex >= startIdx && currentIndex <= endIdx && currentIndex > doneCount;
          const fillPct = (doneInChunk / capacity) * 100;
          const currentPosPct = containsCurrent
            ? ((currentIndex - startIdx + 1) / capacity) * 100
            : null;
          const borderColor = containsCurrent ? color : `${color}55`;
          const borderWidth = containsCurrent ? 1.5 : 1;
          return (
            <div
              key={ci}
              aria-hidden="true"
              style={{
                flex: `${capacity} 1 0`,
                minWidth: 0,
                height,
                position: "relative",
                transform: "skewX(-20deg)",
                border: `${borderWidth}px solid ${borderColor}`,
                borderRadius: 1,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${fillPct}%`,
                  background: color,
                }}
              />
              {currentPosPct !== null && (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(${currentPosPct}% - 1px)`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: color,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <span
        className="shrink-0 tabular-nums"
        style={{ fontSize: size === "md" ? 10 : 9, color: `${color}cc` }}
      >
        {doneCount} / {total}
      </span>
    </div>
  );
};

// V5: 折り返し (wrap) — 固定 segment 幅、container 超過で次の行に折り返し
const WrapBar: BarComponent = ({ total, doneCount, currentIndex, color, size }) => {
  const segWidth = size === "md" ? 12 : 8;
  const segHeight = size === "md" ? 8 : 5;
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[3px]">
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const isDone = idx <= doneCount;
        const isCurrent = idx === currentIndex && !isDone;
        const borderColor = isCurrent ? color : `${color}55`;
        const borderWidth = isCurrent ? 1.5 : 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: segWidth,
              height: segHeight,
              transform: "skewX(-20deg)",
              background: isDone ? color : "transparent",
              border: `${borderWidth}px solid ${borderColor}`,
              borderRadius: 1,
              flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
};

const variants: { id: string; label: string; bar: BarComponent; note: string }[] = [
  {
    id: "current",
    label: "V1: 現状 (既存)",
    bar: CurrentBar,
    note: "N≤9 を想定した固定 segment 幅。N>10 で container を溢れる。",
  },
  {
    id: "autofit-num",
    label: "V2: 案 X — auto-fit + 数字併記",
    bar: makeAutoFitBar(true),
    note: "全件描画。N が増えると segment が連続的に細くなる。数字で正確な数を補える。",
  },
  {
    id: "autofit",
    label: "V3: 案 Y — auto-fit のみ",
    bar: makeAutoFitBar(false),
    note: "全件描画。数字併記なし。N=38 では平行四辺形の skew がほぼ視認できなくなる。",
  },
  {
    id: "chunk",
    label: "V4: 案 Z — 10件チャンク + 数字併記",
    bar: ChunkBar,
    note: "10 個ごとに 1 つの「大きい平行四辺形」、内部 fill で chunk 内の進捗を表示。現在 chunk は枠太め + 縦線で正確位置。1 segment が大きく保たれる。",
  },
  {
    id: "wrap",
    label: "V5: 折り返し (wrap)",
    bar: WrapBar,
    note: "segment 幅は固定 (md=12px / sm=8px)、container を超えたら次の行に折り返す。平行四辺形の視認性は最大、ただし高さが行数で変動。",
  },
];

// ─────────────────────────────────────────────
// Card mockups
// ─────────────────────────────────────────────

const PROJECT_COLOR = "#2563eb";
const TITLE = "○○の本を読む";
const PARENT_TITLE = "Q2 振り返りレポート";

function TopTaskCardMock({ bar }: { bar: React.ReactNode }) {
  return (
    <div className="rounded-md border border-bg-border bg-bg-elevated p-3">
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 shrink-0 rounded-full opacity-70"
          style={{ background: PROJECT_COLOR }}
        />
        <span className="flex-1 truncate font-jp text-[14px]">{TITLE}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">2h</span>
      </div>
      <div className="mt-3 space-y-1 border-t border-bg-border/60 pt-2">
        <div className="font-jp text-[10px] leading-[1.4]" style={{ color: `${PROJECT_COLOR}cc` }}>
          ⤷ {PARENT_TITLE}
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="font-jp text-[10px] tabular-nums text-fg-muted">合計 4h</span>
          <div className="flex min-w-0 max-w-[280px] flex-1 items-center justify-end">{bar}</div>
        </div>
      </div>
    </div>
  );
}

function TaskRowMock({ bar }: { bar: React.ReactNode }) {
  return (
    <div className="cursor-pointer border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <div className="h-3 w-3 shrink-0 opacity-30">⋮⋮</div>
        <div
          className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
          style={{ background: PROJECT_COLOR }}
        />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{TITLE}</span>
        <span className="shrink-0 text-[9px] tabular-nums text-fg-faint">30m</span>
      </div>
      <div className="ml-[26px] mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[9px]"
          style={{ color: `${PROJECT_COLOR}cc` }}
        >
          ⤷ {PARENT_TITLE}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end">{bar}</div>
      </div>
    </div>
  );
}

function DoneListMock({ bar }: { bar: React.ReactNode }) {
  return (
    <div className="border-b border-bg-elevated px-2.5 py-2 opacity-50">
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
          style={{ background: PROJECT_COLOR }}
        />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-weak line-through">
          {TITLE}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-fg-faint">30m</span>
        <button
          type="button"
          className="cursor-default rounded-[3px] border border-bg-divider bg-transparent px-1.5 py-0.5 font-jp text-[9px] text-fg-faint"
        >
          戻す
        </button>
      </div>
      <div className="ml-[14px] mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[9px]"
          style={{ color: `${PROJECT_COLOR}99` }}
        >
          ⤷ {PARENT_TITLE}
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-end">{bar}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Page composition
// ─────────────────────────────────────────────

const samplesProgress: Bar[] = [
  { total: 8, doneCount: 3, currentIndex: 4 },
  { total: 18, doneCount: 8, currentIndex: 9 },
  { total: 38, doneCount: 12, currentIndex: 13 },
];

const samplesDone: Bar[] = [
  { total: 18, doneCount: 18, currentIndex: 0 },
  { total: 38, doneCount: 38, currentIndex: 0 },
];

function VariantBlock({ label, note, Bar }: { label: string; note: string; Bar: BarComponent }) {
  return (
    <section className="space-y-3 rounded-md border border-bg-border/40 p-3">
      <header>
        <h3 className="text-[13px] font-semibold">{label}</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{note}</p>
      </header>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-fg-faint">TopTaskCard (md)</p>
        {samplesProgress.map((c) => (
          <div key={`top-${c.total}`} className="space-y-1">
            <p className="text-[10px] tabular-nums text-fg-faint">
              N={c.total} / done={c.doneCount} / current={c.currentIndex}
            </p>
            <TopTaskCardMock bar={<Bar {...c} color={PROJECT_COLOR} size="md" />} />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-fg-faint">TaskRow (sm)</p>
        {samplesProgress.map((c) => (
          <div key={`row-${c.total}`} className="space-y-1">
            <p className="text-[10px] tabular-nums text-fg-faint">
              N={c.total} / done={c.doneCount} / current={c.currentIndex}
            </p>
            <TaskRowMock bar={<Bar {...c} color={PROJECT_COLOR} size="sm" />} />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-fg-faint">
          DoneList (sm, current=0)
        </p>
        {samplesDone.map((c) => (
          <div key={`done-${c.total}`} className="space-y-1">
            <p className="text-[10px] tabular-nums text-fg-faint">
              N={c.total} / done={c.doneCount}
            </p>
            <DoneListMock bar={<Bar {...c} color={PROJECT_COLOR} size="sm" />} />
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ParallelogramPreviewPage() {
  return (
    <main className="space-y-5 px-4 py-6 text-fg-default">
      <header className="space-y-2">
        <h1 className="text-[16px] font-bold">ParallelogramProgress 比較プレビュー (#166)</h1>
        <p className="text-[11px] leading-relaxed text-fg-muted">
          各 variant を 3 つのカード文脈 (TopTaskCard / TaskRow / DoneList) × 3 つの N (8 / 18 / 38)
          に乗せて並べる。実カードの幅・周囲のテキストとの密度感もそのまま比較できる。
        </p>
        <p className="text-[11px] leading-relaxed text-fg-muted">
          色 = 単色 (#2563eb) で固定。完了 = 塗り、現在 = 太枠 + 縦線、未完了 = 薄い枠。
        </p>
      </header>

      {variants.map((v) => (
        <VariantBlock key={v.id} label={v.label} note={v.note} Bar={v.bar} />
      ))}

      <p className="pt-4 text-[11px] leading-relaxed text-fg-muted">
        メモ: V1 (現状) は N=18 / N=38 でカード幅を超えて溢れる。V4 (10件チャンク) は 1
        平行四辺形が大きいまま保たれ、chunk 単位の進捗感も読み取れる。V5 (wrap)
        は平行四辺形の視認性は最大だが高さが可変になる。判断後にこのページ
        (`src/app/preview/parallelogram/page.tsx`) は削除する。
      </p>
    </main>
  );
}
