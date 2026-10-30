// Unified-diff helpers shared by every provider.

/** New-side line numbers of every added line in a unified patch. */
export function changedLinesOf(patch: string): number[] {
  const lines: number[] = [];
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      lines.push(newLine);
      newLine += 1;
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      // removed line: new side does not advance
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file"
    } else {
      newLine += 1;
    }
  }
  return lines;
}

/** Render a list of files as one patch text for the model. */
export function renderDiff(files: { path: string; status: string; patch: string }[]): string {
  return files
    .map((f) => `--- ${f.status} ${f.path}\n${f.patch}`)
    .join("\n\n");
}
