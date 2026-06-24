import { describe, expect, it } from "vitest";
import {
	channelUsable,
	DARWIN_CANDIDATES,
	discoverSystemBrowser,
	LINUX_CANDIDATES,
	OVERRIDE_ENV_VAR,
	WIN32_CANDIDATES,
} from "./browserDiscovery.js";

const fs = (paths: string[]) => (p: string) => paths.includes(p);

describe("browser discovery (F-2)", () => {
	describe("discoverSystemBrowser", () => {
		it("respects an explicit override when the file exists", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: { [OVERRIDE_ENV_VAR]: "/custom/chrome" },
				exists: fs(["/custom/chrome"]),
			});
			expect(result.browser).toEqual({
				path: "/custom/chrome",
				channel: "override",
			});
		});

		it("ignores an override that points at a missing file and falls back to discovery", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: { [OVERRIDE_ENV_VAR]: "/missing/chrome" },
				exists: fs(["/usr/bin/chromium"]),
			});
			expect(result.browser?.path).toBe("/usr/bin/chromium");
			expect(result.browser?.channel).toBe("chromium");
		});

		it("Omarchy/Arch Linux: discovers /usr/bin/chromium first", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: {},
				exists: fs(["/usr/bin/chromium", "/usr/bin/google-chrome"]),
			});
			expect(result.browser?.path).toBe("/usr/bin/chromium");
			expect(result.detected.map((b) => b.path)).toContain(
				"/usr/bin/google-chrome",
			);
		});

		it("Ubuntu snap: discovers /snap/bin/chromium when nothing else exists", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: {},
				exists: fs(["/snap/bin/chromium"]),
			});
			expect(result.browser?.path).toBe("/snap/bin/chromium");
		});

		it("Ubuntu apt: discovers google-chrome-stable", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: {},
				exists: fs(["/usr/bin/google-chrome-stable"]),
			});
			expect(result.browser?.channel).toBe("chrome");
			expect(result.browser?.path).toBe("/usr/bin/google-chrome-stable");
		});

		it("macOS: discovers the Chrome app bundle", () => {
			const chromePath =
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
			const result = discoverSystemBrowser({
				platform: "darwin",
				env: {},
				exists: fs([chromePath]),
			});
			expect(result.browser?.path).toBe(chromePath);
		});

		it("Windows 11: discovers chrome.exe and expands %LOCALAPPDATA%", () => {
			const localPath =
				"C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
			const result = discoverSystemBrowser({
				platform: "win32",
				env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
				exists: fs([localPath]),
			});
			expect(result.browser?.path).toBe(localPath);
			expect(result.browser?.channel).toBe("chrome");
		});

		it("Windows 11: discovers Edge when Chrome is absent", () => {
			const edge =
				"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
			const result = discoverSystemBrowser({
				platform: "win32",
				env: {},
				exists: fs([edge]),
			});
			expect(result.browser?.channel).toBe("msedge");
		});

		it("Windows: skips %LOCALAPPDATA% path when env var is undefined", () => {
			const edge =
				"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
			const result = discoverSystemBrowser({
				platform: "win32",
				env: {}, // LOCALAPPDATA not set
				exists: (path: string) => {
					// Should not try to check malformed paths starting with backslash
					if (path.startsWith("\\")) return false;
					return path === edge;
				},
			});
			// Falls back to Edge since Chrome path requires undefined LOCALAPPDATA
			expect(result.browser?.channel).toBe("msedge");
			// The malformed %LOCALAPPDATA% path should not appear in detected
			expect(result.detected.some((b) => b.path.startsWith("\\"))).toBe(false);
		});

		it("returns null browser with empty detected when nothing is installed", () => {
			const result = discoverSystemBrowser({
				platform: "linux",
				env: {},
				exists: () => false,
			});
			expect(result.browser).toBeNull();
			expect(result.detected).toEqual([]);
		});

		it("candidate lists cover chromium, chrome, and edge per platform", () => {
			const linuxChannels = LINUX_CANDIDATES.map((c) => c.channel);
			const macChannels = DARWIN_CANDIDATES.map((c) => c.channel);
			const winChannels = WIN32_CANDIDATES.map((c) => c.channel);
			expect(linuxChannels).toContain("chromium");
			expect(linuxChannels).toContain("chrome");
			expect(macChannels).toContain("chrome");
			expect(winChannels).toContain("msedge");
		});
	});

	describe("channelUsable", () => {
		it("reports yes when a browser is discovered", () => {
			expect(
				channelUsable("chrome", {
					platform: "linux",
					env: {},
					exists: fs(["/usr/bin/chromium"]),
				}),
			).toBe("yes");
		});

		it("reports no when no browser family exists", () => {
			expect(
				channelUsable("chrome", {
					platform: "linux",
					env: {},
					exists: () => false,
				}),
			).toBe("no");
		});

		it("reports no for an unknown channel with no browser", () => {
			expect(
				channelUsable("firefox", {
					platform: "linux",
					env: {},
					exists: () => false,
				}),
			).toBe("no");
		});
	});
});
