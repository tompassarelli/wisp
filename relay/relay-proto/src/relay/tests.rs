use super::*;
use crate::wire::{decode, encode, Up, UpAction};

fn up(
    token: u64,
    turn_ack: u32,
    checksum_from: u32,
    checksums: Vec<u32>,
    action_from: u32,
    actions: Vec<UpAction>,
) -> Vec<u8> {
    encode(&Packet::Up(Up {
        token,
        seq: 0,
        sent_us: 0,
        turn_ack,
        cover: 0,
        cover_turns: 0,
        checksum_from,
        checksums,
        action_from,
        actions,
    }))
    .unwrap()
}

fn started() -> Relay {
    let mut r = Relay::new(Cadence::default(), &[1, 2], 0);
    r.start(0);
    r.poll(0);
    r.on_packet(&up(1, 0, 0, vec![5], 0, vec![])).unwrap();
    r.on_packet(&up(2, 0, 0, vec![5], 0, vec![])).unwrap();
    r.poll(Cadence::default().relay_time(9));
    r
}

#[test]
fn the_first_differing_checksum_is_reported() {
    let mut r = started();
    r.on_packet(&up(1, 0, 0, vec![5, 6, 7], 0, vec![])).unwrap();
    r.on_packet(&up(2, 0, 0, vec![5, 6, 0], 0, vec![])).unwrap();
    assert_eq!(r.desync(), Some(2));
    assert_eq!(r.checksums_compared(), 3);
}

#[test]
fn a_player_a_second_behind_stops_the_clock_and_the_restart_is_rebased() {
    let cadence = Cadence::default();
    let mut r = Relay::new(cadence.clone(), &[1], 0);
    r.start(0);
    r.poll(0);
    r.on_packet(&up(1, 1, 0, vec![0], 0, vec![])).unwrap();
    let stop_at = cadence.relay_time(127);
    r.poll(stop_at);
    assert_eq!((r.turns_emitted(), r.stops()), (127, 1));
    let probes = r.poll(stop_at + 500_000);
    assert_eq!(r.turns_emitted(), 127);
    assert!(!probes.is_empty());

    let restart = r.next_wake();
    r.on_packet(&up(1, 127, 1, vec![0; 64], 0, vec![])).unwrap();
    r.on_packet(&up(1, 127, 65, vec![0; 62], 0, vec![]))
        .unwrap();
    let resumed = r.poll(restart);
    assert_eq!(r.turns_emitted(), 128);
    assert_eq!(r.next_wake(), restart + cadence.period_us());
    let base = restart - cadence.relay_time(127);
    match decode(&resumed[0].1).unwrap() {
        Packet::Down(d) => assert_eq!(d.base_us, base as u64),
        other => panic!("{other:?}"),
    }
    r.poll(restart + 10 * cadence.period_us());
    assert_eq!((r.turns_emitted(), r.stops()), (138, 1));
}
