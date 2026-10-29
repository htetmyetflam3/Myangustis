import { useEffect, useRef, type ReactNode } from "react";


export type ToolShellProps = {
  open: boolean;
  onClose: () => void;
  file: string;
  status: string;
  eyebrow: string;
  title: ReactNode;
  subtitle: string;
  icon: ReactNode;
  badges?: string[];
  footer?: ReactNode;
  children: ReactNode;
};

export function ToolShell({
  open,
  onClose,
  file,
  status,
  eyebrow,
  title,
  subtitle,
  icon,
  badges = [],
  footer,
  children,
}: ToolShellProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="ak-fade fixed inset-0 z-90 flex items-start justify-center overflow-y-auto bg-[#0e1626]/65 p-3 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={eyebrow}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="ak-zoom my-auto w-full max-w-6xl overflow-hidden rounded-3xl border border-[#0e1626]/16 bg-white shadow-[0_40px_120px_-40px_rgba(10,17,36,0.6)]">
        {/* window chrome */}
        <div className="flex items-center gap-3 border-b border-[#0e1626]/16 bg-gradient-to-r from-[#f7ece6] via-white to-[#f5f0e6] px-4 py-3 sm:px-6">
          {/* one drawing, not three empty <i> boxes */}
          <svg className="h-3 w-11 shrink-0" viewBox="0 0 44 12" aria-hidden="true">
            <circle cx="6" cy="6" r="6" fill="#c63b26" />
            <circle cx="22" cy="6" r="6" fill="#e0a63c" />
            <circle cx="38" cy="6" r="6" fill="#2e7d5b" />
          </svg>
          <span className="font-mono2 truncate text-[11px] text-[#7a7266] sm:text-xs">{file}</span>
          <span className="ml-auto hidden items-center gap-2 rounded-full border border-[#c63b26]/25 bg-white px-3 py-1 text-[11px] font-semibold text-[#c63b26] sm:inline-flex">
            <i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2e7d5b]" />
            {status}
          </span>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full border border-[#0e1626]/16 bg-white text-[#7a7266] transition hover:border-[#c63b26] hover:text-[#c63b26]"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* header */}
        <div className="flex flex-col gap-4 border-b border-[#0e1626]/16 px-4 py-5 sm:flex-row sm:items-center sm:px-6">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#c63b26] to-[#e0a63c] text-white shadow-lg shadow-[#c63b26]/25">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#c63b26]">{eyebrow}</p>
            <h2 className="mt-0.5 text-xl font-extrabold tracking-tight text-[#0e1626] sm:text-2xl">{title}</h2>
            <p className="mm mt-1 text-sm text-[#7a7266]">{subtitle}</p>
          </div>
          {badges.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {badges.map((b) => (
                <span key={b} className="rounded-full border border-[#0e1626]/16 bg-[#f7f2e7] px-3 py-1 text-[11px] font-semibold text-[#7a7266]">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* body */}
        <div className="ak-scroll max-h-[min(66vh,720px)] overflow-y-auto bg-[#f7f2e7] px-4 py-5 sm:px-6">{children}</div>

        {/* footer */}
        {footer && (
          <div className="flex flex-col gap-3 border-t border-[#0e1626]/16 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
