import type { ReactNode } from "react";

function inlineStyle(text: string): string {
  let result = text.replace(
    /`([^`]+)`/g,
    '<code style="background:#27272a;padding:1px 5px;border-radius:3px;font-size:0.9em;color:#a1a1aa">$1</code>',
  );
  result = result.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong style="color:#e4e4e7;font-weight:600">$1</strong>',
  );
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return result;
}

type HeadingLevel = 1 | 2 | 3;

const headingSizeClass: Record<HeadingLevel, string> = {
  1: "text-[15px]",
  2: "text-[13px]",
  3: "text-[12px]",
};

export function renderMarkdown(
  md: string | null | undefined,
): ReactNode[] | null {
  if (!md) return null;
  const lines = md.split("\n");
  const elements: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      const level = hMatch[1].length as HeadingLevel;
      const topMarginClass = elements.length ? "mt-3.5" : "mt-0";
      elements.push(
        <div
          key={key++}
          className={`mb-1.5 font-jp font-semibold text-fg-emphasized ${topMarginClass} ${headingSizeClass[level]}`}
          dangerouslySetInnerHTML={{ __html: inlineStyle(hMatch[2]) }}
        />,
      );
      i++;
      continue;
    }

    if (line.startsWith("> ")) {
      elements.push(
        <div
          key={key++}
          className="my-1.5 border-l-2 border-fg-faint pl-2.5 font-jp text-[12px] italic text-fg-subtle"
          dangerouslySetInnerHTML={{ __html: inlineStyle(line.slice(2)) }}
        />,
      );
      i++;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      elements.push(
        <pre
          key={key++}
          className="my-1.5 overflow-auto whitespace-pre rounded-md border border-bg-divider bg-bg-elevated px-3 py-2.5 text-[11px] leading-[1.5] text-fg-muted"
        >
          {lang && (
            <div className="mb-1 text-[9px] text-fg-weak">{lang}</div>
          )}
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.match(/^[-*]\s/)) {
      const items: { text: string; indent: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)/);
        if (!m) break;
        const indent = m[1].length > 0 ? 1 : 0;
        items.push({ text: m[2], indent });
        i++;
      }
      elements.push(
        <div key={key++} className="my-1">
          {items.map((it, j) => (
            <div
              key={j}
              className={`flex gap-1.5 py-0.5 font-jp text-[12px] text-fg-muted ${
                it.indent ? "ml-4" : "ml-0"
              }`}
            >
              <span className="shrink-0 text-fg-weak">•</span>
              <span
                dangerouslySetInnerHTML={{ __html: inlineStyle(it.text) }}
              />
            </div>
          ))}
        </div>,
      );
      continue;
    }

    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <div key={key++} className="my-1">
          {items.map((it, j) => (
            <div
              key={j}
              className="flex gap-1.5 py-0.5 font-jp text-[12px] text-fg-muted"
            >
              <span className="min-w-[16px] shrink-0 text-right text-fg-weak">
                {j + 1}.
              </span>
              <span dangerouslySetInnerHTML={{ __html: inlineStyle(it) }} />
            </div>
          ))}
        </div>,
      );
      continue;
    }

    elements.push(
      <p
        key={key++}
        className="my-1 font-jp text-[12px] leading-[1.7] text-fg-muted"
        dangerouslySetInnerHTML={{ __html: inlineStyle(line) }}
      />,
    );
    i++;
  }
  return elements;
}
