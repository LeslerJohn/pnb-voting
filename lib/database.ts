import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Snapshot } from "@/lib/types";

type Routine = "party_snapshot" | "party_cast" | "party_phase" | "party_issue" | "party_nominee";

const globalDatabase = globalThis as typeof globalThis & { rehearsalDatabase?: Promise<PGlite> };
const rehearsalDirectory = resolve(/*turbopackIgnore: true*/ process.env.REHEARSAL_DATA_DIR ?? ".rehearsal");
const portraitDirectory = join(rehearsalDirectory, "portraits");
const bucket = "party-portraits";
const migration = "20261116000000_party_ballot.sql";
let cloudClient: SupabaseClient | undefined;

export const portraitKey = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp$/;
export const rehearsal = () => process.env.REHEARSAL_MODE === "1" ||
  (process.env.NODE_ENV === "development" && !process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY);

function cloud() {
  if (!cloudClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    cloudClient = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  }
  return cloudClient;
}

async function localDatabase() {
  if (!globalDatabase.rehearsalDatabase) {
    globalDatabase.rehearsalDatabase = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      await mkdir(rehearsalDirectory, { recursive: true });
      const db = new PGlite(join(rehearsalDirectory, "database"));
      const current = await db.query<{ installed: boolean }>("select to_regclass('public.party_poll') is not null as installed");
      if (!current.rows[0].installed) {
        await db.exec("create role anon; create role authenticated; create role service_role bypassrls;").catch(async (error: { code?: string }) => {
          if (error.code !== "42710") throw error;
        });
        await db.exec(await readFile(join(process.cwd(), "supabase", "migrations", migration), "utf8"));
      }
      return db;
    })().catch((error) => {
      delete globalDatabase.rehearsalDatabase;
      throw error;
    });
  }
  return globalDatabase.rehearsalDatabase;
}

export async function call<T>(routine: Routine, args: object): Promise<T> {
  if (rehearsal()) {
    const db = await localDatabase();
    const result = await db.query<{ data: T }>(`select public.${routine}($1::jsonb) as data`, [JSON.stringify(args)]);
    return result.rows[0].data;
  }
  const { data, error } = await cloud().rpc(routine, { p: args });
  if (error) throw error;
  return data as T;
}

export async function snapshot(view: "host" | "ballot" | "stage"): Promise<Snapshot> {
  const data = await call<Snapshot>("party_snapshot", { view });
  for (const nominee of data.nominees) {
    if (nominee.photo) nominee.photo = rehearsal()
      ? `/api/photo/${nominee.photo}`
      : cloud().storage.from(bucket).getPublicUrl(nominee.photo).data.publicUrl;
  }
  return data;
}

export async function savePortrait(key: string, bytes: Buffer) {
  if (rehearsal()) {
    await mkdir(portraitDirectory, { recursive: true });
    await writeFile(join(portraitDirectory, key), bytes);
    return;
  }
  const { error } = await cloud().storage.from(bucket).upload(key, bytes, {
    upsert: false, contentType: "image/webp", cacheControl: "31536000",
  });
  if (error) throw error;
}

export async function removePortrait(key: string) {
  try {
    if (rehearsal()) await unlink(join(portraitDirectory, key));
    else {
      const { error } = await cloud().storage.from(bucket).remove([key]);
      if (error) throw error;
    }
  } catch (error) {
    console.error("Portrait cleanup failed", error);
  }
}

export async function readPortrait(key: string) {
  return readFile(join(portraitDirectory, key));
}
