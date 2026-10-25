use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use relay::{udp, Config, Server, Stats};
use relay_agent::host::{AgentHost, HostConfig, HostSummary};
use relay_agent::stop::StopHandle;
use relay_agent::w3gs::{self, Splitter, Writer};
use relay_agent::Link;
use relay_proto::lobby::LobbyTiming;
use relay_proto::room::MapFacts;

const MAP: &str = "path=Maps\\Wisp\\t.w3x size=4096 crc32=1 sha1=00112233445566778899aabbccddeeff00112233 xoro=2 width=52 height=52 layout=1 forces=15 players=0:1:1,1:1:1,2:1:1";
const ROOM_SHA1: [u8; 20] = [0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33];
const OTHER_SHA1: [u8; 20] = [0xab; 20];
const BOUND: Duration = Duration::from_secs(10);
const TURNS: u32 = 50;

type Run = std::io::Result<HostSummary>;

fn relay() -> (SocketAddr, mpsc::Receiver<Stats>) {
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    let addr = socket.local_addr().unwrap();
    let (send, stats) = mpsc::channel();
    thread::spawn(move || {
        let timing = LobbyTiming { settle_us: 50_000, countdown_us: 100_000 };
        let mut server = Server::new(Config { game_timing: timing, ..Config::default() });
        udp::serve(&socket, &mut server, true, 30_000_000).unwrap();
        let _ = send.send(server.stats().clone());
    });
    (addr, stats)
}

fn config(name: &[u8], map: Option<MapFacts>, expect_map_sha1: Option<[u8; 20]>) -> HostConfig {
    HostConfig { game_name: name.to_vec(), version: 10200, listen_port: 0, announce_ports: Vec::new(), host: map.map(|m| (m, 0)), expect_map_sha1, trace: None, tuning: Default::default() }
}

fn spawn(cfg: HostConfig, link: Link) -> (u16, StopHandle, mpsc::Receiver<Run>) {
    let (ready, started) = mpsc::channel();
    let (done, result) = mpsc::channel();
    thread::spawn(move || {
        let mut log = |_line: String| {};
        let host = AgentHost::new(cfg, link, &mut log).unwrap();
        ready.send((host.port().unwrap(), host.stop_handle())).unwrap();
        let _ = done.send(host.run());
    });
    let (port, stop) = started.recv().unwrap();
    (port, stop, result)
}

fn join_packets(name: &[u8]) -> Vec<u8> {
    let mut bytes = w3gs::encode(w3gs::REQ_JOIN, &Writer::default().u32(1).u32(0).u8(0).u16(6112).u32(1).cstring(name).bytes());
    bytes.extend(w3gs::encode(w3gs::MAP_SIZE, &Writer::default().u32(0).u8(1).u32(4096).bytes()));
    bytes.extend(w3gs::encode(w3gs::PROTO_BUF, &Writer::default().u8(w3gs::PROTOBUF_PLAYER_SKINS).u32(2).u8(0x08).u8(1).bytes()));
    bytes
}

#[derive(Debug, Default)]
struct Seen {
    kinds: Vec<u8>,
    turns: u32,
}

fn play(port: u16, name: &'static [u8], quit: Arc<AtomicBool>) -> thread::JoinHandle<Seen> {
    thread::spawn(move || {
        let mut seen = Seen::default();
        let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else { return seen };
        stream.set_read_timeout(Some(Duration::from_millis(20))).unwrap();
        let _ = stream.write_all(&join_packets(name));
        let mut splitter = Splitter::default();
        let deadline = Instant::now() + BOUND;
        let mut buf = [0u8; 4096];
        while Instant::now() < deadline && seen.turns < TURNS && !quit.load(Ordering::Relaxed) {
            let n = match stream.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => continue,
                Err(_) => break,
            };
            for packet in splitter.push(&buf[..n]).unwrap() {
                seen.kinds.push(packet.kind);
                match packet.kind {
                    w3gs::COUNT_DOWN_END => drop(stream.write_all(&w3gs::encode(w3gs::GAME_LOADED_SELF, &[]))),
                    w3gs::INCOMING_ACTION => {
                        seen.turns += 1;
                        drop(stream.write_all(&w3gs::encode(w3gs::OUTGOING_KEEP_ALIVE, &Writer::default().u8(0).u32(seen.turns).bytes())));
                    }
                    _ => {}
                }
            }
        }
        let _ = stream.write_all(&w3gs::encode(w3gs::LEAVE_REQ, &Writer::default().u32(0x07).bytes()));
        seen
    })
}

