import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { NOTE_MAX_CHARS, NOTE_TITLE_MAX_CHARS, URL_MAX_CHARS } from "../constants.js";
import { HttpError } from "../errors.js";
import { decideIngest, hashNote, normalizeUrl, noteTitle } from "../ingest.js";
import {
  DuplicateItemError,
  findItemByKey,
  insertNoteItem,
  insertUrlItem,
  listItems,
  restoreItem,
  softDeleteItem,
  type ItemKey,
  type ItemRow,
} from "../itemQueries.js";
import type { IngestResponse, Item, ItemsResponse } from "../types/api.js";

const ingestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("NOTE"),
    content: z
      .string()
      .trim()
      .min(1, "Note is empty")
      .max(NOTE_MAX_CHARS, `Note is longer than ${NOTE_MAX_CHARS} chars`),
    title: z
      .string()
      .trim()
      .max(NOTE_TITLE_MAX_CHARS, `Title is longer than ${NOTE_TITLE_MAX_CHARS} chars`)
      .optional(),
  }),
  z.object({
    type: z.literal("URL"),
    url: z
      .string()
      .trim()
      .max(URL_MAX_CHARS, `URL is longer than ${URL_MAX_CHARS} chars`)
      .pipe(z.url({ protocol: /^https?$/, error: "URL must start with http:// or https://" })),
  }),
]);

const idSchema = z.uuid();

export function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    type: row.type,
    title: row.title || row.source_url || "",
    sourceUrl: row.source_url,
    preview: row.preview,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
  };
}

function alreadyExists(): HttpError {
  return new HttpError(409, "ALREADY_EXISTS", "Already saved");
}

async function insertItem(insert: () => Promise<ItemRow>): Promise<ItemRow> {
  try {
    return await insert();
  } catch (err) {
    if (err instanceof DuplicateItemError) throw alreadyExists();
    throw err;
  }
}

export function itemsRouter(pool: pg.Pool) {
  const router = Router();

  router.post("/ingest", async (req, res) => {
    const parsed = ingestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid");
    }
    const body = parsed.data;
    const key: ItemKey =
      body.type === "URL"
        ? { column: "source_url", value: normalizeUrl(body.url) }
        : { column: "content_hash", value: hashNote(body.content) };

    const existing = await findItemByKey(pool, key);
    const decision = decideIngest(existing);
    if (decision === "CONFLICT") throw alreadyExists();

    if (decision === "INSERT") {
      const row = await insertItem(() =>
        body.type === "URL"
          ? insertUrlItem(pool, key.value)
          : insertNoteItem(pool, {
              title: noteTitle(body.content, body.title),
              content: body.content,
              hash: key.value,
            }),
      );
      console.info(`Item ${row.id} created (${row.type})`);
      res.status(201).json({ item: toItem(row) } satisfies IngestResponse);
      return;
    }

    const row =
      existing && (await restoreItem(pool, existing.id, decision === "RESTORE_AND_REQUEUE"));
    if (!row) throw alreadyExists();
    console.info(`Item ${row.id} restored (${row.status})`);
    res.status(200).json({ item: toItem(row) } satisfies IngestResponse);
  });

  router.get("/items", async (_req, res) => {
    const rows = await listItems(pool);
    res.json({ items: rows.map(toItem) } satisfies ItemsResponse);
  });

  router.delete("/items/:id", async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const result = id.success ? await softDeleteItem(pool, id.data) : "NOT_FOUND";
    if (result === "NOT_FOUND") throw new HttpError(404, "NOT_FOUND", "Item not found");
    if (result === "BUSY") throw new HttpError(409, "ITEM_BUSY", "Item is still being processed");
    console.info(`Item ${id.data} deleted`);
    res.status(204).end();
  });

  return router;
}
