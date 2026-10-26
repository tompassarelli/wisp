use std::fs::{File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use relay_proto::send_log::{Line, FORMAT};

const FLUSH_EVERY: Duration = Duration::from_secs(1);

pub struct SendLog {
    out: BufWriter<File>,
    flushed: Instant,
}

impl SendLog {
    pub fn append(path: &Path) -> io::Result<SendLog> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let fresh = file.metadata()?.len() == 0;
        let mut out = BufWriter::new(file);
        if fresh {
            writeln!(out, "{FORMAT}")?;
        }
        Ok(SendLog { out, flushed: Instant::now() })
    }

    pub fn write(&mut self, lines: &[Line]) -> io::Result<()> {
        for line in lines {
            writeln!(self.out, "{line}")?;
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
