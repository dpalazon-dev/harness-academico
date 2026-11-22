import assert from "node:assert/strict";
import { it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const plugin = fileURLToPath(new URL("../", import.meta.url));

it("build emits the manifest and the backend bundle, without a frontend: the screens live in the app shell", () => {
  const result = spawnSync(process.execPath, [path.join(plugin, "scripts/build.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  for (const file of ["manifest.json", "backend.cjs", "LICENSE", "README.md"])
    assert.ok(fs.existsSync(path.join(plugin, "dist", file)), file);
  for (const file of ["main.js", "styles.css"]) assert.ok(!fs.existsSync(path.join(plugin, "dist", file)), file);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(plugin, "dist/manifest.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(plugin, "manifest.json"), "utf8")));
});
