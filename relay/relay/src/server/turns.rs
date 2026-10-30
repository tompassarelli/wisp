use relay_proto::send_log::Line;
use relay_proto::Micros;

use crate::path::{send_down, Delivery, Out};
use crate::room::{Body, Room};
use crate::server::Stats;

pub(super) fn send_turns(room: &mut Room, id: u64, now: Micros, out: &mut Out, stats: &mut Stats, mut sends: Option<&mut Vec<Line>>) {
    let Body::Clocked(clocked) = &mut room.body else {
        return;
    };
    let relay = &mut clocked.relay;
    let stops = relay.stops();
    let origin = relay.origin();
    for (index, bytes) in relay.poll(now) {
        let slot = &mut room.slots[index];
        if slot.left {
            continue;
        }
        if let Some(path) = &mut slot.path {
            let before = out.len();
            match send_down(path, bytes, out) {
                Delivery::Sent | Delivery::Undecodable => {}
                Delivery::Trimmed => stats.trimmed += 1,
                Delivery::Withheld => stats.withheld += 1,
            }
            if let (Some(sends), Some((_, sent))) = (sends.as_deref_mut(), out.get(before)) {
                sends.extend(Line::packet(id, index, sent, now - origin));
            }
        }
    }
    if let (Some(sends), Some(stop)) = (sends, relay.last_stop().filter(|_| relay.stops() > stops)) {
        sends.push(Line::Stop { room: id, at_us: stop.at_us, slot: stop.slot, behind_us: stop.behind_us });
    }
}
