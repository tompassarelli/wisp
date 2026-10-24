use std::net::SocketAddr;

use relay::server::{Out, AMPLIFICATION};
use relay::{Config, Server};
use relay_proto::control::{self, Control, Refusal};
use relay_proto::wire::{self, Down, Packet, Up};
use relay_proto::Micros;

fn addr(ip: u8, port: u16) -> SocketAddr {
    SocketAddr::from(([10, 0, 0, ip], port))
}

fn say(s: &mut Server, now: Micros, from: SocketAddr, c: &Control) -> Out {
    let mut out = Vec::new();
    s.on_datagram(now, from, &control::encode(c), &mut out);
    out
}

fn create(s: &mut Server, now: Micros, from: SocketAddr, request: u64) -> Control {
    let cookie = s.cookie(from, now);
    let ask = Control::Create {
        cookie,
        request,
        players: 2,
    };
    let out = say(s, now, from, &ask);
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].0, from);
    control::decode(&out[0].1).unwrap()
}

fn up(token: u64) -> Vec<u8> {
    wire::encode(&Packet::Up(Up {
        token,
        seq: 0,
        sent_us: 0,
        turn_ack: 0,
        cover: 0,
        cover_turns: 0,
        checksum_from: 0,
        checksums: vec![],
        action_from: 0,
        actions: vec![],
    }))
    .unwrap()
}

fn downs(out: &Out, to: SocketAddr) -> Vec<Down> {
    out.iter()
        .filter(|(a, _)| *a == to)
        .filter_map(|(_, b)| match wire::decode(b) {
            Ok(Packet::Down(d)) => Some(d),
            _ => None,
        })
        .collect()
}

#[test]
fn the_cookie_verifies_only_its_own_address_and_expires() {
    let cfg = Config::default();
    let epoch = cfg.cookie_epoch_us;
    let mut s = Server::new(cfg);
    let (a, b) = (addr(1, 1000), addr(2, 1000));

    let bare = Control::Create {
        cookie: 0,
        request: 1,
        players: 2,
    };
    let out = say(&mut s, 0, a, &bare);
    assert_eq!(out.len(), 1);
    let Ok(Control::Challenge { cookie }) = control::decode(&out[0].1) else {
        panic!("{out:?}");
    };
    assert_eq!(cookie, s.cookie(a, 0));
    assert_eq!(s.rooms(), 0);

    let borrowed = Control::Create {
        cookie: s.cookie(b, 0),
        request: 1,
        players: 2,
    };
    let out = say(&mut s, 0, a, &borrowed);
    assert!(matches!(
        control::decode(&out[0].1),
        Ok(Control::Challenge { .. })
    ));
    let other_port = say(
        &mut s,
        0,
        addr(1, 1001),
        &Control::Create {
            cookie,
            request: 1,
            players: 2,
        },
    );
    assert!(matches!(
        control::decode(&other_port[0].1),
        Ok(Control::Challenge { .. })
    ));
    assert_eq!(s.rooms(), 0);

    let late = 2 * epoch - 1;
    let echoed = say(
        &mut s,
        late,
        a,
        &Control::Create {
            cookie,
            request: 1,
            players: 2,
        },
    );
    assert!(matches!(
        control::decode(&echoed[0].1),
        Ok(Control::Room { .. })
    ));
    assert_eq!(s.rooms(), 1);

    let old = s.cookie(b, 0);
    let stale = say(
        &mut s,
        2 * epoch,
        b,
        &Control::Join {
            cookie: old,
            request: 2,
            room: 0,
        },
    );
    assert!(matches!(
        control::decode(&stale[0].1),
        Ok(Control::Challenge { .. })
    ));
}

fn full_room(s: &mut Server, a: SocketAddr, b: SocketAddr) -> u64 {
    let Control::Room { room, token, .. } = create(s, 0, a, 1) else {
        panic!();
    };
    let cookie = s.cookie(b, 0);
    let out = say(
        s,
        0,
        b,
        &Control::Join {
            cookie,
            request: 2,
            room,
        },
    );
    assert!(matches!(
        control::decode(&out[0].1),
        Ok(Control::Room { .. })
    ));
    token
}

