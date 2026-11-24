/**
 * Letra de títulos (HarnessAcademico, ux2 ticket 08): the title-font pick
 * replaces the "Session names in serif" toggle. Seams: the appearance →
 * CSS-variable mapping (what lands on --font-title) and the readers of
 * stored settings (sanitizer, PUT body), with old records read as-is.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appearanceVars, resolveAppearance } from "../components/settings/appearance.tsx";
import { DEFAULT_THEME, sanitizeUserSettings } from "../src/core";
import { parseAppearanceSettingsBody } from "../src/server/settings-body.ts";

const titleVar = (delta: Parameters<typeof resolveAppearance>[0]) =>
	appearanceVars(resolveAppearance(delta), DEFAULT_THEME)["--font-title"];

describe("--font-title from the title-font pick", () => {
	it("an installed family: that family first, Inter as fallback (HarnessAcademico)", () => {
		assert.equal(titleVar({ titleFont: "Georgia" }), `"Georgia", var(--font-inter), ui-sans-serif, system-ui, sans-serif`);
	});

	it("a bundled family renders from its shipped face", () => {
		assert.equal(titleVar({ titleFont: "Source Sans 3" }), `"Source Sans 3", var(--font-sans3), var(--font-inter), ui-sans-serif, system-ui, sans-serif`);
		assert.equal(titleVar({ titleFont: "JetBrains Mono" }), `"JetBrains Mono", var(--font-jetbrains), var(--font-inter), ui-sans-serif, system-ui, sans-serif`);
	});

	it("a picked family wins over the old toggle", () => {
		assert.equal(titleVar({ titleFont: "Georgia", sessionNameSerif: false }), `"Georgia", var(--font-inter), ui-sans-serif, system-ui, sans-serif`);
	});
});

describe("old records (toggle only) read without rewriting", () => {
	it("toggle off → same as reading", () => {
		assert.equal(titleVar({ sessionNameSerif: false }), "var(--font-prose)");
		assert.equal(titleVar({ sessionNameSerif: false, titleFont: null }), "var(--font-prose)");
	});

	it("toggle on → the stylesheet default (Inter in HarnessAcademico), no override", () => {
		assert.equal(titleVar({ sessionNameSerif: true }), undefined);
	});

	it("toggle absent → Computer Modern", () => {
		assert.equal(titleVar(undefined), undefined);
		assert.equal(titleVar({ fontFamily: "Georgia" }), undefined);
	});
});

describe("stored records: the title font survives disk and the section PUT", () => {
	it("the sanitizer keeps a family and the toggle as stored", () => {
		const out = sanitizeUserSettings({ appearance: { sessionNameSerif: false, titleFont: "Georgia" } });
		assert.deepEqual(out?.appearance, { sessionNameSerif: false, titleFont: "Georgia" });
	});

	it("the sanitizer reads blank or wrong-typed families as unset (null)", () => {
		assert.deepEqual(sanitizeUserSettings({ appearance: { titleFont: "  " } })?.appearance, { titleFont: null });
		assert.deepEqual(sanitizeUserSettings({ appearance: { titleFont: 7 } })?.appearance, { titleFont: null });
	});

	it("an old record without titleFont stays without it", () => {
		assert.deepEqual(sanitizeUserSettings({ appearance: { sessionNameSerif: false } })?.appearance, { sessionNameSerif: false });
	});

	it("the PUT body accepts a family or null and rejects anything else", () => {
		const family = parseAppearanceSettingsBody({ titleFont: "Georgia" });
		assert.ok(family.ok);
		assert.deepEqual(family.settings, { titleFont: "Georgia" });
		const unset = parseAppearanceSettingsBody({ titleFont: null, sessionNameSerif: false });
		assert.ok(unset.ok);
		assert.deepEqual(unset.settings, { titleFont: null, sessionNameSerif: false });
		for (const titleFont of ["", 12, true]) {
			assert.equal(parseAppearanceSettingsBody({ titleFont }).ok, false, JSON.stringify(titleFont));
		}
	});
});
