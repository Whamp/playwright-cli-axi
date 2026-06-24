import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
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
  };
}

function parseHookCommands(
  settings: Record<string, unknown>,
): string[] {
  const hooks = settings.hooks as { SessionStart?: unknown[] } | undefined;
  const arr = hooks?.SessionStart ?? [];
  return arr.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const hooks = (entry as { hooks?: { command?: string }[] }).hooks ?? [];
    return hooks.map((h) => h.command ?? "");
  });
}

describe("installSessionStartHook", () => {
  it("installs into fresh settings files for both targets", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const result = installSessionStartHook({
      executablePath: "/usr/local/bin/playwright-cli-axi",
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });
    expect(result.binary).toBe("path");
    expect(result.installed).toHaveLength(2);
    expect(result.installed.every((e) => e.action === "installed")).toBe(true);

    const claudeRaw = files.get(settingsFilePath("claude", "user", home, cwd));
    const codexRaw = files.get(settingsFilePath("codex", "user", home, cwd));
    expect(claudeRaw).toBeDefined();
    expect(codexRaw).toBeDefined();
    expect(claudeRaw).toContain("playwright-cli-axi context");
    expect(codexRaw).toContain("playwright-cli-axi context");
    expect(codexRaw).toContain("startup|resume");
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
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });

    const result = installSessionStartHook({
      executablePath: "/new/path/playwright-cli-axi",
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });

    expect(result.installed.every((e) => e.action === "repaired")).toBe(true);
    const claudeRaw = files.get(settingsFilePath("claude", "user", home, cwd))!;
    expect(claudeRaw).toContain("/new/path/playwright-cli-axi");
    expect(claudeRaw).not.toContain("/old/path/playwright-cli-axi");
    // Only one entry for our hook
    const parsed = JSON.parse(claudeRaw) as Record<string, unknown>;
    const commands = parseHookCommands(parsed);
    const ours = commands.filter((c) => /playwright-cli-axi/.test(c));
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

    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });

    const parsed = JSON.parse(
      files.get(claudePath)!,
    ) as Record<string, unknown>;
    const commands = parseHookCommands(parsed);
    expect(commands).toHaveLength(2);
    expect(commands.some((c) => c.includes("mainline"))).toBe(true);
    expect(commands.some((c) => c.includes("playwright-cli-axi"))).toBe(true);
  });

  it("uses the bare binary name when it resolves on PATH", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    const result = installSessionStartHook({
      executablePath: "/usr/local/bin/playwright-cli-axi",
      cwd,
      home,
      scope: "user",
      deps: {
        ...inMemoryDeps(files),
        which: () => "/usr/local/bin/playwright-cli-axi",
      },
    });
    expect(result.binary).toBe("name");
    const claudeRaw = files.get(settingsFilePath("claude", "user", home, cwd))!;
    expect(claudeRaw).toContain("command -v playwright-cli-axi");
    expect(claudeRaw).not.toContain("exec /usr/local/bin");
  });

  it("writes project-scope settings into cwd, not home", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "project",
      deps: inMemoryDeps(files),
    });
    expect(files.has(join(cwd, ".claude", "settings.json"))).toBe(true);
    expect(files.has(join(cwd, ".codex", "hooks.json"))).toBe(true);
    expect(files.has(join(home, ".claude", "settings.json"))).toBe(false);
  });

  it("enables hooks in Codex config.toml when missing", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const files = new Map<string, string>();
    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });
    const configRaw = files.get(join(home, ".codex", "config.toml"));
    expect(configRaw).toBeDefined();
    expect(configRaw).toContain("[features]");
    expect(configRaw).toContain("hooks = true");
  });

  it("does not duplicate the hooks feature if already present", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    const configPath = join(home, ".codex", "config.toml");
    const files = new Map<string, string>([
      [configPath, "[features]\nhooks = true\n"],
    ]);
    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "user",
      deps: inMemoryDeps(files),
    });
    const configRaw = files.get(configPath)!;
    const matches = configRaw.match(/^hooks\s*=\s*true/gm);
    expect(matches).toHaveLength(1);
  });
});

describe("installSessionStartHook with real filesystem", () => {
  it("installs and reads back from a real temp directory", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    await mkdir(cwd, { recursive: true });

    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "project",
    });

    const projectClaude = await readFile(
      join(cwd, ".claude", "settings.json"),
      "utf-8",
    );
    expect(projectClaude).toContain("playwright-cli-axi session-start");
  });

  it("composes with a real pre-existing hooks file", async () => {
    const home = await makeTempHome();
    const cwd = join(home, "repo");
    await mkdir(join(cwd, ".claude"), { recursive: true });
    const existing = {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo preserve-me" },
            ],
          },
        ],
      },
    };
    await writeFile(
      join(cwd, ".claude", "settings.json"),
      JSON.stringify(existing),
    );

    installSessionStartHook({
      executablePath: "/opt/pca",
      cwd,
      home,
      scope: "project",
    });

    const raw = await readFile(join(cwd, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const commands = parseHookCommands(parsed);
    expect(commands.some((c) => c.includes("preserve-me"))).toBe(true);
    expect(commands.some((c) => c.includes("playwright-cli-axi"))).toBe(true);
  });
});
