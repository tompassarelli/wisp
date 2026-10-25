
use crate::wire::WireError;


#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapPlayer {
    pub id: u8,
    pub controller: u8,
    pub race: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MapFacts {
    pub path: Vec<u8>,
    pub size: u32,
    pub crc32: u32,
    pub sha1: [u8; 20],
    pub xoro: u32,
    pub width: u16,
    pub height: u16,
    pub layout: u8,
    pub forces: Vec<u32>,
    pub players: Vec<MapPlayer>,
}

impl MapFacts {
    pub fn user_slots(&self) -> Vec<u8> {
        self.players.iter().filter(|p| p.controller == 1).map(|p| p.id).collect()
    }

    pub fn parse(line: &str) -> Result<Self, String> {
        let fields: std::collections::BTreeMap<&str, &str> = line.split_whitespace().filter_map(|w| w.split_once('=')).collect();
        let field = |k: &str| fields.get(k).copied().ok_or(format!("map facts lack {k}"));
        let number = |k: &str| field(k)?.parse::<u32>().map_err(|e| format!("map {k}: {e}"));
        let byte = |t: &str| t.parse::<u8>().map_err(|e| format!("map player {t}: {e}"));
        let sha1 = field("sha1")?;
        let sha1: Vec<u8> = (0..sha1.len()).step_by(2).map(|i| u8::from_str_radix(sha1.get(i..i + 2).unwrap_or("x"), 16)).collect::<Result<_, _>>().map_err(|e| format!("map sha1: {e}"))?;
        let players = field("players")?
            .split(',')
            .map(|p| match p.split(':').collect::<Vec<_>>()[..] {
                [id, controller, race] => Ok(MapPlayer { id: byte(id)?, controller: byte(controller)?, race: byte(race)? }),
                _ => Err(format!("map player {p} is not id:controller:race")),
            })
            .collect::<Result<_, _>>()?;
        Ok(MapFacts {
            path: field("path")?.as_bytes().to_vec(),
            size: number("size")?,
            crc32: number("crc32")?,
            sha1: sha1.try_into().map_err(|_| "map sha1 is not 20 bytes".to_string())?,
            xoro: number("xoro")?,
            width: number("width")? as u16,
            height: number("height")? as u16,
            layout: number("layout")? as u8,
            forces: field("forces")?.split(',').map(|f| f.parse().map_err(|e| format!("map force {f}: {e}"))).collect::<Result<_, _>>()?,
            players,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RoomFacts {
    pub map: MapFacts,
    pub seed: u32,
    pub players: u8,
    pub computers: u8,
    pub you: u8,
}

impl RoomFacts {
    pub fn pids(&self) -> Vec<u8> {
        self.map.user_slots().into_iter().take(self.players as usize).map(|id| id + 1).collect()
    }

    pub fn unheld_pid(&self) -> Option<u8> {
        self.map.user_slots().get((self.players + self.computers) as usize).map(|id| id + 1)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Chat {
    pub to: Vec<u8>,
    pub from: u8,
    pub kind: u8,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FromAgent {
    Host { map: MapFacts, computers: u8 },
    Joined { name: Vec<u8> },
    MapSize { size: u32 },
    Ready,
    Loaded,
    Chat(Chat),
    Handicap(u8),
    Left(u32),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FromRelay {
    Room(RoomFacts),
    Joined { pid: u8, name: Vec<u8> },
    Left { pid: u8, reason: u32 },
    Handicap { pid: u8, value: u8 },
    Chat(Chat),
    CountdownStart,
    CountdownEnd,
    Loaded { pid: u8 },
    Refused { reason: Vec<u8> },
}

pub(crate) struct Out(pub(crate) Vec<u8>);

impl Out {
    pub(crate) fn u8(&mut self, v: u8) -> &mut Self {
        self.0.push(v);
        self
    }
    pub(crate) fn u16(&mut self, v: u16) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn u32(&mut self, v: u32) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn u64(&mut self, v: u64) -> &mut Self {
        self.0.extend_from_slice(&v.to_le_bytes());
        self
    }
    pub(crate) fn blob(&mut self, b: &[u8]) -> &mut Self {
        self.u16(b.len() as u16);
        self.0.extend_from_slice(b);
        self
    }
    pub(crate) fn chat(&mut self, c: &Chat) -> &mut Self {
        self.blob(&c.to).u8(c.from).u8(c.kind).blob(&c.body)
    }
}

pub(crate) struct In<'a> {
    pub(crate) buf: &'a [u8],
    pub(crate) at: usize,
}

impl<'a> In<'a> {
    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8], WireError> {
        let end = self.at.checked_add(n).ok_or(WireError::Short)?;
        let s = self.buf.get(self.at..end).ok_or(WireError::Short)?;
        self.at = end;
        Ok(s)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, WireError> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn u16(&mut self) -> Result<u16, WireError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, WireError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(crate) fn u64(&mut self) -> Result<u64, WireError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(crate) fn blob(&mut self) -> Result<Vec<u8>, WireError> {
        let n = self.u16()? as usize;
        Ok(self.take(n)?.to_vec())
    }
    pub(crate) fn chat(&mut self) -> Result<Chat, WireError> {
        Ok(Chat { to: self.blob()?, from: self.u8()?, kind: self.u8()?, body: self.blob()? })
    }
    pub(crate) fn done(&self) -> Result<(), WireError> {
        if self.at == self.buf.len() {
            Ok(())
        } else {
            Err(WireError::Trailing)
        }
    }
}

fn encode_map(o: &mut Out, m: &MapFacts) {
    o.blob(&m.path).u32(m.size).u32(m.crc32);
    o.0.extend_from_slice(&m.sha1);
    o.u32(m.xoro).u16(m.width).u16(m.height).u8(m.layout).u8(m.forces.len() as u8);
    for &f in &m.forces {
        o.u32(f);
    }
    o.u8(m.players.len() as u8);
    for p in &m.players {
        o.u8(p.id).u8(p.controller).u8(p.race);
    }
}

fn decode_map(r: &mut In) -> Result<MapFacts, WireError> {
    let path = r.blob()?;
    let size = r.u32()?;
    let crc32 = r.u32()?;
    let sha1 = r.take(20)?.try_into().unwrap();
    let xoro = r.u32()?;
    let width = r.u16()?;
    let height = r.u16()?;
    let layout = r.u8()?;
    let forces = (0..r.u8()?).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let players = (0..r.u8()?)
        .map(|_| Ok(MapPlayer { id: r.u8()?, controller: r.u8()?, race: r.u8()? }))
        .collect::<Result<_, WireError>>()?;
    Ok(MapFacts { path, size, crc32, sha1, xoro, width, height, layout, forces, players })
}

pub fn encode_from_agent(m: &FromAgent) -> Vec<u8> {
    let mut o = Out(Vec::new());
    match m {
        FromAgent::Joined { name } => o.u8(1).blob(name),
        FromAgent::MapSize { size } => o.u8(2).u32(*size),
        FromAgent::Ready => o.u8(3),
        FromAgent::Loaded => o.u8(4),
        FromAgent::Chat(c) => o.u8(5).chat(c),
        FromAgent::Handicap(v) => o.u8(6).u8(*v),
        FromAgent::Left(reason) => o.u8(7).u32(*reason),
        FromAgent::Host { map, computers } => {
            o.u8(8).u8(*computers);
            encode_map(&mut o, map);
            &mut o
        }
    };
    o.0
}

pub fn decode_from_agent(buf: &[u8]) -> Result<FromAgent, WireError> {
    let mut r = In { buf, at: 0 };
    let m = match r.u8()? {
        1 => FromAgent::Joined { name: r.blob()? },
        2 => FromAgent::MapSize { size: r.u32()? },
        3 => FromAgent::Ready,
        4 => FromAgent::Loaded,
        5 => FromAgent::Chat(r.chat()?),
        6 => FromAgent::Handicap(r.u8()?),
        7 => FromAgent::Left(r.u32()?),
        8 => {
            let computers = r.u8()?;
            FromAgent::Host { map: decode_map(&mut r)?, computers }
        }
        _ => return Err(WireError::Kind),
    };
    r.done()?;
    Ok(m)
}

pub fn encode_from_relay(m: &FromRelay) -> Vec<u8> {
    let mut o = Out(Vec::new());
    match m {
        FromRelay::Room(f) => {
            o.u8(1).u32(f.seed).u8(f.players).u8(f.computers).u8(f.you);
            encode_map(&mut o, &f.map);
        }
        FromRelay::Joined { pid, name } => drop(o.u8(2).u8(*pid).blob(name)),
        FromRelay::Left { pid, reason } => drop(o.u8(3).u8(*pid).u32(*reason)),
        FromRelay::Handicap { pid, value } => drop(o.u8(4).u8(*pid).u8(*value)),
        FromRelay::Chat(c) => drop(o.u8(5).chat(c)),
        FromRelay::CountdownStart => drop(o.u8(6)),
        FromRelay::CountdownEnd => drop(o.u8(7)),
        FromRelay::Loaded { pid } => drop(o.u8(8).u8(*pid)),
        FromRelay::Refused { reason } => drop(o.u8(9).blob(reason)),
    }
    o.0
}

pub fn decode_from_relay(buf: &[u8]) -> Result<FromRelay, WireError> {
    let mut r = In { buf, at: 0 };
    let m = match r.u8()? {
        1 => {
            let seed = r.u32()?;
            let players = r.u8()?;
            let computers = r.u8()?;
            let you = r.u8()?;
            FromRelay::Room(RoomFacts { map: decode_map(&mut r)?, seed, players, computers, you })
        }
        2 => FromRelay::Joined { pid: r.u8()?, name: r.blob()? },
        3 => FromRelay::Left { pid: r.u8()?, reason: r.u32()? },
        4 => FromRelay::Handicap { pid: r.u8()?, value: r.u8()? },
        5 => FromRelay::Chat(r.chat()?),
        6 => FromRelay::CountdownStart,
        7 => FromRelay::CountdownEnd,
        8 => FromRelay::Loaded { pid: r.u8()? },
        9 => FromRelay::Refused { reason: r.blob()? },
        _ => return Err(WireError::Kind),
    };
    r.done()?;
    Ok(m)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn map() -> MapFacts {
        MapFacts {
            path: b"Maps\\Wisp\\a.w3x".to_vec(),
            size: 10,
            crc32: 1,
            sha1: [7; 20],
            xoro: 2,
            width: 64,
            height: 64,
            layout: 3,
            forces: vec![1, 2],
            players: vec![MapPlayer { id: 0, controller: 1, race: 1 }, MapPlayer { id: 1, controller: 1, race: 2 }],
        }
    }

    #[test]
    fn the_unheld_pid_is_the_first_user_slot_past_players_and_computers() {
        let mut map = map();
        map.players.push(MapPlayer { id: 4, controller: 2, race: 1 });
        map.players.push(MapPlayer { id: 2, controller: 1, race: 1 });
        map.players.push(MapPlayer { id: 3, controller: 1, race: 1 });
        let facts = |players, computers| RoomFacts { map: map.clone(), seed: 0, players, computers, you: 1 };
        assert_eq!(facts(2, 0).unheld_pid(), Some(3));
        assert_eq!(facts(2, 1).unheld_pid(), Some(4));
        assert_eq!(facts(3, 1).unheld_pid(), None);
    }

    #[test]
    fn messages_round_trip() {
        let chat = Chat { to: vec![2], from: 1, kind: 0x10, body: b"hi\0".to_vec() };
        for m in [
            FromRelay::Room(RoomFacts { map: map(), seed: 9, players: 2, computers: 0, you: 1 }),
            FromRelay::Joined { pid: 2, name: b"b".to_vec() },
            FromRelay::Chat(chat.clone()),
            FromRelay::CountdownEnd,
        ] {
            assert_eq!(decode_from_relay(&encode_from_relay(&m)).unwrap(), m);
        }
        for m in [FromAgent::Joined { name: b"a".to_vec() }, FromAgent::Chat(chat), FromAgent::Left(1), FromAgent::Host { map: map(), computers: 1 }] {
            assert_eq!(decode_from_agent(&encode_from_agent(&m)).unwrap(), m);
        }
    }
}
