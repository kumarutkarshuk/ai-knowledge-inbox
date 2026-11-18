import { FileText, Link as LinkIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddItemForm } from "@/components/AddItemForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ITEMS_POLL_MS } from "@/constants";
import { ApiError, apiFetch, apiJson } from "@/lib/apiClient";
import type { Item, ItemsResponse, ItemStatus } from "@/types/api";

interface ListState {
  items: Item[] | null;
  error: string | null;
}

const STATUS_VARIANT = {
  SUBMITTED: "secondary",
  PROCESSING: "secondary",
  READY: "outline",
  FAILED: "destructive",
} as const satisfies Record<ItemStatus, string>;

function isBusy(item: Item): boolean {
  return item.status === "SUBMITTED" || item.status === "PROCESSING";
}

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not reach the server. Try again.";
  return err.message;
}

function ItemCard({ item, onDelete }: { item: Item; onDelete: (item: Item) => void }) {
  const Icon = item.type === "URL" ? LinkIcon : FileText;
  return (
    <li>
      <Card size="sm">
        <CardContent className="flex items-start gap-3">
          <Icon
            aria-label={item.type === "URL" ? "URL" : "Note"}
            className="mt-0.5 size-4 shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{item.title}</span>
              <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
            </div>
            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-muted-foreground underline-offset-4 hover:underline"
              >
                {item.sourceUrl}
              </a>
            )}
            {item.preview && (
              <p className="line-clamp-2 break-words text-muted-foreground">{item.preview}</p>
            )}
            {item.status === "FAILED" && item.errorMessage && (
              <p className="text-destructive">{item.errorMessage}</p>
            )}
            <time dateTime={item.createdAt} className="text-xs text-muted-foreground">
              {new Date(item.createdAt).toLocaleString()}
            </time>
          </div>
          {!isBusy(item) && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${item.title}`}
              onClick={() => onDelete(item)}
            >
              <Trash2 />
            </Button>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

export function LibraryPage() {
  const [list, setList] = useState<ListState>({ items: null, error: null });
  const [actionError, setActionError] = useState<string | null>(null);

  const latestLoad = useRef(0);

  const load = useCallback(async () => {
    const id = ++latestLoad.current;
    try {
      const { items } = await apiJson<ItemsResponse>("/items");
      if (id === latestLoad.current) setList({ items, error: null });
    } catch (err) {
      if (id === latestLoad.current) {
        setList((prev) => ({ items: prev.items, error: errorMessage(err) }));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const polling = list.items?.some(isBusy) ?? false;
  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(() => void load(), ITEMS_POLL_MS);
    return () => clearTimeout(timer);
  }, [list, polling, load]);

  async function onDelete(item: Item) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    setActionError(null);
    try {
      await apiFetch(`/items/${item.id}`, { method: "DELETE" });
    } catch (err) {
      setActionError(errorMessage(err));
    }
    await load();
  }

  const { items, error } = list;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Library</h1>
      <AddItemForm onSaved={() => void load()} />
      {[error, actionError].map(
        (message) =>
          message && (
            <p key={message} role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ),
      )}
      {items === null && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
      {items?.length === 0 && (
        <p className="text-sm text-muted-foreground">No items yet. Add a note or a URL above.</p>
      )}
      {items && items.length > 0 && (
        <ul aria-label="Items" className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}
