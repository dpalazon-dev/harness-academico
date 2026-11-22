/**
 * Letra de títulos in Settings > Appearance (HarnessAcademico, ux2 ticket
 * 08): the row that replaces "Session names in serif", what each pick
 * writes, and what the trigger shows for old records.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderWithInteractionLayers as renderToStaticMarkup } from "./interaction-layer-render.tsx";
import { FontMenuList, customFamilyFor, extraRowMatches } from "../components/settings/model-menu";
import {
	AppearanceSection,
	SAME_AS_READING,
	composeTitleFont,
} from "../components/settings/appearance-section";
import type { AppearanceSettings } from "../src/core";

const triggerText = (appearance: AppearanceSettings | undefined) => {
	const html = renderToStaticMarkup(<AppearanceSection appearance={appearance} onSectionChange={() => true} />);
	const row = html.split('data-testid="row-title-font"')[1] ?? "";
	return row.split('data-testid="title-font-trigger"')[1]?.split("</button>")[0] ?? "";
};

describe("composeTitleFont: what each pick writes", () => {
	const before: AppearanceSettings = { fontFamily: "Georgia", sessionNameSerif: false, titleFont: "Menlo" };

	it("Computer Modern (the default row) unsets the family and turns the old toggle on", () => {
		assert.deepEqual(composeTitleFont(before, null), { fontFamily: "Georgia", sessionNameSerif: true, titleFont: null });
	});

	it("«Igual que la lectura» unsets the family and turns the old toggle off", () => {
		assert.deepEqual(composeTitleFont({ fontFamily: "Georgia" }, SAME_AS_READING), {
			fontFamily: "Georgia", sessionNameSerif: false, titleFont: null,
		});
	});

	it("a family is stored trimmed; the rest of the section rides along", () => {
		assert.deepEqual(composeTitleFont(before, " Garamond "), { ...before, titleFont: "Garamond" });
	});
});

describe("the «Letra de títulos» row", () => {
	it("replaces the serif toggle", () => {
		const html = renderToStaticMarkup(<AppearanceSection appearance={undefined} onSectionChange={() => true} />);
		assert.ok(html.includes("Letra de títulos"));
		assert.ok(!html.includes('data-testid="row-session-serif"'));
		assert.ok(!html.includes("Session names in serif"));
		assert.ok(html.includes('data-testid="font-trigger"'), "the reading picker stays");
	});

	it("shows Computer Modern for a record without the toggle or with it on", () => {
		assert.match(triggerText(undefined), /Computer Modern/);
		assert.match(triggerText({ sessionNameSerif: true }), /Computer Modern/);
	});

	it("shows «Igual que la lectura» for an old record with the toggle off", () => {
		assert.match(triggerText({ sessionNameSerif: false }), /Igual que la lectura/);
	});

	it("shows a picked family", () => {
		assert.match(triggerText({ titleFont: "Georgia", sessionNameSerif: false }), /Georgia/);
	});
});

describe("FontMenuList for titles", () => {
	it("names its default row and offers the extra row, marking the one in use", () => {
		const html = renderToStaticMarkup(
			<FontMenuList
				families={["Georgia"]}
				effectiveFamily={undefined}
				defaultLabel="Computer Modern"
				extraRow={{ label: "Igual que la lectura", selected: true, onPick: () => {} }}
				onPick={() => {}}
			/>,
		);
		const defaultRow = html.split('data-testid="font-option-default"')[1]?.split("</button>")[0] ?? "";
		assert.ok(defaultRow.includes("Computer Modern"));
		assert.ok(!defaultRow.includes("bg-muted/60"), "the default is not the one in use");
		const extra = html.split('data-testid="font-option-extra"')[1]?.split("</button>")[0] ?? "";
		assert.ok(extra.includes("Igual que la lectura"));
		assert.ok(extra.includes("bg-muted/60"), "the extra row is the one in use");
	});
});

describe("searching the title menu", () => {
	const extra = "Igual que la lectura";

	it("the extra row answers its own name and the empty search, not other fonts", () => {
		assert.equal(extraRowMatches("", extra), true);
		assert.equal(extraRowMatches("igual", extra), true);
		assert.equal(extraRowMatches("georgia", extra), false);
	});

	it("typing the extra row's name never becomes a custom family", () => {
		assert.equal(customFamilyFor("igual", ["Georgia"], "Computer Modern", extra), null);
		assert.equal(customFamilyFor("Gabriola", ["Georgia"], "Computer Modern", extra), "Gabriola");
	});
});
