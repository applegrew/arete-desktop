import type React from 'react';
import { Fragment, useMemo } from 'react';

/**
 * Tiny dependency-free Markdown renderer for chat bubbles.
 *
 * Handles the subset agents actually emit — headings, bold/italic, inline code,
 * fenced + indented code, ordered/unordered lists, blockquotes, horizontal
 * rules and links — and renders to React nodes (no `dangerouslySetInnerHTML`,
 * so no HTML-injection surface). It is deliberately tolerant of the half-formed
 * markdown that shows up mid-stream: unmatched `**`/`*`/`` ` `` simply render as
 * literal text instead of swallowing the rest of the line.
 */

export interface MarkdownProps {
  text: string;
  /** Muted variant for the thinking channel (smaller, dimmer). */
  dim?: boolean;
}

export function Markdown({ text, dim }: MarkdownProps) {
  const blocks = useMemo(() => renderBlocks(text), [text]);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: dim ? 4 : 8 }}>{blocks}</div>;
}

// ── Block parsing ──────────────────────────────────────────────────────────

function renderBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block ```lang ... ```
    const fence = /^\s*(```|~~~)(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // consume closing fence (or run off the end while streaming)
      out.push(<CodeBlock key={key++} code={body.join('\n')} />);
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(
        <hr
          key={key++}
          style={{ border: 'none', borderTop: '1px solid var(--glass-border, rgba(255,255,255,0.12))', margin: '2px 0' }}
        />,
      );
      i++;
      continue;
    }

    // Heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push(<Heading key={key++} level={level} text={heading[2]!.replace(/\s+#+\s*$/, '')} />);
      i++;
      continue;
    }

    // Blockquote (collapse consecutive `>` lines)
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(
        <blockquote
          key={key++}
          style={{
            margin: 0,
            padding: '2px 0 2px 12px',
            borderLeft: '3px solid var(--glass-border, rgba(124,131,255,0.4))',
            color: 'var(--text-dim, #9aa4b8)',
          }}
        >
          {renderBlocks(quote.join('\n'))}
        </blockquote>,
      );
      continue;
    }

    // List (ordered or unordered) — consume the contiguous run of item lines.
    if (isListItem(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isListItem(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        i++;
      }
      const itemStyle: React.CSSProperties = { marginBottom: 2 };
      out.push(
        ordered ? (
          <ol key={key++} style={{ margin: 0, paddingLeft: 22 }}>
            {items.map((it, idx) => (
              <li key={idx} style={itemStyle}>{renderInline(it)}</li>
            ))}
          </ol>
        ) : (
          <ul key={key++} style={{ margin: 0, paddingLeft: 22 }}>
            {items.map((it, idx) => (
              <li key={idx} style={itemStyle}>{renderInline(it)}</li>
            ))}
          </ul>
        ),
      );
      continue;
    }

    // Paragraph — gather until a blank line or a block-starting line.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !isListItem(lines[i]!) &&
      !/^\s*>/.test(lines[i]!) &&
      !/^(#{1,6})\s+/.test(lines[i]!) &&
      !/^\s*(```|~~~)/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i++;
    }
    out.push(
      <p key={key++} style={{ margin: 0, lineHeight: 1.55 }}>
        {renderInline(para.join('\n'))}
      </p>,
    );
  }

  return out;
}

function isListItem(line: string): boolean {
  return /^\s*([-*+]|\d+[.)])\s+/.test(line);
}

function Heading({ level, text }: { level: number; text: string }) {
  const size = [0, 18, 16.5, 15, 14, 13.5, 13][level] ?? 13.5;
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1.3,
        marginTop: level <= 2 ? 4 : 2,
        color: 'var(--text, #f3f4f6)',
      }}
    >
      {renderInline(text)}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--code-bg, rgba(0,0,0,0.28))',
        border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
        overflowX: 'auto',
        fontSize: 12.5,
        lineHeight: 1.45,
        fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
      }}
    >
      <code>{code}</code>
    </pre>
  );
}

// ── Inline parsing ─────────────────────────────────────────────────────────

// Splits on the inline tokens we support; unmatched delimiters fall through as
// literal text (important while streaming half-finished markdown).
function renderInline(src: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let key = 0;
  let rest = src;

  // Order matters: code first (its contents are opaque), then links, then
  // strong (** / __) before emphasis (* / _).
  const patterns: Array<{ re: RegExp; render: (m: RegExpExecArray) => React.ReactNode }> = [
    {
      re: /`([^`]+)`/,
      render: (m) => (
        <code
          key={key++}
          style={{
            padding: '1px 5px',
            borderRadius: 5,
            background: 'var(--code-bg, rgba(0,0,0,0.28))',
            border: '1px solid var(--glass-border, rgba(255,255,255,0.08))',
            fontSize: '0.92em',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
          }}
        >
          {m[1]}
        </code>
      ),
    },
    {
      re: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
      render: (m) => (
        <a
          key={key++}
          href={m[2]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-2, #22d3ee)', textDecoration: 'underline' }}
        >
          {renderInline(m[1]!)}
        </a>
      ),
    },
    {
      re: /\b(https?:\/\/[^\s<>)]+)/,
      render: (m) => (
        <a
          key={key++}
          href={m[1]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-2, #22d3ee)', textDecoration: 'underline' }}
        >
          {m[1]}
        </a>
      ),
    },
    {
      re: /\*\*([^*]+)\*\*|__([^_]+)__/,
      render: (m) => <strong key={key++} style={{ fontWeight: 700 }}>{renderInline(m[1] ?? m[2]!)}</strong>,
    },
    {
      re: /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?![_\w])/,
      render: (m) => <em key={key++}>{renderInline(m[1] ?? m[2]!)}</em>,
    },
  ];

  // Walk the string, repeatedly taking the earliest-matching pattern.
  while (rest.length > 0) {
    let best: { index: number; len: number; node: React.ReactNode } | null = null;
    for (const { re, render } of patterns) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, len: m[0].length, node: render(m) };
      }
    }
    if (!best) {
      nodes.push(<Fragment key={key++}>{rest}</Fragment>);
      break;
    }
    if (best.index > 0) nodes.push(<Fragment key={key++}>{rest.slice(0, best.index)}</Fragment>);
    nodes.push(best.node);
    rest = rest.slice(best.index + best.len);
  }

  return nodes;
}
