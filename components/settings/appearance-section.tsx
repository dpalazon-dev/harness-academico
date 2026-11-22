"use client";
/**
 * The Appearance + Graph sections (thin settings wave).
 *
 * Appearance controls resolve against the factory in the provider; writes
 * PUT the whole appearance section and hand the delta back so the CSS
 * variables move IMMEDIATELY (the section's whole point — it must DO
 * something). Theme wave (2026-11-04): the theme grid (./theme-cards.tsx)
 * sits on top and sets every color; the "Colors" block below holds one
 * hex override per theme color (empty = the theme's), kept across theme
 * switches; "Typography" holds the type knobs. Hex inputs commit on
 * blur/Enter.
 *
 * Graph graying (owner, 2026-09-20) follows the graph viewer's render-panel
 * convention: the whole row dims when a parent is off (stored values
 * persist but resolve inert — the switch shows stored, the dim effective).
 *
 * Reading font (appearance wave, 2026-09-26, owner ruling): a searchable
 * dropdown of the user's INSTALLED fonts (FontMenuList over model-menu's
 * machine) fed by window.queryLocalFonts() in the desktop shell — the
 * enumeration is click-bound (the API requires user activation), deduped
 * to unique families, the factory family excluded (the DEFAULT row is
 * it). In a plain dev browser the API is absent → a small curated list
 * + a footer that says exactly that — never a fabricated system list.
 * The custom-family input inside the menu is the manual escape path.
 * Empty/unset keeps meaning Source Sans 3.
 *
 * Overrides live in two homes by design: `background` and
 * `mdRendering.boldColor/italicColor` keep their pre-theme keys (existing
 * records keep their colors); the other nine sit in `colors`. core/
 * themes.ts effectiveColors is the one place they merge.
 */

import { useEffect, useRef, useState } from "react";
import {
	EXTRACTION_CHUNK_TOKENS_FLOOR,
	resolveSettings,
	THEME_COLOR_KEYS,
	type AppearanceSettings,
	type GraphSettings,
	type ThemeColorKey,
} from "@/src/core";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { Hint } from "@/components/ui/hint";
import { BUNDLED_READING_FONTS, BUNDLED_TITLE_FONTS, useAppearance } from "./appearance.tsx";
import { FontMenuList } from "./model-menu";
import { ThemeCards } from "./theme-cards.tsx";
import { CommitInput, SettingsMenuTrigger, SettingsRow, Toggle } from "./controls.tsx";

/** The factory reading family — the DEFAULT row's identity (unset =
 *  this). Exported for tests. */
export const DEFAULT_READING_FONT = "Source Sans 3";

/** The dev-browser fallback list (queryLocalFonts is absent there):
 *  the app's own knowns plus a handful of ubiquitous macOS families,
 *  honestly LABELED as common — never presented as the system's real
 *  list. The factory family is absent: the DEFAULT row is it. Exported
 *  for tests. */
export const CURATED_FALLBACK_FONTS: readonly string[] = [
	"Arial",
	"CMU Serif",
	"Courier New",
	"Georgia",
	"Helvetica",
	"Helvetica Neue",
	"JetBrains Mono",
	"Menlo",
	"Times New Roman",
	"Trebuchet MS",
	"Verdana",
];

/** window.queryLocalFonts' shape as this section consumes it (family is
 *  the only field used; the API returns one FontData per FACE — the
 *  caller dedupes). */
type LocalFontsApi = () => Promise<Array<{ family: string }>>;

/** The Local Font Access seam — read lazily (SSR has no window, and
 *  render-time access would evaluate the API on the server). */
function localFontsApi(): LocalFontsApi | null {
	if (typeof window === "undefined") return null;
	return (window as unknown as { queryLocalFonts?: LocalFontsApi }).queryLocalFonts ?? null;
}

/** Compose the reading-font pick: null (or blank) = the factory
 *  Source Sans 3; otherwise the family verbatim (trimmed — the
 *  sanitizer trims again server-side). Pure — exported for tests. */
