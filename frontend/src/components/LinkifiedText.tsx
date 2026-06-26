import { Fragment, ReactNode } from "react";

const LINK_PATTERN = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)>\]]+)/g;

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

function renderLine(line: string, keyPrefix: string, inlineLinks: boolean): ReactNode {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let partIndex = 0;

  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }

    const markdownLabel = match[1];
    const markdownHref = match[2];
    const bareUrl = match[3];
    const href = markdownHref || bareUrl;
    const label = markdownLabel || bareUrl;

    if (href) {
      parts.push(
        <a
          key={`${keyPrefix}-${partIndex++}`}
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

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  if (parts.length === 0) {
    return line;
  }

  return <Fragment key={keyPrefix}>{parts}</Fragment>;
}

export default function LinkifiedText({
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
