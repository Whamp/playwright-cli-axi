import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  propertyOptions,
  safeToonValueArb,
  toonTableArb,
} from "../test/arbitraries.js";
import { table, toToon } from "./toon.js";

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

describe("toToon properties", () => {
  it("renders generated safe TOON values without violating output invariants", () => {
    fc.assert(
      fc.property(safeToonValueArb, (value) => {
        const output = toToon(value);

        expect(output).not.toContain("\r");
        expect(output.endsWith("\n")).toBe(false);
        expect(output.split("\n").some((line) => /\s$/.test(line))).toBe(false);
        expect(output).not.toContain("undefined");
      }),
      propertyOptions,
    );
  });

  it("renders generated tables with row counts that match their data", () => {
    fc.assert(
      fc.property(toonTableArb, (rows) => {
        const output = toToon({ rows });

        expect(output).toContain(
          `rows[${rows.rows.length}]{${rows.fields.join(",")}}:`,
        );
        expect(output).not.toContain("\r");
        expect(output.endsWith("\n")).toBe(false);
      }),
      propertyOptions,
    );
  });

  it("quotes hostile object keys while preserving a value under every key", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 16 }), {
          minLength: 1,
          maxLength: 6,
        }),
        (keys) => {
          const object = Object.fromEntries(
            keys.map((key) => [key, "sentinel"]),
          );
          const output = toToon(object);
          const keyLines = output
            .split("\n")
            .filter((line) => line.endsWith(": sentinel"));

          // no key is silently dropped
          expect(keyLines.length).toBe(keys.length);
          // every key token is a safe bare identifier or fully quoted,
          // never a bare hostile key leaking into TOON structure
          for (const line of keyLines) {
            const token = line
              .slice(0, line.length - ": sentinel".length)
              .trimStart();
            expect(SAFE_KEY.test(token) || /^".*"$/.test(token)).toBe(true);
          }
          expect(output).not.toContain("\r");
          expect(output.endsWith("\n")).toBe(false);
        },
      ),
      propertyOptions,
    );
  });

  it("quotes hostile table field names in the rendered header", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.string({ minLength: 1, maxLength: 12 }).filter(
            (value) => !/[{},]/.test(value),
          ),
          { minLength: 1, maxLength: 4 },
        ),
        (fields) => {
          const row = Object.fromEntries(
            fields.map((field) => [field, "value"]),
          );
          const output = toToon({ rows: table(fields, [row]) });
          const header = output.split("\n")[0]!;
          const open = header.indexOf("{");
          const close = header.indexOf("}");
          const tokens = header.slice(open + 1, close).split(",");

          expect(tokens.length).toBe(fields.length);
          for (const token of tokens) {
            expect(SAFE_KEY.test(token) || /^".*"$/.test(token)).toBe(true);
          }
          expect(output).not.toContain("\r");
          expect(output.endsWith("\n")).toBe(false);
        },
      ),
      propertyOptions,
    );
  });

  it("preserves nested object fields inside generated array rows", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Za-z0-9_./:-]{1,24}$/), (url) => {
        const output = toToon({ result: [{ nested: { url }, id: 1 }] });

        expect(output).toContain("nested:");
        expect(output).toContain("url:");
        expect(output).toContain(url);
        expect(output).not.toContain("nested: null");
      }),
      propertyOptions,
    );
  });

  it("canonicalizes non-finite numeric scalars and negative zero", () => {
    expect(toToon(Number.NaN)).toBe("null");
    expect(toToon(Number.POSITIVE_INFINITY)).toBe("null");
    expect(toToon(Number.NEGATIVE_INFINITY)).toBe("null");
    expect(toToon(-0)).toBe("0");
  });

  it("treats malformed table sentinels as plain objects rather than crashing", () => {
    fc.assert(
      fc.property(safeToonValueArb, (value) => {
        const malformed = { __toon: "table", value } as const;

        const output = toToon(malformed);

        expect(output).toContain("__toon: table");
        expect(output).not.toContain("\r");
      }),
      propertyOptions,
    );
  });
});
