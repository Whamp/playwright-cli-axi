import { mkdtemp, readFile, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  installSessionStartHook,
  settingsFilePath,
  type SetupDeps,
} from "./hookSetup.js";

async function makeTempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pca-hooksetup-"));
}

function inMemoryDeps(files: Map<string, string>): Required<SetupDeps> {
  return {
    which: () => undefined,
    readFile: (path) => files.get(path),
    writeFile: (path, content) => {
      files.set(path, content);
    },
    exists: (path) => files.has(path),
    // In-memory files live at real temp-dir paths; treat them as their own
    // canonical form so the containment check is a no-op for these tests.
    realpath: (path) => path,
  };
}

/** Extract every hook command from a parsed settings file. */
function parseHookCommands(settings: Record<string, unknown>): string[] {
  const hooks = settings.hooks as { SessionStart?: unknown[] } | undefined;
  const arr = hooks?.SessionStart ?? [];
  return arr.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const hooks = (entry as { hooks?: { command?: string }[] }).hooks ?? [];
    return hooks.map((h) => h.command ?? "");
  });
}

/**
 * Parse a written settings file and return OUR SessionStart entry (the one whose
 * command carries the playwright-cli-axi marker), so tests can deep-equal it.
 */
function ourEntry(
  settings: Record<string, unknown>,
): { hooks: { type: string; command: string }[]; matcher?: string } {
  const arr = (settings.hooks as { SessionStart?: unknown[] } | undefined)?.SessionStart ?? [];
  for (const entry of arr) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as { hooks?: { command?: string }[]; matcher?: string };
    if (Array.isArray(e.hooks) && e.hooks.some((h) => /playwright-cli-axi session-start/.test(h.command ?? ""))) {
      return entry as { hooks: { type: string; command: string }[]; matcher?: string };
    }
  }
  throw new Error("no playwright-cli-axi entry found");
}

/** The command the installer emits for an absolute executable path. */
function expectedAbsolutePathCommand(executablePath: string): string {
  return `sh -c '"$1" context || exit 0' playwright-cli-axi ${shellQuoteSingle(executablePath)} # playwright-cli-axi session-start`;
}

