"use client";

/**
 * La barra lateral del armazón de estudio (ADR 0001, ticket 01): el espacio
 * activo como menú en la cabecera, Inicio, «Por decidir» con su panel cuando hay
 * decisiones pendientes (ticket 02 de la segunda ronda), el plan del espacio con el ciclo de
 * cada unidad (ticket 02), Biblioteca (ticket 05), Cuadernos (ticket 09),
 * las conversaciones del espacio, agrupables por fecha o por unidad del plan y filtrables por actividad y fecha
 * (ticket 03 de la segunda ronda), y, abajo, la actividad en segundo plano, Progreso y Ajustes. Plegable a
 * iconos con su botón y con ⌘B. Bajo el espacio, el botón de la paleta de búsqueda y acciones (⌘K, ticket 08).
 *
 * Cada conversación tiene su menú (clic derecho, botón de «más» o la tecla de menú) para renombrarla en línea,
 * exportarla como Markdown o borrarla; F2 sobre la fila la renombra (ticket 12). Las piezas son las del núcleo:
 * `RenameRow`, `DeleteSessionDialog`, `ActivitySection`, la ruta de Markdown y el evento `lh:chat-renamed`.
 *
 * `BarraLateralEstudio` es pura (datos dentro, marcado fuera) para que el
 * render estático la fije; `BarraLateral` la conecta con el plugin y el router.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3Icon, CheckIcon, ChevronRightIcon, ChevronsUpDownIcon, GraduationCapIcon, HomeIcon, InboxIcon, LibraryIcon, MessageSquareIcon, MoreHorizontalIcon, NotebookPenIcon, QuoteIcon, SearchIcon, SettingsIcon, TargetIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { bindingForAction, formatBinding, kbdEventForAction } from "@/src/core";
import {
	DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent,
	DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarHeader, SidebarMenu,
	SidebarMenuAction, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { commitChatRename, downloadChatMarkdown, RenameRow } from "@/components/sidebar";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { ActivitySection } from "@/components/activity-dock";
import type { ChatListItem } from "@/src/core";
import { useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { useOptionalInteractionLayers } from "@/components/interaction-layers";
import { cn } from "@/lib/utils";
import {
	ACTIVIDADES, agruparConversaciones, FECHAS, FILTROS_INICIALES, filtrosConversaciones, recordarFiltros,
	type ConversacionLista, type FiltrosConversaciones, type OrigenConversacion,
} from "./conversaciones";
import { llamarEstudio } from "./llamar";
import { BarraCiclo } from "./ciclo";
import type { LecturaPlan } from "./tipos";
import { usePorDecidir } from "./por-decidir";
import { RUTA_BIBLIOTECA } from "./documentos";
import { RUTA_CUADERNOS } from "./cuadernos";
import { recordarPlegadas, seccionesPlegadas, type IdSeccion } from "./secciones";

export interface Espacio {
	id: string;
	name: string;
	archived: boolean;
	revision?: number;
}

export interface DatosBarraLateral {
	/** null mientras carga o si Estudio no responde. */
	espacios: { areas: Espacio[]; activeAreaId: string | null } | null;
	conversaciones: ConversacionLista[] | null;
	/** El plan del espacio activo; null mientras carga o si Estudio no responde. */
	plan: LecturaPlan | null;
	ruta: string;
	ahora?: Date;
	/** El error de la última operación de espacios, si falló. */
	error?: string | null;
	/** El atajo de la paleta como se muestra («Ctrl+K», «⌘K»). */
	atajoPaleta?: string;
	/** Las secciones plegadas; las demás, desplegadas. */
	plegadas?: readonly IdSeccion[];
	/** Cuántas decisiones esperan a David en el espacio activo; sin ninguna, o mientras se leen, no hay «Por decidir». */
	porDecidir?: number;
	/** Cómo se agrupan y filtran las conversaciones. */
	filtros?: FiltrosConversaciones;
}

