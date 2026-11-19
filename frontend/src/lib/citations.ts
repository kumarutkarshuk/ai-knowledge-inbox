import type { Link, Nodes, PhrasingContent, Root } from "mdast";

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
const CITE_HREF = /^#cite-(\d+)$/;

function citeLink(n: number): Link {
  return { type: "link", url: `#cite-${n}`, children: [{ type: "text", value: String(n) }] };
}

export function splitCitations(text: string, count: number): PhrasingContent[] {
  const nodes: PhrasingContent[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const numbers = (match[1] ?? "").split(",").map((n) => Number(n.trim()));
    if (numbers.some((n) => n < 1 || n > count)) continue;
    if (match.index > last) nodes.push({ type: "text", value: text.slice(last, match.index) });
    nodes.push(...numbers.map(citeLink));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push({ type: "text", value: text.slice(last) });
  return nodes;
}

function visit(node: Nodes, count: number): void {
  if (!("children" in node) || node.type === "link" || node.type === "linkReference") return;
  const children: Nodes[] = node.children;
  (node as { children: Nodes[] }).children = children.flatMap<Nodes>((child) => {
    if (child.type === "text") return splitCitations(child.value, count);
    visit(child, count);
    return [child];
  });
}

export function remarkCitations(count: number) {
  return () => (tree: Root) => visit(tree, count);
}

export function citationNumber(href: string | undefined): number | null {
  const match = href ? CITE_HREF.exec(href) : null;
  return match ? Number(match[1]) : null;
}
