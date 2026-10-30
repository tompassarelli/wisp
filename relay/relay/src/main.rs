use std::io::Write;
use std::net::{TcpListener, UdpSocket};
use std::time::Duration;
use std::process::ExitCode;

use relay::send_log::SendLog;
use relay::tcp::{self, Limits};
use relay::{Config, Server};

const USAGE: &str = "usage: relay [--bind ADDR] [--steps 8|17,17,16] [--lobby-ms N] [--idle-s N] [--rooms-per-minute N] [--max-rooms N] [--slot-mib N] [--tcp-idle-ms N] [--region NAME] [--send-log FILE] [--once]";

struct Options {
    bind: String,
    cfg: Config,
    limits: Limits,
    send_log: Option<String>,
    once: bool,
}

fn parse(args: &[String]) -> Result<Options, String> {
    let mut bind = "0.0.0.0:7457".to_string();
    let mut cfg = Config::default();
    let mut limits = Limits::default();
    let mut send_log = None;
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
            "--max-rooms" => cfg.max_rooms = number()? as usize,
            "--slot-mib" => cfg.slot_bytes = (number()? as u64) << 20,
            "--tcp-idle-ms" => limits.idle = Duration::from_millis(number()?.max(1) as u64),
            "--region" => cfg.region = value.clone(),
            "--send-log" => send_log = Some(value.clone()),
            _ => return Err(format!("unknown flag {flag}")),
        }
    }
    Ok(Options {
        bind,
        cfg,
        limits,
        send_log,
        once,
    })
}

fn bind(addr: &str) -> std::io::Result<(UdpSocket, TcpListener)> {
    let socket = UdpSocket::bind(addr)?;
    let listener = TcpListener::bind(socket.local_addr()?)?;
    Ok((socket, listener))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Options {
        bind: addr,
        cfg,
        limits,
        send_log,
        once,
    } = match parse(&args) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let (socket, listener) = match bind(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("bind {addr}: {e}");
            return ExitCode::FAILURE;
        }
    };
    let mut sends = match send_log.as_deref().map(|p| SendLog::append(p.as_ref())).transpose() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("--send-log: {e}");
            return ExitCode::FAILURE;
        }
    };
    let idle_us = cfg.idle_us;
    let mut server = Server::new(cfg);
    if sends.is_some() {
        server.record_sends();
    }
    println!("listening {}", socket.local_addr().unwrap());
    let _ = std::io::stdout().flush();
    let result = tcp::serve(&socket, listener, &mut server, once, idle_us, limits, sends.as_mut());
    println!("{:?}", server.stats());
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
