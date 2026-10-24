use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, UdpSocket};
use std::process::{Command, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use relay::{udp, Config, Server, Stats};
use relay_agent::Link;
use relay_proto::agent::Fed;
use relay_proto::wire::{Turn, UpAction};

const IDLE_US: i64 = 10_000_000;

fn spawn_server() -> (SocketAddr, JoinHandle<Stats>) {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let addr = socket.local_addr().unwrap();
    let handle = thread::spawn(move || {
        let mut server = Server::new(Config {
            lobby_us: 300_000,
            idle_us: IDLE_US,
            ..Config::default()
        });
        udp::serve(&socket, &mut server, true, IDLE_US).unwrap();
        server.stats().clone()
    });
    (addr, handle)
}

fn digest(turn: &Turn) -> u32 {
    let mut h = DefaultHasher::new();
    turn.step_ms.hash(&mut h);
    for a in &turn.actions {
        (a.player, a.seq, &a.data).hash(&mut h);
    }
    h.finish() as u32
}

struct Player {
    link: Link,
    fed: Vec<Fed>,
    sent: u8,
}

impl Player {
    fn step(&mut self, slice: Duration) {
        for f in self.link.step(Instant::now() + slice).unwrap() {
            self.link.record_checksum(digest(&f.turn));
            if f.index % 25 == 0 {
                let data = vec![self.link.slot(), self.sent];
                self.sent = self.sent.wrapping_add(1);
                let release = self.sent.is_multiple_of(2);
                self.link.send_action(UpAction { release, data }).unwrap();
            }
            self.fed.push(f);
        }
    }
}

fn play(server: SocketAddr, turns: usize, rebind_at: Option<usize>) -> (Vec<Player>, Vec<u16>) {
    let host = Link::create(server, 2).unwrap();
    let guest = Link::join(server, host.room()).unwrap();
    assert_eq!((host.slot(), guest.slot()), (0, 1));
    assert_ne!(host.token(), guest.token());
    let mut players: Vec<Player> = [host, guest]
        .into_iter()
        .map(|link| Player {
            link,
            fed: Vec::new(),
            sent: 0,
        })
        .collect();
    let mut ports = vec![players[0].link.local_addr().unwrap().port()];
    let deadline = Instant::now() + Duration::from_secs(30);
    while players.iter().any(|p| p.fed.len() < turns) {
        assert!(Instant::now() < deadline, "match stalled");
        for p in &mut players {
            p.step(Duration::from_millis(1));
        }
        if rebind_at.is_some_and(|at| players[0].fed.len() >= at) && ports.len() == 1 {
            players[0].link.rebind().unwrap();
            ports.push(players[0].link.local_addr().unwrap().port());
        }
    }
    for p in &players {
        p.link.leave().unwrap();
    }
    (players, ports)
}

fn check_feeds(players: &[Player], turns: usize) {
    let shortest = players.iter().map(|p| p.fed.len()).min().unwrap();
    assert!(shortest >= turns);
    for p in players {
        for (i, f) in p.fed.iter().enumerate() {
            assert_eq!(f.index as usize, i);
        }
    }
    let a: Vec<&Turn> = players[0].fed[..shortest].iter().map(|f| &f.turn).collect();
    let b: Vec<&Turn> = players[1].fed[..shortest].iter().map(|f| &f.turn).collect();
    assert_eq!(a, b);
}

fn actions_of(p: &Player, slot: u8) -> Vec<Vec<u8>> {
    p.fed
        .iter()
        .flat_map(|f| f.turn.actions.iter())
        .filter(|a| a.player == slot)
        .map(|a| a.data.clone())
        .collect()
}

#[test]
fn two_agents_play_through_the_relay_over_loopback_and_survive_a_port_rebind() {
    let (server, handle) = spawn_server();
    let (players, ports) = play(server, 500, Some(200));
    let stats = handle.join().unwrap();

    assert_eq!(ports.len(), 2);
    assert_ne!(ports[0], ports[1]);
    check_feeds(&players, 500);
    assert!(players[0].link.challenges() >= 1);
    assert_eq!(players[1].link.challenges(), 0);
    let host_actions = actions_of(&players[1], 0);
    assert!(host_actions.len() >= 16);
    assert!(host_actions.iter().any(|d| d[1] as usize > 200 / 25));
    for (i, d) in host_actions.iter().enumerate() {
        assert_eq!(d, &vec![0, i as u8]);
    }
    assert_eq!(
        actions_of(&players[0], 1).len(),
        actions_of(&players[1], 1).len()
    );
    assert_eq!(stats.rooms_created, 1);
    assert_eq!(stats.rooms_closed, 1);
    assert_eq!(stats.rebinds, 1);
    assert_eq!(stats.verified, 1);
    assert_eq!(stats.desyncs, 0);
    assert_eq!(stats.stops, 0);
}

#[test]
fn the_relay_binary_serves_a_match_to_agent_links() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_relay"))
        .args([
            "--bind",
            "127.0.0.1:0",
            "--once",
            "--lobby-ms",
            "300",
            "--idle-s",
            "10",
        ])
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    out.read_line(&mut line).unwrap();
    let server: SocketAddr = line
        .trim()
        .strip_prefix("listening ")
        .unwrap()
        .parse()
        .unwrap();

    let (players, _) = play(server, 250, None);
    check_feeds(&players, 250);
    assert!(child.wait().unwrap().success());
    line.clear();
    out.read_line(&mut line).unwrap();
    assert!(line.contains("rooms_closed: 1"), "{line}");
    assert!(line.contains("desyncs: 0"), "{line}");
}
