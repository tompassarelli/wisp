use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};

use relay::server::Out;
use relay::{Config, Server};
use relay_proto::control::{self, Control, Refusal};
use relay_proto::Micros;

static REQUESTS: AtomicU64 = AtomicU64::new(1);

fn fresh() -> u64 {
    REQUESTS.fetch_add(1, Ordering::Relaxed)
}

fn addr(ip: u8, port: u16) -> SocketAddr {
    SocketAddr::from(([10, 0, 0, ip], port))
}

fn say(s: &mut Server, now: Micros, from: SocketAddr, c: &Control) -> Out {
    let mut out = Vec::new();
    s.on_datagram(now, from, &control::encode(c), &mut out);
    out
}

fn reply(out: &Out, to: SocketAddr) -> Control {
    let sent: Vec<_> = out.iter().filter(|(p, _)| *p == to).collect();
    assert_eq!(sent.len(), 1, "{out:?}");
    control::decode(&sent[0].1).unwrap()
}

struct Member {
    addr: SocketAddr,
    token: u64,
    slot: u8,
}

fn open(s: &mut Server, now: Micros, players: u8, host: SocketAddr) -> (u64, Member) {
    let cookie = s.cookie(host, now);
    let out = say(s, now, host, &Control::CreatePeer { cookie, request: fresh(), players });
    let Control::Room { room, token, slot, steps, .. } = reply(&out, host) else { panic!("{out:?}") };
    assert!(steps.is_empty());
    (room, Member { addr: host, token, slot })
}

fn join(s: &mut Server, now: Micros, room: u64, from: SocketAddr) -> Member {
    let cookie = s.cookie(from, now);
    let out = say(s, now, from, &Control::Join { cookie, request: 1, room });
    let Control::Room { token, slot, .. } = reply(&out, from) else { panic!("{out:?}") };
    Member { addr: from, token, slot }
}

fn room_of(s: &mut Server, players: u8) -> (u64, Vec<Member>) {
    let (room, host) = open(s, 0, players, addr(1, 1000));
    let mut members = vec![host];
    for i in 1..players {
        members.push(join(s, 0, room, addr(i + 1, 1000)));
    }
    (room, members)
}

fn datagram(token: u64, payload: &[u8]) -> Control {
    Control::Peer { token, payload: payload.to_vec() }
}

#[test]
fn peer_room_forwards_each_datagram_unchanged_to_every_other_member() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 4);
    assert_eq!(members.iter().map(|m| m.slot).collect::<Vec<_>>(), vec![0, 1, 2, 3]);
    let payload: Vec<u8> = (0..(relay_proto::wire::MAX_PACKET - control::PEER_HEADER)).map(|i| i as u8).collect();
    let out = say(&mut s, 10, members[2].addr, &datagram(members[2].token, &payload));
    assert_eq!(out.len(), 3);
    for m in [&members[0], &members[1], &members[3]] {
        assert_eq!(reply(&out, m.addr), Control::Relayed { from: 2, payload: payload.clone() });
    }
    assert!(out.iter().all(|(_, b)| b.len() <= relay_proto::wire::MAX_PACKET));
    assert!(out.iter().all(|(p, _)| *p != members[2].addr));
    assert_eq!(s.stats().forwarded, 3);
}

#[test]
fn peer_room_takes_two_to_four_members() {
    let mut s = Server::new(Config::default());
    for (request, players) in [(1, 1), (2, 0), (3, 5), (4, 24)] {
        let from = addr(9, 2000);
        let cookie = s.cookie(from, 0);
        let out = say(&mut s, 0, from, &Control::CreatePeer { cookie, request, players });
        assert_eq!(reply(&out, from), Control::Refused { request, reason: Refusal::Players });
    }
    assert_eq!(s.rooms(), 0);
    for players in [2, 3, 4] {
        let (_, members) = room_of(&mut s, players);
        assert_eq!(members.len(), players as usize);
    }
    let (room, _) = room_of(&mut s, 2);
    let cookie = s.cookie(addr(8, 1), 0);
    let out = say(&mut s, 0, addr(8, 1), &Control::Join { cookie, request: 1, room });
    assert_eq!(reply(&out, addr(8, 1)), Control::Refused { request: 1, reason: Refusal::Full });
}

