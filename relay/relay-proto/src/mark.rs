use crate::wire::{Action, VERSION};

pub const MARK_PREFIX: &[u8] = b"WISP_RLY";
pub const MARK_SEQ: u32 = u32::MAX;

pub fn mark_data() -> Vec<u8> {
    let mut data = vec![0x77];
    // BlzSendSyncData's action (0x77) is its prefix and data as C strings, then a u32 that is 0 when a player sent it.
    data.extend_from_slice(MARK_PREFIX);
    data.push(0);
    data.extend_from_slice(VERSION.to_string().as_bytes());
    data.push(0);
    data.extend_from_slice(&0u32.to_le_bytes());
    data
}

pub fn mark_action(player: u8) -> Action {
    Action { player, seq: MARK_SEQ, data: mark_data() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mark_is_a_sync_action_with_the_relay_prefix_and_version() {
        assert_eq!(mark_data(), b"\x77WISP_RLY\x001\x00\x00\x00\x00\x00");
        assert_eq!(VERSION, 1, "a new wire version changes the mark's data");
    }
}
