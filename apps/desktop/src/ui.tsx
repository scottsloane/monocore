// Small dark-theme UI primitives shared across views.
import type { ReactNode, ButtonHTMLAttributes } from "react";

export function Dot({ ok }: { ok: boolean | undefined }) {
  const color = ok === undefined ? "bg-muted" : ok ? "bg-ok" : "bg-err";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${color} shadow-[0_0_8px] shadow-current`}
    />
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border bg-panel/80 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "subtle";
};
export function Button({
  variant = "subtle",
  className = "",
  ...props
}: BtnProps) {
  const styles = {
    primary:
      "bg-gradient-to-r from-accent to-accent-2 text-white shadow-lg shadow-accent/20 enabled:hover:brightness-110",
    ghost:
      "border border-border bg-transparent text-muted enabled:hover:text-fg",
    subtle: "border border-border bg-panel text-fg enabled:hover:bg-panel-2",
  }[variant];
  return (
    <button
      {...props}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    />
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-muted/60">{hint}</span>}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={`rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-fg outline-none transition placeholder:text-muted/40 focus:border-accent ${props.className ?? ""}`}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${
            value === o.value
              ? "border-accent bg-accent/15 text-fg"
              : "border-border bg-panel text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "ok" | "warn" | "err" | "accent";
}) {
  const tones = {
    muted: "bg-panel-2 text-muted",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    err: "bg-err/15 text-err",
    accent: "bg-accent/15 text-accent-2",
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tones}`}
    >
      {children}
    </span>
  );
}

export function LogConsole({
  lines,
  empty,
  className = "",
}: {
  lines: string[];
  empty?: string;
  className?: string;
}) {
  return (
    <div
      ref={(el) => el?.scrollTo(0, el.scrollHeight)}
      className={`overflow-auto rounded-lg border border-border bg-bg/60 p-3 font-mono text-xs leading-relaxed ${className}`}
    >
      {lines.length === 0 ? (
        <span className="text-muted/50">{empty ?? "No output yet."}</span>
      ) : (
        lines.map((l, i) => (
          <div key={i} className="whitespace-pre-wrap text-fg/90">
            {l}
          </div>
        ))
      )}
    </div>
  );
}
