use std::fmt::Write;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Report {
    pub(crate) winner: u8,
    pub(crate) checksum: u32,
    pub(crate) rtt_ms: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Verdict {
    Agree,
    Disagree,
    Incomplete,
}

impl Verdict {
    fn name(self) -> &'static str {
        match self {
            Verdict::Agree => "agree",
            Verdict::Disagree => "disagree",
            Verdict::Incomplete => "incomplete",
        }
    }
}

fn verdict(reports: &[Option<Report>]) -> Verdict {
    let mut given = reports.iter().flatten();
    let Some(first) = given.next() else {
        return Verdict::Incomplete;
    };
    if given.any(|r| (r.winner, r.checksum) != (first.winner, first.checksum)) {
        Verdict::Disagree
    } else if reports.iter().any(Option::is_none) {
        Verdict::Incomplete
    } else {
        Verdict::Agree
    }
}

pub(crate) fn line(room: u64, region: &str, reports: &[Option<Report>]) -> Option<String> {
    if reports.iter().all(Option::is_none) {
        return None;
    }
    let mut line = format!("result room {room:016x} region {region} players {} verdict {}", reports.len(), verdict(reports).name());
    for (slot, report) in reports.iter().enumerate() {
        match report {
            Some(r) => write!(line, " slot{slot} winner={} checksum={:08x} rtt={}", r.winner, r.checksum, r.rtt_ms),
            None => write!(line, " slot{slot} missing"),
        }
        .unwrap();
    }
    Some(line)
}
