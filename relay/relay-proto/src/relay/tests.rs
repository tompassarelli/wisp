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

fn acts(data: &[u8]) -> Vec<UpAction> {
    data.iter()
        .map(|&b| UpAction {
            release: false,
            data: vec![b],
        })
        .collect()
}

fn turn_of(r: &Relay, player: u8, data: u8) -> usize {
    r.log
        .iter()
        .position(|t| {
            t.actions
                .iter()
                .any(|a| a.player == player && a.data == [data])
        })
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
fn a_player_heard_over_tcp_is_answered_over_tcp_in_the_same_room() {
    let mut r = started();
    r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[1]))).unwrap();
    r.on_packet_via(&up(2, 0, 0, vec![], 0, acts(&[2])), Transport::Tcp)
        .unwrap();
    r.on_packet_via(&up(2, 0, 0, vec![], 1, vec![]), Transport::Udp)
        .unwrap();
    assert_eq!(r.transport(0), Transport::Udp);
    assert_eq!(r.transport(1), Transport::Tcp);
    r.poll(Cadence::default().relay_time(10));
    assert_eq!(turn_of(&r, 0, 1), turn_of(&r, 1, 2));
}

#[test]
fn turns_are_due_on_absolute_deadlines() {
    let mut r = Relay::new(Cadence::new(&[17, 17, 16]), &[1], 0);
    r.start(1_000);
    assert_eq!(r.poll(1_000).len(), 1);
    r.on_packet(&up(1, 1, 0, vec![0], 0, vec![])).unwrap();
    assert!(r.poll(17_999).is_empty());
    r.poll(1_000 + 51_000);
    assert_eq!(r.turns_emitted(), 4);
    assert_eq!(r.next_wake(), 1_000 + 67_000);
}

#[test]
fn requested_cover_sends_the_newest_turns_between_turns() {
    let cadence = Cadence::default();
    let period = cadence.period_us();
    let mut r = Relay::new(cadence.clone(), &[1], 0);
    r.start(0);
    r.poll(0);
    r.on_packet(&up(1, 0, 0, vec![0], 0, vec![])).unwrap();
    r.poll(cadence.relay_time(9));
    let mut ask = Up {
        token: 1,
        seq: 0,
        sent_us: 0,
        turn_ack: 0,
        cover: 3,
        cover_turns: 4,
        checksum_from: 0,
        checksums: vec![],
        action_from: 0,
        actions: vec![],
    };
    r.on_packet(&encode(&Packet::Up(ask.clone())).unwrap())
        .unwrap();
    let last = cadence.relay_time(9);
    assert_eq!(r.next_wake(), last + period / 4);
    let mut seqs = Vec::new();
    for j in 1..4 {
        let out = r.poll(last + j * period / 4);
        assert_eq!(out.len(), 1);
        match decode(&out[0].1).unwrap() {
            Packet::Cover(c) => {
                assert_eq!((c.turn_from, c.turns.len()), (6, 4));
                seqs.push(c.seq);
            }
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(r.next_wake(), cadence.relay_time(10));
    let main = r.poll(cadence.relay_time(10));
    match decode(&main[0].1).unwrap() {
        Packet::Down(d) => assert_eq!(d.seq, seqs[2] + 1),
        other => panic!("{other:?}"),
    }
    assert_eq!(seqs[1], seqs[0] + 1);

    ask.cover = 0;
    ask.cover_turns = 0;
    r.on_packet(&encode(&Packet::Up(ask)).unwrap()).unwrap();
    assert_eq!(r.next_wake(), cadence.relay_time(11));
}

#[test]
fn repeated_and_early_actions_enter_one_turn_once() {
    let mut r = started();
    r.on_packet(&up(1, 0, 0, vec![], 1, acts(&[9]))).unwrap();
    r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[8, 9]))).unwrap();
    r.on_packet(&up(1, 0, 0, vec![], 0, acts(&[8, 9]))).unwrap();
    r.poll(Cadence::default().relay_time(10));
    let actions: Vec<_> = r.log.iter().flat_map(|t| t.actions.clone()).collect();
    assert_eq!(
        actions,
        vec![
            Action {
                player: 0,
                seq: 0,
                data: vec![8]
            },
            Action {
                player: 0,
                seq: 1,
                data: vec![9]
            }
        ]
    );
    assert_eq!(r.log.back().unwrap().actions.len(), 2);
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
fn foreign_and_malformed_packets_are_refused() {
    let mut r = started();
    assert_eq!(
        r.on_packet(&up(3, 0, 0, vec![], 0, vec![])),
        Err(RelayError::UnknownToken)
    );
    assert_eq!(
        r.on_packet(&[0x57]),
        Err(RelayError::Wire(WireError::Short))
    );
}

