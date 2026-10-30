import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

export interface Cargo {
  readonly command: readonly string[];
  /** A folder to put first on PATH, so cargo finds the toolchain's rustc and a cargo shim on PATH finds the real cargo. */
  readonly path?: string;
}

export interface CargoSearch {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  /** The channel relay/rust-toolchain.toml pins. */
  readonly channel: string;
  /** Host triples rustup names its toolchains with. */
  readonly hosts: readonly string[];
  readonly exists: (path: string) => boolean;
  readonly which: (command: string) => string | null;
}

const pinnedChannel = (toml: string): string | undefined => /^\s*channel\s*=\s*"([^"]+)"/m.exec(toml)?.[1];

/** CARGO, else cargo on PATH, else the pinned rustup toolchain's cargo, else rustup running that channel; the pinned toolchain's bin goes first on PATH whenever it exists. */
export const findCargo = (search: CargoSearch): Cargo | undefined => {
  const given = search.env["CARGO"];
  if (given !== undefined && search.exists(given)) return { command: [given], path: dirname(given) };
  const rustupHome = search.env["RUSTUP_HOME"] ?? join(search.home, ".rustup");
  const pinned = search.hosts
    .map((host) => join(rustupHome, "toolchains", `${search.channel}-${host}`, "bin"))
    .find((bin) => search.exists(join(bin, "cargo")));
  const onPath = search.which("cargo");
  if (onPath !== null) return pinned === undefined ? { command: [onPath] } : { command: [onPath], path: pinned };
  if (pinned !== undefined) return { command: [join(pinned, "cargo")], path: pinned };
  const rustup = search.which("rustup");
  return rustup === null ? undefined : { command: [rustup, "run", search.channel, "cargo"] };
};

const HOSTS: Readonly<Record<string, string>> = {
  "linux-x64": "x86_64-unknown-linux-gnu", "linux-arm64": "aarch64-unknown-linux-gnu",
  "darwin-x64": "x86_64-apple-darwin", "darwin-arm64": "aarch64-apple-darwin",
};

/** This machine's search for the toolchain `relayDirectory` pins. */
export const hostSearch = (relayDirectory: string): CargoSearch => {
  const host = HOSTS[`${process.platform}-${process.arch}`];
  return {
    env: process.env, home: homedir(), hosts: host === undefined ? [] : [host],
    channel: pinnedChannel(readFileSync(join(relayDirectory, "rust-toolchain.toml"), "utf8")) ?? "stable",
    exists: existsSync, which: (command) => Bun.which(command),
  };
};

/** PATH with `folder` first. */
export const pathWith = (folder: string, current: string | undefined): string => (current === undefined || current === "" ? folder : `${folder}${delimiter}${current}`);