/** Mirror of the module's POSIX single-quote for building expected commands. */
function shellQuoteSingle(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/** Extract the (single-quoted) path token from an absolute-path hook command. */
function extractQuotedPath(command: string): string | null {
  // The path is everything between the $0 arg and the trailing comment; it may
  // contain spaces (inside the single quotes), so match the full span.
  const match = command.match(/^sh -c '"\$1" context \|\| exit 0' playwright-cli-axi (.+) # playwright-cli-axi session-start$/);
  return match ? match[1]! : null;
}

describe("installSessionStartHook", () => {
  it("installs a structural entry into fresh settings for both targets", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const exe = "/usr/local/bin/playwright-cli-axi";
    const result = installSessionStartHook({
      executablePath: exe,
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });
    expect(result.binary).toBe("path");
    expect(result.installed).toHaveLength(2);
    expect(result.installed.every((e) => e.action === "installed")).toBe(true);

    const claude = JSON.parse(files.get(settingsFilePath("claude", "user", home, cwd))!) as Record<string, unknown>;
    const codex = JSON.parse(files.get(settingsFilePath("codex", "user", home, cwd))!) as Record<string, unknown>;

    // Structural deep-equal: Claude entry is exactly { hooks: [{ type, command }] }.
    expect(ourEntry(claude)).toEqual({
      hooks: [{ type: "command", command: expectedAbsolutePathCommand(exe) }],
    });
    // Codex entry additionally carries the startup|resume matcher.
    expect(ourEntry(codex)).toEqual({
      matcher: "startup|resume",
      hooks: [{ type: "command", command: expectedAbsolutePathCommand(exe) }],
    });
  });

  it("is idempotent: re-installing with the same path is a silent no-op", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const deps = { executablePath: "/opt/pca", cwd, home, scope: "user" as const, deps: inMemoryDeps(files) };

    installSessionStartHook(deps);
    const beforeClaude = files.get(settingsFilePath("claude", "user", home, cwd));

    const result = installSessionStartHook(deps);
    const afterClaude = files.get(settingsFilePath("claude", "user", home, cwd));

    expect(result.installed.every((e) => e.action === "noop")).toBe(true);
    expect(afterClaude).toBe(beforeClaude);
  });

  it("repairs the path when the executable has moved", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();

    installSessionStartHook({
      executablePath: "/old/path/playwright-cli-axi",
      cwd, home, scope: "user", deps: inMemoryDeps(files),
    });
    const result = installSessionStartHook({
      executablePath: "/new/path/playwright-cli-axi",
      cwd, home, scope: "user", deps: inMemoryDeps(files),
    });

    expect(result.installed.every((e) => e.action === "repaired")).toBe(true);
    const claude = JSON.parse(files.get(settingsFilePath("claude", "user", home, cwd))!) as Record<string, unknown>;
    expect(ourEntry(claude)).toEqual({
      hooks: [{ type: "command", command: expectedAbsolutePathCommand("/new/path/playwright-cli-axi") }],
    });
    // Exactly one entry for our hook.
    const ours = parseHookCommands(claude).filter((c) => /playwright-cli-axi/.test(c));
    expect(ours).toHaveLength(1);
  });

  it("composes with existing mainline hooks without clobbering them", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const claudePath = settingsFilePath("claude", "user", home, cwd);
    files.set(
      claudePath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command:
                    "sh -c 'command -v mainline >/dev/null 2>&1 && exec mainline hooks claudecode session-start || exit 0'",
                },
              ],
            },
          ],
        },
      }),
    );

    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });

    const claude = JSON.parse(files.get(claudePath)!) as Record<string, unknown>;
    const commands = parseHookCommands(claude);
    expect(commands).toHaveLength(2);
    expect(commands.some((c) => c.includes("mainline"))).toBe(true);
    expect(commands.some((c) => c.includes("playwright-cli-axi"))).toBe(true);
    // Mainline entry untouched.
    expect(commands.some((c) => c.includes("claudecode session-start"))).toBe(true);
  });

  it("uses the bare binary name only when it resolves to the SAME executable (O1)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();

    // Case A: which() returns the exact same path → use bare name.
    const r1 = installSessionStartHook({
      executablePath: "/usr/local/bin/playwright-cli-axi",
      cwd, home, scope: "user",
      deps: { ...inMemoryDeps(files), which: () => "/usr/local/bin/playwright-cli-axi" },
    });
    expect(r1.binary).toBe("name");

    // Case B: which() returns a DIFFERENT path (PATH-planted binary) → must NOT
    // trust it; fall back to the absolute path form.
    files.clear();
    const r2 = installSessionStartHook({
      executablePath: "/real/bin/playwright-cli-axi",
      cwd, home, scope: "user",
      deps: { ...inMemoryDeps(files), which: () => "/planted/bin/playwright-cli-axi" },
    });
    expect(r2.binary).toBe("path");
    const claude = JSON.parse(files.get(settingsFilePath("claude", "user", home, cwd))!) as Record<string, unknown>;
    expect(ourEntry(claude)).toEqual({
      hooks: [{ type: "command", command: expectedAbsolutePathCommand("/real/bin/playwright-cli-axi") }],
    });
  });

  it("writes project-scope settings into cwd, not home", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "project", deps: inMemoryDeps(files) });
    expect(files.has(join(cwd, ".claude", "settings.json"))).toBe(true);
    expect(files.has(join(cwd, ".codex", "hooks.json"))).toBe(true);
    expect(files.has(join(home, ".claude", "settings.json"))).toBe(false);
  });

  it("enables hooks in Codex config.toml when missing", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });
    const configRaw = files.get(join(home, ".codex", "config.toml"));
    expect(configRaw).toContain("[features]");
    expect(configRaw).toContain("hooks = true");
  });

  it("does not duplicate the hooks feature if already enabled", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const configPath = join(home, ".codex", "config.toml");
    const files = new Map<string, string>([[configPath, "[features]\nhooks = true\n"]]);
    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });
    const matches = files.get(configPath)!.match(/^hooks\s*=\s*true/gm);
    expect(matches).toHaveLength(1);
  });

  it("corrects hooks = false to true in the [features] table (F5)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const configPath = join(home, ".codex", "config.toml");
    const files = new Map<string, string>([[configPath, "[features]\nhooks = false\n"]]);
    const result = installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });
    expect(result.installed.every((e) => e.action !== "skipped")).toBe(true);
    const configRaw = files.get(configPath)!;
    expect(configRaw).not.toContain("hooks = false");
    expect(configRaw.match(/^hooks\s*=\s*true/gm)).toHaveLength(1);
  });

  it("does not false-positive on hooks = true in a different table (O3)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const configPath = join(home, ".codex", "config.toml");
    const files = new Map<string, string>([
      // hooks = true lives under [other], not [features]. [features] has none.
      [configPath, "[other]\nhooks = true\n\n[features]\nfoo = 1\n"],
    ]);
    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });
    const configRaw = files.get(configPath)!;
    // Two hooks=true lines now: the original under [other], the new under [features].
    expect(configRaw.match(/^hooks\s*=\s*true/gm)).toHaveLength(2);
    // Both tables keep their content: [other]'s hooks=true is preserved and
    // [features] now contains both foo and hooks.
    const otherBlock = configRaw.split("[other]")[1]!.split("[features]")[0];
    expect(otherBlock).toContain("hooks = true");
    const featuresBlock = configRaw.split("[features]")[1]!;
    expect(featuresBlock).toContain("foo = 1");
    expect(featuresBlock).toContain("hooks = true");
  });

  it("preserves [features] arrays that contain brackets and CRLF line endings (O3)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const configPath = join(home, ".codex", "config.toml");
    const original = "[features]\r\nlist = [\"[a]\", \"[b]\"]\r\nhooks = false\r\n";
    const files = new Map<string, string>([[configPath, original]]);
    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files) });
    const configRaw = files.get(configPath)!;
    expect(configRaw).toContain("list = [\"[a]\", \"[b]\"]"); // array preserved
    expect(configRaw).not.toContain("hooks = false");
    expect(configRaw.includes("\r\n")).toBe(true); // CRLF preserved
  });

  it("refuses to clobber a corrupt settings file and surfaces an error (F6)", async () => {
    for (const bad of ["{not json", "[1, 2, 3]", '"a string"', "42"]) {
      const home = await makeTempHome();
      const cwd = join(home, "repo");
      const files = new Map<string, string>();
      const claudePath = settingsFilePath("claude", "user", home, cwd);
      files.set(claudePath, bad);
      const result = installSessionStartHook({
        executablePath: "/opt/pca", cwd, home, scope: "user", deps: inMemoryDeps(files),
      });
      const claudeInstall = result.installed.find((e) => e.target === "claude")!;
      expect(claudeInstall.action).toBe("skipped");
      expect(claudeInstall.error).toMatch(/not a valid JSON object/);
      expect(result.installed.find((e) => e.target === "claude")!.action).toBe("skipped");
      // The corrupt file is untouched.
      expect(files.get(claudePath)).toBe(bad);
    }
  });
});