export interface AccionesBarraLateral {
	elegirEspacio(id: string | null): void;
	crearEspacio(nombre: string): void;
	renombrarEspacio(id: string, nombre: string): void;
	archivarEspacio(id: string): void;
	/** Devuelve un espacio archivado a la lista de espacios. */
	recuperarEspacio(id: string): void;
	/** Asigna al espacio activo las unidades, planes, documentos, cuadernos y conversaciones que no tienen ninguno. */
	traerSinEspacio(): void;
	/** Lleva el plan, con sus unidades, a otro espacio; null lo deja sin espacio. */
	moverPlan(planId: string, areaId: string | null): void;
	abrirAjustes(): void;
	navegar(ruta: string): void;
	abrirPaleta(): void;
	renombrarConversacion(id: string, titulo: string): void;
	exportarConversacion(id: string): void;
	/** Pide ya el resumen de la conversación (tema, qué quedó abierto, qué sigue), sin esperar a la pausa. */
	resumirConversacion(id: string): void;
	/** Abre el diálogo de borrado del núcleo para esa conversación. */
	borrarConversacion(conversacion: ConversacionLista): void;
	/** Pliega una sección desplegada o despliega una plegada. */
	alternarSeccion(seccion: IdSeccion): void;
	/** Abre el panel con las decisiones pendientes. */
	abrirPorDecidir(): void;
	/** Cambia la agrupación o un filtro de las conversaciones. */
	cambiarFiltros(filtros: FiltrosConversaciones): void;
}

export const RUTA_PROGRESO = "/progreso";

/** Pantallas dedicadas (ticket 06): practicar y un intento ocupan la ventana, sin barra lateral. */
export const sinBarraLateral = (ruta: string | null): boolean => ruta !== null && /^\/(practicar|intento)\//.test(ruta);

type Edicion = { modo: "crear" } | { modo: "renombrar"; id: string; nombre: string } | null;

