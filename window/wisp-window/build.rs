use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

// Must hash the same files in the same order as host/window/library.ts sourceHash, which Bun compares against.
const SOURCE_FILES: [&str; 7] = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "flake.nix", "flake.lock", "wisp-window/Cargo.toml", "wisp-window/build.rs"];

fn files_under(root: &Path, relative: &str, found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(root.join(relative)) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = format!("{relative}/{name}");
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => files_under(root, &path, found),
            Ok(kind) if kind.is_file() => found.push(path),
            _ => {}
        }
    }
}

fn main() {
    let window = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR")).join("..");
    let mut sources = Vec::new();
    for directory in ["wisp-window/src", "wisp-window/assets"] {
        files_under(&window, directory, &mut sources);
        println!("cargo:rerun-if-changed={}", window.join(directory).display());
    }
    sources.sort();
    let mut hasher = Sha256::new();
    for file in SOURCE_FILES.iter().map(|file| file.to_string()).chain(sources) {
        let path = window.join(&file);
        println!("cargo:rerun-if-changed={}", path.display());
        if let Ok(bytes) = fs::read(&path) {
            hasher.update(file.as_bytes());
            hasher.update([0]);
            hasher.update(&bytes);
            hasher.update([0]);
        }
    }
    let digest: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
    println!("cargo:rustc-env=WISP_WINDOW_SOURCE={}", &digest[..16]);
}
