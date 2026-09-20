import { mkdirSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Fire-and-forget JSONL diagnostics for the experimental process relay.
 *
 * The internal processes deliberately discard stdio, so relay failures are
 * otherwise invisible. Logs live under `<server directory>/logs/`.
 */
export type DiagnosticLogger = (event: string, data?: Record<string, unknown>) => void;

export const noopDiagnosticLogger: DiagnosticLogger = () => {};

export function diagnosticsLogPath(directory: string, name: string): string {
	return join(directory, "logs", `${name}.log`);
}

/**
 * Walk a value with the same rules as chord's `isJsonValue` and report the first
 * path that violates them, so non-serializable relay payloads can be diagnosed.
 */
export function findNonJsonValuePath(value: unknown, depth = 0): string {
	if (depth > 512) return "<depth limit>";
	const describe = (v: unknown): string => {
		if (v === null) return "null";
		if (typeof v === "object" || typeof v === "function") {
			const name = Object.getPrototypeOf(v)?.constructor?.name;
			return name === undefined ? typeof v : name;
		}
		return typeof v;
	};
	if (value === null || typeof value === "string" || typeof value === "boolean") return "<ok>";
	if (typeof value === "number") return Number.isFinite(value) ? "<ok>" : `<non-finite number: ${value}>`;
	if (typeof value !== "object") return `<${typeof value}: ${String(value)}>`;
	if (Array.isArray(value)) {
		const keys = Reflect.ownKeys(value);
		if (keys.length !== value.length + 1 || keys.some((key) => typeof key !== "string")) {
			return `<array with irregular keys: ${keys.map(String).join(",")}>`;
		}
		for (let index = 0; index < value.length; index++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
			if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
				return `[${index}]<descriptor: ${descriptor === undefined ? "missing" : `${descriptor.enumerable ? "enumerable" : "non-enumerable"}${"get" in descriptor ? " getter" : ""}`}>`;
			}
			const nested = findNonJsonValuePath(descriptor.value, depth + 1);
			if (nested !== "<ok>") return `[${index}]${nested}`;
		}
		return "<ok>";
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return `<instance of ${describe(value)}>`;
	}
	if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) {
		return `<symbol keys: ${Reflect.ownKeys(value)
			.filter((key) => typeof key !== "string")
			.map(String)
			.join(",")}>`;
	}
	for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
		if (!descriptor.enumerable) continue;
		if (!("value" in descriptor)) return `.${key}<getter>`;
		const nested = findNonJsonValuePath(descriptor.value, depth + 1);
		if (nested !== "<ok>") return `.${key}${nested}`;
	}
	return "<ok>";
}

export interface DiagnosticLoggerOptions {
	/** Also mirror each event to stderr, for foreground development servers. */
	readonly echo?: boolean;
}

export function createDiagnosticLogger(
	name: string,
	directory: string,
	options?: DiagnosticLoggerOptions,
): DiagnosticLogger {
	const path = diagnosticsLogPath(directory, name);
	const prefix = `[${name}]`;
	let ready: Promise<void> | undefined;
	return (event, data) => {
		ready ??= mkdir(dirname(path), { recursive: true }).then(() => undefined);
		let line: string;
		try {
			line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;
		} catch {
			line = `${JSON.stringify({ ts: new Date().toISOString(), event, data: String(data) })}\n`;
		}
		if (options?.echo === true) {
			console.error(`${prefix} ${event}${data === undefined ? "" : ` ${JSON.stringify(data)}`}`);
		}
		void ready
			.then(() => appendFile(path, line))
			.catch(() => {
				// Diagnostics must never affect relay behavior.
			});
	};
}

/** Synchronous variant for pre-spawn paths that cannot await. */
export function ensureDiagnosticsDirectory(directory: string): void {
	mkdirSync(join(directory, "logs"), { recursive: true });
}
