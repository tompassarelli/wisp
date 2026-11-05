use serde::Deserialize;
use wisp_window::model::{global_sequence_frame, skin_position, SkinVertex, Facing, Mat4, Model, Playhead, Pose};

const MDL: &str = include_str!("fixtures/rig.mdl");
const MDX: &[u8] = include_bytes!("fixtures/rig.mdx");
const EXPECTED: &str = include_str!("fixtures/rig.expected.json");
const TOLERANCE: f32 = 1e-4;

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
        pose.update(&playhead, &Facing::FRONT);
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
fn pose_global_sequence_frame_wraps_the_clock_in_milliseconds() {
    assert_eq!(global_sequence_frame(0.25, 400), 250);
    assert_eq!(global_sequence_frame(0.5, 400), 100);
    assert_eq!(global_sequence_frame(-0.1, 400), 300);
    assert_eq!(global_sequence_frame(3.0, 0), 0);
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
    pose.update(&playhead, &Facing::FRONT);
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

const BILLBOARD_MDL: &str = r#"Version { FormatVersion 900, }
Model "Ball" { BlendTime 0, }
Sequences 1 {
  Anim "Stand" { Interval { 0, 1000 }, }
}
Bone "Dummy" {
  ObjectId 0,
  GeosetId Multiple, GeosetAnimId None,
  Rotation 1 { Linear, 0: { 0, 0, 0.3826834, 0.9238795 }, }
  Scaling 1 { Linear, 0: { 2, 2, 2 }, }
}
Bone "Ball" {
  ObjectId 1, Parent 0,
  Billboarded,
  GeosetId Multiple, GeosetAnimId None,
}
PivotPoints 2 { { 0, 0, 0 }, { 4, 0, 5 }, }
"#;

fn apply(matrix: &Mat4, v: [f32; 4]) -> [f32; 3] {
    std::array::from_fn(|row| (0..4).map(|k| matrix[k * 4 + row] * v[k]).sum())
}

fn compose(a: &Mat4, b: &Mat4) -> Mat4 {
    std::array::from_fn(|index| (0..4).map(|k| a[k * 4 + index % 4] * b[(index / 4) * 4 + k]).sum())
}

#[test]
fn a_billboarded_bone_turns_its_front_to_the_camera_whatever_the_model_and_its_parent_face() {
    let model = Model::from_mdl(BILLBOARD_MDL).expect("billboard rig parses");
    let mut pose = Pose::new(&model, &[1]).expect("pose");
    let mut playhead = Playhead::new(&model);
    playhead.set_sequence(&model, Some(0));
    playhead.frame = 0.0;
    let view: Mat4 = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -900.0, 1.0];
    let (sin, cos) = 1.2f32.sin_cos();
    let placement: Mat4 = [cos, sin, 0.0, 0.0, -sin, cos, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 300.0, 0.0, 0.0, 1.0];
    pose.update(&playhead, &Facing::of(&view, &placement));
    let world = compose(&placement, &pose.matrices()[1]);
    let front = apply(&world, [1.0, 0.0, 0.0, 0.0]);
    let side = apply(&world, [0.0, 1.0, 0.0, 0.0]);
    let top = apply(&world, [0.0, 0.0, 1.0, 0.0]);
    let expected = [([0.0, -2.0, 0.0], front), ([2.0, 0.0, 0.0], side), ([0.0, 0.0, 2.0], top)];
    for (want, got) in expected {
        assert!((0..3).all(|axis| (want[axis] - got[axis]).abs() < 1e-4), "{got:?} is not {want:?}");
    }
    let unturned = compose(&placement, &{
        let mut still = Pose::new(&model, &[1]).expect("pose");
        still.update(&playhead, &Facing::FRONT);
        still.matrices()[0]
    });
    let pivot = apply(&unturned, [4.0, 0.0, 5.0, 1.0]);
    let kept = apply(&world, [4.0, 0.0, 5.0, 1.0]);
    assert!((0..3).all(|axis| (pivot[axis] - kept[axis]).abs() < 1e-3), "the pivot stays where its parent puts it: {kept:?} against {pivot:?}");
}
