{
  description = "wisp-window build and test environment";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };
  outputs = { nixpkgs, rust-overlay, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; overlays = [ rust-overlay.overlays.default ]; };
      runtimeLibraries = [ pkgs.libxkbcommon pkgs.wayland pkgs.vulkan-loader pkgs.libGL pkgs.xorg.libX11 pkgs.xorg.libXcursor pkgs.xorg.libXi pkgs.xorg.libXrandr ];
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = [ (pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml) pkgs.pkg-config ];
        buildInputs = [ pkgs.udev pkgs.libxkbcommon ];
        LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibraries;
      };
    };
}
