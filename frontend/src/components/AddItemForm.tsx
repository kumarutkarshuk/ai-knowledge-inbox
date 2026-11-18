import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_MAX_CHARS } from "@/constants";
import { ApiError, apiFetch } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import type { IngestRequest, ItemType } from "@/types/api";

interface Message {
  error: boolean;
  text: string;
}

function errorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Could not reach the server. Try again.";
  if (err.status === 409) return "Already saved";
  if (err.status === 400) return err.message;
  return "Something went wrong. Try again.";
}

export function AddItemForm({ onSaved }: { onSaved: () => void }) {
  const [type, setType] = useState<ItemType>("NOTE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const tooLong = content.length > NOTE_MAX_CHARS;
  const empty = type === "NOTE" ? !content.trim() : !url.trim();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const body: IngestRequest =
      type === "NOTE" ? { type, content, ...(title.trim() && { title }) } : { type, url };
    try {
      const res = await apiFetch("/ingest", { method: "POST", body: JSON.stringify(body) });
      setMessage({ error: false, text: res.status === 201 ? "Saved" : "Restored" });
      if (type === "NOTE") {
        setTitle("");
        setContent("");
      } else {
        setUrl("");
      }
      onSaved();
    } catch (err) {
      setMessage({ error: true, text: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  function changeType(value: string) {
    setType(value as ItemType);
    setMessage(null);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Tabs value={type} onValueChange={changeType}>
        <TabsList>
          <TabsTrigger value="NOTE">Note</TabsTrigger>
          <TabsTrigger value="URL">URL</TabsTrigger>
        </TabsList>
        <TabsContent value="NOTE" className="flex flex-col gap-3 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="note-title">Title (optional)</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="note-content">Note</Label>
            <Textarea
              id="note-content"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              aria-invalid={tooLong || undefined}
              aria-describedby="note-count"
            />
            <p
              id="note-count"
              className={cn("text-xs text-muted-foreground", tooLong && "text-destructive")}
            >
              {content.length.toLocaleString("en-US")} / {NOTE_MAX_CHARS.toLocaleString("en-US")}
            </p>
          </div>
        </TabsContent>
        <TabsContent value="URL" className="flex flex-col gap-2 pt-2">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            type="url"
            placeholder="https://"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </TabsContent>
      </Tabs>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn("text-sm", message.error ? "text-destructive" : "text-muted-foreground")}
        >
          {message.text}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={pending || empty || tooLong}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}
