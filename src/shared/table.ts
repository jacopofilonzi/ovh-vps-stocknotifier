// Emoji and other wide characters take two terminal columns.
const WIDE = /\p{Extended_Pictographic}/u;

export function visibleWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if (char === "️") continue; // emoji presentation selector: no width of its own
    width += WIDE.test(char) ? 2 : 1;
  }
  return width;
}

export function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  const fill = " ".repeat(Math.max(0, width - visibleWidth(text)));
  return align === "left" ? text + fill : fill + text;
}

/** Aligns `rows` in columns. Columns listed in `right` are right-aligned (numbers). */
export function formatColumns(rows: string[][], { right = [] as number[], gap = "  " } = {}): string[] {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell))));
  return rows.map((row) =>
    row
      .map((cell, i) => pad(cell, widths[i]!, right.includes(i) ? "right" : "left"))
      .join(gap)
      .trimEnd(),
  );
}
