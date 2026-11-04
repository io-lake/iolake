import { useId, type ReactNode, type SelectHTMLAttributes } from "react";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  /** 11px/600 label rendered above the control, matching Input. */
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
}

/// Same 32px control and focus treatment as Input. Four pages were each
/// hand-rolling a select with slightly different padding and radius, which is
/// how a form ends up with controls that do not line up.
export default function Select({ label, hint, error, className = "", children, id, ...rest }: Props) {
  const auto = useId();
  const fieldId = id ?? auto;
  const noteId = `${fieldId}-note`;
  return (
    <div>
      {label && (
        <label htmlFor={fieldId} className="block text-[11px] font-semibold text-text-2 mb-1">
          {label}
        </label>
      )}
      <select
        {...rest}
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? noteId : undefined}
        className={`w-full h-8 px-2.5 bg-surface text-text border rounded-control text-[13px]
          focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft
          ${error ? "border-err" : "border-border-strong"} ${className}`}
      >
        {children}
      </select>
      {error ? (
        <p id={noteId} className="mt-1 text-[11px] text-err">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-[11px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
