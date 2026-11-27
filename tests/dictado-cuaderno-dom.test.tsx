import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { parseHTML } from "linkedom";

// Dictar en el cuaderno (ticket 12i), en el DOM: lo transcrito entra por el onChange del campo. Todo se importa después de
// preparar el DOM, para que React detecte el evento `input` como en el navegador.

let restore: (() => void) | undefined;
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); restore?.(); dispose = undefined; restore = undefined; });

test("el texto transcrito entra en el párrafo donde estaba el cursor, por su onChange", async () => {
	const dom = parseHTML("<html><body><div id='root'></div></body></html>");
	Object.assign(dom.document, { oninput: null });
	// linkedom no sincroniza `value` de un campo con lo que pone React: se guarda aparte, como en el navegador.
	const valores = new WeakMap<object, string>();
	Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue", {
		configurable: true,
		get(this: HTMLTextAreaElement) { return this.textContent ?? ""; },
		set(this: HTMLTextAreaElement, v: string) { this.textContent = String(v); },
	});
	Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "value", {
		configurable: true,
		get(this: HTMLTextAreaElement) { return valores.get(this) ?? this.textContent ?? ""; },
		set(this: HTMLTextAreaElement, v: string) { valores.set(this, String(v)); },
	});
	const React = (await import("react")).default;
	const { act } = await import("react");
	const previous = new Map<string, PropertyDescriptor | undefined>();
	class Worklet { static all: Worklet[] = []; port: { onmessage?: (e: { data: unknown }) => void } = {}; constructor() { Worklet.all.push(this); } connect() {} disconnect() {} }
	let reply!: (r: Response) => void;
	for (const [key, value] of Object.entries({
		React, window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event,
		HTMLElement: dom.window.HTMLElement, HTMLTextAreaElement: dom.window.HTMLTextAreaElement, HTMLInputElement: dom.window.HTMLInputElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		navigator: { userAgent: "", platform: "", mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
		AudioContext: class { state = "running"; destination = {}; audioWorklet = { addModule: async () => {} }; createMediaStreamSource() { return { connect() {}, disconnect() {} }; } },
		AudioWorkletNode: Worklet,
		fetch: () => new Promise<Response>((done) => { reply = done; }),
	})) {
		previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
	}
	restore = () => { for (const [key, d] of previous) { if (d) Object.defineProperty(globalThis, key, d); else delete (globalThis as Record<string, unknown>)[key]; } };
	// linkedom: focus and selection, as a browser keeps them.
	let active: Element = dom.document.body;
	Object.defineProperty(dom.document, "activeElement", { configurable: true, get: () => active });
	dom.window.HTMLElement.prototype.focus = function () { active = this; };
	type ConSeleccion = { value: string; _s?: number; _e?: number };
	for (const proto of [dom.window.HTMLTextAreaElement.prototype, dom.window.HTMLInputElement.prototype] as unknown as { setSelectionRange(s: number, e: number): void }[]) {
		Object.defineProperty(proto, "selectionStart", { configurable: true, get(this: ConSeleccion) { return this._s ?? this.value.length; } });
		Object.defineProperty(proto, "selectionEnd", { configurable: true, get(this: ConSeleccion) { return this._e ?? this.value.length; } });
		proto.setSelectionRange = function (this: ConSeleccion, s: number, e: number) { this._s = s; this._e = e; };
	}

	const { DictadoCuaderno } = await import("../components/estudio/dictado-cuaderno.tsx");
	const cambios: string[] = [];
	function Pagina() {
		const raiz = React.useRef<HTMLDivElement>(null);
		const [texto, setTexto] = React.useState("Primera idea");
		return (
			<div ref={raiz}>
				<DictadoCuaderno raiz={raiz} />
				<ol><li data-block-id="b1"><textarea data-campo="texto" value={texto} onChange={(e) => { cambios.push(e.target.value); setTexto(e.target.value); }} /></li></ol>
			</div>
		);
	}
	const { createRoot } = await import("react-dom/client");
	const root = createRoot(dom.document.getElementById("root")!);
	dispose = async () => { await act(async () => { root.unmount(); }); };
	await act(async () => { root.render(<Pagina />); });

	const area = dom.document.querySelector("textarea")!;
	area.focus();
	area.setSelectionRange(12, 12);
	// Pulsar el micrófono quita el foco al párrafo: se recuerda dónde estaba el cursor.
	await act(async () => { area.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })); });
	const boton = () => dom.document.querySelector<HTMLButtonElement>("[data-dictar]")!;
	await act(async () => { active = boton(); boton().click(); });
	await act(async () => { Worklet.all[0]!.port.onmessage?.({ data: { type: "audio", buffer: new Int16Array(2048).buffer } }); });
	await act(async () => { boton().click(); });
	assert.match(boton().textContent!, /Transcribiendo/);
	await act(async () => { reply(Response.json({ text: "y segunda" })); });
	assert.deepEqual(cambios, ["Primera idea y segunda"]);
	assert.equal(area.value, "Primera idea y segunda");
	assert.equal(dom.document.activeElement, area);
});
