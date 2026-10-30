// Enough Markdown for wiki pages: headings, lists, paragraphs, code fences,
// inline code, bold, and links (relative wiki links resolve to pages).

import type { ReactNode } from "react";

interface Props {
  text: string;
  /** Called for links to other wiki pages (relative .md paths). */
  linkTo?: (path: string) => string;
  currentPath?: string;
}

export function Markdown({ text, linkTo, currentPath }: Props) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const resolve = (target: string): string => {
    if (/^https?:/.test(target)) {
      return target;
    }
    if (!linkTo) {
      return target;
    }
    const base = (currentPath ?? "").split("/").slice(0, -1);
    const parts = [...base];
    for (const seg of target.split("/")) {
      if (seg === "..") {
        parts.pop();
      } else if (seg !== ".") {
        parts.push(seg);
      }
    }
    return linkTo(parts.join("/"));
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(
        <pre key={key++}>
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const content = inline(h[2], resolve);
      out.push(level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(<li key={items.length}>{inline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""), resolve)}</li>);
        i += 1;
      }
      out.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3})\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !lines[i].startsWith("```")) {
      buf.push(lines[i]);
      i += 1;
    }
    out.push(<p key={key++}>{inline(buf.join(" "), resolve)}</p>);
  }
  return <div className="md">{out}</div>;
}

function inline(s: string, resolve: (t: string) => string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) {
      nodes.push(s.slice(last, m.index));
    }
    if (m[1]) {
      nodes.push(<code key={k++}>{m[1].slice(1, -1)}</code>);
    } else if (m[2]) {
      nodes.push(<strong key={k++}>{m[2].slice(2, -2)}</strong>);
    } else if (m[3]) {
      const target = resolve(m[5]);
      const external = /^https?:/.test(m[5]);
      nodes.push(
        <a key={k++} href={target} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
          {m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    nodes.push(s.slice(last));
  }
  return nodes;
}
