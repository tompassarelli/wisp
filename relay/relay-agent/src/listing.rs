use crate::w3gs::{encode, Writer, GAME_INFO, PRODUCT, SEARCH_GAME};

pub const DEFAULT_GAME_FLAGS: u32 = 0x0000_0002 | 0x0000_0800 | 0x0000_1000 | 0x0000_3000 | 0x0000_4000 | 0x0006_0000;

fn stat_string(source: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(source.len() + source.len() / 7 + 1);
    for chunk in source.chunks(7) {
        let mut mask = 1u8;
        let encoded: Vec<u8> = chunk
            .iter()
            .enumerate()
            .map(|(i, &byte)| {
                if byte % 2 == 0 {
                    byte.wrapping_add(1)
                } else {
                    mask |= 1 << (i + 1);
                    byte
                }
            })
            .collect();
        out.push(mask);
        out.extend(encoded);
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameInfo<'a> {
    pub version: u32,
    pub name: &'a [u8],
    pub width: u16,
    pub height: u16,
    pub xoro: u32,
    pub path: &'a [u8],
    pub sha1: [u8; 20],
    pub slots: u32,
    pub open_slots: u32,
    pub uptime_seconds: u32,
    pub port: u16,
}

pub fn game_info(info: &GameInfo) -> Vec<u8> {
    let settings = Writer::default()
        .u32(DEFAULT_GAME_FLAGS)
        .u8(0)
        .u16(info.width)
        .u16(info.height)
        .u32(info.xoro)
        .cstring(info.path)
        .cstring(b"Wisp")
        .u8(0)
        .raw(&info.sha1)
        .bytes();
    let w = Writer::default()
        .raw(PRODUCT)
        .u32(info.version)
        .u32(1)
        .u32(0)
        .cstring(info.name)
        .u8(0)
        .raw(&stat_string(&settings))
        .u8(0)
        .u32(info.slots)
        .u32(0x0010_0000)
        .u32(1)
        .u32(info.open_slots)
        .u32(info.uptime_seconds)
        .u16(info.port);
    encode(GAME_INFO, &w.bytes())
}

pub fn is_search_game(datagram: &[u8]) -> bool {
    datagram.len() >= 8 && datagram[0] == 0xf7 && datagram[1] == SEARCH_GAME && &datagram[4..8] == PRODUCT
}
