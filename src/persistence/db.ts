import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import { SCHEMA_STATEMENTS } from "./schema.js";

export class SqliteDatabase {
  readonly connection: Database.Database;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });

    this.connection = new Database(filePath);
    this.connection.pragma("journal_mode = WAL");
    this.connection.pragma("foreign_keys = ON");
    this.connection.pragma("busy_timeout = 5000");

    this.applySchema();
  }

  close(): void {
    this.connection.close();
  }

  private applySchema(): void {
    const transaction = this.connection.transaction(() => {
      for (const statement of SCHEMA_STATEMENTS) {
        this.connection.exec(statement);
      }
    });

    transaction();
  }
}
