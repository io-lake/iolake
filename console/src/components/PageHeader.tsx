import type { ReactNode } from "react";

interface Props {
  title: ReactNode;
  description?: ReactNode;
  /// The page's actions, primary last.
  action?: ReactNode;
  /// Set the title in mono: for a page named by an identifier (a bucket, a
  /// table).
  mono?: boolean;
}

/// Every page opens the same way: the title (Sora 600, 22px, or mono for an
/// identifier), one line saying what the page holds, and its actions on the
/// right.
export default function PageHeader({ title, description, action, mono }: Props) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
      <div className="min-w-0">
        <h1
          className={`${mono ? "font-mono text-[21px]" : "font-display text-[22px] tracking-[-0.01em]"} leading-7 font-semibold text-text break-words`}
        >
          {title}
        </h1>
        {description && <p className="text-[13px] text-muted mt-1">{description}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}
