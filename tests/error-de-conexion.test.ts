/**
 * El código del error y su texto van separados: Electron manda un código estable y un texto en español, y el chat clasifica
 * por el código. Si se clasificara por el texto, «segundo plano» no casaría con /background/ y David vería el mensaje genérico.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { ErrorDeConexion, errorDeRespuesta, motivoDeError } from "../src/agent/error-de-conexion.ts";
import { chatGPTStreamError } from "../src/agent/chatgpt-stream.ts";
import { nativeSubscriptionError } from "../src/agent/subscription-stream.ts";

const require = createRequire(import.meta.url);
const chatgpt = require("../electron/chatgpt.cjs") as { publicError(e: unknown): string; publicCode(e: unknown): string };
const suscripciones = require("../electron/subscriptions.cjs") as { publicError(e: unknown): string; publicCode(e: unknown): string };
const fallo = (code: string) => Object.assign(new Error(code), { code });

test("Electron da un código conocido y su texto en español; un código desconocido cae en el genérico", () => {
	assert.equal(chatgpt.publicCode(fallo("background")), "background");
	assert.match(chatgpt.publicError(fallo("background")), /segundo plano/);
	assert.equal(chatgpt.publicCode(fallo("inventado")), "failed");
	assert.equal(chatgpt.publicCode(new Error("sin código")), "failed");
	assert.equal(chatgpt.publicCode(fallo("revocation")), "failed", "la revocación es un aviso del estado, no un error de una petición");
	assert.equal(suscripciones.publicCode(fallo("refresh")), "refresh");
	assert.match(suscripciones.publicError(fallo("refresh")), /No se pudo renovar la conexión/);
	assert.equal(suscripciones.publicCode(fallo("inventado")), "unavailable");
});

test("la respuesta de IPC con código es un ErrorDeConexion; sin código (paquete antiguo), un error con su texto", () => {
	const conCodigo = errorDeRespuesta("El uso en segundo plano de ChatGPT está desactivado en esta app.", "background", "por defecto");
	assert.ok(conCodigo instanceof ErrorDeConexion);
	assert.equal(conCodigo.message, "El uso en segundo plano de ChatGPT está desactivado en esta app.");
	assert.equal(motivoDeError(conCodigo), "background");
	const sinCodigo = errorDeRespuesta(undefined, undefined, "ChatGPT connection failed.");
	assert.ok(!(sinCodigo instanceof ErrorDeConexion));
	assert.equal(motivoDeError(sinCodigo), "ChatGPT connection failed.");
	assert.equal(motivoDeError("429 quota"), "429 quota");
});

test("el chat clasifica por el código aunque el texto esté en español", () => {
	const texto = chatgpt.publicError(fallo("background"));
	assert.doesNotMatch(texto, /background/i, "el texto ya no lleva la palabra que buscaba la clasificación");
	assert.match(chatGPTStreamError(motivoDeError(new ErrorDeConexion(texto, "background"))), /segundo plano de ChatGPT está desactivado/);
	assert.match(chatGPTStreamError(motivoDeError(new ErrorDeConexion(chatgpt.publicError(fallo("expired")), "expired"))), /sesión de ChatGPT ha caducado/);
	assert.match(nativeSubscriptionError("xai-subscription", motivoDeError(new ErrorDeConexion(suscripciones.publicError(fallo("background")), "background"))), /segundo plano/);
	assert.match(nativeSubscriptionError("xai-subscription", motivoDeError(new ErrorDeConexion(suscripciones.publicError(fallo("refresh")), "refresh"))), /No se pudo renovar la autorización/);
});
