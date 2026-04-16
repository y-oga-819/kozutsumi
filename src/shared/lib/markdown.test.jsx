import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { renderMarkdown } from "./markdown.jsx";

describe("renderMarkdown", () => {
  test("null/undefined は null を返す", () => {
    expect(renderMarkdown(null)).toBeNull();
    expect(renderMarkdown(undefined)).toBeNull();
  });

  test("見出し (#, ##, ###) がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("# Title\n## Sub\n### Sub2")}</>);
    expect(container.textContent).toContain("Title");
    expect(container.textContent).toContain("Sub");
    expect(container.textContent).toContain("Sub2");
  });

  test("箇条書き (- item) がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("- item1\n- item2")}</>);
    expect(container.textContent).toContain("item1");
    expect(container.textContent).toContain("item2");
  });

  test("番号付きリスト (1. item) がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("1. first\n2. second")}</>);
    expect(container.textContent).toContain("first");
    expect(container.textContent).toContain("second");
  });

  test("コードブロック (```) がレンダリングされる", () => {
    const md = "```js\nconst x = 1;\n```";
    const { container } = render(<>{renderMarkdown(md)}</>);
    expect(container.textContent).toContain("const x = 1;");
  });

  test("blockquote (> text) がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("> quoted text")}</>);
    expect(container.textContent).toContain("quoted text");
  });

  test("インラインコードが <code> 要素で囲まれる", () => {
    const { container } = render(<>{renderMarkdown("use `myFunc()` here")}</>);
    expect(container.innerHTML).toContain("<code");
    expect(container.textContent).toContain("myFunc()");
  });

  test("太字 (**text**) がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("**bold text**")}</>);
    expect(container.innerHTML).toContain("<strong");
    expect(container.textContent).toContain("bold text");
  });

  test("段落がレンダリングされる", () => {
    const { container } = render(<>{renderMarkdown("plain text")}</>);
    expect(container.textContent).toContain("plain text");
  });
});
