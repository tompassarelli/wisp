use std::io::Write;
use std::net::UdpSocket;
use std::process::ExitCode;

use relay::{udp, Config, Server};

const USAGE: &str = "usage: relay [--bind ADDR] [--steps 8|17,17,16] [--lobby-ms N] [--idle-s N] [--rooms-per-minute N] [--once]";

fn parse(args: &[String]) -> Result<(String, Config, bool), String> {
    let mut bind = "0.0.0.0:7457".to_string();
    let mut cfg = Config::default();
    let mut once = false;
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        if flag == "--once" {
            once = true;
            continue;
        }
        let value = it.next().ok_or(format!("{flag} needs a value"))?;
        let number = || value.parse::<i64>().map_err(|e| format!("{flag}: {e}"));
        match flag.as_str() {
            "--bind" => bind = value.clone(),
            "--steps" => {
                cfg.steps_ms = value
                    .split(',')
                    .map(|s| s.parse::<u8>().ok().filter(|&v| v > 0))
                    .collect::<Option<_>>()
                    .ok_or(format!("--steps: {value}"))?
            }
            "--lobby-ms" => cfg.lobby_us = number()? * 1_000,
            "--idle-s" => cfg.idle_us = number()? * 1_000_000,
            "--rooms-per-minute" => cfg.rooms_per_window = number()? as u32,
            _ => return Err(format!("unknown flag {flag}")),
        }
    }
    Ok((bind, cfg, once))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (bind, cfg, once) = match parse(&args) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let socket = match UdpSocket::bind(&bind) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("bind {bind}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let idle_us = cfg.idle_us;
    let mut server = Server::new(cfg);
    println!("listening {}", socket.local_addr().unwrap());
    let _ = std::io::stdout().flush();
    let result = udp::serve(&socket, &mut server, once, idle_us);
    println!("{:?}", server.stats());
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
