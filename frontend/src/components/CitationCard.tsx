import { FileText, Link as LinkIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Citation } from "@/types/api";

export function CitationCard({ citation, active }: { citation: Citation; active: boolean }) {
  const Icon = citation.type === "URL" ? LinkIcon : FileText;
  return (
    <li id={`citation-${citation.n}`} className="scroll-mt-4">
      <Card
        size="sm"
        data-active={active || undefined}
        className="h-full transition-shadow data-active:ring-2 data-active:ring-primary"
      >
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {citation.n}
            </span>
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{citation.title}</span>
          </div>
          {citation.sourceUrl && (
            <a
              href={citation.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              {citation.sourceUrl}
            </a>
          )}
          <p className="line-clamp-3 text-xs break-words text-muted-foreground">
            {citation.snippet}
          </p>
          <span className="text-xs text-muted-foreground">
            {Math.round(citation.similarity * 100)}% match
          </span>
        </CardContent>
      </Card>
    </li>
  );
}
