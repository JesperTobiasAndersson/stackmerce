import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { describe, beforeAll, test, expect } from "vitest";
import { loadSchema, loadInputQuery, loadFixture, validateTestAssets, runFunction } from "@shopify/shopify-function-test-helpers";

const execFileAsync = promisify(execFile);
const shopifyCommand = process.platform === "win32" ? "shopify.cmd" : "shopify";

async function runShopify(args, cwd) {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : shopifyCommand;
  const commandArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", shopifyCommand, ...args]
      : args;

  const { stdout } = await execFileAsync(command, commandArgs, {
    cwd,
    env: {
      ...process.env,
      SHOPIFY_INVOKED_BY: "shopify-function-test-helpers",
    },
  });

  return stdout;
}

describe("Default Integration Test", () => {
  let schema;
  let functionDir;
  let functionInfo;
  let schemaPath;
  let targeting;
  let functionRunnerPath;
  let wasmPath;

  beforeAll(async () => {
    functionDir = path.dirname(__dirname);
    const appRootDir = path.dirname(functionDir);
    const functionName = path.basename(functionDir);
    await runShopify(["app", "function", "build", "--path", functionName], appRootDir);
    functionInfo = JSON.parse(
      await runShopify(
        ["app", "function", "info", "--json", "--path", functionName],
        appRootDir,
      ),
    );
    ({ schemaPath, functionRunnerPath, wasmPath, targeting } = functionInfo);
    schema = await loadSchema(schemaPath);
  }, 45000);

  const fixturesDir = path.join(__dirname, "fixtures");
  const fixtureFiles = fs
    .readdirSync(fixturesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(fixturesDir, file));

  fixtureFiles.forEach((fixtureFile) => {
    test(`runs ${path.relative(fixturesDir, fixtureFile)}`, async () => {
      const fixture = await loadFixture(fixtureFile);
      const targetInputQueryPath = targeting[fixture.target].inputQueryPath;
      const inputQueryAST = await loadInputQuery(targetInputQueryPath);

      const validationResult = await validateTestAssets({ schema, fixture, inputQueryAST });
      expect(validationResult.inputQuery.errors).toEqual([]);
      expect(validationResult.inputFixture.errors).toEqual([]);
      expect(validationResult.outputFixture.errors).toEqual([]);

      const runResult = await runFunction(fixture, functionRunnerPath, wasmPath, targetInputQueryPath, schemaPath);
      expect(runResult.error).toBeNull();
      expect(runResult.result.output).toEqual(fixture.expectedOutput);
    }, 10000);
  });
});
