import { artifactRenderers } from "@/components/artifacts";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import { QUESTION_TOOLS, type LhViewPart } from "@/src/core";

/**
 * ¿Va esta herramienta dentro del bloque de actividad (diseño 2B)? Solo las
 * que el estudiante no necesita ver: las que se pintan con la tarjeta
 * genérica de una línea. Fuera quedan las preguntas, los problemas, el plan,
 * las demos, las figuras, las imágenes, los trabajos en segundo plano y las
 * herramientas de plugin con renderizador propio.
 */
export function esHerramientaSilenciosa(part: LhViewPart, conRenderizador: ReadonlySet<string>): boolean {
	if (!part.type.startsWith("tool-") || part.pluginQuestion || part.pluginProblem) return false;
	const nombre = part.type.slice("tool-".length);
	if ((QUESTION_TOOLS as readonly string[]).includes(nombre) || nombre.startsWith("plan_")) return false;
	if (Object.hasOwn(artifactRenderers, nombre)) return artifactRenderers[nombre] === ToolCallCard;
	if ((part as { background?: unknown }).background || conRenderizador.has(nombre)) return false;
	const details = part.result?.details as { dispatched?: unknown } | null | undefined;
	return details?.dispatched !== true;
}
