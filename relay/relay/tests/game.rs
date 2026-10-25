use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use relay::{udp, Config, Server};
use relay_agent::host::{AgentHost, HostConfig, HostSummary};
use relay_agent::keys::{KEY_DOWN_EVENT, KEY_UP_EVENT};
use relay_agent::w3gs::{self, Reader, Splitter, Writer};
use relay_agent::Link;
use relay_proto::lobby::LobbyTiming;
use relay_proto::room::MapFacts;

const MAP: &str = "path=Maps\\Wisp\\t.w3x size=4096 crc32=1 sha1=00112233445566778899aabbccddeeff00112233 xoro=2 width=52 height=52 layout=1 forces=15 players=0:1:1,1:1:1,2:1:1";
const LEAVE_AT: u32 = 200;
const PRESS_AT: u32 = 20;

fn key(event: u32) -> Vec<u8> {
    Writer::default().u8(0x79).u32(1).u32(1).u32(event).u32(67).u32(0).bytes()
}

fn outgoing(data: &[u8]) -> Vec<u8> {
    w3gs::encode(w3gs::OUTGOING_ACTION, &Writer::default().u32(w3gs::crc32(data)).raw(data).bytes())
}

fn join_packets(name: &[u8]) -> Vec<u8> {
    let mut bytes = w3gs::encode(w3gs::REQ_JOIN, &Writer::default().u32(1).u32(0).u8(0).u16(6112).u32(1).cstring(name).bytes());
    bytes.extend(w3gs::encode(w3gs::MAP_SIZE, &Writer::default().u32(0).u8(1).u32(4096).bytes()));
    bytes.extend(w3gs::encode(w3gs::PROTO_BUF, &Writer::default().u8(w3gs::PROTOBUF_PLAYER_SKINS).u32(2).u8(0x08).u8(1).bytes()));
    bytes
}

#[derive(Debug, Default)]
struct Seen {
    turns: u32,
    keys: Vec<(u32, u8, u32)>,
    syncs: Vec<(u32, u8, Vec<u8>)>,
}

impl Seen {
    fn read_turn(&mut self, payload: &[u8]) {
        let mut r = Reader::new(payload);
        r.u16().unwrap();
        if r.remaining() > 0 {
            r.u16().unwrap();
        }
        while r.remaining() > 0 {
            let pid = r.u8().unwrap();
            let len = r.u16().unwrap() as usize;
            let block = r.take(len).unwrap();
            if block.first() == Some(&0x77) {
                self.syncs.push((self.turns, pid, block.to_vec()));
            }
            for k in relay_agent::keys::key_events(block) {
                self.keys.push((self.turns, pid, if k.down { KEY_DOWN_EVENT } else { KEY_UP_EVENT }));
            }
        }
        self.turns += 1;
    }
}

fn play(port: u16, name: &[u8], presses: bool) -> Seen {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_millis(20))).unwrap();
    stream.write_all(&join_packets(name)).unwrap();
    let mut splitter = Splitter::default();
    let mut seen = Seen::default();
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut buf = [0u8; 4096];
    while Instant::now() < deadline && seen.turns < LEAVE_AT {
        let n = match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => continue,
        };
        for packet in splitter.push(&buf[..n]).unwrap() {
            match packet.kind {
                w3gs::COUNT_DOWN_END => stream.write_all(&w3gs::encode(w3gs::GAME_LOADED_SELF, &[])).unwrap(),
                w3gs::INCOMING_ACTION => {
                    seen.read_turn(&packet.payload);
                    let mut reply = w3gs::encode(w3gs::OUTGOING_KEEP_ALIVE, &Writer::default().u8(0).u32(seen.turns).bytes());
                    if presses && seen.turns == PRESS_AT {
                        reply.extend(outgoing(&key(KEY_DOWN_EVENT)));
                        reply.extend(outgoing(&key(KEY_UP_EVENT)));
                    }
                    stream.write_all(&reply).unwrap();
                }
                _ => {}
            }
        }
    }
    let _ = stream.write_all(&w3gs::encode(w3gs::LEAVE_REQ, &Writer::default().u32(0x07).bytes()));
    seen
}

fn trace_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("relay-game-{}-{name}.trace", std::process::id()))
}

