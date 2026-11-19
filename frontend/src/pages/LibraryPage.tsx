import { FileText, Link as LinkIcon, LoaderCircle, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddItemForm } from "@/components/AddItemForm";
import { Button } from "@/components/ui/button";
import { ITEMS_POLL_MS } from "@/constants";
import { ApiError, apiFetch, apiJson } from "@/lib/apiClient";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Item, ItemsResponse, ItemStatus } from "@/types/api";

interface ListState {
  items: Item[] | null;
  error: string | null;
}

const STATUS_CLASS = {
  SUBMITTED: "text-muted-foreground",
  PROCESSING: "text-muted-foreground",
  READY: "text-muted-foreground",
  FAILED: "text-destructive",
} as const satisfies Record<ItemStatus, string>;

function isBusy(item: Item): boolean {
  return item.status === "SUBMITTED" || item.status === "PROCESSING";
}

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not reach the server. Try again.";
  return err.message;
}

function ItemRow({ item, onDelete }: { item: Item; onDelete: (item: Item) => void }) {
  const Icon = item.type === "URL" ? LinkIcon : FileText;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_2rem] gap-x-3 gap-y-2 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto_2rem] sm:gap-x-5">
      <Icon
        aria-label={item.type === "URL" ? "URL" : "Note"}
        className="row-span-2 mt-1 size-4 shrink-0 text-muted-foreground"
      />
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
        <span className="truncate font-heading text-base font-bold tracking-[-0.01em]">
          {item.title}
        </span>
        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate text-sm text-brick underline decoration-1 underline-offset-[0.16em] hover:decoration-2"
          >
            {item.sourceUrl}
          </a>
        )}
        {item.preview && (
          <p className="line-clamp-2 max-w-[65ch] text-sm break-words text-muted-foreground">
            {item.preview}
          </p>
        )}
        {item.status === "FAILED" && item.errorMessage && (
          <p className="text-sm text-destructive">{item.errorMessage}</p>
        )}
      </div>
      <div className="col-start-2 row-start-2 flex items-baseline gap-3 text-sm sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:gap-1">
        <span className={cn("inline-flex items-center gap-1.5", STATUS_CLASS[item.status])}>
          {isBusy(item) && <LoaderCircle aria-hidden className="size-3.5 animate-spin" />}
          <span className="sentence-case inline-block">{item.status}</span>
        </span>
        <time
          dateTime={item.createdAt}
          className="font-figure text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {formatDateTime(item.createdAt)}
        </time>
      </div>
      {!isBusy(item) && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${item.title}`}
          onClick={() => onDelete(item)}
          className="col-start-3 row-start-1 -mt-1 text-muted-foreground hover:text-destructive sm:col-start-4"
        >
          <Trash2 />
        </Button>
      )}
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-3xl">Library</h1>
      <AddItemForm onSaved={() => void load()} />
      <div aria-hidden className="rule-double mt-4" />
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
        <ul aria-label="Items" className="-mt-4 flex flex-col divide-y divide-hairline">
          {items.map((item) => (
            <ItemRow key={item.id} item={item} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </div>
  );
}
