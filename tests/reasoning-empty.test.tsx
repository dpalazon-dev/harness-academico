import React from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { hasReasoningToShow, ReasoningPart } from "../components/ai-elements/reasoning.tsx";

// Fork divergence (docs/sistema-comun/divergencias.md): a thinking block that
// settled without text draws no toggle.
describe("reasoning part — empty thinking", () => {
	it("draws nothing once settled with empty or blank text", () => {
		for (const text of [undefined, "", "   \n\t "]) {
			assert.equal(hasReasoningToShow(text, false), false);
			assert.equal(renderToStaticMarkup(<ReasoningPart text={text} />), "");
		}
	});
	it("keeps the row while streaming, even before any text arrives", () => {
		assert.equal(hasReasoningToShow("", true), true);
		assert.match(renderToStaticMarkup(<ReasoningPart text="" isStreaming />), /Razonando/);
	});
	it("keeps a settled block that has text, with its label", () => {
		assert.match(renderToStaticMarkup(<ReasoningPart text="Comparo las dos hipótesis." />), /RAZONAMIENTO DEL AGENTE/);
	});
});