fn check_trace(path: &Path, summary: &HostSummary) {
    let text = std::fs::read_to_string(path).unwrap();
    let lines: Vec<Vec<i64>> = text.lines().map(|l| l.split(' ').skip(1).map(|f| f.parse().unwrap()).collect()).collect();
    let kinds: Vec<&str> = text.lines().map(|l| l.split(' ').next().unwrap()).collect();
    let fed: Vec<&Vec<i64>> = kinds.iter().zip(&lines).filter(|(k, _)| **k == "fed").map(|(_, l)| l).collect();
    assert_eq!(fed.len() as u64, summary.fed, "one fed line per fed turn");
    assert!(fed.iter().enumerate().all(|(i, l)| l.len() == 5 && l[0] == i as i64), "fed lines run 0, 1, 2, ... with five fields");
    let depth: Vec<&Vec<i64>> = kinds.iter().zip(&lines).filter(|(k, _)| **k == "depth").map(|(_, l)| l).collect();
    assert_eq!(depth.len(), 1, "one depth line");
    assert_eq!(depth[0][0], summary.depth_turns as i64);
    assert!(depth[0][1] <= fed[0][1], "D is chosen before the first turn is fed");
    assert_eq!(kinds.iter().filter(|k| **k == "underrun").count(), summary.underruns);
    std::fs::remove_file(path).unwrap();
}

fn agent(link: Link, map: Option<MapFacts>, name: &'static [u8], ports: mpsc::Sender<u16>) -> HostSummary {
    let mut log = |_line: String| {};
    let trace = Some(trace_path(std::str::from_utf8(name).unwrap()));
    let cfg = HostConfig { game_name: name.to_vec(), version: 10200, listen_port: 0, announce_ports: Vec::new(), host: map.map(|m| (m, 0)), expect_map_sha1: None, trace, tuning: Default::default() };
    let host = AgentHost::new(cfg, link, &mut log).unwrap();
    ports.send(host.port().unwrap()).unwrap();
    host.run().unwrap()
}

#[test]
fn two_games_join_load_and_play_through_agents_and_the_relay() {
    thread::spawn(|| {
        thread::sleep(Duration::from_secs(60));
        eprintln!("the relayed game stalled for 60 s");
        std::process::exit(1);
    });
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let server_addr: SocketAddr = socket.local_addr().unwrap();
    let relay = thread::spawn(move || {
        let timing = LobbyTiming { settle_us: 50_000, countdown_us: 100_000 };
        let mut server = Server::new(Config { game_timing: timing, ..Config::default() });
        udp::serve(&socket, &mut server, true, 30_000_000).unwrap();
        server.stats().clone()
    });
    let host_link = Link::create(server_addr, 2).unwrap();
    let room = host_link.room();
    let (ports_a, port_a) = mpsc::channel();
    let (ports_b, port_b) = mpsc::channel();
    let map = MapFacts::parse(MAP).unwrap();
    let agent_a = thread::spawn(move || agent(host_link, Some(map), b"a", ports_a));
    let agent_b = thread::spawn(move || agent(Link::join(server_addr, room).unwrap(), None, b"b", ports_b));
    let (port_a, port_b) = (port_a.recv().unwrap(), port_b.recv().unwrap());
    let client_a = thread::spawn(move || play(port_a, b"a", true));
    let client_b = thread::spawn(move || play(port_b, b"b", false));
    let (seen_a, seen_b) = (client_a.join().unwrap(), client_b.join().unwrap());
    let (summary_a, summary_b) = (agent_a.join().unwrap(), agent_b.join().unwrap());
    let stats = relay.join().unwrap();

    assert!(seen_a.turns >= LEAVE_AT && seen_b.turns >= LEAVE_AT, "turns {} and {}", seen_a.turns, seen_b.turns);
    assert_eq!(summary_a.releases, 1, "the release went up while its press was unacknowledged");
    for seen in [&seen_a, &seen_b] {
        let down = seen.keys.iter().find(|k| k.2 == KEY_DOWN_EVENT).expect("the press arrives");
        let up = seen.keys.iter().find(|k| k.2 == KEY_UP_EVENT).expect("the release arrives");
        assert_eq!((down.1, up.1), (1, 1), "both edges belong to player 1");
        assert!(up.0 > down.0, "the release lands a turn after its press: {:?}", seen.keys);
    }
    assert_eq!((stats.rooms_closed, stats.desyncs), (1, 0));
    assert!(summary_a.fed >= LEAVE_AT as u64, "fed {}", summary_a.fed);
    check_trace(&trace_path("a"), &summary_a);
    check_trace(&trace_path("b"), &summary_b);
    for seen in [&seen_a, &seen_b] {
        assert_eq!(seen.syncs, [], "no turn carries a sync action the players did not send");
    }
}
