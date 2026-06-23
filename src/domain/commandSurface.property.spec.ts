import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { propertyOptions, safeArgArb } from "../test/arbitraries.js";
import {
	argsAfterCommand,
	commandName,
	sessionFromArgv,
	shouldInjectJson,
	stripJsonFlags,
} from "./commandSurface.js";

const globalPrefixArb = fc.array(
	fc.oneof(
		fc.constant(["--json"]),
		fc.constant(["--raw"]),
		fc.constant(["--version"]),
		safeArgArb.map((session) => ["--session", session]),
		safeArgArb.map((session) => ["-s", session]),
		safeArgArb.map((session) => [`--session=${session}`]),
		safeArgArb.map((session) => [`-s=${session}`]),
	),
	{ maxLength: 5 },
).map((chunks) => chunks.flat());

const jsonDecoratedArgvArb = fc.array(safeArgArb, { maxLength: 20 }).chain((argv) =>
	fc.array(fc.boolean(), { minLength: argv.length + 1, maxLength: argv.length + 1 }).map((slots) => {
		const decorated: string[] = [];
		for (const [index, arg] of argv.entries()) {
			if (slots[index]) decorated.push("--json");
			decorated.push(arg);
		}
		if (slots[argv.length]) decorated.push("--json");
		return { argv, decorated };
	}),
);

describe("commandSurface properties", () => {
	it("removes injected --json flags idempotently without changing generated arguments", () => {
		fc.assert(
			fc.property(jsonDecoratedArgvArb, ({ argv, decorated }) => {
				const stripped = stripJsonFlags(decorated);

				expect(stripJsonFlags(stripped)).toEqual(stripped);
				expect(stripped).not.toContain("--json");
				expect(stripped).toEqual(argv);
			}),
			propertyOptions,
		);
	});

	it("finds the first non-global command after any valid global prefix", () => {
		fc.assert(
			fc.property(globalPrefixArb, safeArgArb, (prefix, command) => {
				const argv = [...prefix, command, "--json"];

				expect(commandName(argv)).toBe(command);
			}),
			propertyOptions,
		);
	});

	it("extracts sessions from every supported session flag spelling", () => {
		fc.assert(
			fc.property(safeArgArb, safeArgArb, (session, command) => {
				expect(sessionFromArgv(["--session", session, command])).toBe(session);
				expect(sessionFromArgv(["-s", session, command])).toBe(session);
				expect(sessionFromArgv([`--session=${session}`, command])).toBe(session);
				expect(sessionFromArgv([`-s=${session}`, command])).toBe(session);
			}),
			propertyOptions,
		);
	});

	it("leaves command arguments unchanged when only removable global flags are injected after the command", () => {
		fc.assert(
			fc.property(safeArgArb, safeArgArb, fc.array(safeArgArb, { maxLength: 6 }), (command, session, args) => {
				const plain = [command, ...args];
				const withGlobals = [command, "--session", session, "--json", ...args, "--raw"];

				expect(argsAfterCommand(plain)).toEqual(args);
				expect(argsAfterCommand(withGlobals)).toEqual(args);
			}),
			propertyOptions,
		);
	});

	it("injects JSON only for concrete non-help commands that support JSON mode", () => {
		fc.assert(
			fc.property(safeArgArb, (command) => {
				expect(shouldInjectJson([])).toBe(false);
				expect(shouldInjectJson(["install-browser", command])).toBe(false);
				expect(shouldInjectJson([command, "--help"])).toBe(false);
				expect(shouldInjectJson([command, "-h"])).toBe(false);
				if (command !== "install-browser") expect(shouldInjectJson([command])).toBe(true);
			}),
			propertyOptions,
		);
	});
});