#[test]
fn an_unverified_address_gets_at_most_three_times_its_bytes_with_turns_trimmed_to_fit() {
    let mut s = Server::new(Config {
        lobby_us: 0,
        ..Config::default()
    });
    let (a, b, rebound) = (addr(1, 1000), addr(2, 1000), addr(1, 2000));
    let token = full_room(&mut s, a, b);

    let period = 8_000;
    let mut now = 0;
    let mut out = Vec::new();
    for _ in 0..75 {
        s.poll(now, &mut out);
        now += period;
    }
    assert!(downs(&out, a).iter().any(|d| d.turns.len() >= 70));

    let mut received = 0u64;
    let mut sent = 0u64;
    let mut carried = 0;
    let bogus = Control::Verify {
        token,
        cookie: s.cookie(a, now),
    };
    for tick in 0..30 {
        let mut out = Vec::new();
        let bytes = up(token);
        received += bytes.len() as u64;
        s.on_datagram(now, rebound, &bytes, &mut out);
        if tick == 10 {
            let v = control::encode(&bogus);
            received += v.len() as u64;
            s.on_datagram(now, rebound, &v, &mut out);
        }
        s.poll(now, &mut out);
        assert!(out.iter().all(|(to, _)| *to != a));
        sent += out
            .iter()
            .filter(|(to, _)| *to == rebound)
            .map(|(_, b)| b.len() as u64)
            .sum::<u64>();
        assert!(sent <= AMPLIFICATION * received, "{sent} > 3 × {received}");
        for d in downs(&out, rebound) {
            assert_eq!(d.turn_from, 0);
            assert!(d.turns.len() < 75 + tick);
            carried = carried.max(d.turns.len());
        }
        now += period;
    }
    assert!(carried > 0);
    assert!(s.stats().trimmed >= 25);
    assert_eq!((s.stats().rebinds, s.stats().verified), (1, 0));

    let mut out = Vec::new();
    let verify = Control::Verify {
        token,
        cookie: s.cookie(rebound, now),
    };
    s.on_datagram(now, rebound, &control::encode(&verify), &mut out);
    s.poll(now, &mut out);
    let full = downs(&out, rebound);
    assert_eq!(full.len(), 1);
    assert_eq!(full[0].turns.len(), 75 + 30 + 1);
    assert_eq!((s.stats().rebinds, s.stats().verified), (1, 1));
}

#[test]
fn room_creation_is_rate_limited_per_address() {
    let cfg = Config {
        rooms_per_window: 2,
        ..Config::default()
    };
    let window = cfg.rate_window_us;
    let mut s = Server::new(cfg);
    let (a, a2, b) = (addr(1, 1000), addr(1, 1001), addr(2, 1000));
    let first = create(&mut s, 0, a, 1);
    assert!(matches!(first, Control::Room { .. }));
    assert_eq!(create(&mut s, 1, a, 1), first);
    assert!(matches!(create(&mut s, 2, a, 2), Control::Room { .. }));
    assert_eq!(
        create(&mut s, 3, a2, 3),
        Control::Refused {
            request: 3,
            reason: Refusal::RateLimited
        }
    );
    assert!(matches!(create(&mut s, 4, b, 4), Control::Room { .. }));
    assert_eq!((s.rooms(), s.stats().rate_limited), (3, 1));
    s.poll(window, &mut Vec::new());
    assert!(matches!(
        create(&mut s, window, a2, 5),
        Control::Room { .. }
    ));
}

#[test]
fn rooms_close_when_every_player_leaves_or_after_the_idle_limit() {
    let cfg = Config::default();
    let idle = cfg.idle_us;
    let mut s = Server::new(cfg);
    let Control::Room { token, .. } = create(&mut s, 0, addr(1, 1), 1) else {
        panic!();
    };
    let Control::Room {
        room, token: host, ..
    } = create(&mut s, 0, addr(2, 1), 2)
    else {
        panic!();
    };
    let cookie = s.cookie(addr(3, 1), 0);
    let joined = say(
        &mut s,
        0,
        addr(3, 1),
        &Control::Join {
            cookie,
            request: 3,
            room,
        },
    );
    let Ok(Control::Room { token: joiner, .. }) = control::decode(&joined[0].1) else {
        panic!();
    };
    say(&mut s, 1, addr(2, 1), &Control::Leave { token: host });
    assert_eq!(s.rooms(), 2);
    say(&mut s, 1, addr(3, 1), &Control::Leave { token: joiner });
    assert_eq!(s.rooms(), 1);
    let mut out = Vec::new();
    s.on_datagram(idle - 1, addr(1, 1), &up(token), &mut out);
    s.poll(2 * idle - 2, &mut out);
    assert_eq!(s.rooms(), 1);
    s.poll(2 * idle - 1, &mut out);
    assert_eq!((s.rooms(), s.stats().rooms_closed), (0, 2));
}
