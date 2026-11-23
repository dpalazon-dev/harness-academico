/**
 * Wiring of .github/workflows/release.yml (HarnessAcademico): only the Windows
 * x64 installer and its SHA-256, uploaded to a draft and verified read-only.
 * These tests fail if the workflow loses a gate, the checksum or the check.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

describe("release workflow wiring", () => {
	// Fork HarnessAcademico: no macOS/Linux, no update feeds, no 11-asset gate.
	const yaml = require("js-yaml") as { load(source: string): any };
	const workflow = yaml.load(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8"));
	const quality = workflow.jobs.quality;
	const packaging = workflow.jobs.package;
	const runs = (job: any): string[] => job.steps.map((step: any) => step.run ?? "");
	const step = (job: any, name: string) => job.steps.find((entry: any) => entry.name === name);
	const upload = () => step(packaging, "Upload installer and checksum to the tag's draft");
	const gate = () => step(packaging, "Verify the draft holds exactly the installer and its checksum");

	it("runs on v* tags and manual rehearsals, never cancelling an upload", () => {
		assert.deepEqual(workflow.on.push, { tags: ["v*"] });
		assert.ok("workflow_dispatch" in workflow.on);
		assert.equal(workflow.concurrency["cancel-in-progress"], false);
		assert.deepEqual(workflow.permissions, { contents: "read" });
	});

	it("gates packaging on typecheck, tests, lint and tag = package.json version", () => {
		for (const command of ["npm run typecheck", "npm test", "npm run lint"]) {
			assert.ok(runs(quality).includes(command), `quality job lost: ${command}`);
		}
		const tag = step(quality, "Tag must match package.json");
		assert.ok(tag);
		assert.equal(tag.if, "github.event_name == 'push'");
		assert.match(tag.run, /GITHUB_REF_NAME/);
		assert.match(tag.run, /process\.exit\(1\)/);
		assert.equal(workflow.jobs.draft.needs, "quality");
		assert.deepEqual(packaging.needs, ["quality", "draft"]);
	});

	it("packages only the Windows x64 installer through desktop:dist:win", () => {
		assert.equal(packaging["runs-on"], "windows-2025");
		assert.equal(packaging.strategy, undefined);
		assert.ok(runs(packaging).includes("npm run desktop:dist:win"));
		assert.equal(runs(packaging).some(run => run.includes("electron-builder") || run.includes("--mac") || run.includes("--linux")), false);
	});

	it("computes the SHA-256 and uploads installer and checksum only on tag pushes", () => {
		const checksum = step(packaging, "SHA-256 of the installer");
		assert.ok(checksum);
		assert.match(checksum.run, /sha256sum "\$installer" > "\$installer\.sha256"/);
		const uploading = upload();
		assert.ok(uploading);
		assert.equal(uploading.if, "github.event_name == 'push'");
		assert.match(uploading.run, /^gh release upload "\$GITHUB_REF_NAME" /);
		assert.match(uploading.run, /x64-setup\.exe /);
		assert.match(uploading.run, /x64-setup\.exe\.sha256/);
		const order = [checksum, uploading, gate()].map(entry => packaging.steps.indexOf(entry));
		assert.deepEqual([...order].sort((a, b) => a - b), order);
		assert.ok(order[0]! > runs(packaging).indexOf("npm run desktop:dist:win"));
	});

	it("verifies the draft read-only: exactly two assets, still a draft, checksum matches the download", () => {
		const verifying = gate();
		assert.ok(verifying);
		assert.equal(verifying.if, "github.event_name == 'push'");
		assert.match(verifying.run, /isDraft/);
		assert.match(verifying.run, /"\$installer \$installer\.sha256"/);
		assert.match(verifying.run, /sha256sum -c "\$installer\.sha256"/);
		const calls: string[] = verifying.run.split("\n").filter((line: string) => /\bgh\s/.test(line));
		assert.ok(calls.length >= 3);
		for (const call of calls) {
			assert.match(call, /\bgh release (?:view|download) /);
			assert.doesNotMatch(call, /\bgh release (?:create|edit|delete|upload)\b|\bgh api\b/);
		}
	});

	it("only the upload and gate steps see the token", () => {
		const withToken = packaging.steps.filter((entry: any) => entry.env?.GH_TOKEN);
		assert.deepEqual(withToken, [upload(), gate()]);
		for (const job of Object.values(workflow.jobs) as any[]) assert.equal(job.env?.GH_TOKEN, undefined);
	});
});
