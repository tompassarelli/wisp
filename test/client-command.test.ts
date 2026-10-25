import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sample = join(import.meta.dir, "../examples/sample/scripts/sample.ts");

const client = (root: string, args: readonly string[]) => {
  const { exitCode, stderr } = Bun.spawnSync(["bun", sample, "client", ...args], {
    env: { ...process.env, HOME: root, WISP_CLIENTS: join(root, "env-clients.json") },
    stdout: "ignore",
  });
  return { exitCode, stderr: stderr.toString() };
};

test("[boundary] client --clients-file F, after or before the action, reads F over WISP_CLIENTS and the default", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-client-file-"));
  const file = join(root, "lan-clients.json");

  for (const args of [["chat", "lanKa", "hello there", "--clients-file", file], ["--clients-file", file, "chat", "lanKa", "hello there"]]) {
    const { exitCode, stderr } = client(root, args);
    expect(exitCode).toBe(1);
    expect(stderr).toContain(`read clients file failed for ${file}`);
    expect(stderr).not.toContain("env-clients.json");
    expect(stderr).not.toContain(".local/state");
  }
});

test("[boundary] client refuses an option its action does not define and names it", () => {
  const root = mkdtempSync(join(tmpdir(), "wisp-client-flag-"));

  const chat = client(root, ["chat", "lanKa", "hello", "--clients-fil", join(root, "lan-clients.json")]);
  const wait = client(root, ["wait", "lanKa", "menus", "--seconds", "1"]);

  expect(chat.exitCode).toBe(2);
  expect(chat.stderr).toContain("client chat has no option --clients-fil");
  expect(wait.stderr).not.toContain("has no option");
  expect(wait.stderr).toContain("env-clients.json");
});
