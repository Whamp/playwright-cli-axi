import { describe, expect, it } from "vitest";
import {
  argsAfterCommand,
  canonicalizePath,
  commandName,
  hasVersionFlag,
  isValidWaitState,
  parseFieldsFlag,
  parseSettleFlag,
  parseDialogFlag,
  parseWaitFlag,
  resolveRelativeFilePaths,
  sessionFromArgv,
  settleLoadStateCode,
  shouldInjectJson,
  stripJsonFlags,
  stripWrapperFlags,
  validationProbeCode,
  waitForLoadStateCode,
} from "./commandSurface.js";

describe("commandSurface", () => {
  it("should strip user --json while injecting JSON only for supported upstream commands", () => {
    // Arrange
    const listArgv = stripJsonFlags(["list", "--json"]);
    const installArgv = stripJsonFlags([
      "install-browser",
      "chrome-for-testing",
      "--json",
    ]);

    // Act / Assert
    expect(listArgv).toEqual(["list"]);
    expect(shouldInjectJson(listArgv)).toBe(true);
    expect(installArgv).toEqual(["install-browser", "chrome-for-testing"]);
    expect(shouldInjectJson(installArgv)).toBe(false);
    expect(shouldInjectJson(["video-start", "--help"])).toBe(false);
    expect(sessionFromArgv(["-s=demo", "video-start"])).toBe("demo");
    expect(sessionFromArgv(["--session", "named", "video-stop"])).toBe("named");
  });

  it("should identify commands after session flags with separate values", () => {
    // Act / Assert
    expect(commandName(["--session", "demo", "list"])).toBe("list");
    expect(commandName(["-s", "demo", "video-start"])).toBe("video-start");
    expect(commandName(["--json", "--session=demo", "close-all"])).toBe(
      "close-all",
    );
    expect(sessionFromArgv(["video-start", "-s", "demo"])).toBe("demo");
  });

  it("should detect top-level version requests without intercepting a command own flags", () => {
    // Act / Assert
    expect(hasVersionFlag(["--version"])).toBe(true);
    expect(hasVersionFlag(["-v"])).toBe(true);
    expect(hasVersionFlag(["--json", "--version"])).toBe(true);
    // A command resolves -> version not requested (passthrough preserved)
    expect(hasVersionFlag(["list", "--version"])).toBe(false);
    expect(hasVersionFlag(["list", "-v"])).toBe(false);
    expect(hasVersionFlag(["video-start", "./out.webm"])).toBe(false);
    expect(hasVersionFlag([])).toBe(false);
    // O2: a flag after the `--` separator must NOT be intercepted (forwards upstream).
    expect(hasVersionFlag(["--", "--version"])).toBe(false);
    expect(hasVersionFlag(["--", "-v"])).toBe(false);
    // `--version` before `--` with no command still counts.
    expect(hasVersionFlag(["--version", "--"])).toBe(true);
  });

  it("strips --fields in both space and equals forms from video validation and upstream args (F3)", () => {
    // Validation args exclude the wrapper flag (both forms) so video-start does
    // not reject it as unsupported.
    expect(
      argsAfterCommand(["video-start", "--fields", "id", "./out.webm"]),
    ).toEqual(["./out.webm"]);
    expect(
      argsAfterCommand(["video-start", "--fields=id", "./out.webm"]),
    ).toEqual(["./out.webm"]);
    // The command still resolves correctly with the inline equals form.
    expect(commandName(["--fields=name", "list"])).toBe("list");
    // stripWrapperFlags removes both forms (and the value token) before upstream.
    expect(
      stripWrapperFlags(["video-start", "--fields", "id", "./out.webm"]),
    ).toEqual(["video-start", "./out.webm"]);
    expect(
      stripWrapperFlags(["video-start", "--fields=id", "./out.webm"]),
    ).toEqual(["video-start", "./out.webm"]);
    // parseFieldsFlag reads both forms identically.
    expect(parseFieldsFlag(["--fields=id,name"])).toEqual(["id", "name"]);
    expect(parseFieldsFlag(["--fields", "id,name"])).toEqual(["id", "name"]);
    expect(parseFieldsFlag(["list"])).toBeUndefined();
  });

  it("should exclude global flags from video command validation args without dropping upstream argv", () => {
    // Act / Assert
    expect(
      argsAfterCommand([
        "video-start",
        "--session",
        "demo",
        "./out.webm",
        "--size",
        "320x240",
      ]),
    ).toEqual(["./out.webm", "--size", "320x240"]);
    expect(
      argsAfterCommand([
        "video-show-actions",
        "-s=demo",
        "--raw",
        "--duration",
        "100",
      ]),
    ).toEqual(["--duration", "100"]);
  });
});