#[test]
fn peer_room_forwards_only_between_verified_addresses() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 3);
    let moved = addr(1, 4000);
    let out = say(&mut s, 5, moved, &datagram(members[0].token, b"from a new address"));
    assert_eq!(out.len(), 1);
    let Control::Challenge { cookie } = reply(&out, moved) else { panic!("{out:?}") };
    assert_eq!(cookie, s.cookie(moved, 5));
    assert_eq!(s.stats().forwarded, 0);

    let out = say(&mut s, 6, members[1].addr, &datagram(members[1].token, b"to the unverified rebind"));
    assert_eq!(out.len(), 1);
    assert_eq!(reply(&out, members[2].addr), Control::Relayed { from: 1, payload: b"to the unverified rebind".to_vec() });

    say(&mut s, 7, moved, &Control::Verify { token: members[0].token, cookie });
    let out = say(&mut s, 8, members[1].addr, &datagram(members[1].token, b"after"));
    assert_eq!(out.len(), 2);
    assert_eq!(reply(&out, moved), Control::Relayed { from: 1, payload: b"after".to_vec() });
    let out = say(&mut s, 9, moved, &datagram(members[0].token, b"hello"));
    assert_eq!(out.len(), 2);
    assert_eq!(s.holds(moved.into()), true);
    assert_eq!(s.holds(members[0].addr.into()), false);
}

#[test]
fn peer_room_drops_unknown_tokens_departed_members_and_other_rooms_datagrams() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 3);
    assert!(say(&mut s, 1, addr(7, 7), &datagram(12345, b"x")).is_empty());
    say(&mut s, 2, members[1].addr, &Control::Leave { token: members[1].token });
    assert!(say(&mut s, 3, members[1].addr, &datagram(members[1].token, b"gone")).is_empty());
    let out = say(&mut s, 4, members[0].addr, &datagram(members[0].token, b"hi"));
    assert_eq!(out.len(), 1);
    assert_eq!(reply(&out, members[2].addr), Control::Relayed { from: 0, payload: b"hi".to_vec() });
    let mut too_long = control::encode(&datagram(members[0].token, b""));
    too_long.resize(relay_proto::wire::MAX_PACKET + 1, 0);
    let mut out = Vec::new();
    s.on_datagram(5, members[0].addr, &too_long, &mut out);
    assert!(out.is_empty());
}

#[test]
fn peer_room_runs_without_a_clock_and_closes_when_idle_or_left() {
    let cfg = Config::default();
    let idle = cfg.idle_us;
    let mut s = Server::new(cfg);
    let (_, members) = room_of(&mut s, 2);
    assert_eq!(s.next_wake(), None);
    let mut out = Vec::new();
    s.poll(1_000_000, &mut out);
    assert!(out.is_empty());
    assert_eq!(s.rooms(), 1);
    say(&mut s, 2_000_000, members[0].addr, &datagram(members[0].token, b"alive"));
    s.poll(2_000_000 + idle - 1, &mut out);
    assert_eq!(s.rooms(), 1);
    s.poll(2_000_000 + idle, &mut out);
    assert_eq!(s.rooms(), 0);

    let (_, members) = room_of(&mut s, 3);
    for m in &members {
        say(&mut s, 5, m.addr, &Control::Leave { token: m.token });
    }
    assert_eq!(s.rooms(), 0);
    assert_eq!(s.stats().rooms_closed, 2);
}

#[test]
fn peer_room_closes_when_its_forwarded_bytes_pass_the_per_slot_budget() {
    let cfg = Config { slot_bytes: 2000, ..Config::default() };
    let mut s = Server::new(cfg);
    let (_, members) = room_of(&mut s, 2);
    let payload = vec![7u8; 1000];
    for now in 1..=3 {
        say(&mut s, now, members[0].addr, &datagram(members[0].token, &payload));
    }
    let mut out = Vec::new();
    s.poll(10, &mut out);
    assert_eq!(s.rooms(), 1);
    for now in 4..=5 {
        say(&mut s, now, members[0].addr, &datagram(members[0].token, &payload));
    }
    s.poll(10, &mut out);
    assert_eq!(s.rooms(), 0);
    assert_eq!(s.stats().spent, 1);
}

#[test]
fn peer_room_creation_counts_against_the_address_rate_limit() {
    let cfg = Config::default();
    let limit = cfg.rooms_per_window;
    let mut s = Server::new(cfg);
    let host = addr(1, 1000);
    let cookie = s.cookie(host, 0);
    for request in 0..limit as u64 {
        let out = say(&mut s, 0, host, &Control::CreatePeer { cookie, request, players: 2 });
        assert!(matches!(reply(&out, host), Control::Room { .. }));
    }
    let out = say(&mut s, 0, host, &Control::CreatePeer { cookie, request: 99, players: 2 });
    assert_eq!(reply(&out, host), Control::Refused { request: 99, reason: Refusal::RateLimited });
}

fn report(m: &Member, winner: u8, checksum: u32, rtt_ms: u16) -> Control {
    Control::Result { token: m.token, winner, checksum, rtt_ms }
}

fn close_all(s: &mut Server, now: Micros, members: &[Member]) {
    for m in members {
        say(s, now, m.addr, &Control::Leave { token: m.token });
    }
}

