use std::collections::VecDeque;

use crate::w3gs::{Reader, W3gsError};

// BlzTriggerRegisterPlayerKeyEvent's synchronized key action (0x79) names press and release by these event ids on 3.0.0.24268.
pub const KEY_DOWN_EVENT: u32 = 0x0008_0338;
pub const KEY_UP_EVENT: u32 = 0x0008_0339;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KeyEvent {
    pub down: bool,
    pub key: u32,
    pub meta: u32,
}

const TAG: usize = 8;
const POINT: usize = 8;
const ORDER: usize = 2 + 4 + TAG;
const GHOST: usize = 4 + 4 + 4 + 1 + POINT;

const FIXED: [(u8, usize); 34] = [
    (0x01, 1), (0x02, 0), (0x03, 1), (0x04, 0), (0x05, 0), (0x07, 4),
    (0x10, ORDER), (0x11, ORDER + POINT), (0x12, ORDER + POINT + TAG), (0x13, ORDER + POINT + 2 * TAG),
    (0x14, ORDER + POINT + GHOST), (0x15, ORDER + POINT + GHOST + TAG),
    (0x18, 2), (0x19, 4 + TAG), (0x1a, 0), (0x1b, 1 + TAG), (0x1c, 1 + TAG), (0x1d, TAG), (0x1e, 5),
    (0x50, 5), (0x51, 9), (0x61, 0), (0x62, 4 + TAG), (0x63, TAG), (0x64, TAG), (0x65, TAG),
    (0x66, 0), (0x67, 0), (0x68, 4 + POINT), (0x69, 2 * TAG), (0x6a, 2 * TAG),
    (0x75, 1), (0x76, 2 + POINT), (0x7a, 2 * TAG),
];

fn fixed_len(id: u8) -> Option<usize> {
    FIXED.iter().find(|&&(i, _)| i == id).map(|&(_, n)| n)
}

fn string_shape(id: u8) -> Option<(usize, usize, usize)> {
    Some(match id {
        0x06 => (0, 2, 1),
        0x60 => (TAG, 1, 0),
        0x6b..=0x6d => (0, 3, 4),
        0x70..=0x73 => (0, 3, 0),
        0x77 => (0, 2, 4),
        0x78 => (TAG + 8, 1, 0),
        _ => return None,
    })
}

fn key_event(r: &mut Reader) -> Result<Option<KeyEvent>, W3gsError> {
    r.take(TAG)?;
    let (event, key, meta) = (r.u32()?, r.u32()?, r.u32()?);
    Ok(match event {
        KEY_DOWN_EVENT => Some(KeyEvent { down: true, key, meta }),
        KEY_UP_EVENT => Some(KeyEvent { down: false, key, meta }),
        _ => None,
    })
}

fn skip_action(r: &mut Reader, id: u8) -> Result<Option<KeyEvent>, W3gsError> {
    if let Some(n) = fixed_len(id) {
        r.take(n)?;
    } else if let Some((lead, strings, tail)) = string_shape(id) {
        r.take(lead)?;
        for _ in 0..strings {
            r.cbytes()?;
        }
        r.take(tail)?;
    } else if id == 0x16 || id == 0x17 {
        r.take(1)?;
        let count = r.u16()? as usize;
        r.take(count * TAG)?;
    } else if id == 0x79 {
        return key_event(r);
    } else {
        return Err(W3gsError::Short);
    }
    Ok(None)
}

pub fn key_events(block: &[u8]) -> Vec<KeyEvent> {
    let mut r = Reader::new(block);
    let mut events = Vec::new();
    while r.remaining() > 0 {
        let Ok(id) = r.u8() else { break };
        match skip_action(&mut r, id) {
            Ok(Some(event)) => events.push(event),
            Ok(None) => {}
            Err(_) => break,
        }
    }
    events
}

#[derive(Debug, Default)]
pub struct ReleaseMarker {
    sent: u32,
    presses: VecDeque<(u32, Vec<(u32, u32)>)>,
}

impl ReleaseMarker {
    pub fn mark(&mut self, block: &[u8], acked: u32) -> bool {
        while self.presses.front().is_some_and(|&(index, _)| index < acked) {
            self.presses.pop_front();
        }
        let events = key_events(block);
        let release = events
            .iter()
            .filter(|e| !e.down)
            .any(|e| self.presses.iter().any(|(_, keys)| keys.contains(&(e.key, e.meta))));
        let downs: Vec<(u32, u32)> = events.iter().filter(|e| e.down).map(|e| (e.key, e.meta)).collect();
        if !downs.is_empty() {
            self.presses.push_back((self.sent, downs));
        }
        self.sent += 1;
        release
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(event: u32, key: u32) -> Vec<u8> {
        let mut block = vec![0x79];
        block.extend_from_slice(&[0xb8, 0x24, 0, 0, 0xb8, 0x24, 0, 0]);
        block.extend_from_slice(&event.to_le_bytes());
        block.extend_from_slice(&key.to_le_bytes());
        block.extend_from_slice(&0u32.to_le_bytes());
        block
    }

    #[test]
    fn a_release_is_marked_only_while_the_same_keys_press_is_unacknowledged() {
        let mut marker = ReleaseMarker::default();
        assert!(!marker.mark(&key(KEY_DOWN_EVENT, 67), 0));
        assert!(marker.mark(&key(KEY_UP_EVENT, 67), 0));
        assert!(!marker.mark(&key(KEY_DOWN_EVENT, 67), 2));
        assert!(!marker.mark(&key(KEY_UP_EVENT, 67), 3));
        let mut other = ReleaseMarker::default();
        assert!(!other.mark(&key(KEY_DOWN_EVENT, 67), 0));
        assert!(!other.mark(&key(KEY_UP_EVENT, 13), 0));
        let mut block = vec![0x77];
        block.extend_from_slice(b"SC_FE\0\0");
        block.extend_from_slice(&0u32.to_le_bytes());
        block.extend(key(KEY_UP_EVENT, 67));
        let mut after_sync = ReleaseMarker::default();
        assert!(!after_sync.mark(&key(KEY_DOWN_EVENT, 67), 0));
        assert!(after_sync.mark(&block, 0));
    }
}
