use std::sync::OnceLock;
use std::time::Instant;

fn origin() -> Instant {
    static ORIGIN: OnceLock<Instant> = OnceLock::new();
    *ORIGIN.get_or_init(Instant::now)
}

/// Nanoseconds on the monotonic clock the library shares with Bun, counted from the first call.
pub fn now_ns() -> u64 {
    origin().elapsed().as_nanos() as u64
}