export function BarraLateralEstudio({
	espacios, conversaciones, plan, ruta, ahora, error, atajoPaleta = "Ctrl+K", plegadas = [], porDecidir = 0, filtros = FILTROS_INICIALES, acciones,
}: DatosBarraLateral & { acciones: AccionesBarraLateral }) {
	const [edicion, setEdicion] = useState<Edicion>(null);
	/** Al elegir «Nuevo» o «Renombrar», el menú no devuelve el foco a su botón: va al campo. */
	const editarAlCerrar = useRef(false);
	/** La conversación con su menú abierto y la que se está renombrando en su fila. */
	const [menu, setMenu] = useState<string | null>(null);
	const [renombrando, setRenombrando] = useState<string | null>(null);
	/** «Renombrar» desde el menú: el campo aparece cuando el menú ya ha cerrado, o su foco devuelto al botón lo cerraría. */
	const renombrarAlCerrar = useRef<string | null>(null);
	const visibles = espacios?.areas.filter(a => !a.archived) ?? [];
	const archivados = espacios?.areas.filter(a => a.archived) ?? [];
	const activo = visibles.find(a => a.id === espacios?.activeAreaId) ?? null;
	const nombre = espacios === null ? "Estudio" : activo?.name ?? "Todos los espacios";
	const todos = espacios !== null && activo === null;
	const grupos = conversaciones ? agruparConversaciones(conversaciones, filtros, { ahora, plan, todos }) : [];
	const propsSeccion = (id: IdSeccion) => ({ seccion: id, plegada: plegadas.includes(id), onAlternar: () => acciones.alternarSeccion(id) });

	return (
		<Sidebar collapsible="icon" className="font-prose">
			<SidebarHeader className="gap-1 p-2">
				<div className="lh-drag flex h-9 items-center justify-end group-data-[collapsible=icon]:justify-center">
					<SidebarTrigger aria-label="Plegar o desplegar la barra lateral" className="lh-no-drag text-muted-foreground" />
				</div>
				{edicion ? (
					<CampoEspacio
						inicial={edicion.modo === "renombrar" ? edicion.nombre : ""}
						etiqueta={edicion.modo === "crear" ? "Nombre del espacio nuevo" : "Nuevo nombre del espacio"}
						onAceptar={(valor) => {
							if (edicion.modo === "crear") acciones.crearEspacio(valor);
							else acciones.renombrarEspacio(edicion.id, valor);
							setEdicion(null);
						}}
						onCancelar={() => setEdicion(null)}
					/>
				) : (
					<SidebarMenu>
						<SidebarMenuItem>
							<DropdownMenu>
								<DropdownMenuTrigger asChild disabled={espacios === null}>
									<SidebarMenuButton size="lg" data-testid="menu-espacio" tooltip={nombre} className="data-[state=open]:bg-sidebar-accent">
										<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary font-title text-base text-primary-foreground">
											{nombre.charAt(0).toLocaleUpperCase("es")}
										</span>
										<span className="grid flex-1 text-left leading-tight">
											<span className="truncate font-medium">{nombre}</span>
											<span className="truncate text-xs text-muted-foreground">Espacio</span>
										</span>
										<ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
									</SidebarMenuButton>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									className="w-60 font-prose"
									align="start"
									onCloseAutoFocus={(e) => {
										if (editarAlCerrar.current) e.preventDefault();
										editarAlCerrar.current = false;
									}}
								>
									<DropdownMenuLabel className="text-xs text-muted-foreground">Espacios</DropdownMenuLabel>
									{visibles.map(a => (
										<DropdownMenuItem key={a.id} onSelect={() => acciones.elegirEspacio(a.id)}>
											<span className="flex-1 truncate">{a.name}</span>
											{a.id === activo?.id && <CheckIcon className="size-4" />}
										</DropdownMenuItem>
									))}
									<DropdownMenuItem onSelect={() => acciones.elegirEspacio(null)}>
										<span className="flex-1">Todos</span>
										{activo === null && <CheckIcon className="size-4" />}
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem onSelect={() => { editarAlCerrar.current = true; setEdicion({ modo: "crear" }); }}>
										Nuevo espacio…
									</DropdownMenuItem>
									{activo && <>
										<DropdownMenuItem onSelect={() => { editarAlCerrar.current = true; setEdicion({ modo: "renombrar", id: activo.id, nombre: activo.name }); }}>
											Renombrar «{activo.name}»…
										</DropdownMenuItem>
										<DropdownMenuItem onSelect={acciones.traerSinEspacio}>Traer aquí lo que no tiene espacio</DropdownMenuItem>
										{plan?.plan && <MoverPlan planId={plan.plan.id} destinos={visibles.filter(a => a.id !== activo.id)} onMover={acciones.moverPlan} />}
										<DropdownMenuItem onSelect={() => acciones.archivarEspacio(activo.id)}>
											Archivar «{activo.name}»
										</DropdownMenuItem>
									</>}
									{archivados.length > 0 && <>
										<DropdownMenuSeparator />
										<DropdownMenuLabel className="text-xs text-muted-foreground">Archivados</DropdownMenuLabel>
										{archivados.map(a => (
											<DropdownMenuItem key={a.id} onSelect={() => acciones.recuperarEspacio(a.id)}>
												<span className="truncate">Recuperar «{a.name}»</span>
											</DropdownMenuItem>
										))}
									</>}
								</DropdownMenuContent>
							</DropdownMenu>
						</SidebarMenuItem>
					</SidebarMenu>
				)}
				{error && <p role="alert" className="px-2 text-xs text-destructive group-data-[collapsible=icon]:hidden">{error}</p>}
				<BotonPaleta atajo={atajoPaleta} onAbrir={acciones.abrirPaleta} />
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === "/"} onClick={() => acciones.navegar("/")} tooltip="Inicio" data-testid="inicio">
								<HomeIcon />Inicio
							</SidebarMenuButton>
						</SidebarMenuItem>
						{porDecidir > 0 && (
							<SidebarMenuItem>
								<SidebarMenuButton
									onClick={acciones.abrirPorDecidir}
									tooltip={`Por decidir (${porDecidir})`}
									aria-label={`Por decidir: ${porDecidir} ${porDecidir === 1 ? "pendiente" : "pendientes"}`}
									data-testid="por-decidir"
									className="relative"
								>
									<InboxIcon />Por decidir
									{/* Plegada la barra a iconos, la insignia de shadcn se oculta: el total va sobre el icono. */}
									<span aria-hidden data-icono-por-decidir className="absolute right-0.5 top-0.5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] leading-none text-primary-foreground tabular-nums group-data-[collapsible=icon]:flex">
										{porDecidir > 9 ? "9+" : porDecidir}
									</span>
								</SidebarMenuButton>
								<SidebarMenuBadge className="bg-primary text-primary-foreground tabular-nums">{porDecidir}</SidebarMenuBadge>
							</SidebarMenuItem>
						)}
					</SidebarMenu>
				</SidebarGroup>

				<SeccionBarra {...propsSeccion("plan")} titulo="Plan" descripcion={plan?.plan?.objetivo}>
					{plan === null ? (
						<p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">Cargando…</p>
					) : plan.unidades.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
							{plan.plan
								? "El plan aún no tiene unidades. Pide en Inicio al tutor que te proponga una ruta."
								: "Este espacio aún no tiene plan. Escribe en Inicio qué quieres poder hacer y el tutor te propondrá unidades."}
						</p>
					) : (
						<SidebarMenu>
							{plan.unidades.map((u, i) => (
								<SidebarMenuItem key={u.id}>
									<SidebarMenuButton
										isActive={ruta === `/unidad/${u.id}`}
										onClick={() => acciones.navegar(`/unidad/${u.id}`)}
										tooltip={u.propuesta ? `${u.titulo} (propuesta)` : u.titulo}
										className="h-auto py-1.5"
									>
										<span className="flex size-4 shrink-0 items-center justify-center text-[11px] tabular-nums text-muted-foreground">{u.fueraDelPlan ? "·" : i + 1}</span>
										<span className="grid min-w-0 flex-1 gap-1">
											<span className={cn("truncate", u.propuesta && "italic text-muted-foreground")}>{u.titulo}</span>
											{!u.propuesta && <BarraCiclo ciclo={u.ciclo} className="w-20" />}
										</span>
									</SidebarMenuButton>
									{u.propuesta
										? <SidebarMenuBadge className="text-[10px] font-normal text-muted-foreground">propuesta</SidebarMenuBadge>
										: u.fueraDelPlan && <SidebarMenuBadge className="text-[10px] font-normal text-muted-foreground">fuera del plan</SidebarMenuBadge>}
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					)}
				</SeccionBarra>

				<SeccionBarra {...propsSeccion("materiales")} titulo="Materiales">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === RUTA_BIBLIOTECA || ruta.startsWith(`${RUTA_BIBLIOTECA}/`)} onClick={() => acciones.navegar(RUTA_BIBLIOTECA)} tooltip="Biblioteca">
								<LibraryIcon />Biblioteca
							</SidebarMenuButton>
						</SidebarMenuItem>
						<SidebarMenuItem>
							<SidebarMenuButton isActive={ruta === RUTA_CUADERNOS || ruta.startsWith(`${RUTA_CUADERNOS}/`)} onClick={() => acciones.navegar(RUTA_CUADERNOS)} tooltip="Cuadernos">
								<NotebookPenIcon />Cuadernos
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SeccionBarra>

				<SeccionBarra {...propsSeccion("conversaciones")} titulo="Conversaciones" className="group-data-[collapsible=icon]:hidden">
					{conversaciones === null ? (
						<p className="px-2 text-xs text-muted-foreground">Cargando…</p>
					) : conversaciones.length === 0 ? (
						<p className="px-2 text-xs text-muted-foreground">Aún no hay conversaciones en este espacio.</p>
					) : <>
					<SelectoresConversaciones filtros={filtros} todos={todos} onCambiar={acciones.cambiarFiltros} />
					{grupos.length === 0 && <p className="px-2 pt-1 text-xs text-muted-foreground">Ninguna conversación con estos filtros.</p>}
					{grupos.map(g => (
						<div key={g.clave} className="mb-2">
							<p data-grupo-conversaciones={g.etiqueta} title={g.etiqueta} className="truncate px-2 pb-1 pt-2 text-[11px] text-muted-foreground/80">
								{g.numero !== null && <span className="tabular-nums">{g.numero} · </span>}{g.etiqueta}
							</p>
							<SidebarMenu>
								{g.conversaciones.map(c => (
									<SidebarMenuItem key={c.id}>
										{renombrando === c.id ? (
											<RenameRow
												chat={comoFila(c)}
												onCommit={(titulo) => {
													setRenombrando(null);
													if (titulo.trim() && titulo.trim() !== c.title) acciones.renombrarConversacion(c.id, titulo);
												}}
												onCancel={() => setRenombrando(null)}
											/>
										) : <>
											<SidebarMenuButton
												isActive={ruta === `/chat/${c.id}`}
												onClick={() => acciones.navegar(`/chat/${c.id}`)}
												onContextMenu={(e) => { e.preventDefault(); setMenu(c.id); }}
												onKeyDown={(e) => {
													// F2 renombra la fila enfocada, no la conversación abierta en la cabecera.
													if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
														e.preventDefault();
														setRenombrando(c.id);
													}
													// La tecla de menú y Mayús+F10 abren el menú de la fila, como el clic derecho.
													if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey)) {
														e.preventDefault();
														setMenu(c.id);
													}
												}}
												data-testid="conversacion"
												data-conversacion={c.id}
												data-actividad={c.origen}
												title={c.unidad ? `${ETIQUETA_ACTIVIDAD[c.origen]} · ${c.unidad.titulo}` : ETIQUETA_ACTIVIDAD[c.origen]}
												className="text-muted-foreground data-[active=true]:text-sidebar-accent-foreground"
											>
												<IconoActividad origen={c.origen} />
												<span className="truncate"><span className="sr-only">{ETIQUETA_ACTIVIDAD[c.origen]}: </span>{c.title}</span>
											</SidebarMenuButton>
											<DropdownMenu open={menu === c.id} onOpenChange={(abierto) => setMenu(abierto ? c.id : null)}>
												<DropdownMenuTrigger asChild>
													<SidebarMenuAction showOnHover aria-label={`Más acciones de «${c.title}»`} title="Más acciones" data-testid="conversacion-mas">
														<MoreHorizontalIcon />
													</SidebarMenuAction>
												</DropdownMenuTrigger>
												<DropdownMenuContent
													side="right"
													align="start"
													className="w-56 font-prose"
													data-testid="menu-conversacion"
													onCloseAutoFocus={(e) => {
														const id = renombrarAlCerrar.current;
														renombrarAlCerrar.current = null;
														if (id) { e.preventDefault(); setRenombrando(id); }
													}}
												>
													<DropdownMenuItem onSelect={() => { renombrarAlCerrar.current = c.id; }}>
														Renombrar<DropdownMenuShortcut>F2</DropdownMenuShortcut>
													</DropdownMenuItem>
													<DropdownMenuItem onSelect={() => acciones.exportarConversacion(c.id)}>Exportar como Markdown</DropdownMenuItem>
													<DropdownMenuItem onSelect={() => acciones.resumirConversacion(c.id)}>Resumir ahora</DropdownMenuItem>
													<DropdownMenuSeparator />
													<DropdownMenuItem variant="destructive" onSelect={() => acciones.borrarConversacion(c)}>Borrar…</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</>}
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</div>
					))}
					</>}
				</SeccionBarra>
			</SidebarContent>

			<SidebarFooter>
				{/* Los procesos en segundo plano (ActivitySection del núcleo), encima de Progreso y Ajustes; plegada la barra, no se ven. */}
				<div className="-mx-2 group-data-[collapsible=icon]:hidden">
					<ActivitySection />
				</div>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton isActive={ruta.startsWith(RUTA_PROGRESO)} onClick={() => acciones.navegar(RUTA_PROGRESO)} tooltip="Progreso">
							<BarChart3Icon />Progreso
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton onClick={acciones.abrirAjustes} tooltip="Ajustes" data-testid="settings-entry">
							<SettingsIcon />Ajustes
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</Sidebar>
	);
}

