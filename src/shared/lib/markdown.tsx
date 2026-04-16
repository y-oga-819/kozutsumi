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
      const sizes: Record<HeadingLevel, number> = { 1: 15, 2: 13, 3: 12 };
      elements.push(
        <div
          key={key++}
          style={{
            fontSize: sizes[level],
            fontWeight: 600,
            color: "#e4e4e7",
            marginTop: elements.length ? 14 : 0,
            marginBottom: 6,
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
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
          style={{
            borderLeft: "2px solid #3f3f46",
            paddingLeft: 10,
            margin: "6px 0",
            color: "#71717a",
            fontSize: 12,
            fontStyle: "italic",
            fontFamily: "'Noto Sans JP', sans-serif",
          }}
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
          style={{
            background: "#18181b",
            border: "1px solid #27272a",
            borderRadius: 6,
            padding: "10px 12px",
            margin: "6px 0",
            fontSize: 11,
            color: "#a1a1aa",
            overflow: "auto",
            lineHeight: 1.5,
            whiteSpace: "pre",
          }}
        >
          {lang && (
            <div style={{ fontSize: 9, color: "#52525b", marginBottom: 4 }}>
              {lang}
            </div>
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
        <div key={key++} style={{ margin: "4px 0" }}>
          {items.map((it, j) => (
            <div
              key={j}
              style={{
                display: "flex",
                gap: 6,
                marginLeft: it.indent * 16,
                padding: "2px 0",
                fontSize: 12,
                color: "#a1a1aa",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              <span style={{ color: "#52525b", flexShrink: 0 }}>•</span>
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
        <div key={key++} style={{ margin: "4px 0" }}>
          {items.map((it, j) => (
            <div
              key={j}
              style={{
                display: "flex",
                gap: 6,
                padding: "2px 0",
                fontSize: 12,
                color: "#a1a1aa",
                fontFamily: "'Noto Sans JP', sans-serif",
              }}
            >
              <span
                style={{
                  color: "#52525b",
                  flexShrink: 0,
                  minWidth: 16,
                  textAlign: "right",
                }}
              >
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
        style={{
          fontSize: 12,
          color: "#a1a1aa",
          lineHeight: 1.7,
          margin: "4px 0",
          fontFamily: "'Noto Sans JP', sans-serif",
        }}
        dangerouslySetInnerHTML={{ __html: inlineStyle(line) }}
      />,
    );
    i++;
  }
  return elements;
}