#[test]
fn peer_room_result_line_records_both_reports_of_a_finished_room() {
    let cfg = Config { region: "us-west".to_string(), ..Config::default() };
    let mut s = Server::new(cfg);
    let (room, members) = room_of(&mut s, 2);
    assert!(say(&mut s, 5, members[0].addr, &report(&members[0], 1, 0xdead_beef, 34)).is_empty());
    assert!(say(&mut s, 6, members[1].addr, &report(&members[1], 1, 0xdead_beef, 36)).is_empty());
    assert!(s.take_results().is_empty());
    close_all(&mut s, 7, &members);
    assert_eq!(
        s.take_results(),
        vec![format!("result room {room:016x} region us-west players 2 verdict agree slot0 winner=1 checksum=deadbeef rtt=34 slot1 winner=1 checksum=deadbeef rtt=36")]
    );
    assert!(s.take_results().is_empty());
}

#[test]
fn peer_room_result_line_marks_a_disagreement_in_winner_or_checksum_but_not_in_rtt() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 1, members[0].addr, &report(&members[0], 0, 7, 20));
    say(&mut s, 1, members[1].addr, &report(&members[1], 0, 7, 90));
    close_all(&mut s, 2, &members);
    assert!(s.take_results()[0].contains("verdict agree"));

    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 1, members[0].addr, &report(&members[0], 0, 7, 20));
    say(&mut s, 1, members[1].addr, &report(&members[1], 1, 7, 20));
    close_all(&mut s, 2, &members);
    assert!(s.take_results()[0].contains("verdict disagree"));

    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 1, members[0].addr, &report(&members[0], 0, 7, 20));
    say(&mut s, 1, members[1].addr, &report(&members[1], 0, 8, 20));
    close_all(&mut s, 2, &members);
    assert!(s.take_results()[0].contains("verdict disagree"));
}

#[test]
fn peer_room_result_line_marks_missing_reports_and_skips_a_room_with_none() {
    let mut s = Server::new(Config::default());
    let (room, members) = room_of(&mut s, 3);
    say(&mut s, 1, members[0].addr, &report(&members[0], 2, 9, 40));
    say(&mut s, 1, members[2].addr, &report(&members[2], 2, 9, 41));
    close_all(&mut s, 2, &members);
    assert_eq!(
        s.take_results(),
        vec![format!("result room {room:016x} region unknown players 3 verdict incomplete slot0 winner=2 checksum=00000009 rtt=40 slot1 missing slot2 winner=2 checksum=00000009 rtt=41")]
    );

    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 1, members[0].addr, &report(&members[0], 1, 1, 1));
    say(&mut s, 1, members[1].addr, &report(&members[1], 0, 1, 1));
    let (_, quiet) = room_of(&mut s, 2);
    close_all(&mut s, 2, &quiet);
    assert!(s.take_results().is_empty());
    close_all(&mut s, 2, &members);
    assert!(s.take_results()[0].contains("verdict disagree"));
}

#[test]
fn peer_room_result_line_is_written_when_an_idle_room_closes() {
    let cfg = Config::default();
    let idle = cfg.idle_us;
    let mut s = Server::new(cfg);
    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 10, members[1].addr, &report(&members[1], 1, 3, 50));
    let mut out = Vec::new();
    s.poll(10 + idle - 1, &mut out);
    assert!(s.take_results().is_empty());
    s.poll(10 + idle, &mut out);
    let lines = s.take_results();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("verdict incomplete slot0 missing slot1 winner=1"));
}

#[test]
fn peer_room_result_keeps_the_first_report_of_a_slot_and_ignores_unverified_and_departed_senders() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 2);
    say(&mut s, 1, members[0].addr, &report(&members[0], 1, 5, 30));
    say(&mut s, 2, members[0].addr, &report(&members[0], 0, 6, 31));

    let moved = addr(2, 4000);
    let out = say(&mut s, 3, moved, &report(&members[1], 0, 6, 31));
    assert!(matches!(reply(&out, moved), Control::Challenge { .. }));

    say(&mut s, 4, addr(7, 7), &Control::Result { token: 99, winner: 1, checksum: 5, rtt_ms: 1 });
    say(&mut s, 5, members[1].addr, &Control::Leave { token: members[1].token });
    say(&mut s, 6, members[1].addr, &report(&members[1], 1, 5, 30));
    say(&mut s, 7, members[0].addr, &Control::Leave { token: members[0].token });
    let lines = s.take_results();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("verdict incomplete slot0 winner=1 checksum=00000005 rtt=30 slot1 missing"), "{}", lines[0]);
}

#[test]
fn peer_room_result_is_not_forwarded_to_other_members() {
    let mut s = Server::new(Config::default());
    let (_, members) = room_of(&mut s, 3);
    let out = say(&mut s, 1, members[0].addr, &report(&members[0], 1, 5, 30));
    assert!(out.is_empty());
    assert_eq!(s.stats().forwarded, 0);
}
