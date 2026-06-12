import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const repoRoot = join(import.meta.dirname, "../../../");
const testScript = join(repoRoot, ".github/scripts/validate-deploy-inputs.test.sh");

test("validate-deploy-inputs.test.sh: all cases pass", () => {
  const result = spawnSync("bash", [testScript], { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `bash test exited ${result.status}:\n${result.stdout}\n${result.stderr}`,
  );
});
