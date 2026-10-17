import { expect, test } from "bun:test";
import { cleanRoomProblems, contentRuleHits, LAN_PLUGIN_LOADER, WISP_POLICY } from "../host/checks/cleanRoom";

const PROC = "/pr" + "oc";

const REFUSED: readonly (readonly [string, string, string])[] = [
  ["memory access", "tool.ts", `const n = process_vm_${"readv"}(pid, local, remote);`],
  ["memory access", "notes.md", `Attach with p${"trace"} first.`],
  ["memory access", "reader.ts", `const file = \`${PROC}/\${pid}/m${"em"}\`;`],
  ["memory access", "win.ts", `Read${"Process"}Memory(handle, base, buffer, size, null);`],
  ["memory access", "win.ts", `Write${"Process"}Memory(handle, base, buffer, size, null);`],
  ["memory access", "win.ts", `VirtualProtect${"Ex"}(handle, base, size, 0x40, old);`],
  ["memory access", "win.ts", `CreateRemote${"Thread"}(handle, null, 0, start, null, 0, null);`],
  ["binary address table", "table.json", ["{", `"unitOffset": "0x2f00010",`, `"${"r"}va": "0x1a2b30",`, `"stateBase": "0x00c0ffee"`, "}"].join("\n")],
  ["decomp symbol", "notes.md", `The landing lag comes from ft${"Co"}_800DF1C8.`],
  ["private import", "host/tool.ts", `const m = await import(\`\${home}/.local/share/wisp-${"private"}/engine/index.ts\`);`],
  ["private import", "host/tool.ts", `import { read } from "../../wisp-${"private"}/reader";`],
  ["private import", "host/tool.ts", `import {\n  read,\n} from "../../wisp-${"private"}/reader";`],
];

for (const [rule, path, text] of REFUSED) {
  test(`[spec docs/clean-room.md] refuses ${rule}: ${text.split("\n")[0]}`, () => {
    expect(contentRuleHits(path, text)).toContain(rule);
    const problems = cleanRoomProblems({ files: [], jassLines: new Map(), allowlist: [], policy: WISP_POLICY, contentHits: new Map([[path, contentRuleHits(path, text)]]) });
    expect(problems.some((problem) => problem.includes(path) && problem.includes(rule))).toBe(true);
  });
}

test("[spec docs/clean-room.md] passes our own process facts, single hex values, the plugin loader and docs that name the private folder", () => {
  expect(contentRuleHits("src/perf.ts", `const stat = readFileSync(\`${PROC}/\${pid}/stat\`); const rss = status.VmRSS; const map = "${PROC}/self/maps";`)).toEqual([]);
  expect(contentRuleHits("host/toolchain/sourceMaps.ts", "const cached = !options.sourceMapTraceback;")).toEqual([]);
  expect(contentRuleHits("src/colors.ts", "const offset = 0x1e;\nconst base = 0xff00ff;")).toEqual([]);
  expect(contentRuleHits(LAN_PLUGIN_LOADER, `const plugin = await import(\`\${home}/.local/share/wisp-${"private"}/lan/index.ts\`);`)).toEqual([]);
  expect(contentRuleHits("docs/lan.md", `Wisp loads it from \`~/.local/share/wisp-${"private"}/lan/index.ts\`.`)).toEqual([]);
  expect(contentRuleHits("test/host-tools.test.ts", `const plugin = join(home, ".local/share/wisp-${"private"}/lan");`)).toEqual([]);
});

test("[spec docs/clean-room.md] an allowlisted path passes a content rule", () => {
  const problems = cleanRoomProblems({
    files: [{ path: "notes.md", head: "# no" }], jassLines: new Map(),
    allowlist: [{ path: "notes.md", origin: "original", how: "written by us" }], policy: WISP_POLICY,
    contentHits: new Map([["notes.md", ["memory access"]]]),
  });
  expect(problems).toEqual([]);
});