describe("resolveRelativeFilePaths (F-3)", () => {
  it("absolutizes --filename value against the shell cwd", () => {
    expect(
      resolveRelativeFilePaths(
        ["screenshot", "--filename", "./out.png"],
        "/repo",
      ),
    ).toEqual(["screenshot", "--filename", "/repo/out.png"]);
  });

  it("absolutizes inline --filename=value form", () => {
    expect(
      resolveRelativeFilePaths(["pdf", "--filename=p.pdf"], "/repo"),
    ).toEqual(["pdf", "--filename=/repo/p.pdf"]);
  });

  it("leaves absolute paths untouched", () => {
    expect(
      resolveRelativeFilePaths(
        ["screenshot", "--filename", "/abs/out.png"],
        "/repo",
      ),
    ).toEqual(["screenshot", "--filename", "/abs/out.png"]);
  });

  it("leaves Windows absolute paths untouched", () => {
    expect(
      resolveRelativeFilePaths(
        ["screenshot", "--filename", "C:\\out.png"],
        "/repo",
      ),
    ).toEqual(["screenshot", "--filename", "C:\\out.png"]);
  });

  it("absolutizes --path (upload) values too", () => {
    expect(
      resolveRelativeFilePaths(["drop", "e5", "--path", "./f.txt"], "/repo"),
    ).toEqual(["drop", "e5", "--path", "/repo/f.txt"]);
  });

  it("passes non-file args through unchanged", () => {
    expect(
      resolveRelativeFilePaths(["goto", "https://example.com"], "/repo"),
    ).toEqual(["goto", "https://example.com"]);
  });

  // N-9: the video-start positional filename is a named output file and must
  // resolve to the shell cwd so the recording is findable, even though the
  // daemon runs in the artifact cache dir.
  it("N-9: absolutizes the video-start positional filename against the shell cwd", () => {
    expect(
      resolveRelativeFilePaths(["video-start", "./out.webm"], "/repo"),
    ).toEqual(["video-start", "/repo/out.webm"]);
  });

  it("N-9: absolutizes the video-start positional filename with inline --size=value", () => {
    expect(
      resolveRelativeFilePaths(
        ["video-start", "--size=800x600", "./out.webm"],
        "/repo",
      ),
    ).toEqual(["video-start", "--size=800x600", "/repo/out.webm"]);
  });

  it("N-9: absolutizes the video-start positional filename wherever it appears", () => {
    expect(
      resolveRelativeFilePaths(
        ["video-start", "./out.webm", "--size", "800x600"],
        "/repo",
      ),
    ).toEqual(["video-start", "/repo/out.webm", "--size", "800x600"]);
  });

  it("N-9: leaves an absolute video-start filename untouched", () => {
    expect(
      resolveRelativeFilePaths(["video-start", "/abs/out.webm"], "/repo"),
    ).toEqual(["video-start", "/abs/out.webm"]);
  });

  it("N-9: does not absolutize non-file command positionals (e.g. click refs)", () => {
    expect(resolveRelativeFilePaths(["click", "e16"], "/repo")).toEqual([
      "click",
      "e16",
    ]);
  });

  // H3-1: state-save/state-load positional filenames are named storage files and
  // must be absolutized against the shell cwd, exactly like video-start (N-9),
  // otherwise the daemon's spawn cwd orphans them in the artifact cache dir.
  it("H3-1: absolutizes the state-save positional filename against the shell cwd", () => {
    expect(
      resolveRelativeFilePaths(["state-save", "./state.json"], "/repo"),
    ).toEqual(["state-save", "/repo/state.json"]);
  });

  it("H3-1: absolutizes the state-load positional filename against the shell cwd", () => {
    expect(
      resolveRelativeFilePaths(["state-load", "./state.json"], "/repo"),
    ).toEqual(["state-load", "/repo/state.json"]);
  });

  it("H3-1: leaves an absolute state-save filename untouched", () => {
    expect(
      resolveRelativeFilePaths(["state-save", "/abs/state.json"], "/repo"),
    ).toEqual(["state-save", "/abs/state.json"]);
  });
});

