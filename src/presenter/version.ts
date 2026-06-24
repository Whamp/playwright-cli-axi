import type { ToonValue } from "./toon.js";

export interface VersionInput {
  wrapperVersion: string;
  upstreamPackage: string;
  upstreamVersion: string;
}

/**
 * Version model printed for `--version` / `-v`.
 *
 * AXI principle 10: a clean, structured version (TOON, on stdout) rather than
 * forwarding `--version` to upstream, which previously rendered as an awkward
 * generic-command wrap (`command: --version / output: 0.1.14`).
 */
export function versionModel(input: VersionInput): ToonValue {
  return {
    command: "playwright-cli-axi",
    version: input.wrapperVersion,
    upstream: {
      package: input.upstreamPackage,
      version: input.upstreamVersion,
    },
  };
}
