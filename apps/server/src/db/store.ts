import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.ts';

export class Store {
  readonly db: DatabaseSync;
  private inTransaction = false;

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(samples)').all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'slot')) {
      this.db.exec('ALTER TABLE samples ADD COLUMN slot INTEGER NOT NULL DEFAULT 1');
    }
  }

  transaction<T>(operation: () => T): T {
    if (this.inTransaction) {
      return this.nestedTransaction(operation);
    }
    this.db.exec('BEGIN IMMEDIATE');
    this.inTransaction = true;
    try {
      const result = operation();
      this.db.exec('COMMIT');
      this.inTransaction = false;
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.inTransaction = false;
      throw error;
    }
  }

  private nestedTransaction<T>(operation: () => T): T {
    const name = `sp_${Math.random().toString(16).slice(2)}`;
    this.db.exec(`SAVEPOINT ${name}`);
    try {
      const result = operation();
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
      this.db.exec(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}
