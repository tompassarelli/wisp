
use relay_agent::game::GameHost;
use relay_agent::w3gs::{self, Packet, SockAddr, Splitter};
use relay_proto::lobby::{Lobby, HOST_TIMING};
use relay_proto::room::FromRelay;

mod common;

use common::{connection_clients, lines, room};

fn comparable(packet: &[u8]) -> Option<Vec<u8>> {
    let mut packet = packet.to_vec();
    match packet[1] {
        w3gs::PING_FROM_HOST | w3gs::INCOMING_ACTION => None,
        w3gs::SLOT_INFO_JOIN => {
            let end = packet.len();
            packet[end - 14..end - 8].fill(0);
            Some(packet)
        }
        _ => Some(packet),
    }
}

struct Seat {
    host: GameHost,
    splitter: Splitter,
    received: Vec<Vec<u8>>,
}

fn deliver(seats: &mut [Seat], messages: Vec<(usize, FromRelay)>) {
    for (to, message) in messages {
        let packets = seats[to].host.relay(message);
        seats[to].received.extend(packets);
    }
}

#[test]
fn the_agent_sends_each_client_the_lobby_bytes_host_ts_sent() {
    let (map, seed, players, computers) = room();
    let lines = lines();
    let names = connection_clients(&lines);
    let order: Vec<String> = names.values().cloned().collect();
    let mut lobby = Lobby::new(map, seed, players, computers, HOST_TIMING);
    let mut seats: Vec<Seat> = (0..lobby.players())
        .map(|i| {
            let FromRelay::Room(facts) = lobby.welcome(i).remove(0) else { panic!("room first") };
            Seat { host: GameHost::new(facts), splitter: Splitter::default(), received: Vec::new() }
        })
        .collect();
    let address = SockAddr { ip: [127, 0, 0, 1], port: 0 };
    for line in lines.iter().filter(|l| l.inbound) {
        let polled = lobby.poll(line.at);
        deliver(&mut seats, polled);
        let client = names.get(&line.client).unwrap_or(&line.client);
        let player = order.iter().position(|c| c == client).expect("a known client");
        for Packet { kind, payload } in seats[player].splitter.push(&line.bytes).expect("W3GS") {
            let out = seats[player].host.client(&Packet { kind, payload }, address, 0).expect("client packet");
            seats[player].received.extend(out.to_client);
            for message in out.to_relay {
                let replies = lobby.on_message(line.at, player, message);
                deliver(&mut seats, replies);
            }
        }
    }
    for (player, client) in order.iter().enumerate() {
        let expected: Vec<Vec<u8>> = lines.iter().filter(|l| !l.inbound && &l.client == client).filter_map(|l| comparable(&l.bytes)).collect();
        let got: Vec<Vec<u8>> = seats[player].received.iter().filter_map(|p| comparable(p)).collect();
        for (i, (e, g)) in expected.iter().zip(&got).enumerate() {
            assert_eq!(hexed(g), hexed(e), "{client} packet {i}");
        }
        assert_eq!(got.len(), expected.len(), "{client} packet count");
        assert!(expected.len() >= 10, "{client} has only {} lobby packets", expected.len());
    }
}

fn hexed(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
