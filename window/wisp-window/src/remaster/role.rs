//! What a texture is for, which picks its upscaler: Real-CUGAN paints fine detail into character skins and effects, but streaks smooth gradients and smooths the grain off tiling ground, so scenery takes the edge-directed filter (measured over Smashcraft's 706 imported textures: 35 failed gates with the network against 3 with the filter).

/// A texture's role, read from its path the way `Edges::for_path` reads whether it tiles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Skins of characters and effects, doubled by Real-CUGAN when it runs.
    Figure,
    /// Stage art, doodads and terrain tiles, always doubled by the edge-directed filter.
    Scenery,
}

const SCENERY_FOLDERS: [&str; 3] = ["terrainart\\", "doodads\\", "environment\\"];
const STAGE_PREFIX: &str = "stage";

impl Role {
    pub fn for_path(path: &str) -> Self {
        let path = path.to_ascii_lowercase().replace('/', "\\");
        let file = path.rsplit('\\').next().unwrap_or(&path);
        if SCENERY_FOLDERS.iter().any(|folder| path.starts_with(folder)) || file.starts_with(STAGE_PREFIX) {
            Role::Scenery
        } else {
            Role::Figure
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_tiles_doodads_and_stage_imports_are_scenery() {
        for path in ["TerrainArt\\LordaeronSummer\\Lords_Grass.blp", "terrainart/lordaeronsummer/lords_dirt.blp", "Doodads\\Cinematic\\Tree.blp", "war3mapImported\\StageTombSea-090f18c4.tga", "war3mapImported\\StageDeck.blp"] {
            assert_eq!(Role::for_path(path), Role::Scenery, "{path}");
        }
    }

    #[test]
    fn fighter_skins_effects_and_everything_else_are_figures() {
        for path in ["war3mapImported\\FighterWhite-65bfd307.tga", "war3mapImported\\ShieldP3.blp", "Units\\Human\\Footman\\Footman.blp", "ReplaceableTextures\\CommandButtons\\BTNLichKing.blp"] {
            assert_eq!(Role::for_path(path), Role::Figure, "{path}");
        }
    }
}