const ETIQUETA_ACTIVIDAD = Object.fromEntries(ACTIVIDADES.map(a => [a.id, a.etiqueta])) as Record<OrigenConversacion, string>;
const ICONO_ACTIVIDAD = { unidad: GraduationCapIcon, pasaje: QuoteIcon, intento: TargetIcon, libre: MessageSquareIcon } as const;

function IconoActividad({ origen }: { origen: OrigenConversacion }) {
	const Icono = ICONO_ACTIVIDAD[origen];
	return <Icono aria-hidden />;
}

/** Agrupar, actividad y fecha: tres selectores nativos compactos bajo la cabecera, como en el prototipo. */
function SelectoresConversaciones({ filtros, todos, onCambiar }: { filtros: FiltrosConversaciones; todos: boolean; onCambiar(filtros: FiltrosConversaciones): void }) {
	const clase = "h-6 min-w-0 rounded-md border border-sidebar-border bg-background px-1 text-[11px] text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring";
	return (
		<div className="flex flex-wrap gap-1 px-2 pb-1 pt-1">
			<select aria-label="Agrupar" className={clase} value={filtros.agrupar} onChange={(e) => onCambiar({ ...filtros, agrupar: e.target.value as FiltrosConversaciones["agrupar"] })}>
				<option value="fecha">Por fecha</option>
				<option value="unidad">{todos ? "Por plan" : "Por unidad del plan"}</option>
			</select>
			<select aria-label="Actividad" className={clase} value={filtros.actividad} onChange={(e) => onCambiar({ ...filtros, actividad: e.target.value as FiltrosConversaciones["actividad"] })}>
				<option value="toda">Toda actividad</option>
				{ACTIVIDADES.map(a => <option key={a.id} value={a.id}>{a.etiqueta}</option>)}
			</select>
			<select aria-label="Fecha" className={clase} value={filtros.fecha} onChange={(e) => onCambiar({ ...filtros, fecha: e.target.value as FiltrosConversaciones["fecha"] })}>
				{FECHAS.map(f => <option key={f.id} value={f.id}>{f.etiqueta}</option>)}
			</select>
		</div>
	);
}

