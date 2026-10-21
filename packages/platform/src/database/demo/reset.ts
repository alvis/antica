import type { Transaction } from '../transaction.js';

/** one foreign key: rows of `child` point at rows of `parent` */
export interface ForeignKeyEdge {
  readonly child: string;
  readonly childColumns: readonly string[];
  readonly parent: string;
  readonly parentColumns: readonly string[];
}

/** rows to delete: a table and a SQL condition over its columns */
export interface DeletionTarget {
  readonly table: string;
  /** SQL boolean expression; `$1` is the owner id and `$2` onwards are `parameters` */
  readonly condition: string;
  /** values bound from `$2` onwards */
  readonly parameters?: readonly unknown[];
}

// owner-scoped record state; corpus, knowledge and auth rows are never roots
const recordRoots: readonly DeletionTarget[] = [
  { table: 'records', condition: 'owner_id = $1' },
  { table: 'locations', condition: 'owner_id = $1' },
];

/**
 * deletes every record-side row of the owner, children before parents
 * @param tx transaction the whole reset runs in
 * @param ownerId collector whose collection state is reset
 * @returns number of rows deleted per table
 */
export async function resetCollectionState(
  tx: Transaction,
  ownerId: string,
): Promise<Readonly<Record<string, number>>> {
  const jobIds = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `select id::text from jobs where owner_id = $1 and (
      kind in ('analysis', 'recordEditing')
      or resource_id in (select id from media_assets where owner_id = $1 and record_id is not null)
      or resource_id in (select t.id from transcription_runs t join records r on r.id = t.record_id where r.owner_id = $1))`,
    ownerId,
  );
  const roots: readonly DeletionTarget[] = [
    ...recordRoots,
    {
      table: 'jobs',
      condition: 'owner_id = $1 and id = any($2::uuid[])',
      parameters: [jobIds.map(({ id }) => id)],
    },
  ];
  const deleted: Record<string, number> = {};
  for (const root of roots) {
    for (const [table, count] of Object.entries(
      await deleteCascade(tx, ownerId, root),
    )) {
      deleted[table] = (deleted[table] ?? 0) + count;
    }
  }
  await tx.$executeRawUnsafe(
    `delete from sequence_counters where owner_id = $1 and kind = 'record'`,
    ownerId,
  );

  return deleted;
}

/**
 * deletes rows and, children first, every row that references them
 * @param tx transaction the deletion runs in
 * @param ownerId owner bound to `$1` in the conditions, before the root's own parameters
 * @param root rows to delete
 * @returns number of rows deleted per table
 */
export async function deleteCascade(
  tx: Transaction,
  ownerId: string,
  root: DeletionTarget,
): Promise<Readonly<Record<string, number>>> {
  const deleted: Record<string, number> = {};
  for (const target of planCascade(await readForeignKeys(tx), root)) {
    const count = await tx.$executeRawUnsafe(
      `delete from ${quoteIdentifier(target.table)} where ${target.condition}`,
      ownerId,
      ...(target.parameters ?? []),
    );
    deleted[target.table] = (deleted[target.table] ?? 0) + count;
  }

  return deleted;
}

/**
 * orders deletions so that every row referencing a deleted row goes first
 * @param edges foreign keys of the schema
 * @param root rows whose removal starts the cascade
 * @param path tables on the current branch, which stops reference cycles
 * @returns deletions, children before their parents, ending with the root
 */
export function planCascade(
  edges: readonly ForeignKeyEdge[],
  root: DeletionTarget,
  path: readonly string[] = [],
): readonly DeletionTarget[] {
  const branch = [...path, root.table];
  const children = edges.filter(
    (edge) => edge.parent === root.table && !branch.includes(edge.child),
  );

  return [
    ...children.flatMap((edge) =>
      planCascade(
        edges,
        {
          table: edge.child,
          condition: `(${edge.childColumns.map(quoteIdentifier).join(', ')}) in (select ${edge.parentColumns.map(quoteIdentifier).join(', ')} from ${quoteIdentifier(root.table)} where ${root.condition})`,
          parameters: root.parameters,
        },
        branch,
      ),
    ),
    root,
  ];
}

/**
 * reads the public schema's foreign keys from the catalog
 * @param tx transaction to read in
 * @returns one edge per foreign key constraint
 */
async function readForeignKeys(
  tx: Transaction,
): Promise<readonly ForeignKeyEdge[]> {
  return tx.$queryRawUnsafe<ForeignKeyEdge[]>(
    `select child.relname as child, parent.relname as parent,
        array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as "childColumns",
        array(select a.attname::text from unnest(c.confkey) with ordinality k(n, i)
          join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.n order by k.i) as "parentColumns"
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace ns on ns.oid = child.relnamespace
      where c.contype = 'f' and ns.nspname = 'public'`,
  );
}

/**
 * quotes a catalog identifier for interpolation into SQL
 * @param name table or column name
 * @returns double-quoted identifier
 */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
