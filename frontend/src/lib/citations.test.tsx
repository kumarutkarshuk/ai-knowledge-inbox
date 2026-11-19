import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import { describe, expect, it } from "vitest";
import { citationNumber, remarkCitations, splitCitations } from "@/lib/citations";

function html(text: string, count: number) {
  return renderToStaticMarkup(<Markdown remarkPlugins={[remarkCitations(count)]}>{text}</Markdown>);
}

describe("splitCitations", () => {
  it("turns [n] markers into citation links", () => {
    expect(splitCitations("Cats [1]. Dogs [2][3].", 3)).toEqual([
      { type: "text", value: "Cats " },
      { type: "link", url: "#cite-1", children: [{ type: "text", value: "1" }] },
      { type: "text", value: ". Dogs " },
      { type: "link", url: "#cite-2", children: [{ type: "text", value: "2" }] },
      { type: "link", url: "#cite-3", children: [{ type: "text", value: "3" }] },
      { type: "text", value: "." },
    ]);
  });

  it("splits a comma list marker into one link per number", () => {
    expect(splitCitations("[1, 2]", 2).map((n) => n.type === "link" && n.url)).toEqual([
      "#cite-1",
      "#cite-2",
    ]);
  });

  it("accepts the full-width 【n】 markers that gpt-oss writes", () => {
    expect(splitCitations("Leo sleeps【1】 and eats【1, 2】【2†L3-L5】.", 2)).toEqual([
      { type: "text", value: "Leo sleeps" },
      { type: "link", url: "#cite-1", children: [{ type: "text", value: "1" }] },
      { type: "text", value: " and eats" },
      { type: "link", url: "#cite-1", children: [{ type: "text", value: "1" }] },
      { type: "link", url: "#cite-2", children: [{ type: "text", value: "2" }] },
      { type: "link", url: "#cite-2", children: [{ type: "text", value: "2" }] },
      { type: "text", value: "." },
    ]);
  });

  it("leaves markers with no matching citation as text", () => {
    expect(splitCitations("See [0], [4] and [1, 9].", 3)).toEqual([
      { type: "text", value: "See [0], [4] and [1, 9]." },
    ]);
    expect(splitCitations("Not cited [1].", 0)).toEqual([
      { type: "text", value: "Not cited [1]." },
    ]);
  });
});

describe("remarkCitations", () => {
  it("links markers in text, lists and emphasis", () => {
    expect(html("- **Fact [1]**\n- other [2]", 2)).toBe(
      '<ul>\n<li><strong>Fact <a href="#cite-1">1</a></strong></li>\n<li>other <a href="#cite-2">2</a></li>\n</ul>',
    );
  });

  it("does not touch code, code blocks or real links", () => {
    expect(html("`arr[1]` and [1](https://x.com)\n\n```\nx[1]\n```", 1)).toBe(
      '<p><code>arr[1]</code> and <a href="https://x.com">1</a></p>\n<pre><code>x[1]\n</code></pre>',
    );
  });
});

describe("citationNumber", () => {
  it("reads the number from a citation href only", () => {
    expect(citationNumber("#cite-3")).toBe(3);
    expect(citationNumber("https://example.com")).toBeNull();
    expect(citationNumber("#cite-x")).toBeNull();
    expect(citationNumber(undefined)).toBeNull();
  });
});