export function composeFontFamily(
	appearance: AppearanceSettings | undefined,
	family: string | null,
): AppearanceSettings {
	const value = family?.trim() ?? "";
	return { ...appearance, fontFamily: value === "" ? null : value };
}

/** The title default (the bundled "lh-cmu" face) and the pick that
 *  follows the reading font (HarnessAcademico, ux2 ticket 08). */
export const DEFAULT_TITLE_FONT = "Computer Modern";
/** Its installed name (the curated list has it): left out of the title
 *  menu, where the default row already is that face. */
const CMU_FAMILY = "CMU Serif";
const SAME_AS_READING_LABEL = "Igual que la lectura";
export const SAME_AS_READING: unique symbol = Symbol("same-as-reading");
export type TitleFontPick = string | null | typeof SAME_AS_READING;

/** Compose the title-font pick. An unset family keeps the old toggle as
 *  its meaning (on = Computer Modern, off = the reading font), so records
 *  written before this picker read the same without being rewritten.
 *  Pure — exported for tests. */
export function composeTitleFont(appearance: AppearanceSettings | undefined, pick: TitleFontPick): AppearanceSettings {
	if (pick === SAME_AS_READING) return { ...appearance, titleFont: null, sessionNameSerif: false };
	const value = pick?.trim() ?? "";
	if (value === "") return { ...appearance, titleFont: null, sessionNameSerif: true };
	return { ...appearance, titleFont: value };
}

/** A picker's families: the installed ones (or, unreadable, the curated
 *  list) plus the faces the app ships, minus the picker's default row. */
function pickerFamilies(
	installed: string[] | null,
	bundled: Readonly<Record<string, string>>,
	defaultFamily?: string,
): string[] {
	const base = installed ?? CURATED_FALLBACK_FONTS;
	return [...new Set([...base, ...Object.keys(bundled)])]
		.filter((f) => f !== defaultFamily)
		.sort((a, b) => a.localeCompare(b));
}

/** The installed-font enumeration, read once and shared by the pickers.
 *  undefined = not read yet; null = UNAVAILABLE (the API is absent in a
 *  plain browser, rejected, or resolved EMPTY — Electron 44's local-fonts
 *  grant passes and the enumeration still yields zero fonts, reproduced
 *  2026-09-26) → the curated fallback; a list = the deduped families.
 *  `load` must run INSIDE the trigger click: queryLocalFonts requires user
 *  activation, so it cannot be a mount effect. Font installs mid-dialog
 *  are not a case — the first read is cached for the section's life. */
function useInstalledFonts() {
	const [fonts, setFonts] = useState<string[] | null | undefined>(undefined);
	const [empty, setEmpty] = useState(false);
	const requested = useRef(false);
	const load = () => {
		if (requested.current) return;
		requested.current = true;
		const api = localFontsApi();
		if (api === null) {
			setFonts(null);
			return;
		}
		void api()
			.then((list) => {
				const families = [...new Set(list.map((f) => f.family))];
				if (families.length === 0) {
					setFonts(null);
					setEmpty(true);
				} else {
					setFonts(families);
				}
			})
			.catch(() => setFonts(null));
	};
	const footer =
		fonts === undefined
			? undefined
			: fonts === null
				? empty
					? "Letras habituales: no se pudieron leer las instaladas"
					: "Letras habituales: la lista de las instaladas necesita la app de escritorio"
				: "Tus letras instaladas";
	return { fonts, footer, load };
}

/** One font dropdown row (the reading font; since HarnessAcademico, the
 *  title font too). The dropdown contract (agent-section's, mirrored): any
 *  click outside the open menu — or an Esc — closes it. Esc is CLAIMED with
 *  stopPropagation so the settings dialog behind does NOT also close. */
