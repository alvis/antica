import { Prisma } from '../../generated/client.js';

import type { Transaction } from '../../transaction.js';

/** measured statement executor; every SQL statement passes through this capability */
export interface ImportSqlWriter {
  readonly tx: Transaction;
  execute(query: Prisma.Sql): Promise<number>;
  query<T>(query: Prisma.Sql): Promise<T>;
}

/**
 * inserts one parameter-bounded JSON recordset as one actual SQL statement
 * @param writer measured transaction writer
 * @param table internal table name
 * @param rows homogeneous typed projection records
 */
export async function insertRows(
  writer: ImportSqlWriter,
  table: string,
  rows: readonly object[],
): Promise<void> {
  if (!rows.length) {
    return;
  }
  const records = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    ),
  );
  const columns = Prisma.raw(
    Object.keys(records[0]!)
      .map((column) => `"${column}"`)
      .join(', '),
  );
  const relation = Prisma.raw(`"${table}"`);
  await writer.execute(
    Prisma.sql`insert into ${relation} (${columns}) select ${columns} from jsonb_populate_recordset(null::${relation}, ${JSON.stringify(records)}::jsonb) on conflict do nothing`,
  );
}
