import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { renderSkillMarkdown } from "./catalog.js";

describe("playwright-cli-axi skill catalog", () => {
  it("keeps the committed generated skill in sync", () => {
    const skillPath = join(
      process.cwd(),
      ".agents/skills/playwright-cli-axi/SKILL.md",
    );
    const committed = readFileSync(skillPath, "utf8");

    expect(committed).toBe(renderSkillMarkdown());
  });
});