/** Una sección con jerarquía: la cabecera, en negrita al tamaño del cuerpo y con chevrón, pliega y despliega sus
 * elementos, que van un punto más pequeños y con sangría. Plegada la barra a iconos no hay cabecera. */
function SeccionBarra({ seccion, plegada, onAlternar, titulo, descripcion, className, children }: {
	seccion: IdSeccion;
	plegada: boolean;
	onAlternar(): void;
	titulo: string;
	descripcion?: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<SidebarGroup className={className}>
			<button
				type="button"
				aria-expanded={!plegada}
				aria-controls={`seccion-${seccion}`}
				onClick={onAlternar}
				title={descripcion}
				data-seccion={seccion}
				className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm font-bold text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
			>
				<ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !plegada && "rotate-90")} />{titulo}
			</button>
			{/* Plegada, sus elementos siguen en la barra de iconos, como antes de haber secciones. */}
			<div
				id={`seccion-${seccion}`}
				data-elementos={seccion}
				className={cn("pl-3 [&_[data-sidebar=menu-button]]:text-[11.5px] group-data-[collapsible=icon]:pl-0", plegada && "hidden group-data-[collapsible=icon]:block")}
			>
				{children}
			</div>
		</SidebarGroup>
	);
}

/** `RenameRow` del núcleo pide una fila de la lista de sesiones; de una conversación del espacio basta su título y
 * su fecha: sin turno en marcha ni pregunta pendiente, su segunda línea es «hace cuánto». */
