use relay_proto::rng::Rng;
use relay_proto::wire::{self, Action, Cover, Down, Packet, Turn, Up, UpAction};

fn random_packet(rng: &mut Rng) -> Packet {
    let bytes = |rng: &mut Rng, max: u64| {
        (0..rng.below(max))
            .map(|_| rng.next_u64() as u8)
            .collect::<Vec<u8>>()
    };
    let kind = rng.below(3);
    if kind != 1 {
        let turns: Vec<Turn> = (0..rng.below(6))
            .map(|_| Turn {
                step_ms: rng.next_u64() as u8,
                actions: (0..rng.below(4))
                    .map(|_| Action {
                        player: rng.next_u64() as u8,
                        seq: rng.next_u64() as u32,
                        data: bytes(rng, 40),
                    })
                    .collect(),
            })
            .collect();
        if kind == 2 {
            return Packet::Cover(Cover {
                token: rng.next_u64(),
                seq: rng.next_u64() as u32,
                turn_from: rng.next_u64() as u32,
                turns,
            });
        }
        Packet::Down(Down {
            token: rng.next_u64(),
            seq: rng.next_u64() as u32,
            sent_us: rng.next_u64(),
            base_us: rng.next_u64(),
            action_ack: rng.next_u64() as u32,
            checksum_ack: rng.next_u64() as u32,
            turn_from: rng.next_u64() as u32,
            turns,
        })
    } else {
        Packet::Up(Up {
            token: rng.next_u64(),
            seq: rng.next_u64() as u32,
            sent_us: rng.next_u64(),
            turn_ack: rng.next_u64() as u32,
            cover: rng.below(2) as u8 * rng.next_u64() as u8,
            cover_turns: rng.next_u64() as u8,
            checksum_from: rng.next_u64() as u32,
            checksums: (0..rng.below(10)).map(|_| rng.next_u64() as u32).collect(),
            action_from: rng.next_u64() as u32,
            actions: (0..rng.below(8))
                .map(|_| UpAction {
                    release: rng.chance(0.5),
                    data: bytes(rng, 60),
                })
                .collect(),
        })
    }
}

#[test]
fn packets_round_trip_and_damaged_bytes_never_panic() {
    let mut rng = Rng::new(7);
    for _ in 0..5000 {
        let p = random_packet(&mut rng);
        let bytes = wire::encode(&p).unwrap();
        assert!(bytes.len() <= wire::MAX_PACKET);
        assert_eq!(wire::decode(&bytes), Ok(p));
        let mut damaged = bytes.clone();
        for _ in 0..1 + rng.below(4) {
            let i = rng.below(damaged.len() as u64) as usize;
            damaged[i] = rng.next_u64() as u8;
        }
        damaged.truncate(rng.below(damaged.len() as u64 + 1) as usize);
        let _ = wire::decode(&damaged);
        let noise: Vec<u8> = (0..rng.below(1300)).map(|_| rng.next_u64() as u8).collect();
        let _ = wire::decode(&noise);
    }
}