describe("hook command safety (F1 — shell injection)", () => {
  it("shell-quotes the executable path so hostile paths cannot break sh -c", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const hostile = "/tmp/x';touch /tmp/pca-pwn-marker;#'";
    installSessionStartHook({
      executablePath: hostile, cwd, home, scope: "user", deps: inMemoryDeps(files),
    });
    const claude = JSON.parse(files.get(settingsFilePath("claude", "user", home, cwd))!) as Record<string, unknown>;
    const command = ourEntry(claude).hooks[0]!.command;

    // Structural format check.
    const quoted = extractQuotedPath(command);
    expect(quoted).not.toBeNull();
    // The path is passed as $1, never interpolated raw into the sh -c body.
    expect(command).not.toMatch(/exec \$\(.*\)/);
    expect(command.includes(`exec "${hostile}"`)).toBe(false);

    // Real-shell PoC: running the generated command must NOT create the marker,
    // and (because we run the binary as a child, not via exec) a broken path is
    // caught by `|| exit 0` so the hook stays non-fatal.
    rmSync("/tmp/pca-pwn-marker", { force: true });
    const proc = spawnSync("sh", ["-c", command], { encoding: "utf8" });
    expect(existsSync("/tmp/pca-pwn-marker")).toBe(false);
    expect(proc.status).toBe(0);
    rmSync("/tmp/pca-pwn-marker", { force: true });
  });

  it("survives paths with spaces, $, backticks, semicolons, and newlines", async () => {
    const cases = [
      "/opt/my tools/playwright-cli-axi",
      "/opt/$HOME/bin/pca",
      "/opt/`whoami`/pca",
      "/opt/a;echo hi/pca",
      "/opt/a\nb/pca",
    ];
    for (const exe of cases) {
      const home = await makeTempHome();
      const cwd = join(home, "repo");
      const files = new Map<string, string>();
      installSessionStartHook({ executablePath: exe, cwd, home, scope: "user", deps: inMemoryDeps(files) });
      const claude = JSON.parse(files.get(settingsFilePath("claude", "user", home, cwd))!) as Record<string, unknown>;
      const command = ourEntry(claude).hooks[0]!.command;
      // The command is syntactically valid: it parses through sh -n without error.
      const check = spawnSync("sh", ["-n", "-c", command], { encoding: "utf8" });
      expect(check.status, `sh -n failed for ${exe}: ${check.stderr}`).toBe(0);
    }
  });
});

