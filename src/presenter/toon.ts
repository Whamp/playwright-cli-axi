export type ToonValue =
	| null
	| boolean
	| number
	| string
	| ToonValue[]
	| { [key: string]: ToonValue }
	| ToonTable;

export interface ToonTable {
	__toon: "table";
	fields: string[];
	rows: Record<string, ToonValue>[];
}

export function table(
	fields: string[],
	rows: Record<string, ToonValue>[],
): ToonTable {
	return { __toon: "table", fields, rows };
}

export function toToon(value: ToonValue): string {
	const lines = encodeRoot(value);
	const output = lines.join("\n");
	assertInvariants(output);
	return output;
}

function encodeRoot(value: ToonValue): string[] {
	if (Array.isArray(value)) return encodeNamed("items", value, 0);
	if (isPlainObject(value)) {
		return Object.entries(value).flatMap(([key, child]) =>
			encodeNamed(key, child, 0),
		);
	}
	return [formatScalar(scalarOrNull(value))];
}

function encodeNamed(key: string, value: ToonValue, indent: number): string[] {
	const prefix = " ".repeat(indent);
	if (isTable(value)) {
		const header = `${prefix}${key}[${value.rows.length}]{${value.fields.join(",")}}:`;
		const rows = value.rows.map(
			(row) =>
				`${" ".repeat(indent + 2)}${value.fields.map((field) => formatScalar(scalarOrNull(row[field]) ?? "")).join(",")}`,
		);
		return [header, ...rows];
	}
	if (Array.isArray(value)) {
		const lines = [`${prefix}${key}[${value.length}]:`];
		for (const item of value) {
			if (isPlainObject(item)) {
				const entries = Object.entries(item);
				if (entries.length === 0) {
					lines.push(`${" ".repeat(indent + 2)}- {}`);
					continue;
				}
				const [firstKey, firstValue] = entries[0]!;
				lines.push(
					`${" ".repeat(indent + 2)}- ${firstKey}: ${formatScalar(scalarOrNull(firstValue as ToonValue))}`,
				);
				for (const [childKey, childValue] of entries.slice(1)) {
					lines.push(...encodeNamed(childKey, childValue, indent + 4));
				}
			} else {
				lines.push(
					`${" ".repeat(indent + 2)}- ${formatScalar(scalarOrNull(item as ToonValue))}`,
				);
			}
		}
		return lines;
	}
	if (isPlainObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) return [`${prefix}${key}: {}`];
		return [
			`${prefix}${key}:`,
			...entries.flatMap(([childKey, childValue]) =>
				encodeNamed(childKey, childValue, indent + 2),
			),
		];
	}
	return [
		`${prefix}${key}: ${formatScalar(value as string | number | boolean | null)}`,
	];
}

function formatScalar(value: string | number | boolean | null): string {
	if (value === null) return "null";
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number")
		return Number.isFinite(value) ? canonicalNumber(value) : "null";
	return quoteIfNeeded(value);
}

function canonicalNumber(value: number): string {
	if (Object.is(value, -0)) return "0";
	return String(value);
}

function quoteIfNeeded(value: string): string {
	if (value.length === 0) return '""';
	if (/^(true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.test(value))
		return quote(value);
	if (/^[\s]|[\s]$/.test(value)) return quote(value);
	if (/[\n\r\t,:[\]{}#"]/.test(value)) return quote(value);
	if (/^-\s/.test(value)) return quote(value);
	return value;
}

function quote(value: string): string {
	return `"${value
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
		.replace(
			/[\u0000-\u001f]/g,
			(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
		)}"`;
}

function isTable(value: ToonValue): value is ToonTable {
	return (
		isPlainObject(value) &&
		value.__toon === "table" &&
		Array.isArray(value.fields) &&
		value.fields.every((field) => typeof field === "string") &&
		Array.isArray(value.rows) &&
		value.rows.every(isPlainObject)
	);
}

function isPlainObject(value: unknown): value is { [key: string]: ToonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarOrNull(value: ToonValue): string | number | boolean | null {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	)
		return value as string | number | boolean | null;
	if (Array.isArray(value) || isPlainObject(value)) return null;
	return null;
}

function assertInvariants(output: string): void {
	if (output.includes("\r"))
		throw new Error("TOON output must use LF line endings");
	if (output.endsWith("\n"))
		throw new Error("TOON output must not end with a trailing newline");
	for (const line of output.split("\n")) {
		if (/\s$/.test(line))
			throw new Error(`TOON output has trailing whitespace: ${line}`);
	}
}
