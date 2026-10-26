use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::net::SocketAddr;
use std::process::{ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

use relay_agent::Link;
use relay_proto::relay::LAG_LIMIT_US;
use relay_proto::send_log::{self, Line, Sent};
use relay_proto::wire::{self, Packet};
use relay_proto::Micros;

const HOLD: Duration = Duration::from_millis(1_300);

struct Player {
    link: Link,
    received: Vec<(Sent, u32, Option<u32>, Option<Micros>)>,
    unchecked: VecDeque<u32>,
    fed: usize,
}

impl Player {
    fn step(&mut self, holding: bool) {
        let token = self.link.token();
        let received = &mut self.received;
        let fed = self.link.step_tapped(Instant::now() + Duration::from_millis(1), |_, bytes| {
            let newest = |from: u32, n: usize| (n as u32).checked_sub(1).map(|k| from + k);
            match wire::decode(bytes) {
                Ok(Packet::Down(d)) if d.token == token => {
                    received.push((Sent::Down, d.seq, newest(d.turn_from, d.turns.len()), Some(d.sent_us as Micros)))
                }
                Ok(Packet::Cover(c)) if c.token == token => received.push((Sent::Cover, c.seq, newest(c.turn_from, c.turns.len()), None)),
                _ => {}
            }
        });
        for f in fed.unwrap() {
            self.unchecked.push_back(f.index);
            self.fed += 1;
        }
        if !holding {
            self.unchecked.drain(..).for_each(|index| self.link.record_checksum(index));
        }
    }
}

fn spawn_relay(log: &std::path::Path) -> (std::process::Child, BufReader<ChildStdout>, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_relay"))
        .args(["--bind", "127.0.0.1:0", "--once", "--lobby-ms", "300", "--idle-s", "10", "--send-log"])
        .arg(log)
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    let addr = line.trim().strip_prefix("listening ").unwrap().parse().unwrap();
    (child, out, addr)
}

#[test]
fn the_send_log_holds_one_line_per_downstream_packet_in_order_and_names_a_lag_stop() {
    let dir = std::env::temp_dir().join(format!("relay-send-log-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("sends.log");
    let _ = std::fs::remove_file(&path);
    let (mut child, mut out, server) = spawn_relay(&path);
    let host = Link::create(server, 2).unwrap();
    let guest = Link::join(server, host.room()).unwrap();
    let room = host.room();
    let mut players: Vec<Player> =
        [host, guest].into_iter().map(|link| Player { link, received: Vec::new(), unchecked: VecDeque::new(), fed: 0 }).collect();
    let deadline = Instant::now() + Duration::from_secs(30);
    while players.iter().any(|p| p.fed < 100) {
        assert!(Instant::now() < deadline, "match stalled before the hold");
        players.iter_mut().for_each(|p| p.step(false));
    }
    let held = Instant::now();
    while held.elapsed() < HOLD {
        players[0].step(false);
        players[1].step(true);
    }
    let resumed = players.iter().map(|p| p.fed).max().unwrap();
    while players.iter().any(|p| p.fed < resumed + 100) {
        assert!(Instant::now() < deadline, "match stalled after the hold");
        players.iter_mut().for_each(|p| p.step(false));
    }
    for p in &players {
        p.link.leave().unwrap();
    }
    let left = Instant::now();
    while left.elapsed() < Duration::from_millis(200) {
        players.iter_mut().for_each(|p| p.step(false));
    }
    let mut rest = String::new();
    out.read_to_string(&mut rest).unwrap();
    assert!(child.wait().unwrap().success());
    assert!(rest.contains("rooms_closed: 1"), "{rest}");
    let lines = send_log::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
    let _ = std::fs::remove_dir_all(&dir);

    let times: Vec<Micros> = lines.iter().map(|l| match *l {
        Line::Packet { at_us, .. } | Line::Stop { at_us, .. } => at_us,
    }).collect();
    assert!(times.windows(2).all(|w| w[0] <= w[1]), "send times fall");
    assert!(times.last() > times.first());
    for (slot, p) in players.iter().enumerate() {
        let logged: Vec<_> = lines
            .iter()
            .filter_map(|l| match *l {
                Line::Packet { sent, room: r, slot: s, seq, newest, at_us } if r == room && s == slot => {
                    Some((sent, seq, newest, (sent == Sent::Down).then_some(at_us)))
                }
                _ => None,
            })
            .collect();
        assert_eq!(logged, p.received, "slot {slot}");
    }
    let stops: Vec<_> = lines.iter().filter(|l| matches!(l, Line::Stop { .. })).collect();
    assert_eq!(stops.len(), 1, "{stops:?}");
    let Line::Stop { room: r, slot, behind_us, .. } = *stops[0] else { unreachable!() };
    assert_eq!((r, slot), (room, 1));
    assert!(behind_us > LAG_LIMIT_US);
}