fn finished<T>(result: &mpsc::Receiver<T>, what: &str) -> T {
    let got = result.recv_timeout(BOUND);
    assert!(got.is_ok(), "{what} was still running {BOUND:?} later");
    got.unwrap()
}

#[test]
fn a_joiner_expecting_another_map_leaves_the_room_before_the_countdown() {
    let (server, stats) = relay();
    let link = Link::create(server, 2).unwrap();
    let room = link.room();
    let (host_port, host_stop, host_result) = spawn(config(b"a", Some(MapFacts::parse(MAP).unwrap()), None), link);
    let quit = Arc::new(AtomicBool::new(false));
    let host_client = play(host_port, b"a", quit.clone());
    let (joiner_port, _, joiner_result) = spawn(config(b"b", None, Some(OTHER_SHA1)), Link::join(server, room).unwrap());
    let joiner_client = play(joiner_port, b"b", quit.clone());

    let result = finished(&joiner_result, "the joiner");
    assert!(result.is_err(), "the joiner played: {result:?}");
    let error = result.unwrap_err();
    assert_eq!(error.kind(), ErrorKind::InvalidData);
    assert!(error.to_string().contains(&"ab".repeat(20)), "{error}");
    assert!(error.to_string().contains("00112233445566778899aabbccddeeff00112233"), "{error}");
    thread::sleep(Duration::from_millis(500));
    quit.store(true, Ordering::Relaxed);
    let seen = host_client.join().unwrap();
    joiner_client.join().unwrap();
    assert!(seen.kinds.contains(&w3gs::SLOT_INFO_JOIN), "the host's game joined: {:?}", seen.kinds);
    assert!(!seen.kinds.contains(&w3gs::COUNT_DOWN_START), "the host's game started its countdown: {:?}", seen.kinds);
    host_stop.stop();
    assert!(finished(&host_result, "the host").is_ok());
    assert_eq!(finished(&stats, "the relay").rooms_closed, 1, "both agents left the room");
}

#[test]
fn a_joiner_expecting_the_rooms_map_plays() {
    let (server, stats) = relay();
    let link = Link::create(server, 2).unwrap();
    let room = link.room();
    let (host_port, _, host_result) = spawn(config(b"a", Some(MapFacts::parse(MAP).unwrap()), Some(ROOM_SHA1)), link);
    let (joiner_port, _, joiner_result) = spawn(config(b"b", None, Some(ROOM_SHA1)), Link::join(server, room).unwrap());
    let quit = Arc::new(AtomicBool::new(false));
    let clients = [play(host_port, b"a", quit.clone()), play(joiner_port, b"b", quit)];
    for client in clients {
        let seen = client.join().unwrap();
        assert!(seen.turns >= TURNS, "turns {}", seen.turns);
    }
    for result in [host_result, joiner_result] {
        let summary = finished(&result, "an agent");
        assert!(summary.as_ref().is_ok_and(|s| s.turns >= TURNS as u64), "{summary:?}");
    }
    assert_eq!(finished(&stats, "the relay").rooms_closed, 1);
}

#[test]
fn a_stop_handle_stops_its_own_host_and_no_other() {
    let (server, stats) = relay();
    let link = Link::create(server, 2).unwrap();
    let room = link.room();
    let (_, host_stop, host_result) = spawn(config(b"a", Some(MapFacts::parse(MAP).unwrap()), None), link);
    let (_, joiner_stop, joiner_result) = spawn(config(b"b", None, None), Link::join(server, room).unwrap());

    joiner_stop.stop();
    assert!(finished(&joiner_result, "the stopped joiner").is_ok());
    assert!(host_result.recv_timeout(Duration::from_millis(500)).is_err(), "the host stopped with the joiner");
    host_stop.stop();
    assert!(finished(&host_result, "the host").is_ok());
    assert_eq!(finished(&stats, "the relay").rooms_closed, 1);
}
