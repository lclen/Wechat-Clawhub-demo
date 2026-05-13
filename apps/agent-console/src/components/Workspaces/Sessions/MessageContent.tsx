type MessageContentProps = {
  content: string;
};

type MessageContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; alt: string }
  | { kind: "file"; url: string; title: string; fileType: string }
  | { kind: "link"; url: string; label: string };

export function MessageContent({ content }: MessageContentProps) {
  const parts = parseMarkdownParts(content);
  if (!parts.length) {
    return <span className="message-text-fragment">{content}</span>;
  }

  return parts.map((part, index) => {
    if (part.kind === "image") {
      return (
        <figure key={`img-${index}-${part.url}`} className="message-media-card">
          <div className="message-media-frame">
            <img className="message-inline-image" src={part.url} alt={part.alt || "message image"} loading="lazy" />
          </div>
          <figcaption className="message-media-meta">
            <strong>{part.alt || "图片附件"}</strong>
            <a href={part.url} target="_blank" rel="noreferrer">
              查看来源
            </a>
          </figcaption>
        </figure>
      );
    }

    if (part.kind === "file") {
      return (
        <a
          key={`file-${index}-${part.url}`}
          className="message-file-card"
          href={part.url}
          target="_blank"
          rel="noreferrer"
          title={part.title}
        >
          <span className="message-file-icon" aria-hidden="true">
            PDF
          </span>
          <span className="message-file-main">
            <span className="message-file-title">{part.title}</span>
            <span className="message-file-meta">{part.fileType}</span>
          </span>
          <span className="message-file-action">打开文档</span>
        </a>
      );
    }

    if (part.kind === "link") {
      return (
        <a
          key={`link-${index}-${part.url}`}
          className="message-inline-link"
          href={part.url}
          target="_blank"
          rel="noreferrer"
        >
          {part.label}
        </a>
      );
    }

    return (
      <span key={`text-${index}`} className="message-text-fragment">
        {part.text}
      </span>
    );
  });
}

function parseMarkdownParts(content: string): MessageContentPart[] {
  const pattern = /(!?)\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  const parts: MessageContentPart[] = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pushTextPart(parts, content.slice(cursor, index), !match[1] && isDocumentLink(match[3], match[2]));
    }
    const label = match[2]?.trim() || "";
    const url = extractMarkdownUrl(match[3] || "");
    if (!url) {
      parts.push({ kind: "text", text: match[0] });
      cursor = index + match[0].length;
      continue;
    }

    if (match[1]) {
      parts.push({
        kind: "image",
        alt: label,
        url,
      });
      cursor = index + match[0].length;
      continue;
    }

    if (isDocumentLink(url, label)) {
      parts.push({
        kind: "file",
        title: label || getFileNameFromUrl(url) || "文档附件",
        fileType: getDocumentFileType(url, label),
        url,
      });
      cursor = index + match[0].length;
      continue;
    }

    parts.push({
      kind: "link",
      label: label || url,
      url,
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ kind: "text", text: content.slice(cursor) });
  }

  return parts;
}

function pushTextPart(parts: MessageContentPart[], text: string, beforeFileCard = false) {
  if (!text) {
    return;
  }
  const normalized = beforeFileCard ? text.replace(/(^|\n)[ \t]*[-*][ \t]*$/, "$1") : text;
  if (normalized) {
    parts.push({ kind: "text", text: normalized });
  }
}

function extractMarkdownUrl(rawUrl: string): string {
  return rawUrl.split(" ", 1)[0].trim();
}

function isDocumentLink(url: string, label: string): boolean {
  const normalizedUrl = safeDecode(url).toLowerCase();
  const normalizedLabel = label.toLowerCase();
  return (
    /(?:^|[/?#&=._-])pdf(?:$|[/?#&=._-])/.test(normalizedUrl) ||
    /\.(?:pdf|docx?|xlsx?|pptx?)(?:$|[?#&])/.test(normalizedUrl) ||
    /\bpdf\b/i.test(label) ||
    ["产品说明书", "说明书", "文档", "接线图"].some((keyword) => normalizedLabel.includes(keyword.toLowerCase()))
  );
}

function getDocumentFileType(url: string, label: string): string {
  const normalized = `${safeDecode(url)} ${label}`.toLowerCase();
  if (normalized.includes("pdf")) {
    return "PDF 文档";
  }
  if (/\.(?:doc|docx)(?:$|[?#&\s])/.test(normalized)) {
    return "Word 文档";
  }
  if (/\.(?:xls|xlsx)(?:$|[?#&\s])/.test(normalized)) {
    return "Excel 表格";
  }
  if (/\.(?:ppt|pptx)(?:$|[?#&\s])/.test(normalized)) {
    return "PPT 演示文稿";
  }
  return "文件链接";
}

function getFileNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);
    return safeDecode(segments.at(-1) || "");
  } catch {
    const segments = url.split("?")[0].split("#")[0].split("/").filter(Boolean);
    return safeDecode(segments.at(-1) || "");
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