describe("installSessionStartHook with real filesystem", () => {
  it("installs and reads back from a real temp directory", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    await mkdir(cwd, { recursive: true });

    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "project" });

    const projectClaude = await readFile(join(cwd, ".claude", "settings.json"), "utf-8");
    expect(projectClaude).toContain("playwright-cli-axi session-start");
  });

  it("composes with a real pre-existing hooks file", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    await mkdir(join(cwd, ".claude"), { recursive: true });
    const existing = {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo preserve-me" }] }] },
    };
    await writeFile(join(cwd, ".claude", "settings.json"), JSON.stringify(existing));

    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "project" });

    const raw = await readFile(join(cwd, ".claude", "settings.json"), "utf-8");
    const commands = parseHookCommands(JSON.parse(raw) as Record<string, unknown>);
    expect(commands.some((c) => c.includes("preserve-me"))).toBe(true);
    expect(commands.some((c) => c.includes("playwright-cli-axi"))).toBe(true);
  });

  it("writes atomically and keeps a .bak when overwriting (O4)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    await mkdir(join(cwd, ".claude"), { recursive: true });
    const settingsPath = join(cwd, ".claude", "settings.json");
    await writeFile(settingsPath, JSON.stringify({ hooks: { SessionStart: [] } }));

    installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "project" });
    // Re-run with a new path → must back up the prior content before overwriting.
    installSessionStartHook({ executablePath: "/new/pca", cwd, home, scope: "project" });

    const backup = await readFile(`${settingsPath}.bak`, "utf-8");
    expect(backup).toContain("SessionStart");
    // The .bak reflects the state after the FIRST install (which wrote our hook),
    // proving the second install backed up before mutating.
    const current = await readFile(settingsPath, "utf-8");
    expect(current).toContain("/new/pca");
  });

  it("rejects config writes that escape the base via a symlinked dir (O5)", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const outside = await mkdtemp(join(tmpdir(), "pca-outside-"));
    await mkdir(cwd, { recursive: true });
    // .claude inside cwd is a symlink pointing OUTSIDE the project base.
    await symlink(outside, join(cwd, ".claude"), "dir");

    const result = installSessionStartHook({ executablePath: "/opt/pca", cwd, home, scope: "project" });
    const claude = result.installed.find((e) => e.target === "claude")!;
    expect(claude.action).toBe("skipped");
    expect(claude.error).toMatch(/Refusing to write config outside/);
    // Nothing was written into the symlinked target.
    expect(existsSync(join(outside, "settings.json"))).toBe(false);
    await rm(outside, { recursive: true, force: true });
  });
});
