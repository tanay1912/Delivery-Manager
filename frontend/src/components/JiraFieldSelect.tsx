import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, JiraFieldItem } from "../api/client";

interface JiraFieldSelectProps {
  id?: string;
  value: string;
  onChange: (fieldId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function formatFieldLabel(field: JiraFieldItem): string {
  return `${field.name} (${field.id})`;
}

export default function JiraFieldSelect({
  id,
  value,
  onChange,
  placeholder = "Search Jira fields…",
  disabled = false,
}: JiraFieldSelectProps) {
  const [query, setQuery] = useState("");
  const [fields, setFields] = useState<JiraFieldItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedField = useMemo(
    () => fields.find((field) => field.id === value) ?? null,
    [fields, value],
  );

  const loadFields = useCallback(async (search: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getJiraFields(search, true);
      setFields(data.fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Jira fields");
      setFields([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    const timer = window.setTimeout(() => {
      void loadFields(query.trim());
    }, query.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [disabled, loadFields, query]);

  useEffect(() => {
    if (!value.trim() || fields.some((field) => field.id === value)) return;
    void loadFields(value.trim());
  }, [fields, loadFields, value]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const displayValue = selectedField ? formatFieldLabel(selectedField) : value;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          className="input font-mono flex-1"
          placeholder={placeholder}
          value={open ? query : displayValue}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (!event.target.value.trim()) {
              onChange("");
            }
          }}
          onFocus={() => {
            setOpen(true);
            setQuery(selectedField?.name ?? value);
          }}
          disabled={disabled}
          autoComplete="off"
        />
        {value && !disabled && (
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-60 overflow-y-auto">
          {loading && <p className="px-3 py-2 text-sm text-slate-500">Loading fields…</p>}
          {!loading && error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
          {!loading && !error && fields.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-500">No matching custom fields.</p>
          )}
          {!loading &&
            fields.map((field) => (
              <button
                key={field.id}
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 border-b border-slate-100 last:border-b-0"
                onClick={() => {
                  onChange(field.id);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-900">{field.name}</span>
                <span className="ml-2 font-mono text-xs text-slate-500">{field.id}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
