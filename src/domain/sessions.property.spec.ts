import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { jsonValueArb, propertyOptions, safeArgArb } from "../test/arbitraries.js";
import { normalizeClosed, normalizeSessions } from "./sessions.js";

const browserLikeArb = fc.oneof(
	jsonValueArb,
	fc.record(
		{
			id: fc.option(safeArgArb, { nil: undefined }),
			browserId: fc.option(safeArgArb, { nil: undefined }),
			name: fc.option(safeArgArb, { nil: undefined }),
			browserName: fc.option(safeArgArb, { nil: undefined }),
			type: fc.option(safeArgArb, { nil: undefined }),
			status: fc.option(safeArgArb, { nil: undefined }),
			state: fc.option(safeArgArb, { nil: undefined }),
		},
		{ requiredKeys: [] },
	),
);

const closedEntryArb = fc.oneof(
	jsonValueArb,
	safeArgArb,
	fc.record(
		{
			id: fc.option(safeArgArb, { nil: undefined }),
			name: fc.option(safeArgArb, { nil: undefined }),
		},
		{ requiredKeys: [] },
	),
);

describe("session normalization properties", () => {
	it("always returns count/empty invariants for arbitrary session input", () => {
		fc.assert(
			fc.property(jsonValueArb, (value) => {
				const sessions = normalizeSessions(value);
				const { browsers } = sessions;

				expect(browsers.count).toBe(browsers.rows.length);
				expect(browsers.empty).toBe(browsers.count === 0 ? "no open browsers" : undefined);
				for (const row of browsers.rows) {
					expect(typeof row.id).toBe("string");
					expect(typeof row.name).toBe("string");
					expect(typeof row.status).toBe("string");
				}
			}),
			propertyOptions,
		);
	});

	it("keeps one normalized browser row per upstream browser array entry", () => {
		fc.assert(
			fc.property(fc.array(browserLikeArb, { maxLength: 20 }), (browsers) => {
				const sessions = normalizeSessions({ browsers });

				expect(sessions.browsers.count).toBe(browsers.length);
				expect(sessions.browsers.rows).toHaveLength(browsers.length);
			}),
			propertyOptions,
		);
	});

	it("always returns count/empty/status invariants for arbitrary close input", () => {
		fc.assert(
			fc.property(jsonValueArb, (value) => {
				const closed = normalizeClosed(value);

				expect(closed.count).toBe(closed.rows.length);
				expect(closed.empty).toBe(closed.count === 0 ? "no browsers were closed" : undefined);
				for (const row of closed.rows) {
					expect(typeof row.id).toBe("string");
					expect(row.status).toBe("closed");
				}
			}),
			propertyOptions,
		);
	});

	it("keeps one normalized closed row per upstream closed array entry", () => {
		fc.assert(
			fc.property(fc.array(closedEntryArb, { maxLength: 20 }), (closed) => {
				const normalized = normalizeClosed({ closed });

				expect(normalized.count).toBe(closed.length);
				expect(normalized.rows).toHaveLength(closed.length);
			}),
			propertyOptions,
		);
	});

	it("falls back for hostile non-scalar closed entries", () => {
		expect(normalizeClosed({ closed: [[{ toString: null }]] })).toMatchObject({
			count: 1,
			rows: [{ id: "1", status: "closed" }],
		});
	});
});
