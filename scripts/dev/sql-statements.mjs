/**
 * Splits a .sql file into executable statements.
 *
 * Comment lines are stripped rather than used to discard the statement that
 * follows them - a leading "-- explains the next table" must not take the
 * CREATE TABLE with it.
 */
export function splitStatements(sql) {
  return sql
    .split(/;\s*$/m)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((chunk) => chunk.length > 0);
}