export function comoFila(c: ConversacionLista): ChatListItem {
	return {
		id: c.id, title: c.title, createdAt: c.updatedAt, updatedAt: c.updatedAt, kind: "teach", messageCount: 0, phase: "teach",
		pendingQuestion: false, pendingProblem: false, busy: false, compacting: false,
	} as ChatListItem;
}

/** «Mover el plan a…» del menú de espacios: los demás espacios y «Sin espacio». Sus unidades van con él. */
function MoverPlan({ planId, destinos, onMover }: { planId: string; destinos: Espacio[]; onMover(planId: string, areaId: string | null): void }) {
	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>Mover el plan a…</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className="w-52 font-prose">
				{destinos.map(a => (
					<DropdownMenuItem key={a.id} onSelect={() => onMover(planId, a.id)}><span className="truncate">{a.name}</span></DropdownMenuItem>
				))}
				<DropdownMenuItem onSelect={() => onMover(planId, null)}>Sin espacio</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

/** El botón que abre la paleta (ticket 08), con su atajo; plegada la barra, solo la lupa. */
function BotonPaleta({ atajo, onAbrir }: { atajo: string; onAbrir(): void }) {
	return (
		<button
			type="button"
			onClick={onAbrir}
			aria-label={`Buscar o hacer (${atajo})`}
			title={`Buscar o hacer (${atajo})`}
			data-testid="abrir-paleta"
			className="mt-1 flex h-8 w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2.5 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
		>
			<SearchIcon className="size-3.5 shrink-0" />
			<span className="flex-1 truncate text-left group-data-[collapsible=icon]:hidden">Buscar o hacer…</span>
			<Kbd className="group-data-[collapsible=icon]:hidden">{atajo}</Kbd>
		</button>
	);
}

/** Campo en línea para nombrar un espacio: Intro acepta, Escape cancela. */
function CampoEspacio({ inicial, etiqueta, onAceptar, onCancelar }: {
	inicial: string;
	etiqueta: string;
	onAceptar: (valor: string) => void;
	onCancelar: () => void;
}) {
	const [valor, setValor] = useState(inicial);
	const ref = useRef<HTMLInputElement>(null);
	const capas = useOptionalInteractionLayers();
	useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
	return (
		<input
			ref={ref}
			value={valor}
			aria-label={etiqueta}
			placeholder={etiqueta}
			spellCheck={false}
			onChange={(e) => setValor(e.target.value)}
			onBlur={onCancelar}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					if (valor.trim()) onAceptar(valor.trim());
					else onCancelar();
				}
				if (e.key === "Escape") {
					if (capas && !capas.isElementEligible(e.currentTarget)) return;
					// Reclamado: que no llegue también a la cadena de Escape de la conversación.
					capas?.claimEscape(e);
					e.stopPropagation();
					onCancelar();
				}
			}}
			className="lh-input h-12 w-full rounded-md border border-sidebar-border bg-background px-3 text-sm outline-none focus:border-ring group-data-[collapsible=icon]:hidden"
		/>
	);
}

