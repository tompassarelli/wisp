//! Where a player's settings live: a JSON file under the player's own configuration directory, one per player name.

use std::fs;
use std::path::PathBuf;

use super::Settings;

pub struct Store {
    path: PathBuf,
}

fn config_home() -> Option<PathBuf> {
    let from = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty()).map(PathBuf::from);
    from("XDG_CONFIG_HOME").or_else(|| from("APPDATA")).or_else(|| from("HOME").map(|home| home.join(".config")))
}

/// `WISP_PLAYER`, else the operating system's user name, as a file name.
fn player() -> String {
    let named = ["WISP_PLAYER", "USER", "USERNAME"].iter().find_map(|name| std::env::var(name).ok().filter(|value| !value.is_empty())).unwrap_or_else(|| "player".into());
    named.chars().map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' { ch } else { '_' }).collect()
}

impl Store {
    pub fn open() -> Option<Self> {
        Some(Self::at(config_home()?.join("wisp").join("players").join(format!("{}.graphics.json", player()))))
    }

    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    /// The saved settings, or the defaults when there is no file or it cannot be read.
    pub fn load(&self) -> Settings {
        fs::read(&self.path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
    }

    /// A failed write costs the player their choice next run, so it is reported to the caller to log.
    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        if let Some(directory) = self.path.parent() {
            fs::create_dir_all(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
        }
        let temporary = self.path.with_extension("json.tmp");
        let text = serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?;
        fs::write(&temporary, text).and_then(|()| fs::rename(&temporary, &self.path)).map_err(|error| format!("{}: {error}", self.path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Art, Preset};
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("wisp-settings-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&directory);
        directory
    }

    #[test]
    fn settings_round_trip_through_the_file() {
        let directory = scratch("round");
        let store = Store::at(directory.join("nested").join("a.graphics.json"));
        assert_eq!(store.load(), Settings::default());
        let chosen = Settings { preset: Preset::Low, art: Art::Remastered };
        store.save(&chosen).unwrap();
        assert_eq!(store.load(), chosen);
        fs::write(&store.path, br#"{"preset":"ultra"}"#).unwrap();
        assert_eq!(store.load(), Settings { preset: Preset::Ultra, art: Art::Original });
        fs::write(&store.path, b"not json").unwrap();
        assert_eq!(store.load(), Settings::default());
        fs::remove_dir_all(&directory).unwrap();
    }
}
