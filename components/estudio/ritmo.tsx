"use client";

/**
 * El ritmo de estudio (ticket 06 de la segunda ronda), con la lectura `ritmo`
 * de Estudio: `LineaRitmo`, las cuatro cifras compactas que el inicio pone sobre
 * la agenda, y `GraficoActividad`, el año de actividad que Progreso pone en
 * lugar de los últimos 14 días. Día estudiado es el de la agenda, y la escala de
 * verdes también: ambas salen del tema activo. No se mide tiempo de estudio.
 */
import { Fragment } from "react";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { nivelDeActividad, VERDE } from "./agenda";
import type { LecturaRitmo } from "./tipos";

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

const TENDENCIA = {
	sube: { Icono: TrendingUpIcon, texto: "más que la media de las semanas anteriores", color: "text-[var(--lh-success)]" },
	baja: { Icono: TrendingDownIcon, texto: "menos que la media de las semanas anteriores", color: "text-[var(--lh-warning)]" },
	igual: { Icono: MinusIcon, texto: "igual que la media de las semanas anteriores", color: "" },
} as const;

function Cifra({ valor, children, title }: { valor: string | number; children: string; title?: string }) {
	return (
		<span title={title}>
			<strong className="font-semibold tabular-nums text-foreground">{valor}</strong> {children}
		</span>
	);
}

/** Las cuatro cifras en una línea que se parte si no cabe; con `null` (cargando) guarda su altura sin cifras. */
export function LineaRitmo({ ritmo }: { ritmo: LecturaRitmo | null }) {
	const cifras = ritmo && (() => {
		const semanas = ritmo.intentosPorSemana.length;
		const estaSemana = ritmo.intentosPorSemana.at(-1) ?? 0;
		const { total, aTiempo } = ritmo.repasos;
		const t = TENDENCIA[ritmo.tendencia];
		return [
			<Cifra key="dias" valor={ritmo.diasEstudiados}>{`${ritmo.diasEstudiados === 1 ? "día" : "días"} en ${semanas} semanas`}</Cifra>,
			<Cifra key="racha" valor={ritmo.racha} title="Días estudiados seguidos hasta hoy, o hasta ayer si hoy aún no">{`${ritmo.racha === 1 ? "día" : "días"} de racha`}</Cifra>,
			total === 0
				? <Cifra key="repasos" valor={0} title={`Ningún repaso en las últimas ${semanas} semanas`}>repasos</Cifra>
				: <Cifra key="repasos" valor={`${Math.round((aTiempo / total) * 100)} %`} title={`${aTiempo} de ${total} repasos de las últimas ${semanas} semanas, hechos en su fecha o antes`}>repasos a tiempo</Cifra>,
			<span key="intentos" className="inline-flex items-center gap-1" data-tendencia={ritmo.tendencia}
				title={`Intentos valorados cada 7 días, de los más antiguos a los últimos: ${ritmo.intentosPorSemana.join(" · ")}`}>
				<Cifra valor={estaSemana}>{`${estaSemana === 1 ? "intento" : "intentos"} en 7 días`}</Cifra>
				<t.Icono className={cn("size-3.5", t.color)} aria-label={t.texto} role="img" />
			</span>,
		];
	})();
	return (
		<p data-ritmo="" aria-label="Ritmo de estudio" className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
			{cifras?.map((c, i) => <Fragment key={i}>{i > 0 && <span aria-hidden="true">·</span>}{c}</Fragment>)}
		</p>
	);
}

const enUTC = (dia: string) => new Date(`${dia}T12:00:00Z`);
const fechaCorta = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });
const mesCorto = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "UTC" });
/** Lunes 0, domingo 6. */
const diaDeSemana = (dia: string) => (enUTC(dia).getUTCDay() + 6) % 7;
const FILAS = ["L", "", "X", "", "V", "", ""];

type Celda = { dia: string; n: number } | null;

/** Las columnas de semana, de lunes a domingo: huecos antes del primer día y después del último. */
function semanas(actividad: LecturaRitmo["actividad"]): Celda[][] {
	if (!actividad.length) return [];
	const celdas: Celda[] = [...Array<null>(diaDeSemana(actividad[0]!.dia)).fill(null), ...actividad];
	while (celdas.length % 7) celdas.push(null);
	return Array.from({ length: celdas.length / 7 }, (_, i) => celdas.slice(i * 7, i * 7 + 7));
}

/** Un año de actividad en una rejilla de semanas, con las intensidades de la agenda y un resumen para quien no la ve. */
export function GraficoActividad({ actividad }: { actividad: LecturaRitmo["actividad"] }) {
	const estudiados = actividad.filter(d => d.n > 0).length;
	const columnas = semanas(actividad);
	const resumen = estudiados === 0 ? "Ningún día estudiado en el último año." : `${dias(estudiados)} ${estudiados === 1 ? "estudiado" : "estudiados"} en el último año.`;
	return (
		<div data-grafico="actividad">
			<p className="text-sm text-muted-foreground">{resumen}</p>
			<div role="img" aria-label={resumen} className="mt-3 flex gap-[3px] text-[10px] leading-none text-muted-foreground">
				<div className="flex flex-col gap-[3px] pr-1" aria-hidden="true">
					<span className="h-3" />
					{FILAS.map((f, i) => <span key={i} className="flex aspect-square items-center">{f}</span>)}
				</div>
				{columnas.map((semana, i) => {
					// El mes se rotula en la columna donde empieza.
					const primero = semana.find(c => c?.dia.endsWith("-01"));
					return (
						<div key={i} data-semana={i} className="flex min-w-0 flex-1 flex-col gap-[3px]">
							<span className="h-3 overflow-visible whitespace-nowrap">{primero ? mesCorto.format(enUTC(primero.dia)).replace(".", "") : ""}</span>
							{semana.map((c, j) => c === null
								? <span key={j} data-hueco="" className="aspect-square w-full" />
								: (
									<span
										key={j}
										data-dia={c.dia}
										data-nivel={nivelDeActividad(c.n)}
										title={`${fechaCorta.format(enUTC(c.dia)).replace(".", "")}: ${c.n === 0 ? "sin actividad" : c.n === 1 ? "1 actividad" : `${c.n} actividades`}`}
										className={cn("aspect-square w-full rounded-[2px]", c.n === 0 ? "bg-muted" : VERDE[nivelDeActividad(c.n)])}
									/>
								))}
						</div>
					);
				})}
			</div>
			<p className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
				menos
				<span aria-hidden="true" className="size-2.5 rounded-[2px] bg-muted" />
				{[1, 2, 3].map(n => <span key={n} aria-hidden="true" className={cn("size-2.5 rounded-[2px]", VERDE[n])} />)}
				más
			</p>
		</div>
	);
}
