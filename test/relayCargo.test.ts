import { describe, expect, test } from "bun:test";
import { delimiter } from "node:path";
import { findCargo, pathWith, type CargoSearch } from "../host/net/cargo";

const bin = "/home/p/.rustup/toolchains/1.97.0-x86_64-unknown-linux-gnu/bin";

const search = (files: readonly string[], onPath: Record<string, string> = {}, env: CargoSearch["env"] = {}): CargoSearch => ({
  env, home: "/home/p", channel: "1.97.0", hosts: ["x86_64-unknown-linux-gnu"],
  exists: (path) => files.includes(path), which: (command) => onPath[command] ?? null,
});

describe("finding the cargo that builds the relay", () => {
  test("[boundary] the pinned toolchain's bin goes first on PATH, with or without a cargo on PATH, so a cargo shim finds the real cargo", () => {
    expect(findCargo(search([`${bin}/cargo`], { cargo: "/home/p/.local/bin/cargo" }))).toEqual({ command: ["/home/p/.local/bin/cargo"], path: bin });
    expect(findCargo(search([`${bin}/cargo`]))).toEqual({ command: [`${bin}/cargo`], path: bin });
    expect(pathWith(bin, `/home/p/.local/bin${delimiter}/usr/bin`)).toBe(`${bin}${delimiter}/home/p/.local/bin${delimiter}/usr/bin`);
  });

  test("[boundary] CARGO wins, rustup runs the pinned channel when no cargo is found, and with nothing found there is no cargo", () => {
    expect(findCargo(search(["/opt/cargo", `${bin}/cargo`], { cargo: "/usr/bin/cargo" }, { CARGO: "/opt/cargo" }))).toEqual({ command: ["/opt/cargo"], path: "/opt" });
    expect(findCargo(search([], { rustup: "/usr/bin/rustup" }))).toEqual({ command: ["/usr/bin/rustup", "run", "1.97.0", "cargo"] });
    expect(findCargo(search([]))).toBeUndefined();
  });
});
