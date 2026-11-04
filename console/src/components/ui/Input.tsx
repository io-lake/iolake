import { useId, type InputHTMLAttributes, type ReactNode } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  /** 11px/600 label rendered above the control. */
  label?: ReactNode;
  /** Leading icon, 13px, sits at left-2.5. */
  icon?: ReactNode;
  hint?: ReactNode;
  error?: string;
}

/// 32px control. Focus is a soft accent ring plus an accent border. The label
/// is tied to the control, so a screen reader names the field.
export default function Input({ label, icon, hint, error, className = "", id, ...rest }: Props) {
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
      <div className="relative">
        {icon && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none">
            {icon}
          </span>
        )}
        <input
          {...rest}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? noteId : undefined}
          className={`w-full h-8 ${icon ? "pl-8" : "pl-2.5"} pr-2.5 bg-surface text-text
            border border-border-strong rounded-control text-[13px]
            placeholder:text-muted focus:outline-none focus:border-accent
            focus:ring-2 focus:ring-accent-soft ${error ? "border-err" : ""} ${className}`}
        />
      </div>
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
