import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code({ node: _node, inline, className: cls, children, ...props }: any) {
            const match = /language-(\w+)/.exec(cls || "");
            return !inline && match ? (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            ) : (
              <code
                className="bg-muted px-1 py-0.5 rounded text-xs font-mono"
                {...props}
              >
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-sm">{children}</li>;
          },
          h2({ children }) {
            return <h2 className="font-semibold text-sm mt-3 mb-1">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="font-medium text-sm mt-2 mb-1">{children}</h3>;
          },
          strong({ children }) {
            return <strong className="font-semibold">{children}</strong>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground my-2">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
