import { isObject } from "../upstream/parse.js";

/**
 * C-3: structured lookup over an accessibility-tree snapshot.
 *
 * The default `snapshot` command returns the page as a flat YAML-like a11y
 * tree, so reading a page's pre-aggregated values (e.g. dashboard KPIs
 * `0/0 Classrooms`, pricing cards) means grepping fragile sibling text nodes.
 * `find <label>` parses that tree and returns labelled matches with refs and,
 * when the label is paired with a preceding value sibling, the value too — so
 * an agent reads structured data instead of mining a string.
 */

export interface SnapshotNode {
	/** Snapshot ref, e.g. "e253", when the node carries `[ref=e...]`. */
	ref?: string;
	role: string;
	/** Quoted accessible name, e.g. `Your Name` from `textbox "Your Name"`. */
	name?: string;
	/** Trailing text after the colon, e.g. `0/0` from `- generic [ref=e253]: 0/0`. */
	text?: string;
	/** Leading-indent depth (raw space count). */
	depth: number;
	/** 1-based source line, for diagnostics. */
	line: number;
	parent?: SnapshotNode;
	children: SnapshotNode[];
}

export interface FindMatch {
	ref?: string;
	role: string;
	name?: string;
	text?: string;
	/** Value paired from a preceding bare-value sibling, when present. */
	value?: string;
}

const NODE_LINE = /^(\s*)- (.+)$/;
const REF = /\[ref=([^\]]+)\]/;
const QUOTED_NAME = /"([^"]*)"/;

/**
 * Parse an a11y-tree snapshot into its node tree. Lines it cannot match are
 * skipped (properties like `- /url: /register` attach to the nearest node as
 * best-effort and are not needed for label/value lookups). Tolerant by design:
 * the upstream serialization is stable but we never want a parse error to fail
 * a lookup.
 */
export function parseSnapshotTree(raw: string): SnapshotNode[] {
	const lines = raw.split("\n");
	const roots: SnapshotNode[] = [];
	const stack: SnapshotNode[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		const match = line.match(NODE_LINE);
		if (!match) continue;
		const indent = match[1]!;
		const body = match[2]!;
		// Property lines (`- /key: value`) describe the nearest node; skip them.
		if (body.startsWith("/")) continue;
		const space = indent.length;
		const firstSpace = body.indexOf(" ");
		const role = firstSpace === -1 ? body : body.slice(0, firstSpace);
		const rest = firstSpace === -1 ? "" : body.slice(firstSpace + 1);

		const refMatch = rest.match(REF);
		const nameMatch = rest.match(QUOTED_NAME);
		const afterBrackets = rest.slice(rest.lastIndexOf("]") + 1).trim();
		let text: string | undefined;
		if (afterBrackets.startsWith(":")) {
			const trailing = afterBrackets.slice(1).trim();
			text = trailing.length > 0 ? trailing : undefined;
		}

		const node: SnapshotNode = {
			role,
			depth: space,
			line: index + 1,
			children: [],
			...(refMatch ? { ref: refMatch[1] } : {}),
			...(nameMatch ? { name: nameMatch[1] } : {}),
			...(text ? { text } : {}),
		};

		while (stack.length > 0 && stack[stack.length - 1]?.depth >= space) {
			stack.pop();
		}
		const parent = stack[stack.length - 1];
		if (parent) {
			node.parent = parent;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
		stack.push(node);
	}
	return roots;
}

/** Flatten a node tree into document order. */
export function flattenNodes(roots: SnapshotNode[]): SnapshotNode[] {
	const out: SnapshotNode[] = [];
	const walk = (node: SnapshotNode): void => {
		out.push(node);
		for (const child of node.children) walk(child);
	};
	for (const root of roots) walk(root);
	return out;
}

/** The immediately preceding sibling of a node, or undefined. Root nodes are
 * siblings of the other roots; nested nodes are siblings within their parent. */
function previousSibling(
	node: SnapshotNode,
	roots: SnapshotNode[],
): SnapshotNode | undefined {
	const siblings = node.parent ? node.parent.children : roots;
	const i = siblings.indexOf(node);
	return i > 0 ? siblings[i - 1] : undefined;
}

/**
 * Find nodes whose accessible name OR trailing text contains `query`
 * (case-insensitive). Each match is returned with its ref/role/name/text, and
 * when the matched label is immediately preceded by a bare-value sibling
 * (the common KPI pattern `0/0` then `Classrooms`), the paired `value` too.
 */
export function findInTree(roots: SnapshotNode[], query: string): FindMatch[] {
	const needle = query.toLowerCase();
	if (needle.length === 0) return [];
	const matches: FindMatch[] = [];
	for (const node of flattenNodes(roots)) {
		const name = node.name ?? "";
		const text = node.text ?? "";
		const matched =
			name.toLowerCase().includes(needle) ||
			text.toLowerCase().includes(needle);
		if (!matched) continue;
		const prev = previousSibling(node, roots);
		const value = prev && !prev.name && prev.text ? prev.text : undefined;
		matches.push({
			role: node.role,
			...(node.ref ? { ref: node.ref } : {}),
			...(node.name ? { name: node.name } : {}),
			...(node.text ? { text: node.text } : {}),
			...(value ? { value } : {}),
		});
	}
	return matches;
}

/**
 * Extract the a11y-tree text from an upstream snapshot JSON payload. Mirrors the
 * extraction in the snapshot presenter: upstream wraps the tree in
 * `{ result: { snapshot: "<text>" } }` (or `{ snapshot: ... }`); a bare string
 * payload is returned as-is.
 */
export function snapshotTextOf(value: unknown): string {
	let payload: unknown = value;
	if (isObject(payload) && isObject(payload.result)) {
		payload = payload.result;
	}
	if (isObject(payload) && typeof payload.snapshot === "string") {
		return payload.snapshot;
	}
	return typeof value === "string" ? value : "";
}