function FontPickerRow({
	label,
	hint,
	testid,
	idPrefix,
	value,
	tooltip,
	families,
	footer,
	effectiveFamily,
	defaultLabel,
	extraRow,
	onOpen,
	onPick,
}: {
	label: string;
	hint: string;
	testid: string;
	/** Test ids: `${idPrefix}-trigger`, `${idPrefix}-menu`. */
	idPrefix: string;
	/** What the closed trigger shows. */
	value: string;
	tooltip: string;
	families: string[] | undefined;
	footer: string | undefined;
	effectiveFamily: string | null | undefined;
	defaultLabel?: string;
	extraRow?: { label: string; selected: boolean; onPick: () => void };
	onOpen: () => void;
	onPick: (family: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const interactions = useInteractionLayers();
	const triggerTestid = `${idPrefix}-trigger`;
	const menuTestid = `${idPrefix}-menu`;

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>(`[data-testid="${menuTestid}"]`))) return;
			const target = e.target as Node;
			if (anchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (target instanceof Element && target.closest('[role="dialog"]')) {
				setOpen(false);
			}
			// else: outside the dialog — the dialog's own close handles it.
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [open, interactions, menuTestid]);

	// The tooltip rides the CLOSED button ONLY (owner ruling 2026-09-26:
	// never while the dropdown is out — it popped over the open menu when
	// the wrap covered the whole anchor span).
	const trigger = (
		<SettingsMenuTrigger
			value={value}
			aria-label={label}
			aria-expanded={open}
			data-testid={triggerTestid}
			onClick={() => {
				if (!open) onOpen();
				setOpen(!open);
			}}
			className="min-w-20"
		/>
	);
	return (
		<SettingsRow label={label} hint={hint} testid={testid}>
			<span ref={open ? anchorRef : undefined} className="relative flex items-center gap-2">
				{open ? trigger : (
					<Hint label={tooltip} side="left">
						{trigger}
					</Hint>
				)}
				{open && (
					<MenuShell
						preferredSide="down"
						anchorTestid={triggerTestid}
						testid={menuTestid}
						onClose={() => { setOpen(false); return "closed"; }}
						menuClass="flex w-[18rem] flex-col gap-0.5 rounded-xl border border-border bg-card p-2 text-xs shadow-xl"
					>
						<FontMenuList
							families={families}
							effectiveFamily={effectiveFamily}
							defaultLabel={defaultLabel}
							extraRow={extraRow && { ...extraRow, onPick: () => { setOpen(false); extraRow.onPick(); } }}
							onPick={(family) => { setOpen(false); onPick(family); }}
							footer={footer}
						/>
					</MenuShell>
				)}
			</span>
		</SettingsRow>
	);
}

/** The Colors grid's labels and the one hint that explains a key. */
const COLOR_LABELS: Record<ThemeColorKey, { label: string; note?: string }> = {
	background: { label: "Fondo" },
	accent: { label: "Acento", note: "Foco, interruptores, selección" },
	surface: { label: "Superficie", note: "Tarjetas, campos, barra lateral" },
	bold: { label: "Negrita" },
	border: { label: "Borde" },
	italic: { label: "Cursiva" },
	text: { label: "Texto" },
	code: { label: "Código en línea" },
	textMuted: { label: "Texto atenuado" },
	error: { label: "Error" },
	success: { label: "Éxito" },
	warning: { label: "Aviso" },
};

/** The legacy test ids of the three pre-theme rows (kept stable). */
const LEGACY_TESTIDS: Partial<Record<ThemeColorKey, string>> = {
	background: "input-background",
	bold: "input-bold-color",
	italic: "input-italic-color",
};

/** The stored override for one theme color ("" = none). Pure — exported
 *  for tests. */
export function colorOverride(appearance: AppearanceSettings | undefined, key: ThemeColorKey): string {
	if (key === "background") return appearance?.background ?? "";
	if (key === "bold") return appearance?.mdRendering?.boldColor ?? "";
	if (key === "italic") return appearance?.mdRendering?.italicColor ?? "";
	return appearance?.colors?.[key] ?? "";
}

/** Compose one override into the section ("" = back to the theme's).
 *  Every other field rides along untouched. Pure — exported for tests. */
