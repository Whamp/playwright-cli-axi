import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  commandGroupFor,
  UPSTREAM_COMMANDS,
} from "../domain/upstreamCommands.js";
import {
  parsedJson,
  parsedText,
  propertyOptions,
  safeArgArb,
} from "../test/arbitraries.js";
import { toToon, type ToonValue } from "./toon.js";
import { commandSuccessModel } from "./success.js";

function containsKey(value: ToonValue, key: string): boolean {
  if (Array.isArray(value))
    return value.some((entry) => containsKey(entry, key));
  if (typeof value === "object" && value !== null) {
    if ("__toon" in value) return false;
    return Object.entries(value).some(
      ([childKey, child]) => childKey === key || containsKey(child, key),
    );
  }
  return false;
}

const upstreamCommandArb = fc.constantFrom(...UPSTREAM_COMMANDS);

const jsonObjectArb = fc.dictionary(
  fc.oneof(
    fc.constant("isError"),
    fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,12}$/),
  ),
  fc.jsonValue(),
  { maxKeys: 8 },
);

describe("commandSuccessModel properties", () => {
  it("never leaks transport-only isError keys from generic JSON result models", () => {
    fc.assert(
      fc.property(jsonObjectArb, (value) => {
        const model = commandSuccessModel("request", parsedJson(value));
        const output = toToon(model);

        expect(model.command).toBe("request");
        expect(model.status).toBe("ok");
        expect(containsKey(model.result as ToonValue, "isError")).toBe(false);
        expect(output).not.toContain("\r");
        expect(output.endsWith("\n")).toBe(false);
      }),
      propertyOptions,
    );
  });

  it("adds command-family metadata for every upstream command with arbitrary JSON objects", () => {
    fc.assert(
      fc.property(upstreamCommandArb, jsonObjectArb, (command, value) => {
        const model = commandSuccessModel(command, parsedJson(value));
        const output = toToon(model);
        const group = commandGroupFor(command)!;

        expect(model.command).toBe(command);
        expect(model.status).toBe("ok");
        expect(output).toContain(`id: ${group.id}`);
        expect(output).not.toContain("\r");
        expect(output.endsWith("\n")).toBe(false);
      }),
      propertyOptions,
    );
  });

  it("preserves every hostile JSON key in the generic result model", () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 16 }), fc.jsonValue(), {
          maxKeys: 6,
        }),
        (value) => {
          const model = commandSuccessModel("config-print", parsedJson(value)) as {
            command: string;
            status: string;
            result: Record<string, ToonValue>;
          };
          const expectedKeys = Object.keys(value).filter(
            (key) => key !== "isError",
          );

          // pruneJson must not drop or rename hostile keys; only isError is pruned
          expect(Object.keys(model.result).sort()).toEqual(
            [...new Set(expectedKeys)].sort(),
          );
          const output = toToon(model);
          expect(model.command).toBe("config-print");
          expect(model.status).toBe("ok");
          expect(output).not.toContain("\r");
          expect(output.endsWith("\n")).toBe(false);
        },
      ),
      propertyOptions,
    );
  });

  it("reports list counts and empty state from generated upstream browser arrays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ id: safeArgArb }, { requiredKeys: [] }), {
          maxLength: 20,
        }),
        (browsers) => {
          const model = commandSuccessModel("list", parsedJson({ browsers }));
          const browserModel = model.browsers as {
            count: number;
            empty?: string;
          };

          expect(browserModel.count).toBe(browsers.length);
          expect(browserModel.empty).toBe(
            browsers.length === 0 ? "no open browsers" : undefined,
          );
          expect("browser_rows" in model).toBe(browsers.length > 0);
        },
      ),
      propertyOptions,
    );
  });

  it("reports close counts and empty state from generated upstream closed arrays", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(safeArgArb, fc.record({ id: safeArgArb })), {
          maxLength: 20,
        }),
        (closed) => {
          const model = commandSuccessModel(
            "close-all",
            parsedJson({ closed }),
          );
          const closeModel = model.closed as { count: number; empty?: string };

          expect(closeModel.count).toBe(closed.length);
          expect(closeModel.empty).toBe(
            closed.length === 0 ? "no browsers were closed" : undefined,
          );
          expect("closed_rows" in model).toBe(closed.length > 0);
        },
      ),
      propertyOptions,
    );
  });

  it("switches text output exactly at the 1200 character truncation boundary", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2_000 }), (text) => {
        const model = commandSuccessModel("snapshot", parsedText(text));

        expect(model.command).toBe("snapshot");
        expect(model.status).toBe("ok");
        if (text.length <= 1_200) {
          expect(model.output).toBe(text);
        } else {
          expect(model.output).toBe(
            `${text.slice(0, 1_200)}… (${text.length} chars total)`,
          );
        }
      }),
      propertyOptions,
    );
  });
});
