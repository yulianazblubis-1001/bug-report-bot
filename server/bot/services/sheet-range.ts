/** Quotes a sheet tab title for A1 range notation, e.g. `P&K Testing` -> `'P&K Testing'`. Required whenever the title has spaces or special characters. */
export function quoteSheetName(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}