describe("canonicalizePath (H3-1/H3-3)", () => {
  it("collapses a leading ./ segment", () => {
    expect(canonicalizePath("/repo/./state.json")).toBe("/repo/state.json");
  });

  it("resolves parent .. segments against the prefix", () => {
    expect(canonicalizePath("/a/b/../../c")).toBe("/c");
    expect(
      canonicalizePath("/cache/playwright-cli-axi/../../repo/state.json"),
    ).toBe("/repo/state.json");
  });

  it("preserves the root and normalizes Windows drive paths to forward slashes", () => {
    expect(canonicalizePath("/")).toBe("/");
    // Windows drive paths keep the drive letter; separators normalize to '/'.
    expect(canonicalizePath("C:\\repo\\.\\x")).toBe("C:/repo/x");
  });

  it("returns the empty string unchanged", () => {
    expect(canonicalizePath("")).toBe("");
  });
});

describe("parseWaitFlag (P-5)", () => {
  it("reads --wait <state> and validates the state", () => {
    expect(parseWaitFlag(["click", "e5", "--wait", "networkidle"])).toBe(
      "networkidle",
    );
    expect(parseWaitFlag(["goto", "https://x", "--wait=load"])).toBe("load");
    expect(parseWaitFlag(["goto", "--wait", "bogus"])).toBeUndefined();
    expect(parseWaitFlag(["goto", "https://x"])).toBeUndefined();
  });

  it("isValidWaitState accepts the three Playwright states", () => {
    expect(isValidWaitState("load")).toBe(true);
    expect(isValidWaitState("domcontentloaded")).toBe(true);
    expect(isValidWaitState("networkidle")).toBe(true);
    expect(isValidWaitState("idle")).toBe(false);
  });
});

describe("waitForLoadStateCode (N-1)", () => {
  // N-1: upstream `run-code` wraps the snippet in a NON-async function body and
  // invokes it with `page`, so a bare `await ...` is a SyntaxError. The emitted
  // snippet MUST be an async arrow function expression that receives `page`.
  it("emits an async arrow function expression that receives page", () => {
    const code = waitForLoadStateCode("load", 2000);
    expect(code.startsWith("async (page) =>")).toBe(true);
    expect(code).toContain("page.waitForLoadState('load'");
    expect(code).toContain("timeout: 2000");
    // The broken form began with a bare `await`.
    expect(code.startsWith("await ")).toBe(false);
  });

  it("produces a syntactically valid async arrow function", () => {
    const code = waitForLoadStateCode("networkidle", 5000);
    // `new Function("return " + expr)` parses expr as an expression and would
    // throw on a syntax error (e.g. a bare top-level `await`).
    const fn = new Function(`return ${code}`)();
    expect(typeof fn).toBe("function");
  });

  it("does not emit a bare top-level await (the regression that shipped)", () => {
    for (const state of ["load", "domcontentloaded", "networkidle"]) {
      const code = waitForLoadStateCode(state, 1000);
      // The regression was `await page.waitForLoadState(...)` with no wrapper.
      expect(/^await\s/.test(code)).toBe(false);
    }
  });
});

