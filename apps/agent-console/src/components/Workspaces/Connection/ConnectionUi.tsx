import { useState } from "react";
import type { ComponentProps } from "react";
import type { ConnectionHeroCardData, ConnectionSignalCardData, ConnectionTone } from "../../../types";

export function ConnectionHeroCard({ eyebrow, title, detail, tone }: ConnectionHeroCardData) {
  return (
    <article className={`connection-hero-card connection-hero-card-${tone}`}>
      <div className="connection-hero-eyebrow">{eyebrow}</div>
      <div className="connection-hero-title">{title}</div>
      <div className="connection-hero-detail">{detail}</div>
    </article>
  );
}

export function ConnectionSignalCard({ label, value, meta, tone }: ConnectionSignalCardData) {
  return (
    <article className={`connection-signal-card connection-signal-card-${tone}`}>
      <div className="connection-signal-label">{label}</div>
      <div className="connection-signal-value">{value}</div>
      <div className="connection-signal-meta">{meta}</div>
    </article>
  );
}

export function PrepStrip({ label, detail, tone }: { label: string; detail: string; tone: ConnectionTone }) {
  return (
    <div className="prep-strip">
      <div className={`prep-dot prep-dot-${tone}`} />
      <div className="prep-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

export function InfoRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={multiline ? "multiline" : ""}>{value}</strong>
    </div>
  );
}

export function SnippetBlock({ label, content }: { label: string; content: string }) {
  return (
    <div className="snippet-block">
      <div className="snippet-label">{label}</div>
      <div className="snippet-content">{content}</div>
    </div>
  );
}

export function ToggleSecretInput(props: ComponentProps<"input">) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="toggle-secret-field">
      <input {...props} type={visible ? "text" : "password"} className={props.className} style={{ ...(props.style ?? {}), flex: 1 }} />
      <button type="button" className="ghost-button" onClick={() => setVisible((current) => !current)}>
        {visible ? "隐藏" : "显示"}
      </button>
    </div>
  );
}
