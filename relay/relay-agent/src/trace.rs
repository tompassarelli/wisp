use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use relay_proto::agent::Fed;

use crate::link::Link;

const FLUSH_EVERY: Duration = Duration::from_secs(1);

pub struct Trace {
    out: BufWriter<File>,
    flushed: Instant,
    depth: bool,
    underruns: usize,
}

impl Trace {
    pub fn create(path: &Path) -> io::Result<Trace> {
        Ok(Trace { out: BufWriter::new(File::create(path)?), flushed: Instant::now(), depth: false, underruns: 0 })
    }

    pub fn record(&mut self, link: &Link, fed: &[Fed]) -> io::Result<()> {
        if let (false, Some(choice), Some(at)) = (self.depth, link.agent().choice(), link.chosen_at()) {
            writeln!(self.out, "depth {} {at}", choice.turns)?;
            self.depth = true;
        }
        let stats = link.agent().stats();
        for (index, at) in stats.underrun_index.iter().zip(&stats.underrun_at).skip(self.underruns) {
            writeln!(self.out, "underrun {index} {at}")?;
        }
        self.underruns = stats.underrun_at.len();
        for f in fed {
            writeln!(self.out, "fed {} {} {} {} {}", f.index, f.at, f.scheduled, f.backlog, f.extra_us)?;
        }
        if self.flushed.elapsed() >= FLUSH_EVERY {
            self.flush()?;
        }
        Ok(())
    }

    pub fn flush(&mut self) -> io::Result<()> {
        self.flushed = Instant::now();
        self.out.flush()
    }
}
