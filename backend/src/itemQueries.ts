import pg from "pg";
import { NOTE_PREVIEW_CHARS } from "./constants.js";
import type { KnowledgeBaseRow } from "./db.js";

type Queryable = pg.Pool | pg.PoolClient;

const UNIQUE_VIOLATION = "23505";

const ITEM_COLUMNS = `id, type, title, source_url, status, error_message, created_at,
  case when type = 'NOTE' then left(raw_content, ${NOTE_PREVIEW_CHARS}) end as preview`;

export type ItemRow = Pick<
  KnowledgeBaseRow,
  "id" | "type" | "title" | "source_url" | "status" | "error_message" | "created_at"
> & { preview: string | null };

export type ItemKey = { column: "source_url" | "content_hash"; value: string };

export type DedupeRow = Pick<KnowledgeBaseRow, "id" | "status" | "deleted_at">;

export type DeleteResult = "DELETED" | "NOT_FOUND" | "BUSY";

export class DuplicateItemError extends Error {}

export async function findItemByKey(db: Queryable, key: ItemKey): Promise<DedupeRow | undefined> {
  const { rows } = await db.query<DedupeRow>(
    `select id, status, deleted_at from knowledge_base where ${key.column} = $1`,
    [key.value],
  );
  return rows[0];
}

async function insertOne(db: Queryable, sql: string, params: unknown[]): Promise<ItemRow> {
  try {
    const { rows } = await db.query<ItemRow>(sql, params);
    return rows[0] as ItemRow;
  } catch (err) {
    if (err instanceof pg.DatabaseError && err.code === UNIQUE_VIOLATION) {
      throw new DuplicateItemError();
    }
    throw err;
  }
}

export function insertUrlItem(db: Queryable, sourceUrl: string): Promise<ItemRow> {
  return insertOne(
    db,
    `insert into knowledge_base (type, source_url) values ('URL', $1) returning ${ITEM_COLUMNS}`,
    [sourceUrl],
  );
}

export function insertNoteItem(
  db: Queryable,
  note: { title: string; content: string; hash: string },
): Promise<ItemRow> {
  return insertOne(
    db,
    `insert into knowledge_base (type, title, raw_content, content_hash)
     values ('NOTE', $1, $2, $3) returning ${ITEM_COLUMNS}`,
    [note.title, note.content, note.hash],
  );
}

export async function restoreItem(
  db: Queryable,
  id: string,
  requeue: boolean,
): Promise<ItemRow | undefined> {
  const { rows } = await db.query<ItemRow>(
    `update knowledge_base
     set deleted_at = null,
         status = case when $2 then 'SUBMITTED' else status end,
         retry_count = case when $2 then 0 else retry_count end,
         error_message = case when $2 then null else error_message end
     where id = $1 and deleted_at is not null
     returning ${ITEM_COLUMNS}`,
    [id, requeue],
  );
  return rows[0];
}

export async function listItems(db: Queryable): Promise<ItemRow[]> {
  const { rows } = await db.query<ItemRow>(
    `select ${ITEM_COLUMNS} from knowledge_base
     where deleted_at is null
     order by created_at desc, id desc`,
  );
  return rows;
}

export async function softDeleteItem(db: Queryable, id: string): Promise<DeleteResult> {
  const { rows } = await db.query<{ deleted: boolean }>(
    `with target as (
       select id, status from knowledge_base where id = $1 and deleted_at is null
     ),
     deleted as (
       update knowledge_base kb set deleted_at = now()
       from target
       where kb.id = target.id and kb.deleted_at is null and kb.status in ('READY', 'FAILED')
       returning kb.id
     )
     select exists (select 1 from deleted) as deleted from target`,
    [id],
  );
  const row = rows[0];
  if (!row) return "NOT_FOUND";
  return row.deleted ? "DELETED" : "BUSY";
}
