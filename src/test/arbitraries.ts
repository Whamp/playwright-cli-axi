import fc, { type Arbitrary } from "fast-check";

import { table, type ToonTable, type ToonValue } from "../presenter/toon.js";

export const propertyOptions = { numRuns: 100 } as const;
export const asyncPropertyOptions = { numRuns: 50 } as const;

export const safeKeyArb = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,12}$/);
export const safeArgArb = fc.stringMatching(/^[A-Za-z0-9_./:]{1,24}$/);
export const safeLineArb = fc.stringMatching(/^[A-Za-z0-9_./: -]{1,60}$/);
export const flagValueArb = fc.oneof(
	fc.constant(""),
	fc.stringMatching(/^[A-Za-z0-9_./: ][A-Za-z0-9_./: -]{0,23}$/),
);

export const jsonValueArb = fc.jsonValue();

export const toonScalarArb: Arbitrary<string | number | boolean | null> = fc.oneof(
	fc.constant(null),
	fc.boolean(),
	fc.integer({ min: -1_000_000, max: 1_000_000 }),
	fc.string({ maxLength: 80 }),
);

export const safeToonValueArb: Arbitrary<ToonValue> = fc.letrec((tie) => ({
	value: fc.oneof(
		toonScalarArb,
		fc.array(tie("value") as Arbitrary<ToonValue>, { maxLength: 4 }),
		fc.dictionary(safeKeyArb, tie("value") as Arbitrary<ToonValue>, {
			maxKeys: 4,
		}),
	),
})).value as Arbitrary<ToonValue>;

export const toonTableArb: Arbitrary<ToonTable> = fc
	.uniqueArray(safeKeyArb, { minLength: 1, maxLength: 4 })
	.chain((fields) =>
		fc
			.array(
				fc.array(toonScalarArb, {
					minLength: fields.length,
					maxLength: fields.length,
				}),
				{ maxLength: 5 },
			)
			.map((rows) =>
				table(
					fields,
					rows.map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index] ?? null]))),
				),
			),
	);

export function parsedJson(value: unknown) {
	return { kind: "json", value, isError: false } as const;
}

export function parsedText(text: string) {
	return { kind: "text", text, isError: false } as const;
}
