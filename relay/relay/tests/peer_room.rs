use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};

use relay::server::Out;
use relay::{Config, Server};
use relay_proto::control::{self, Control};
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
