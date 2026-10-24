use std::collections::BTreeMap;

use relay_proto::room::MapFacts;
use relay_proto::Micros;

pub const FIXTURE: &str = include_str!("../fixtures/pool-lobby.packets");

pub struct Line {
    pub at: Micros,
    pub inbound: bool,
    pub client: String,
    pub bytes: Vec<u8>,
}

pub fn hex(text: &str) -> Vec<u8> {
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).expect("hex")).collect()
}

pub fn header(prefix: &str) -> BTreeMap<String, String> {
    let line = FIXTURE.lines().find_map(|l| l.strip_prefix(prefix)).expect(prefix);
    line.split_whitespace().filter_map(|w| w.split_once('=')).map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

pub fn room() -> (MapFacts, u32, u8, u8) {
    let facts = MapFacts::parse(FIXTURE.lines().find_map(|l| l.strip_prefix("# map ")).expect("a map line")).expect("map facts");
    let room = header("# room ");
    let seed = u32::from_str_radix(&room["seed"], 16).expect("seed");
    (facts, seed, room["players"].parse().expect("players"), room["computers"].parse().expect("computers"))
}

pub fn lines() -> Vec<Line> {
    FIXTURE
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            Line {
                at: (f[0].parse::<f64>().expect("seconds") * 1e6) as Micros,
                inbound: f[1] == "in",
                client: f[2].to_string(),
                bytes: hex(f[3]),
            }
        })
        .collect()
}

pub fn connection_clients(lines: &[Line]) -> BTreeMap<String, String> {
    let mut names = BTreeMap::new();
    for (i, line) in lines.iter().enumerate() {
        if line.inbound && line.client.starts_with('#') {
            let client = lines[i..].iter().find(|l| !l.inbound).expect("a reply to the join").client.clone();
            names.insert(line.client.clone(), client);
        }
    }
    names
}
