use serde::Deserialize;
use wisp_window::model::{global_sequence_frame, rotate, sample, skin_position, SkinVertex, Key, LineType, Mat4, Model, Playhead, Pose, Track};

const MDL: &str = include_str!("fixtures/rig.mdl");
const MDX: &[u8] = include_bytes!("fixtures/rig.mdx");
const EXPECTED: &str = include_str!("fixtures/rig.expected.json");
const TOLERANCE: f32 = 1e-4;
const IDENTITY: Mat4 = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];

#[derive(Deserialize)]
struct Case {
    sequence: usize,
    frame: f32,
    global: u32,
    nodes: Vec<Option<Mat4>>,
    geosets: Vec<Vec<f32>>,
}

fn close(actual: f32, expected: f32) -> bool {
    (actual - expected).abs() <= TOLERANCE * (1.0 + expected.abs())
}

fn check_model(model: &Model) {
    let cases: Vec<Case> = serde_json::from_str(EXPECTED).expect("expected.json");
    assert!(!cases.is_empty());
    let blends = model.blends();
    let skins: Vec<_> = model.geosets.iter().map(|geoset| geoset.skin_vertices(&blends)).collect();
    let mut pose = Pose::new(model, &[]).expect("pose");
    let mut playhead = Playhead::new(model);
    for case in &cases {
        playhead.set_sequence(model, Some(case.sequence));
        playhead.frame = case.frame;
        playhead.set_global_frame(0, case.global);
        pose.update(&playhead);
        for (id, expected) in case.nodes.iter().enumerate() {
            let expected = expected.expect("node");
            let actual = pose.matrices()[id];
            for index in 0..16 {
                assert!(close(actual[index], expected[index]), "sequence {} frame {} node {id} element {index}: {} vs {}", case.sequence, case.frame, actual[index], expected[index]);
            }
        }
        for (geoset, expected) in skins.iter().zip(&case.geosets) {
            assert_eq!(geoset.len() * 3, expected.len());
            for (index, vertex) in geoset.iter().enumerate() {
                let position = skin_position(vertex, pose.matrices());
                for axis in 0..3 {
                    assert!(close(position[axis], expected[index * 3 + axis]), "sequence {} frame {} vertex {index} axis {axis}: {} vs {}", case.sequence, case.frame, position[axis], expected[index * 3 + axis]);
                }
            }
        }
    }
}

#[test]
fn pose_mdx_matches_war3_model_vertices() {
    check_model(&Model::from_mdx(MDX).expect("mdx"));
}

#[test]
fn pose_mdl_matches_war3_model_vertices() {
    check_model(&Model::from_mdl(MDL).expect("mdl"));
}

#[test]
fn pose_mdl_and_mdx_parse_to_the_same_model() {
    let (text, binary) = (Model::from_mdl(MDL).expect("mdl"), Model::from_mdx(MDX).expect("mdx"));
    assert_eq!(text.version, binary.version);
    assert_eq!(text.global_sequences, binary.global_sequences);
    assert_eq!(text.sequences.len(), binary.sequences.len());
    assert_eq!(text.nodes.len(), binary.nodes.len());
    assert_eq!(text.geosets, binary.geosets);
    assert!(text.geosets[1].skin_weights.len() == 4 && text.geosets[0].skin_weights.is_empty());
}

#[test]
fn pose_leaves_unplaced_nodes_at_rest() {
    let mut model = Model::from_mdl(MDL).expect("mdl");
    model.geosets.truncate(1);
    model.geosets[0].groups[3] = vec![2, 3];
    let mut pose = Pose::new(&model, &[]).expect("pose");
    let mut playhead = Playhead::new(&model);
    playhead.set_sequence(&model, Some(0));
    playhead.frame = 500.0;
    pose.update(&playhead);
    assert_ne!(pose.matrices()[2], IDENTITY);
    assert_eq!(pose.matrices()[4], IDENTITY);
    assert_eq!(pose.matrices()[5], IDENTITY);
}


#[test]
fn pose_global_sequence_frame_wraps_the_clock_in_milliseconds() {
    assert_eq!(global_sequence_frame(0.25, 400), 250);
    assert_eq!(global_sequence_frame(0.5, 400), 100);
    assert_eq!(global_sequence_frame(-0.1, 400), 300);
    assert_eq!(global_sequence_frame(3.0, 0), 0);
}

fn track(line: LineType, keys: &[(i32, [f32; 3])]) -> Track<3> {
    Track { line, global_sequence: None, keys: keys.iter().map(|&(frame, value)| Key { frame, value, in_tan: [0.0; 3], out_tan: [0.0; 3] }).collect() }
}

#[test]
fn pose_sample_holds_the_ends_and_blends_linearly() {
    let linear = track(LineType::Hermite, &[(10, [0.0, 0.0, 0.0]), (20, [10.0, 20.0, 30.0])]);
    assert_eq!(sample(Some(&linear), 0.0, [9.0; 3]), [0.0; 3]);
    assert_eq!(sample(Some(&linear), 15.0, [9.0; 3]), [5.0, 10.0, 15.0]);
    assert_eq!(sample(Some(&linear), 99.0, [9.0; 3]), [10.0, 20.0, 30.0]);
    let stepped = track(LineType::DontInterp, &[(10, [1.0; 3]), (20, [2.0; 3])]);
    assert_eq!(sample(Some(&stepped), 19.0, [9.0; 3]), [1.0; 3]);
    assert_eq!(sample(None, 15.0, [9.0; 3]), [9.0; 3]);
    assert_eq!(sample(Some(&track(LineType::Linear, &[])), 15.0, [9.0; 3]), [9.0; 3]);
}

#[test]
fn pose_rotate_turns_a_vector_by_a_normalised_quaternion() {
    let quarter_turn_about_z = [0.0, 0.0, 2.0, 2.0];
    let turned = rotate(quarter_turn_about_z, [1.0, 0.0, 0.0]);
    assert!(close(turned[0], 0.0) && close(turned[1], 1.0) && close(turned[2], 0.0), "{turned:?}");
    assert_eq!(rotate([0.0; 4], [1.0, 2.0, 3.0]), [1.0, 2.0, 3.0]);
}

#[test]
fn pose_group_of_six_bones_skins_as_the_equal_weight_mean_of_its_bones() {
    let mut model = Model::from_mdl(MDL).expect("mdl");
    let group = vec![0, 1, 2, 3, 4, 5];
    model.geosets[0].groups[3] = group.clone();
    let blends = model.blends();
    assert_eq!(blends.len(), 1);
    let skin = model.geosets[0].skin_vertices(&blends);
    let mut pose = Pose::new(&model, &[]).expect("pose");
    let mut playhead = Playhead::new(&model);
    playhead.set_sequence(&model, Some(0));
    playhead.frame = 500.0;
    pose.update(&playhead);
    let grouped: Vec<_> = (0..skin.len()).filter(|&at| model.geosets[0].vertex_group[at] == 3).collect();
    assert!(!grouped.is_empty());
    for at in grouped {
        let position = skin_position(&skin[at], pose.matrices());
        let mut mean = [0.0f32; 3];
        for &bone in &group {
            let moved = skin_position(&SkinVertex { bones: [bone, 0, 0, 0], weights: [1.0, 0.0, 0.0, 0.0], ..skin[at] }, pose.matrices());
            (0..3).for_each(|axis| mean[axis] += moved[axis] / group.len() as f32);
        }
        assert!((0..3).all(|axis| close(position[axis], mean[axis])), "vertex {at}: {position:?} vs {mean:?}");
    }
}
