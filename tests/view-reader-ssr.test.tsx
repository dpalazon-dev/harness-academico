/**
 * Cargar /chat/<id> directamente daba 500 (HarnessAcademico, 2026-11-13):
 * el renderizador de servidor de React sella en desarrollo los objetos de
 * useRef, y el chat les añadía `changed` al renderizar. Los lectores de
 * vista se crean con useViewReader: estables y ampliables también en SSR.
 */
import React, { useRef } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToString } from "react-dom/server";
import { useViewReader, type ViewReaderRef } from "../components/session-view-readers.ts";

describe("useViewReader en el renderizado de servidor", () => {
	it("admite que se le asigne changed, como hace el chat", () => {
		function Lector() {
			const reader = useViewReader<string>();
			reader.changed = () => {};
			reader.current = () => "texto";
			return <span>{reader.current()}</span>;
		}
		assert.match(renderToString(<Lector />), /texto/);
	});

	it("con useRef el mismo patrón falla: la causa del 500", { skip: process.env.NODE_ENV === "production" }, () => {
		function ConRef() {
			const reader = useRef<(() => string) | null>(null) as ViewReaderRef<string>;
			reader.changed = () => {};
			return null;
		}
		assert.throws(() => renderToString(<ConRef />), /not extensible/);
	});
});
