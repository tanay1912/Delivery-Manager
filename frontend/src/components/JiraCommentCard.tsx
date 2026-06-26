import { useState } from "react";
import { JiraComment } from "../api/client";
import LinkifiedText from "./LinkifiedText";

const COLLAPSIBLE_HEADERS = ["Development Plan:", "Test Cases:", "Reasoning:"];
const INFO_LABELS = ["Story points:", "Original estimate:"];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function ExternalLinkIcon() {
  return (
    <svg className="h-3.5 w-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)>\]]+/);
  return match ? match[0] : null;
}

interface ParsedSection {
  type: "text" | "branch" | "link" | "info" | "collapsible";
  label?: string;
  value?: string;
  content?: string;
}

function parseCommentBody(body: string): ParsedSection[] {
  const lines = body.split("\n");
  const sections: ParsedSection[] = [];
  let textBuffer: string[] = [];
  let i = 0;

  const flushText = () => {
    if (textBuffer.length > 0) {
      const text = textBuffer.join("\n").trim();
      if (text) sections.push({ type: "text", content: text });
      textBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("Branch:")) {
      flushText();
      sections.push({ type: "branch", value: trimmed.replace(/^Branch:\s*/i, "") });
      i++;
      continue;
    }

    if (trimmed.startsWith("PR:") || /^https?:\/\//.test(trimmed) || /https?:\/\//.test(trimmed)) {
      flushText();
      const url = extractUrl(trimmed);
      if (url) {
        const label = trimmed.startsWith("PR:") ? trimmed : url;
        sections.push({ type: "link", label, value: url });
      } else {
        textBuffer.push(line);
      }
      i++;
      continue;
    }

    const infoLabel = INFO_LABELS.find((l) => trimmed.startsWith(l));
    if (infoLabel) {
      flushText();
      sections.push({
        type: "info",
        label: infoLabel.replace(":", ""),
        value: trimmed.slice(infoLabel.length).trim(),
      });
      i++;
      continue;
    }

    const collapsibleHeader = COLLAPSIBLE_HEADERS.find((h) => trimmed.startsWith(h));
    if (collapsibleHeader) {
      flushText();
      const headerContent = trimmed.slice(collapsibleHeader.length).trim();
      const contentLines: string[] = headerContent ? [headerContent] : [];
      i++;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (
          next.startsWith("Branch:") ||
          next.startsWith("PR:") ||
          /^https?:\/\//.test(next) ||
          INFO_LABELS.some((l) => next.startsWith(l)) ||
          COLLAPSIBLE_HEADERS.some((h) => next.startsWith(h))
        ) {
          break;
        }
        contentLines.push(lines[i]);
        i++;
      }
      sections.push({
        type: "collapsible",
        label: collapsibleHeader.replace(":", ""),
        content: contentLines.join("\n").trim(),
      });
      continue;
    }

    textBuffer.push(line);
    i++;
  }

  flushText();
  return sections.length > 0 ? sections : [{ type: "text", content: body }];
}

function CollapsibleSection({ label, content }: { label: string; content: string }) {
  const [open, setOpen] = useState(false);
  if (!content) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 hover:text-brand-700 transition-colors"
      >
        <span className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
        {label}
      </button>
      {open && (
        <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap break-words leading-relaxed pl-5">
          <LinkifiedText text={content} />
        </p>
      )}
    </div>
  );
}

function CommentBody({ body }: { body: string }) {
  const sections = parseCommentBody(body);

  return (
    <div className="space-y-2">
      {sections.map((section, idx) => {
        if (section.type === "branch" && section.value) {
          return (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Branch:</span>
              <code className="bg-gray-800 text-green-400 rounded px-2 py-0.5 text-xs font-mono">
                {section.value}
              </code>
            </div>
          );
        }
        if (section.type === "link" && section.value) {
          return (
            <a
              key={idx}
              href={section.value}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium break-all"
            >
              {section.label}
              <ExternalLinkIcon />
            </a>
          );
        }
        if (section.type === "info" && section.label) {
          return (
            <div key={idx} className="grid grid-cols-2 gap-x-4 gap-y-1 max-w-sm mt-1">
              <span className="text-xs text-slate-500">{section.label}</span>
              <span className="text-sm font-bold text-slate-900">{section.value}</span>
            </div>
          );
        }
        if (section.type === "collapsible" && section.label) {
          return (
            <CollapsibleSection key={idx} label={section.label} content={section.content ?? ""} />
          );
        }
        if (section.type === "text" && section.content) {
          return (
            <p key={idx} className="text-sm text-slate-700 whitespace-pre-wrap break-words leading-relaxed">
              <LinkifiedText text={section.content} />
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

function inferTag(body: string): string | null {
  if (/Development Plan:/i.test(body)) return "Estimation";
  if (/Test Cases:/i.test(body)) return "Test plan";
  if (/Branch:/i.test(body) && /PR:/i.test(body)) return "Implementation";
  if (/Original estimate:/i.test(body) || /Story points:/i.test(body)) return "Estimation";
  return null;
}

export default function JiraCommentCard({ comment }: { comment: JiraComment }) {
  const tag = inferTag(comment.body);

  return (
    <article className="bg-slate-50 rounded-lg p-4 mb-3 border border-slate-200/80">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-brand-500 text-white text-xs font-bold"
            aria-hidden="true"
          >
            {getInitials(comment.author)}
          </span>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="font-bold text-slate-900 text-sm">{comment.author}</span>
            {tag && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-100 text-brand-700">
                {tag}
              </span>
            )}
          </div>
        </div>
        {comment.created && (
          <time className="text-xs text-slate-400 flex-shrink-0 tabular-nums">
            {new Date(comment.created).toLocaleString()}
          </time>
        )}
      </div>
      <CommentBody body={comment.body} />
    </article>
  );
}
