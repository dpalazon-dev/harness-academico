import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import test from "node:test";
import { localizeFixedNotice } from "../components/chat";

test("localizeFixedNotice traduce el envoltorio de un envío rechazado y deja el detalle", () => {
	assert.equal(
		localizeFixedNotice("Could not prepare submission (foo): bar baz. Your input has been kept."),
		"No se pudo preparar el envío (foo): bar baz. Se ha conservado lo que habías escrito.",
	);
});

test("localizeFixedNotice no toca los mensajes que no son del runner", () => {
	assert.equal(localizeFixedNotice("Boom"), "Boom");
});
