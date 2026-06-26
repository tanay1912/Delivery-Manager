import { Fragment, ReactNode, useEffect, useState } from "react";
import { api } from "../api/client";

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)>\]]+)/g;
const MEDIA_PATTERN = /\{\{jira-media:([^|{}]+)\|([^}]*)\}\}/g;

function ExternalLinkIcon() {
  return (
    <svg className="h-3 w-3 inline-block ml-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function linkClassName(inline?: boolean) {
  return inline
    ? "text-blue-600 hover:text-blue-800 underline underline-offset-2 break-all"
    : "inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium break-all";
}

function JiraAttachmentImage({ attachmentId, alt }: { attachmentId: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        const response = await fetch(api.jiraAttachmentUrl(attachmentId), {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Attachment unavailable");
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (active) setSrc(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    };

    void load();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachmentId]);

  if (failed) {
    return (
      <div className="my-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Image unavailable{alt ? `: ${alt}` : ""}
      </div>
    );
  }

  if (!src) {
    return (
      <div className="my-2 h-24 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
        <span className="h-4 w-4 rounded-full border-2 border-slate-200 border-t-brand-600 animate-spin" />
      </div>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block my-2">
      <img
        src={src}
        alt={alt || "Jira attachment"}
        className="max-w-full rounded-lg border border-slate-200 shadow-sm"
      />
    </a>
  );
}

function renderInlineSegment(segment: string, keyPrefix: string, inlineLinks: boolean): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(segment)) !== null) {
    if (match.index > lastIndex) {
      parts.push(segment.slice(lastIndex, match.index));
    }

    const markdownLabel = match[1];
    const markdownHref = match[2];
    const bareUrl = match[3];
    const href = markdownHref || bareUrl;
    const label = markdownLabel || bareUrl;

    if (href) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${partIndex++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClassName(inlineLinks)}
        >
          {label}
          {!inlineLinks && <ExternalLinkIcon />}
        </a>,
      );
    }

    lastIndex = LINK_PATTERN.lastIndex;
  }

  if (lastIndex < segment.length) {
    parts.push(segment.slice(lastIndex));
  }

  if (parts.length === 0) {
    return segment;
  }

  return <Fragment key={keyPrefix}>{parts}</Fragment>;
}

function renderLine(line: string, keyPrefix: string, inlineLinks: boolean): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let mediaIndex = 0;

  MEDIA_PATTERN.lastIndex = 0;
  while ((match = MEDIA_PATTERN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      const text = line.slice(lastIndex, match.index);
      if (text) {
        nodes.push(renderInlineSegment(text, `${keyPrefix}-text-${mediaIndex}`, inlineLinks));
      }
    }

    const attachmentId = match[1];
    const alt = match[2];
    nodes.push(
      <JiraAttachmentImage
        key={`${keyPrefix}-media-${mediaIndex++}`}
        attachmentId={attachmentId}
        alt={alt}
      />,
    );
    lastIndex = MEDIA_PATTERN.lastIndex;
  }

  if (lastIndex < line.length) {
    const text = line.slice(lastIndex);
    if (text) {
      nodes.push(renderInlineSegment(text, `${keyPrefix}-tail`, inlineLinks));
    }
  }

  if (nodes.length === 0) {
    return renderInlineSegment(line, keyPrefix, inlineLinks);
  }

  return <Fragment key={keyPrefix}>{nodes}</Fragment>;
}

export default function JiraRichText({
  text,
  className = "",
  inlineLinks = true,
}: {
  text: string;
  className?: string;
  inlineLinks?: boolean;
}) {
  const lines = text.split("\n");

  return (
    <span className={className}>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {renderLine(line, `line-${index}`, inlineLinks)}
        </Fragment>
      ))}
    </span>
  );
}