export function composeColorOverride(
	appearance: AppearanceSettings | undefined,
	key: ThemeColorKey,
	value: string,
): AppearanceSettings {
	const v = value === "" ? null : value;
	if (key === "background") return { ...appearance, background: v };
	if (key === "bold") return { ...appearance, mdRendering: { ...appearance?.mdRendering, boldColor: v } };
	if (key === "italic") return { ...appearance, mdRendering: { ...appearance?.mdRendering, italicColor: v } };
	const colors = { ...appearance?.colors };
	if (v === null) delete colors[key];
	else colors[key] = v;
	return { ...appearance, colors };
}

/** "Reset all": every color back to the theme's; type knobs untouched. */
export function clearColorOverrides(appearance: AppearanceSettings | undefined): AppearanceSettings {
	const { background: _bg, colors: _colors, ...rest } = appearance ?? {};
	const md = appearance?.mdRendering;
	if (!md) return rest;
	const { boldColor: _b, italicColor: _i, ...mdRest } = md;
	return { ...rest, mdRendering: mdRest };
}

function ColorOverrideRow({
	colorKey,
	value,
	themeColor,
	effective,
	onCommit,
}: {
	colorKey: ThemeColorKey;
	value: string;
	themeColor: string;
	effective: string;
	onCommit: (next: string) => boolean | Promise<boolean>;
}) {
	const { label, note } = COLOR_LABELS[colorKey];
	const empty = `Vacío = ${themeColor}`;
	return (
		<SettingsRow label={label} hint={note ? `${note} · ${empty}` : empty} testid={`row-color-${colorKey}`}>
			<span className="flex items-center gap-2">
				<span
					aria-hidden
					data-testid={`swatch-${colorKey}`}
					className="size-4 shrink-0 rounded-sm border border-border"
					style={{ background: effective }}
				/>
				<CommitInput
					value={value}
					placeholder={themeColor}
					ariaLabel={`${label.toLowerCase()} en hexadecimal`}
					testid={LEGACY_TESTIDS[colorKey] ?? `input-color-${colorKey}`}
					onCommit={onCommit}
				/>
			</span>
		</SettingsRow>
	);
}

