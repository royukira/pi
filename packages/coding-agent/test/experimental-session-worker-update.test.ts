import type { ServiceProviderUpdate } from "@earendil-works/chord";
import { describe, expect, it } from "vitest";
import { toWorkerServiceUpdate } from "../src/experimental/session-worker.ts";

/** Build a state update from raw op tuples so tests can exercise non-conforming payloads. */
function stateUpdate(ops: unknown): ServiceProviderUpdate {
	return { type: "state", member: "state", sequence: 1, ops } as unknown as ServiceProviderUpdate;
}

describe("toWorkerServiceUpdate", () => {
	it("passes JSON-safe updates through", () => {
		const update = stateUpdate([["s", ["revision"], 2]]);
		expect(toWorkerServiceUpdate(update)).toEqual(update);
	});

	it("strips explicitly undefined properties, matching the JSON wire encoding", () => {
		expect(
			toWorkerServiceUpdate(stateUpdate([["s", ["details"], { truncation: undefined, path: "/tmp/spill.log" }]])),
		).toEqual(stateUpdate([["s", ["details"], { path: "/tmp/spill.log" }]]));
	});

	it("strips undefined properties nested inside streaming messages", () => {
		const payload = {
			snapshot: { operation: { streamingMessage: { content: [{ type: "toolCall", customInput: undefined }] } } },
			event: null,
		};
		expect(toWorkerServiceUpdate(stateUpdate([["s", ["state"], payload]]))).toEqual(
			stateUpdate([
				[
					"s",
					["state"],
					{ snapshot: { operation: { streamingMessage: { content: [{ type: "toolCall" }] } } }, event: null },
				],
			]),
		);
	});

	it("keeps undefined array entries as null, matching JSON.stringify", () => {
		expect(toWorkerServiceUpdate(stateUpdate([["s", ["list"], [1, undefined, 3]]]))).toEqual(
			stateUpdate([["s", ["list"], [1, null, 3]]]),
		);
	});

	it("still rejects genuinely non-JSON updates", () => {
		expect(() => toWorkerServiceUpdate(stateUpdate([["s", ["bad"], new Date()]]))).toThrow(
			"Service produced a non-JSON update",
		);
	});
});
