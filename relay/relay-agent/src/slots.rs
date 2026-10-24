use std::collections::BTreeMap;

use relay_proto::room::RoomFacts;

use crate::w3gs::{Slot, SlotTable, RACE_RANDOM_SELECTABLE, SLOT_CLOSED, SLOT_OCCUPIED, SLOT_OPEN};

const RACE_BITS: [(u8, u8); 4] = [(1, 0x01), (2, 0x02), (3, 0x08), (4, 0x04)];

pub fn slot_table(room: &RoomFacts, joined: &dyn Fn(u8) -> bool, handicaps: &BTreeMap<u8, u8>) -> SlotTable {
    let map = &room.map;
    let users = map.user_slots();
    let used = &users[..room.players as usize];
    let computer = &users[room.players as usize..(room.players + room.computers) as usize];
    let force_of = |id: u8| map.forces.iter().position(|&mask| mask & (1 << id) != 0).unwrap_or(0) as u8;
    let race_of = |race: u8| RACE_BITS.iter().find(|(r, _)| *r == race).map_or(RACE_RANDOM_SELECTABLE, |(_, bit)| *bit) | 0x40;
    let slots = map
        .players
        .iter()
        .enumerate()
        .map(|(index, p)| {
            let occupied = used.contains(&p.id) && joined(p.id + 1);
            let filled = occupied || computer.contains(&p.id);
            let player_id = if occupied { p.id + 1 } else { 0 };
            Slot {
                player_id,
                download: if filled { 100 } else { 255 },
                status: match (filled, used.contains(&p.id)) {
                    (true, _) => SLOT_OCCUPIED,
                    (false, true) => SLOT_OPEN,
                    (false, false) => SLOT_CLOSED,
                },
                computer: computer.contains(&p.id),
                team: if map.layout & 1 != 0 { force_of(p.id) } else { index as u8 },
                color: p.id,
                race: if map.layout & 2 != 0 { race_of(p.race) } else { RACE_RANDOM_SELECTABLE },
                computer_type: 1,
                handicap: handicaps.get(&player_id).copied().unwrap_or(100),
            }
        })
        .collect();
    SlotTable { slots, random_seed: room.seed, layout: map.layout, players: map.players.len() as u8 }
}
