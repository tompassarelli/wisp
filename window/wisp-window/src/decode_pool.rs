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
