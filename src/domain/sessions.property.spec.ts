import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  jsonValueArb,
  propertyOptions,
  safeArgArb,
} from "../test/arbitraries.js";
import {
  normalizeClosed,
  normalizeCloseStatus,
  normalizeSessions,
} from "./sessions.js";

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

const serverLikeArb = fc.oneof(
  jsonValueArb,
  fc.record(
    {
      title: fc.option(safeArgArb, { nil: undefined }),
      playwrightVersion: fc.option(safeArgArb, { nil: undefined }),
      workspaceDir: fc.option(safeArgArb, { nil: undefined }),
      browser: fc.option(
        fc.record({ browserName: safeArgArb, userDataDir: safeArgArb }),
        { nil: undefined },
      ),
    },
    { requiredKeys: [] },
  ),
);

const channelSessionLikeArb = fc.oneof(
  jsonValueArb,
  fc.record(
    {
      channel: fc.option(safeArgArb, { nil: undefined }),
      userDataDir: fc.option(safeArgArb, { nil: undefined }),
      extensionInstalled: fc.option(fc.boolean(), { nil: undefined }),
      endpoint: fc.option(safeArgArb, { nil: undefined }),
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
        expect(browsers.empty).toBe(
          browsers.count === 0 ? "no open browsers" : undefined,
        );
        expect(sessions.servers.count).toBe(sessions.servers.rows.length);
        expect(sessions.servers.empty).toBe(
          sessions.servers.count === 0
            ? "no attachable browser servers"
            : undefined,
        );
        expect(sessions.channelSessions.count).toBe(
          sessions.channelSessions.rows.length,
        );
        expect(sessions.channelSessions.empty).toBe(
          sessions.channelSessions.count === 0
            ? "no channel sessions"
            : undefined,
        );
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

  it("keeps one normalized server and channel row per upstream list --all entry", () => {
    fc.assert(
      fc.property(
        fc.array(serverLikeArb, { maxLength: 20 }),
        fc.array(channelSessionLikeArb, { maxLength: 20 }),
        (servers, channelSessions) => {
          const sessions = normalizeSessions({
            browsers: [],
            servers,
            channelSessions,
          });

          expect(sessions.servers.count).toBe(servers.length);
          expect(sessions.servers.rows).toHaveLength(servers.length);
          expect(sessions.channelSessions.count).toBe(channelSessions.length);
          expect(sessions.channelSessions.rows).toHaveLength(
            channelSessions.length,
          );
        },
      ),
      propertyOptions,
    );
  });

  it("normalizes generated single-close status payloads without losing session or status", () => {
    fc.assert(
      fc.property(safeArgArb, safeArgArb, (session, status) => {
        const normalized = normalizeCloseStatus({ session, status });

        expect(normalized.session).toBe(session);
        expect(normalized.status).toBe(status);
      }),
      propertyOptions,
    );
  });

  it("always returns count/empty/status invariants for arbitrary close input", () => {
    fc.assert(
      fc.property(jsonValueArb, (value) => {
        const closed = normalizeClosed(value);

        expect(closed.count).toBe(closed.rows.length);
        expect(closed.empty).toBe(
          closed.count === 0 ? "no browsers were closed" : undefined,
        );
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
