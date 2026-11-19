import { FileText, Link as LinkIcon } from "lucide-react";
import type { Citation } from "@/types/api";

interface Props {
  id: string;
  citation: Citation;
  active: boolean;
}

export function CitationCard({ id, citation, active }: Props) {
  const Icon = citation.type === "URL" ? LinkIcon : FileText;
  return (
    <li id={id} className="min-w-0 scroll-mt-28 border-t border-hairline">
      <div
        data-active={active || undefined}
        className="flex h-full flex-col gap-1 px-3 py-3 text-sm transition-[background-color] duration-(--dur-short) data-active:bg-brick/15 data-active:outline data-active:-outline-offset-1 data-active:outline-brick"
      >
        <div className="flex items-baseline gap-2">
          <span className="font-figure text-sm text-brick tabular-nums">{citation.n}</span>
          <Icon aria-hidden className="size-3.5 shrink-0 self-center text-muted-foreground" />
          <span className="truncate font-medium">{citation.title}</span>
        </div>
        {citation.sourceUrl && (
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-brick underline decoration-1 underline-offset-[0.16em] hover:decoration-2"
          >
            {citation.sourceUrl}
          </a>
        )}
        <p className="line-clamp-3 break-words text-muted-foreground">{citation.snippet}</p>
        <span className="font-figure text-xs text-muted-foreground tabular-nums">
          {Math.round(citation.similarity * 100)}% match
        </span>
      </div>
    </li>
  );
}
