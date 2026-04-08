type MessageContentProps = {
  content: string;
};

type MessageContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; alt: string };

export function MessageContent({ content }: MessageContentProps) {
  const parts = parseMarkdownImageParts(content);
  if (!parts.length) {
    return content;
  }

  return parts.map((part, index) => {
    if (part.kind === "image") {
      return (
        <figure key={`img-${index}-${part.url}`} className="message-image-block">
          <img className="message-inline-image" src={part.url} alt={part.alt || "message image"} loading="lazy" />
          {part.alt ? <figcaption>{part.alt}</figcaption> : null}
        </figure>
      );
    }

    return (
      <span key={`text-${index}`} className="message-text-fragment">
        {part.text}
      </span>
    );
  });
}

function parseMarkdownImageParts(content: string): MessageContentPart[] {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g;
  const parts: MessageContentPart[] = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: "text", text: content.slice(cursor, index) });
    }
    parts.push({
      kind: "image",
      alt: match[1]?.trim() || "",
      url: match[2].split(" ", 1)[0].trim(),
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push({ kind: "text", text: content.slice(cursor) });
  }

  return parts;
}