describe("settleLoadStateCode (C-4)", () => {
  it("emits an async arrow expression receiving page", () => {
    const code = settleLoadStateCode("networkidle", 5000);
    expect(code.startsWith("async (page) =>")).toBe(true);
    // Syntactically valid function expression (the gap that broke N-1).
    new Function(code);
  });

  it("waits for the load state AND polls the URL to stability", () => {
    const code = settleLoadStateCode("networkidle", 5000);
    expect(code).toContain("waitForLoadState('networkidle'");
    expect(code).toContain("page.url()");
    expect(code).toMatch(/for\s*\(let\s*i/);
    // uses Playwright's waitForTimeout, not the node setTimeout global which
    // upstream's run-code sandbox does not expose.
    expect(code).toContain("page.waitForTimeout");
    expect(code).not.toContain("setTimeout");
  });
});

describe("parseSettleFlag (C-4)", () => {
  it("reads --settle with an optional state, defaulting to networkidle", () => {
    expect(parseSettleFlag(["click", "e5", "--settle"])).toBe("networkidle");
    expect(parseSettleFlag(["click", "e5", "--settle", "load"])).toBe("load");
    expect(parseSettleFlag(["goto", "--settle=domcontentloaded"])).toBe(
      "domcontentloaded",
    );
    // a positional after --settle is not consumed as a state when unrecognized
    expect(parseSettleFlag(["click", "--settle", "e5"])).toBe("networkidle");
  });

  it("returns undefined when --settle is absent", () => {
    expect(parseSettleFlag(["click", "e5", "--wait", "load"])).toBeUndefined();
  });

  it("stripWrapperFlags drops --settle and its optional value", () => {
    expect(stripWrapperFlags(["click", "e5", "--settle"])).toEqual([
      "click",
      "e5",
    ]);
    expect(stripWrapperFlags(["click", "--settle", "load", "e5"])).toEqual([
      "click",
      "e5",
    ]);
    expect(stripWrapperFlags(["click", "--settle=load", "e5"])).toEqual([
      "click",
      "e5",
    ]);
  });
});

describe("validationProbeCode (C-1)", () => {
  it("emits an async arrow expression with the test marker", () => {
    const code = validationProbeCode();
    expect(code.startsWith("async (page) =>")).toBe(true);
    expect(code).toContain("pca-validation-probe");
    new Function(code);
  });

  it("queries :invalid form fields and reports the activeElement state", () => {
    const code = validationProbeCode();
    expect(code).toContain(":invalid");
    expect(code).toContain("activeIsInvalid");
    expect(code).toContain("validationMessage");
  });
});

describe("parseDialogFlag (D-1)", () => {
  it("parses accept:<text> for a prompt", () => {
    expect(parseDialogFlag(["click", "e16", "--dialog", "accept:Alice"])).toEqual(
      { action: "accept", text: "Alice" },
    );
    expect(parseDialogFlag(["click", "e16", "--dialog=accept:Alice"])).toEqual({
      action: "accept",
      text: "Alice",
    });
  });

  it("parses a bare dismiss", () => {
    expect(parseDialogFlag(["click", "e14", "--dialog", "dismiss"])).toEqual({
      action: "dismiss",
    });
  });

  it("parses a bare accept (alert/confirm with no prompt text)", () => {
    expect(parseDialogFlag(["click", "e12", "--dialog", "accept"])).toEqual({
      action: "accept",
    });
  });

  it("treats a bare value as accept-with-text", () => {
    expect(parseDialogFlag(["click", "e16", "--dialog", "Bob"])).toEqual({
      action: "accept",
      text: "Bob",
    });
  });

  it("returns undefined when absent", () => {
    expect(parseDialogFlag(["click", "e16"])).toBeUndefined();
  });

  it("stripWrapperFlags drops --dialog and its value", () => {
    expect(stripWrapperFlags(["click", "e16", "--dialog", "accept:Alice"])).toEqual(
      ["click", "e16"],
    );
    expect(stripWrapperFlags(["click", "e16", "--dialog=dismiss"])).toEqual([
      "click",
      "e16",
    ]);
  });
});

describe("validationProbeCode (D-8)", () => {
  it("also reports open pages so a spawned tab can be surfaced", () => {
    const code = validationProbeCode();
    expect(code).toContain("pageCount");
    expect(code).toContain(".pages()");
    expect(code).toContain("currentUrl");
  });
});
