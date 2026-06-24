import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMAND_GROUPS } from "../domain/upstreamCommands.js";

describe("README command matrix", () => {
  it("keeps the README command matrix in sync with COMMAND_GROUPS", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const rows = parseMatrixRows(readme);

    // titles must match in order...
    expect(rows.map((row) => row.title)).toEqual(
      COMMAND_GROUPS.map((group) => group.title),
    );
    // ...and each row's commands must match the live group exactly
    for (const row of rows) {
      const group = COMMAND_GROUPS.find((entry) => entry.title === row.title);
      expect(group, `command group for "${row.title}"`).toBeDefined();
      expect(row.commands).toEqual([...group!.commands]);
    }
  });
});

function parseMatrixRows(
  readme: string,
): { title: string; commands: string[] }[] {
  const lines = readme.split("\n");
  const headerIndex = lines.findIndex((line) => /^\|\s*Family\s*\|/.test(line));
  if (headerIndex === -1)
    throw new Error("README command matrix header not found");

  const rows: { title: string; commands: string[] }[] = [];
  // skip the header row and the markdown separator row
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const title = cells[0] ?? "";
    const commandText = cells[1] ?? "";
    const commands = [...commandText.matchAll(/`([^`]+)`/g)].map(
      (match) => match[1]!,
    );
    rows.push({ title, commands });
  }
  return rows;
}
