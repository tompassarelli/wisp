//! What a texture is for, which picks its upscaler: Real-CUGAN paints fine detail into character skins and effects, but streaks smooth gradients and smooths the grain off tiling ground, so scenery takes the edge-directed filter (measured over Mak'gora's 706 imported textures: 35 failed gates with the network against 3 with the filter), and it pushes the cool palettes of small painted icons and portraits 6 to 11 degrees of hue, so interface art takes the filter too.

/// A texture's role, read from its path the way `Edges::for_path` reads whether it tiles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Skins of characters and effects, doubled by Real-CUGAN when it runs.
    Figure,
    /// Stage art, doodads and terrain tiles, always doubled by the edge-directed filter.
    Scenery,
    /// Menu, HUD and icon art drawn flat on screen (command buttons, portraits, fighter cards, busts, stock icons, cursors), always doubled by the edge-directed filter.
    Interface,
}

const SCENERY_FOLDERS: [&str; 3] = ["terrainart\\", "doodads\\", "environment\\"];
const STAGE_PREFIX: &str = "stage";
const INTERFACE_FOLDERS: [&str; 3] = ["ui\\", "replaceabletextures\\commandbuttons", "replaceabletextures\\passivebuttons"];
const INTERFACE_FILES: [&str; 16] = [
    "sscscorescreen",
    "fighterstock",
    "fightercard",
    "fighterbust",
    "fightertile",
    "select",
    "hud",
    "menuframe",
    "markerarrow",
    "nameplate",
    "stockshadow",
    "preview",
    "ping",
    "stagecard",
    "stagechip",
    "stagebackdrop",
];

impl Role {
    pub fn for_path(path: &str) -> Self {
        let path = path.to_ascii_lowercase().replace('/', "\\");
        let file = path.rsplit('\\').next().unwrap_or(&path);
        if INTERFACE_FOLDERS.iter().any(|folder| path.starts_with(folder)) || INTERFACE_FILES.iter().any(|prefix| file.starts_with(prefix)) {
            Role::Interface
        } else if SCENERY_FOLDERS.iter().any(|folder| path.starts_with(folder)) || file.starts_with(STAGE_PREFIX) {
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
        for path in ["war3mapImported\\FighterWhite-65bfd307.tga", "war3mapImported\\ShieldP3.blp", "Units\\Human\\Footman\\Footman.blp", "LichKing.BLP", "war3mapImported\\ParasolShaft-4d59f7fb.tga", "ReplaceableTextures\\TeamColor\\TeamColor00.blp"] {
            assert_eq!(Role::for_path(path), Role::Figure, "{path}");
        }
    }

    #[test]
    fn buttons_portraits_cards_and_menu_art_are_interface() {
        for path in [
            "ReplaceableTextures\\CommandButtons\\BTNLichKing.blp",
            "ReplaceableTextures\\CommandButtonsDisabled\\DISBTNLichKing.blp",
            "ReplaceableTextures\\SSCscorescreen-hero-lichking.blp",
            "war3mapImported\\FighterStockArchimondeP2.blp",
            "war3mapImported\\FighterCardLichKingP1.blp",
            "war3mapImported\\FighterBustLichKingP1.blp",
            "war3mapImported\\FighterTileLichKing.blp",
            "war3mapImported\\SelectionHandLabelP2.tga",
            "war3mapImported\\SelectBarFrame90x28.tga",
            "war3mapImported\\MenuFrameTopLeft.tga",
            "war3mapImported\\StageCardTomb.blp",
            "war3mapImported\\StageBackdrop.tga",
            "UI\\Cursor\\HumanCursor.blp",
        ] {
            assert_eq!(Role::for_path(path), Role::Interface, "{path}");
        }
    }
}