/** El proveedor de la barra de shadcn, gobernado por el estado del núcleo
 * (preferencia guardada, cierre en ventana estrecha y ⌘B). El núcleo aplica
 * la preferencia guardada después de montar; sin animación hasta entonces, la
 * barra no se despliega a la vista en cada carga. */
export function ProveedorBarraLateral({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
	const [animar, setAnimar] = useState(false);
	useEffect(() => {
		// Dos fotogramas: el primero ya pinta el estado guardado, el segundo activa las transiciones.
		let segundo = 0;
		const primero = requestAnimationFrame(() => { segundo = requestAnimationFrame(() => setAnimar(true)); });
		return () => { cancelAnimationFrame(primero); cancelAnimationFrame(segundo); };
	}, []);
	return (
		<SidebarProvider
			open={open}
			onOpenChange={(siguiente) => { if (siguiente !== open) onToggle(); }}
			className={cn("min-h-0 h-dvh", !animar && "[&_*]:transition-none")}
		>
			{children}
		</SidebarProvider>
	);
}

/** La barra conectada: lee espacios, plan y conversaciones del plugin y se
 * refresca con los avisos del servidor; lo pendiente de decidir y su panel, con
 * `usePorDecidir`. */
export function BarraLateral() {
	const ruta = usePathname();
	const router = useRouter();
	const { open: abrirAjustes } = useSettingsDialog();
	const [espacios, setEspacios] = useState<DatosBarraLateral["espacios"]>(null);
	const [conversaciones, setConversaciones] = useState<ConversacionLista[] | null>(null);
	const [plan, setPlan] = useState<LecturaPlan | null>(null);
	const porDecidir = usePorDecidir();
	const [error, setError] = useState<string | null>(null);
	const [borrando, setBorrando] = useState<ConversacionLista | null>(null);
	// Como la preferencia de la barra del núcleo: se lee al montar, porque el servidor no ve el almacenamiento.
	const [plegadas, setPlegadas] = useState<IdSeccion[]>([]);
	const [filtros, setFiltros] = useState<FiltrosConversaciones>(FILTROS_INICIALES);
	useEffect(() => { setPlegadas(seccionesPlegadas()); setFiltros(filtrosConversaciones()); }, []);
	const cambiarFiltros = useCallback((siguientes: FiltrosConversaciones) => { recordarFiltros(siguientes); setFiltros(siguientes); }, []);
	const alternarSeccion = useCallback((seccion: IdSeccion) => {
		const siguiente = plegadas.includes(seccion) ? plegadas.filter(s => s !== seccion) : [...plegadas, seccion];
		recordarPlegadas(siguiente);
		setPlegadas(siguiente);
	}, [plegadas]);

	const leer = useCallback(async () => {
		try {
			// El plan va aparte: si su lectura falla, el menú de espacios y las conversaciones siguen.
			const plan = llamarEstudio<LecturaPlan>("plan").then(setPlan, () => setPlan(null));
			const [e, c] = await Promise.all([
				llamarEstudio<NonNullable<DatosBarraLateral["espacios"]>>("espacios"),
				llamarEstudio<ConversacionLista[]>("conversaciones"),
			]);
			setEspacios(e);
			setConversaciones(c);
			await plan;
		} catch {
			setEspacios(null);
			setConversaciones(prev => prev ?? []);
		}
	}, []);

	const pendiente = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const leerPronto = useCallback(() => {
		if (pendiente.current) clearTimeout(pendiente.current);
		pendiente.current = setTimeout(() => { pendiente.current = undefined; void leer(); }, 250);
	}, [leer]);
	useEffect(() => () => { if (pendiente.current) clearTimeout(pendiente.current); }, []);
	useEffect(() => { void leer(); }, [leer, ruta]);
	useServerEvent("chats-changed", leerPronto);
	useServerEvent("turn-settled", leerPronto);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") leerPronto(); });
	useServerResync(() => void leer());
	// Renombrar desde la cabecera del chat, desde esta barra o desde otra pieza: el título cambia al momento.
	useEffect(() => {
		const renombrada = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setConversaciones(prev => prev?.map(c => (c.id === id ? { ...c, title } : c)) ?? prev);
		};
		window.addEventListener("lh:chat-renamed", renombrada);
		return () => window.removeEventListener("lh:chat-renamed", renombrada);
	}, []);

	/** Como en la barra del núcleo: fuera de la lista al momento y, si estaba abierta, de vuelta al inicio. */
	const borrada = useCallback((id: string, _modo: unknown, graphRevision: number) => {
		setBorrando(null);
		setConversaciones(prev => prev?.filter(c => c.id !== id) ?? prev);
		if (ruta === `/chat/${id}`) router.push("/");
		window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
	}, [ruta, router]);

	const operar = useCallback(async (operation: string, input: unknown) => {
		setError(null);
		try {
			await llamarEstudio(operation, input);
		} catch (e) {
			setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
		}
		await leer();
	}, [leer]);

	const revision = (id: string) => espacios?.areas.find(a => a.id === id)?.revision;
	// El atajo admite cambios del usuario y depende del sistema: se calcula en el cliente.
	const [atajoPaleta, setAtajoPaleta] = useState("Ctrl+K");
	useEffect(() => { setAtajoPaleta(formatBinding(bindingForAction("command-palette"))); }, []);

	return (<>
		<BarraLateralEstudio
			espacios={espacios}
			conversaciones={conversaciones}
			plan={plan}
			ruta={ruta}
			error={error}
			atajoPaleta={atajoPaleta}
			plegadas={plegadas}
			porDecidir={porDecidir.total}
			filtros={filtros}
			acciones={{
				elegirEspacio: (id) => void operar("activar-espacio", { areaId: id }),
				crearEspacio: (nombre) => void operar("crear-espacio", { name: nombre }),
				renombrarEspacio: (id, nombre) => void operar("editar-espacio", { id, expectedRevision: revision(id), name: nombre }),
				archivarEspacio: (id) => void operar("editar-espacio", { id, expectedRevision: revision(id), archived: true }),
				recuperarEspacio: (id) => void operar("editar-espacio", { id, expectedRevision: revision(id), archived: false }),
				traerSinEspacio: () => void operar("traer-sin-espacio", {}),
				moverPlan: (planId, areaId) => void operar("mover-a-espacio", { kind: "plan", id: planId, areaId }),
				abrirAjustes: () => abrirAjustes(),
				navegar: (destino) => router.push(destino),
				abrirPaleta: () => window.dispatchEvent(new CustomEvent(kbdEventForAction("command-palette"))),
				renombrarConversacion: (id, titulo) => void commitChatRename(id, titulo),
				exportarConversacion: (id) => downloadChatMarkdown(id),
				resumirConversacion: (id) => void operar("resumir-conversacion", { chatId: id }),
				borrarConversacion: (c) => setBorrando(c),
				alternarSeccion,
				abrirPorDecidir: porDecidir.abrir,
				cambiarFiltros,
			}}
		/>
		{porDecidir.panel}
		<DeleteSessionDialog chat={borrando} onClose={() => setBorrando(null)} onDeleted={borrada} />
	</>);
}
