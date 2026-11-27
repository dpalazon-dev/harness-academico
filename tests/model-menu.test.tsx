import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";
import type { ModelCatalogEntry } from "../src/core/index.ts";
import { ModelMenuList } from "../components/settings/model-menu.tsx";
import { InteractionLayersProvider, useInteractionLayers, type InteractionLayersController } from "../components/interaction-layers.tsx";

// Kept from the retired dictation-language picker suite (ticket 12i, 2026-11-27):
// the shared model menu was tested through the same fixture.
let interactionController: InteractionLayersController | undefined;
function InteractionFixture({ children }: { children: React.ReactNode }) { interactionController = useInteractionLayers(); return children; }
function WithLayers({ children }: { children: React.ReactNode }) { return <InteractionLayersProvider><InteractionFixture>{children}</InteractionFixture></InteractionLayersProvider>; }

let dispose: (() => Promise<void>) | undefined;
let restore: (() => void) | undefined;
async function key(element: HTMLElement, value: string) {
	await act(async () => {
		const event = new window.Event("keydown", { bubbles: true, cancelable: true });
		Object.assign(event, { key: value });
		// linkedom omits the browser's window capture path.
		interactionController?.captureKeyDown(event as KeyboardEvent);
		element.dispatchEvent(event);
	});
}
async function search(value: string, element: HTMLInputElement) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(element, value);
		element.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}

async function fixture() {
	const { window: win, document: doc } = parseHTML("<html><body><div id='root'></div></body></html>");
	let active: Element = doc.body;
	Object.defineProperty(doc, "activeElement", { get: () => active });
	Object.assign(doc, { oninput: null });
	Object.assign(win, { innerWidth: 1280, innerHeight: 900 });
	win.HTMLElement.prototype.focus = function () { active = this; };
	win.HTMLElement.prototype.scrollIntoView = () => {};
	win.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 200, bottom: 230, left: 400, right: 500, width: 100, height: 30, x: 400, y: 200, toJSON() {} });
	const previous = new Map<string, PropertyDescriptor | undefined>();
	for (const [name, value] of Object.entries({
		React, window: win, document: doc, Element: win.Element, HTMLElement: win.HTMLElement,
		HTMLInputElement: win.HTMLInputElement, HTMLTextAreaElement: win.HTMLTextAreaElement,
		Event: win.Event, CustomEvent: win.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
		requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
		cancelAnimationFrame: clearTimeout,
	})) {
		previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
		Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
	}
	restore = () => {
		for (const [name, descriptor] of previous) {
			if (descriptor) Object.defineProperty(globalThis, name, descriptor);
			else delete (globalThis as Record<string, unknown>)[name];
		}
	};
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(doc.getElementById("root")!);
	dispose = async () => { await act(async () => { root.unmount(); }); };
	return { render: async (element: React.ReactNode) => { await act(async () => { root.render(<WithLayers>{element}</WithLayers>); }); } };
}

afterEach(async () => { await dispose?.(); restore?.(); dispose = undefined; restore = undefined; interactionController = undefined; });

test("the shared model menu preserves ranking, provider identity, keyboard clamping, and row content", async () => {
	const f = await fixture();
	const model = (id: string, provider: string): ModelCatalogEntry => ({
		id, provider, name: `Model ${id}`, contextWindow: 32000, maxTokens: 4096,
		cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
		input: ["text"], reasoning: false, supportedLevels: [],
	});
	const models = [model("beta", "p1"), model("alpha", "p1"), model("alpha", "p2")];
	const picked: ModelCatalogEntry[] = [];
	await f.render(<ModelMenuList models={models} effectiveId="alpha" effectiveProvider="p2" onPick={(m) => picked.push(m)} footer="Model footer" />);
	const modelInput = document.querySelector<HTMLInputElement>('[data-testid="model-search"]')!;
	const options = () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid="model-list"] button')];
	assert.equal(document.activeElement, modelInput);
	assert.match(options()[0]!.textContent!, /p1 · alpha/);
	assert.match(options()[1]!.textContent!, /p2 · alpha/);
	assert.ok(!options()[0]!.className.includes("bg-muted/60"));
	assert.ok(options()[1]!.className.includes("bg-muted/60"));
	assert.match(options()[0]!.textContent!, /\$1\.00\/\$2\.00/);
	assert.match(options()[0]!.textContent!, /32k/);
	assert.match(document.body.textContent!, /Model footer/);
	await key(modelInput, "Enter");
	assert.equal(picked[0], models[1], "Enter without walking selects the first ranked result");
	await key(modelInput, "ArrowUp");
	await key(modelInput, "Enter");
	assert.equal(picked[1], models[0], "ArrowUp enters at the last result");
	await key(modelInput, "ArrowDown");
	await key(modelInput, "ArrowDown");
	await key(modelInput, "Enter");
	assert.equal(picked[2], models[0], "ArrowDown clamps at the last result");
	await search("p2", modelInput);
	assert.equal(options().length, 1);
	await key(modelInput, "Enter");
	assert.equal(picked[3], models[2], "search resets the walked index and includes provider identity");
	await search("no-model-matches", modelInput);
	await key(modelInput, "Enter");
	assert.equal(picked.length, 4);
	assert.match(document.body.textContent!, /Ningún modelo coincide/);
});
