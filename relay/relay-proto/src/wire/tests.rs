use super::*;

fn sample_down() -> Down {
    Down {
        token: 0x0123_4567_89ab_cdef,
        seq: 7,
        sent_us: 1_000_000,
        base_us: 20_000_000,
        action_ack: 3,
        checksum_ack: 9,
        turn_from: 41,
        turns: vec![
            Turn {
                step_ms: 17,
                actions: vec![],
            },
            Turn {
                step_ms: 16,
                actions: vec![Action {
                    player: 1,
                    seq: 2,
                    data: vec![9, 8, 7],
                }],
            },
        ],
    }
}

#[test]
fn down_round_trips() {
    let d = sample_down();
    let bytes = encode(&Packet::Down(d.clone())).unwrap();
    assert_eq!(
        bytes.len(),
        DOWN_HEADER + d.turns.iter().map(Turn::wire_len).sum::<usize>()
    );
    assert_eq!(decode(&bytes), Ok(Packet::Down(d)));
}

#[test]
fn up_round_trips() {
    let u = Up {
        token: 5,
        seq: 1,
        sent_us: 2,
        turn_ack: 3,
        cover: 0,
        cover_turns: 0,
        checksum_from: 4,
        checksums: vec![10, 11],
        action_from: 6,
        actions: [(false, vec![1]), (true, vec![]), (true, vec![2, 3])]
            .into_iter()
            .map(|(release, data)| UpAction { release, data })
            .collect(),
    };
    let bytes = encode(&Packet::Up(u.clone())).unwrap();
    assert_eq!(bytes.len(), UP_HEADER + 8 + 3 * UP_ACTION_HEADER + 3);
    assert_eq!(decode(&bytes), Ok(Packet::Up(u)));
}

#[test]
fn an_unknown_action_flag_is_refused() {
    let u = Up {
        token: 5,
        seq: 1,
        sent_us: 2,
        turn_ack: 3,
        cover: 0,
        cover_turns: 0,
        checksum_from: 4,
        checksums: vec![],
        action_from: 6,
        actions: vec![UpAction {
            release: true,
            data: vec![7],
        }],
    };
    let mut bytes = encode(&Packet::Up(u)).unwrap();
    let flag = bytes.len() - 1 - 2 - 1;
    bytes[flag] = 2;
    assert_eq!(decode(&bytes), Err(WireError::Flags));
}

#[test]
fn down_keeps_oldest_turns_within_budget() {
    let mut d = sample_down();
    let big = Turn {
        step_ms: 17,
        actions: vec![Action {
            player: 0,
            seq: 0,
            data: vec![0; 400],
        }],
    };
    d.turns = vec![big.clone(), big.clone(), big.clone(), big];
    let (bytes, n) = encode_down(&d, &d.turns, MAX_PACKET);
    assert_eq!(n, 2);
    assert!(bytes.len() <= MAX_PACKET);
    match decode(&bytes).unwrap() {
        Packet::Down(got) => assert_eq!(got.turns, d.turns[..2].to_vec()),
        other => panic!("{other:?}"),
    }
}

#[test]
fn every_truncation_is_refused() {
    let bytes = encode(&Packet::Down(sample_down())).unwrap();
    for len in 0..bytes.len() {
        assert!(
            decode(&bytes[..len]).is_err(),
            "prefix of {len} bytes decoded"
        );
    }
    let mut long = bytes.clone();
    long.push(0);
    assert_eq!(decode(&long), Err(WireError::Trailing));
}

#[test]
fn frames_carry_packets_on_a_stream() {
    let a = encode(&Packet::Down(sample_down())).unwrap();
    let mut stream = frame(&a);
    stream.extend(frame(&a));
    let (first, used) = unframe(&stream).unwrap();
    assert_eq!(decode(first), decode(&a));
    let (second, _) = unframe(&stream[used..]).unwrap();
    assert_eq!(second, &a[..]);
    assert!(unframe(&stream[..3]).is_none());
}
