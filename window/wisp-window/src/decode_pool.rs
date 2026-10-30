use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use crate::sync::lock;

type Job<T> = Box<dyn FnOnce() -> T + Send>;

pub struct Pool<T> {
    jobs: Option<Sender<(u64, Job<T>)>>,
    done: Receiver<(u64, T)>,
    threads: Vec<JoinHandle<()>>,
}

impl<T: Send + 'static> Pool<T> {
    pub fn new(threads: usize) -> Self {
        let (jobs, queue) = channel::<(u64, Job<T>)>();
        let (finished, done) = channel();
        let queue = Arc::new(Mutex::new(queue));
        let threads = (0..threads.max(1))
            .map(|index| {
                let (queue, finished) = (Arc::clone(&queue), finished.clone());
                thread::Builder::new()
                    .name(format!("wisp-decode-{index}"))
                    .spawn(move || loop {
                        let next = lock(&queue).recv();
                        let Ok((id, job)) = next else { return };
                        if finished.send((id, job())).is_err() {
                            return;
                        }
                    })
                    .expect("spawn a decode worker")
            })
            .collect();
        Self { jobs: Some(jobs), done, threads }
    }

    pub fn submit(&self, id: u64, job: impl FnOnce() -> T + Send + 'static) {
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send((id, Box::new(job)));
        }
    }

    pub fn try_recv(&self) -> Option<(u64, T)> {
        self.done.try_recv().ok()
    }
}

impl<T> Drop for Pool<T> {
    fn drop(&mut self) {
        self.jobs = None;
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn jobs_finish_on_worker_threads_and_come_back_by_id() {
        let pool = Pool::new(3);
        let caller = thread::current().id();
        for id in 0..8 {
            pool.submit(id, move || (id * 2, thread::current().id()));
        }
        let mut results = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        while results.len() < 8 && Instant::now() < deadline {
            match pool.try_recv() {
                Some(result) => results.push(result),
                None => thread::sleep(Duration::from_millis(1)),
            }
        }
        results.sort_by_key(|(id, _)| *id);
        assert_eq!(results.iter().map(|(id, (doubled, _))| (*id, *doubled)).collect::<Vec<_>>(), (0..8).map(|id| (id, id * 2)).collect::<Vec<_>>());
        assert!(results.iter().all(|(_, (_, worker))| *worker != caller));
    }
}
