use std::net::ToSocketAddrs;
use std::process::ExitCode;

use relay_agent::host::{AgentHost, HostConfig};
use relay_agent::{Link, Tuning};
use relay_proto::Micros;
use relay_proto::room::MapFacts;

const USAGE: &str = "relay-agent --relay HOST:PORT --name GAME (--create PLAYERS --map 'path=... size=...' [--computers N] | --join ROOM) [--announce PORT,...] [--version N] [--trace FILE] [--raise-headroom-ms N] [--max-total-depth-ms N]";
const CLIENT_PORTS: &str = "16000,16001,16002,16003,16004,16005,16006,16007";

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str)
}

fn millis(args: &[String], name: &str) -> Result<Option<Micros>, String> {
    flag(args, name).map(|n| n.parse::<u32>().map(|ms| Micros::from(ms) * 1000).map_err(|e| format!("{name}: {e}"))).transpose()
}

fn config(args: &[String]) -> Result<(String, HostConfig, Option<u8>, Option<u64>), String> {
    let relay = flag(args, "--relay").ok_or(USAGE)?.to_string();
    let name = flag(args, "--name").ok_or(USAGE)?;
    let create = flag(args, "--create").map(|n| n.parse::<u8>().map_err(|e| format!("--create: {e}"))).transpose()?;
    let join = flag(args, "--join").map(|r| u64::from_str_radix(r, 16).map_err(|e| format!("--join: {e}"))).transpose()?;
    if create.is_some() == join.is_some() {
        return Err(USAGE.into());
    }
    let host = match create {
        Some(_) => {
            let map = MapFacts::parse(flag(args, "--map").ok_or(USAGE)?)?;
            let computers = flag(args, "--computers").map_or(Ok(0), str::parse).map_err(|e| format!("--computers: {e}"))?;
            Some((map, computers))
        }
        None => None,
    };
    let cfg = HostConfig {
        game_name: name.as_bytes().to_vec(),
        version: flag(args, "--version").map_or(Ok(10200), str::parse).map_err(|e| format!("--version: {e}"))?,
        listen_port: 0,
        announce_ports: flag(args, "--announce").unwrap_or(CLIENT_PORTS).split(',').map(str::parse).collect::<Result<_, _>>().map_err(|e| format!("--announce: {e}"))?,
        host,
        trace: flag(args, "--trace").map(Into::into),
        tuning: Tuning { raise_headroom_us: millis(args, "--raise-headroom-ms")?, max_total_depth_us: millis(args, "--max-total-depth-ms")? },
    };
    Ok((relay, cfg, create, join))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (relay, cfg, create, join) = match config(&args) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::from(2);
        }
    };
    relay_agent::stop::on_signals();
    let started = std::time::Instant::now();
    let mut log = |line: String| println!("{:.3} {line}", started.elapsed().as_secs_f64());
    let link = relay
        .to_socket_addrs()
        .and_then(|mut addrs| addrs.next().ok_or_else(|| std::io::Error::other(format!("{relay} has no address"))))
        .and_then(|server| match (create, join) {
            (Some(players), _) => Link::create_tuned(server, players, cfg.tuning),
            (_, Some(room)) => Link::join_tuned(server, room, cfg.tuning),
            _ => unreachable!(),
        });
    let link = match link {
        Ok(link) => link,
        Err(e) => {
            eprintln!("relay-agent: {relay}: {e}");
            return ExitCode::FAILURE;
        }
    };
    log(format!("room {:016x} slot {}", link.room(), link.slot()));
    match AgentHost::new(cfg, link, &mut log).and_then(AgentHost::run) {
        Ok(s) => {
            println!(
                "agent summary: turns {} underruns {} depth {} releases {} spiky {} stalls {} raise_ms {:.1}",
                s.turns,
                s.underruns,
                s.depth_turns,
                s.releases,
                s.spiky,
                s.visible_stalls,
                s.raise_us as f64 / 1000.0
            );
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("relay-agent: {e}");
            ExitCode::FAILURE
        }
    }
}
