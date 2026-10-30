import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config";
import { schema } from "./schema";

let instance: Database | null = null;

export function openDb(path: string = config.dbPath): Database {
  if (instance) {
    return instance;
  }
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(schema);
  instance = db;
  return db;
}

export function db(): Database {
  return openDb();
}

export function nowIso(): string {
  return new Date().toISOString();
}
