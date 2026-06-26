export type TerminalLineStatus = "pending" | "done" | "failed" | "active" | "skipped";

export interface TerminalLine {
  id: string;
  text: string;
  status: TerminalLineStatus;
  nested?: boolean;
}

function statusPrefix(status: TerminalLineStatus): { symbol: string; className: string } {
  switch (status) {
    case "done":
      return { symbol: "✓", className: "text-green-400" };
    case "failed":
      return { symbol: "✗", className: "text-red-400" };
    case "active":
      return { symbol: "▶", className: "text-amber-400" };
    case "skipped":
      return { symbol: "–", className: "text-gray-500" };
    default:
      return { symbol: "⏳", className: "text-gray-500" };
  }
}

export default function DeploymentTerminal({ lines }: { lines: TerminalLine[] }) {
  if (lines.length === 0) return null;

  return (
    <div className="bg-gray-900 text-green-400 font-mono text-xs rounded-lg p-4 overflow-x-auto">
      {lines.map((line) => {
        const { symbol, className } = statusPrefix(line.status);
        return (
          <div
            key={line.id}
            className={`flex items-start gap-2 py-0.5 ${line.nested ? "pl-4" : ""} ${className}`}
          >
            <span className="flex-shrink-0 w-4 text-center">{symbol}</span>
            <span className="break-all">{line.text}</span>
          </div>
        );
      })}
    </div>
  );
}
