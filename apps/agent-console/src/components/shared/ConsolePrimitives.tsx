import type { PropsWithChildren, ReactNode } from "react";

type SurfaceCardProps = PropsWithChildren<{
  className?: string;
  tone?: "default" | "accent" | "strong";
  style?: import("react").CSSProperties;
}>;

type SectionHeaderProps = {
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

type SignalBadgeProps = {
  tone: "good" | "warn" | "info" | "neutral";
  children: ReactNode;
  className?: string;
  style?: import("react").CSSProperties;
};

type MetricStripItem = {
  label: string;
  value: string;
  detail?: string;
};

type MetricCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "default" | "accent" | "healthy" | "warning";
  className?: string;
  style?: import("react").CSSProperties;
};

type MetricStripProps = {
  items: MetricStripItem[];
  className?: string;
  style?: import("react").CSSProperties;
};

type CommandBarProps = PropsWithChildren<{
  className?: string;
  label?: string;
  detail?: string;
  style?: import("react").CSSProperties;
}>;

type EmptyStateProps = {
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
};

type InfoListProps = {
  items: Array<{
    label: string;
    value: ReactNode;
    multiline?: boolean;
  }>;
  className?: string;
  style?: import("react").CSSProperties;
};

export function SurfaceCard({ className = "", tone = "default", style, children }: SurfaceCardProps) {
  const mergedClassName = ["surface", "surface-card", `surface-card-${tone}`, className].filter(Boolean).join(" ");
  return <section className={mergedClassName} style={style}>{children}</section>;
}

export function SectionHeader({ kicker, title, description, actions, className = "" }: SectionHeaderProps) {
  return (
    <div className={["console-section-header", className].filter(Boolean).join(" ")}>
      <div className="console-section-copy">
        {kicker ? <div className="section-kicker">{kicker}</div> : null}
        <h3>{title}</h3>
        {description ? <p className="console-section-description">{description}</p> : null}
      </div>
      {actions ? <div className="console-section-actions">{actions}</div> : null}
    </div>
  );
}

export function SignalBadge({ tone, children, className = "", style }: SignalBadgeProps) {
  return (
    <span className={["signal-badge", `signal-badge-${tone}`, className].filter(Boolean).join(" ")} style={style}>
      {children}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  className = "",
  style,
}: MetricCardProps) {
  return (
    <article className={["metric-card", `metric-card-${tone}`, className].filter(Boolean).join(" ")} style={style}>
      <span className="metric-card-label">{label}</span>
      <strong className="metric-card-value">{value}</strong>
      {detail ? <small className="metric-card-detail">{detail}</small> : null}
    </article>
  );
}

export function MetricStrip({ items, className = "", style }: MetricStripProps) {
  return (
    <div className={["metric-strip", className].filter(Boolean).join(" ")} style={style}>
      {items.map((item) => (
        <MetricCard
          key={`${item.label}-${item.value}`}
          label={item.label}
          value={item.value}
          detail={item.detail}
          className="metric-strip-item"
        />
      ))}
    </div>
  );
}

export function CommandBar({ className = "", label, detail, style, children }: CommandBarProps) {
  return (
    <div className={["command-bar", className].filter(Boolean).join(" ")} style={style}>
      {label || detail ? (
        <div className="command-bar-copy">
          {label ? <span className="command-bar-label">{label}</span> : null}
          {detail ? <span className="command-bar-detail">{detail}</span> : null}
        </div>
      ) : null}
      <div className="command-bar-actions">{children}</div>
    </div>
  );
}

export function EmptyState({ title, detail, action, className = "" }: EmptyStateProps) {
  return (
    <div className={["console-empty-state", className].filter(Boolean).join(" ")}>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {action ? <div className="console-empty-state-action">{action}</div> : null}
    </div>
  );
}

export function InfoList({ items, className = "", style }: InfoListProps) {
  return (
    <div className={["console-info-list", className].filter(Boolean).join(" ")} style={style}>
      {items.map((item) => (
        <div key={item.label} className={`console-info-row ${item.multiline ? "is-multiline" : ""}`}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
