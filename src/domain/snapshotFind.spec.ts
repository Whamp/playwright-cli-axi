import { describe, expect, it } from "vitest";

import {
  findInTree,
  flattenNodes,
  parseSnapshotTree,
  snapshotTextOf,
} from "./snapshotFind.js";

describe("parseSnapshotTree (C-3)", () => {
  it("parses role, ref, name, and trailing text from each node line", () => {
    const roots = parseSnapshotTree(
      '- generic [ref=e2]:\n  - heading "Example" [level=1] [ref=e3]\n  - textbox "Your Name" [ref=e118]\n  - generic [ref=e253]: 0/0',
    );
    const nodes = flattenNodes(roots);
    expect(nodes.map((n) => n.role)).toEqual([
      "generic",
      "heading",
      "textbox",
      "generic",
    ]);
    const heading = nodes[1]!;
    expect(heading.ref).toBe("e3");
    expect(heading.name).toBe("Example");
    const textbox = nodes[2]!;
    expect(textbox.ref).toBe("e118");
    expect(textbox.name).toBe("Your Name");
    expect(textbox.text).toBeUndefined();
    const value = nodes[3]!;
    expect(value.ref).toBe("e253");
    expect(value.text).toBe("0/0");
  });

  it("builds the parent/child/sibling structure from indentation", () => {
    const roots = parseSnapshotTree(
      "- generic [ref=e1]:\n  - generic [ref=e2]:\n    - generic [ref=e3]: a\n    - generic [ref=e4]: b",
    );
    expect(roots).toHaveLength(1);
    const parent = roots[0]!.children[0]!;
    expect(parent.children.map((c) => c.ref)).toEqual(["e3", "e4"]);
  });

  it("skips property lines and unparseable lines without throwing", () => {
    const roots = parseSnapshotTree(
      '- generic [ref=e1]:\n  - /url: https://x\n\n  not a node line',
    );
    expect(flattenNodes(roots).map((n) => n.ref)).toEqual(["e1"]);
  });
});

describe("findInTree (C-3)", () => {
  it("pairs a label with its preceding value sibling (the KPI pattern)", () => {
    const tree = parseSnapshotTree(
      "- generic [ref=e251]:\n  - generic [ref=e252]:\n    - generic [ref=e253]: 0/0\n    - generic [ref=e254]: Classrooms\n    - generic [ref=e256]: 0/0\n    - generic [ref=e257]: Staff",
    );
    expect(findInTree(tree, "Classrooms")).toEqual([
      { role: "generic", ref: "e254", text: "Classrooms", value: "0/0" },
    ]);
    expect(findInTree(tree, "Staff")).toEqual([
      { role: "generic", ref: "e257", text: "Staff", value: "0/0" },
    ]);
  });

  it("matches the accessible name (quoted) and returns the ref", () => {
    const tree = parseSnapshotTree(
      '- link "Learn more" [ref=e6] [cursor=pointer]:\n  - /url: https://iana.org/domains/example',
    );
    expect(findInTree(tree, "learn")).toEqual([
      { role: "link", ref: "e6", name: "Learn more" },
    ]);
  });

  it("is case-insensitive and returns structured rows, not a flat string", () => {
    const tree = parseSnapshotTree(
      '- heading "Basic" [ref=e336]\n- heading "Standard" [ref=e357]',
    );
    const matches = findInTree(tree, "STANDARD");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.name).toBe("Standard");
    expect(typeof matches).toBe("object");
  });

  it("returns an empty list when nothing matches and ignores empty queries", () => {
    const tree = parseSnapshotTree('- heading "Basic" [ref=e336]');
    expect(findInTree(tree, "Nonexistent")).toEqual([]);
    expect(findInTree(tree, "")).toEqual([]);
  });

  it("does not pair a value when the preceding sibling has a name", () => {
    const tree = parseSnapshotTree(
      '- link "Prev" [ref=e1]\n- link "Label" [ref=e2]',
    );
    const matches = findInTree(tree, "Label");
    expect(matches[0]!.value).toBeUndefined();
  });
});

describe("snapshotTextOf (C-3)", () => {
  it("extracts the a11y text from { result: { snapshot } }", () => {
    expect(snapshotTextOf({ result: { snapshot: "- generic [ref=e1]" } })).toBe(
      "- generic [ref=e1]",
    );
  });

  it("extracts from a bare { snapshot } payload", () => {
    expect(snapshotTextOf({ snapshot: "tree" })).toBe("tree");
  });

  it("returns a bare string payload as-is and empty for other shapes", () => {
    expect(snapshotTextOf("bare")).toBe("bare");
    expect(snapshotTextOf({ other: 1 })).toBe("");
  });
});
