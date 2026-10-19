import { Prisma } from '../../generated/client.js';

/**
 * reuses the strongest KDB18 lane over tokenizer-versioned title and alias copies
 * @param normalized normalized whole field or query
 * @param projection stored newline-delimited title, alias and topic projection
 * @returns exact title or alias membership without weak lexical overlap
 */
export function exactTitleAliasSql(
  normalized: Prisma.Sql,
  projection: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`('t:'||${normalized}=ANY(string_to_array(${projection},E'\\n')) OR 'a:'||${normalized}=ANY(string_to_array(${projection},E'\\n')))`;
}
