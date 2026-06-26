import { InputHTMLAttributes, useState } from "react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  wrapperClassName?: string;
  /** Fetches the saved secret when the user clicks show on an empty field. */
  onReveal?: () => Promise<void>;
}

export default function PasswordInput({
  className = "input",
  wrapperClassName,
  onReveal,
  value,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const hasValue = String(value ?? "").length > 0;

  const handleToggle = async () => {
    if (visible) {
      setVisible(false);
      return;
    }

    if (!hasValue && onReveal) {
      setRevealing(true);
      try {
        await onReveal();
      } catch {
        return;
      } finally {
        setRevealing(false);
      }
    }

    setVisible(true);
  };

  return (
    <div className={`relative w-full ${wrapperClassName ?? ""}`}>
      <input {...props} value={value} type={visible ? "text" : "password"} className={`${className} pr-10`} />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => void handleToggle()}
        disabled={revealing || props.disabled}
        className="absolute right-3 top-1/2 z-10 -translate-y-1/2 text-slate-400 hover:text-slate-600 disabled:opacity-50 p-0.5"
        aria-label={visible ? "Hide" : "Show"}
        tabIndex={-1}
      >
        {revealing ? (
          <span className="block h-4 w-4 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
        ) : visible ? (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