export function AppearanceSection({
	appearance,
	onSectionChange,
}: {
	/** The record's appearance delta (absent = factory). */
	appearance: AppearanceSettings | undefined;
	/** PUT the whole appearance section; the page re-applies on success. */
	onSectionChange: (next: AppearanceSettings) => boolean | Promise<boolean>;
}) {
	const { appearance: resolved, activeTheme, colors, themes, refreshThemes } = useAppearance();
	const md = appearance?.mdRendering;

	// One installed-font read serves both pickers (reading and titles).
	const installed = useInstalledFonts();
	const titleFont = appearance?.titleFont ?? null;
	const titleSameAsReading = titleFont === null && appearance?.sessionNameSerif === false;

	return (
		<>
			<ThemeCards
				themes={themes}
				active={activeTheme}
				appearance={appearance}
				onSelect={(id) => onSectionChange({ ...appearance, theme: id })}
				onImported={() => void refreshThemes()}
				onRemoved={(removed) => {
					void refreshThemes();
					// The server already fell back to Default; the write keeps the
					// dialog's record mirror and the live vars in step with it.
					if (removed.id === activeTheme.id) onSectionChange({ ...appearance, theme: "default" });
				}}
			/>
			<div data-testid="group-colors" className="mt-5 flex flex-col gap-2">
				<div className="flex items-end justify-between gap-4">
					<p className="text-xs uppercase tracking-widest text-muted-foreground">
						Colores{" "}
						<span className="normal-case tracking-normal text-muted-foreground/70">
							· cambios sobre el tema, que se conservan al cambiar de tema
						</span>
					</p>
					<button
						type="button"
						data-testid="colors-reset"
						onClick={() => onSectionChange(clearColorOverrides(appearance))}
						className="h-6 shrink-0 rounded-sm px-2 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						Restablecer todos
					</button>
				</div>
				<div className="grid grid-cols-2 gap-x-10 gap-y-2">
					{THEME_COLOR_KEYS.map((key) => (
						<ColorOverrideRow
							key={key}
							colorKey={key}
							value={colorOverride(appearance, key)}
							themeColor={activeTheme.colors[key]}
							effective={colors[key]}
							onCommit={(v) => onSectionChange(composeColorOverride(appearance, key, v))}
						/>
					))}
				</div>
			</div>
			<p className="mt-5 mb-2 text-xs uppercase tracking-widest text-muted-foreground">Tipografía</p>
			<FontPickerRow
				label="Letra de lectura"
				hint={`Por defecto, ${DEFAULT_READING_FONT}`}
				testid="row-font"
				idPrefix="font"
				value={appearance?.fontFamily || DEFAULT_READING_FONT}
				tooltip="Elige entre tus letras instaladas"
				families={installed.fonts === undefined ? undefined : pickerFamilies(installed.fonts, BUNDLED_READING_FONTS, DEFAULT_READING_FONT)}
				footer={installed.footer}
				effectiveFamily={appearance?.fontFamily ?? null}
				onOpen={installed.load}
				onPick={(family) => onSectionChange(composeFontFamily(appearance, family))}
			/>
			<SettingsRow label="Tamaño de la letra de lectura" hint={`${resolved.proseFontSize}px`} testid="row-prose-size">
				<CommitInput
					type="number"
					value={String(appearance?.proseFontSize ?? "")}
					placeholder="16"
					ariaLabel="tamaño de la letra de lectura"
					testid="input-prose-size"
					onCommit={(v) => {
						// Empty = factory default (owner, fix wave): omit the key so the record
						// UNSETS and the field stays empty (absence, not null, is the
						// unset for numbers). Number("") is 0, so the old clamp wrote 12.
						if (v === "") {
							return onSectionChange({ ...appearance, proseFontSize: undefined });
						}
						const n = Number(v);
						if (!Number.isFinite(n)) return false; // bad input: no write, factory stays
						return onSectionChange({ ...appearance, proseFontSize: Math.min(24, Math.max(12, Math.round(n))) });
					}}
				/>
			</SettingsRow>
			<SettingsRow label="Ligaduras en el código" testid="row-code-ligatures">
				<Toggle
					checked={resolved.codeLigatures}
					label="Ligaduras en el código"
					onChange={(on) => onSectionChange({ ...appearance, codeLigatures: on })}
				/>
			</SettingsRow>
			{/* Letra de títulos (HarnessAcademico, ux2 ticket 08): replaces the
			    "Session names in serif" toggle. The section went Spanish in
			    ux2 ticket 11b. */}
			<FontPickerRow
				label="Letra de títulos"
				hint={`Por defecto, ${DEFAULT_TITLE_FONT}`}
				testid="row-title-font"
				idPrefix="title-font"
				value={titleFont ?? (titleSameAsReading ? SAME_AS_READING_LABEL : DEFAULT_TITLE_FONT)}
				tooltip="Elige entre tus letras instaladas"
				families={installed.fonts === undefined ? undefined : pickerFamilies(installed.fonts, BUNDLED_TITLE_FONTS, CMU_FAMILY)}
				footer={installed.footer}
				effectiveFamily={titleSameAsReading ? undefined : titleFont}
				defaultLabel={DEFAULT_TITLE_FONT}
				extraRow={{
					label: SAME_AS_READING_LABEL,
					selected: titleSameAsReading,
					onPick: () => onSectionChange(composeTitleFont(appearance, SAME_AS_READING)),
				}}
				onOpen={installed.load}
				onPick={(family) => onSectionChange(composeTitleFont(appearance, family))}
			/>
			<SettingsRow label="Grosor de los títulos" hint={`${resolved.mdRendering.headingWeight}`} testid="row-heading-weight">
				<CommitInput
					type="number"
					value={String(md?.headingWeight ?? "")}
					placeholder="900"
					ariaLabel="grosor de los títulos"
					testid="input-heading-weight"
					onCommit={(v) => {
						// Empty = factory default (owner, fix wave): Number("") is 0, so
						// Absence is the unset representation — the old clamp wrote 100.
						if (v === "") {
							return onSectionChange({ ...appearance, mdRendering: { ...md, headingWeight: undefined } });
						}
						const n = Number(v);
						if (!Number.isFinite(n)) return false;
						return onSectionChange({
							...appearance,
							mdRendering: { ...md, headingWeight: Math.min(900, Math.max(100, Math.round(n))) },
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}

export function GraphSection({
	graph,
	onSectionChange,
}: {
	graph: GraphSettings | undefined;
	onSectionChange: (next: GraphSettings) => boolean | Promise<boolean>;
}) {
	// Wave 7 collapse (owner ruling 2026-09-23): the section is the MASTER
	// SWITCH — the embedding/clustering/labeling rungs are gone; clustering
	// is the free birth-session partition derived on read, labels ARE session
	// names. The chunk budget (2026-10-02) joined it as the section's second
	// and only other control: it denominates the coverage ring AND gates the
	// auto-extraction trigger (turn settle ≥ budget fires the run).
	//
	// Resolved through the SAME core resolver the server's effective
	// settings use (one source of truth, the 4096-fallback fix 2026-10-02):
	// the hint and placeholder report exactly the number the trigger waits
	// for — never a second hand-rolled default.
	const resolved = resolveSettings(graph === undefined ? null : { version: 1, graph }).graph;
	return (
		<>
			{/* EXTRACTION (renamed, owner 2026-10-06): this switch is the DATA
			    channel — the pipeline, the auditor, the prober's graph tools. It
			    was born labeled "Graph" and that label lied once the rendering
			    switch below arrived: off ≠ no graph, off = the graph stops
			    growing. The testid keeps the old name's shape (row-enabled) so
			    this stays one rename, not a test re-pin. */}
			<SettingsRow label="Extraction" hint="Off = the graph stops growing" testid="graph-row-enabled">
				<Toggle
					checked={graph?.enabled ?? true}
					label="extraction enabled"
					onChange={(on) =>
						// Compose, never replace-whole (the section PUT is, but the
					// row must not drop its sibling field — fixed with the budget
					// row's arrival: the old { enabled: on } wiped a stored budget).
						onSectionChange({ ...graph, enabled: on })
					}
				/>
			</SettingsRow>
			{/* GRAPH RENDERING (owner, 2026-10-06 — the release graph-controls
			    round): display-only. Off = the home shows the chains view
			    instead of the canvas. The ledgers, the pipeline, everything
			    data keeps working — that is the extraction switch above. */}
			<SettingsRow label="Graph rendering" hint="Off = home shows the chains view" testid="graph-row-rendering">
				<Toggle
					checked={graph?.rendering ?? true}
					label="graph rendering enabled"
					onChange={(on) => onSectionChange({ ...graph, rendering: on })}
				/>
			</SettingsRow>
			<SettingsRow
				label="Extraction chunk budget"
				hint={`${resolved.extractionChunkTokens} tok`}
				testid="graph-row-chunk-tokens"
			>
				<CommitInput
					type="number"
					value={String(graph?.extractionChunkTokens ?? "")}
					placeholder={String(resolved.extractionChunkTokens)}
					ariaLabel="extraction chunk budget"
					testid="input-chunk-tokens"
					onCommit={(v) => {
						// Empty = factory default (the fix-wave discipline): absence is
						// the unset for numbers — Number("") is 0, so clamping would
						// write the floor instead of unsetting.
						if (v === "") {
							return onSectionChange({ ...graph, extractionChunkTokens: undefined });
						}
						const n = Number(v);
						if (!Number.isFinite(n) || n <= 0) return false; // bad input: no write
						// Mirror the server sanitize exactly: floor only (cost
						// protection), no ceiling — a big budget is the user's call.
						return onSectionChange({
							...graph,
							extractionChunkTokens: Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.round(n)),
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}