#[test]
fn acknowledged_turns_leave_the_log() {
    let mut r = started();
    r.on_packet(&up(1, 6, 0, vec![], 0, vec![])).unwrap();
    assert_eq!(r.log_from, 0);
    r.on_packet(&up(2, 4, 0, vec![], 0, vec![])).unwrap();
    assert_eq!(r.log_from, 4);
    r.on_packet(&up(2, 99, 0, vec![], 0, vec![])).unwrap();
    assert_eq!(r.log_from, 6);
}

#[test]
fn a_marked_release_lands_a_turn_after_its_press_without_holding_others() {
    let mut r = started();
    let press_release = vec![
        UpAction {
            release: false,
            data: vec![1],
        },
        UpAction {
            release: true,
            data: vec![2],
        },
        UpAction {
            release: false,
            data: vec![3],
        },
    ];
    r.on_packet(&up(1, 0, 0, vec![], 0, press_release)).unwrap();
    r.on_packet(&up(2, 0, 0, vec![], 0, acts(&[4]))).unwrap();
    r.poll(Cadence::default().relay_time(11));
    let press = turn_of(&r, 0, 1);
    assert_eq!(turn_of(&r, 1, 4), press);
    assert_eq!(turn_of(&r, 0, 2), press + 1);
    assert_eq!(turn_of(&r, 0, 3), press + 1);

    r.on_packet(&up(
        1,
        0,
        0,
        vec![],
        3,
        vec![UpAction {
            release: true,
            data: vec![5],
        }],
    ))
    .unwrap();
    r.poll(Cadence::default().relay_time(12));
    assert_eq!(turn_of(&r, 0, 5), press + 2);
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

#[test]
fn the_clock_holds_after_the_first_turn_until_every_player_has_run_it_without_a_stop() {
    let cadence = Cadence::default();
    let mut r = Relay::new(cadence.clone(), &[1, 2], 0);
    r.start(0);
    r.poll(3_000_000);
    assert_eq!((r.turns_emitted(), r.stops(), r.running_since()), (1, 0, None));
    r.on_packet(&up(1, 1, 0, vec![0], 0, vec![])).unwrap();
    r.poll(3_100_000);
    assert_eq!((r.turns_emitted(), r.running_since()), (1, None));

    r.on_packet(&up(2, 1, 0, vec![0], 0, vec![])).unwrap();
    let release = r.next_wake();
    r.poll(release);
    let since = release - cadence.relay_time(1);
    assert_eq!((r.turns_emitted(), r.stops(), r.running_since()), (2, 0, Some(since)));
    r.poll(since + cadence.relay_time(100));
    assert_eq!((r.turns_emitted(), r.stops()), (101, 0));
}

#[test]
fn players_who_run_the_first_turn_on_time_start_the_clock_at_the_start() {
    let cadence = Cadence::default();
    let mut r = Relay::new(cadence.clone(), &[1], 500);
    r.start(500);
    r.poll(500);
    r.on_packet(&up(1, 1, 0, vec![0], 0, vec![])).unwrap();
    r.poll(500 + cadence.relay_time(10));
    assert_eq!((r.turns_emitted(), r.running_since()), (11, Some(500)));
}
