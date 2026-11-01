"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Images are never loaded: an image URL written into a report could send data to another site.
  img: ({ alt }) => <span className="image-placeholder">[image{alt ? `: ${alt}` : ""}]</span>,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  ),
};

/** Renders AI-written Markdown. Raw HTML is shown as text and images aren't loaded. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
