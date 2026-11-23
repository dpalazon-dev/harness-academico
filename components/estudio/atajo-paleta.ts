"use client";

/**
 * El atajo de la paleta de comandos escrito como lo ve David: «Ctrl+K» en Windows, «⌘K» en macOS, o el que haya
 * reasignado en Ajustes › Teclado. Depende del sistema y de lo guardado en el navegador, así que se calcula en el
 * cliente; antes de eso, y en el render del servidor, vale el de Windows.
 */
import { useEffect, useState } from "react";
import { bindingForAction, formatBinding } from "@/src/core";

export const ATAJO_PALETA_INICIAL = "Ctrl+K";

export function useAtajoPaleta(): string {
	const [atajo, setAtajo] = useState(ATAJO_PALETA_INICIAL);
	useEffect(() => { setAtajo(formatBinding(bindingForAction("command-palette"))); }, []);
	return atajo;
}
