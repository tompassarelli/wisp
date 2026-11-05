//! The app id a window an agent launched carries, so niri can place it on a named workspace without taking the seat's focus.

const AGENT_APP_ID: &str = "wisp-agent";

pub fn agent_launched(var: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> bool {
    var("AI_AGENT").is_some_and(|value| !value.is_empty())
}

#[cfg(all(unix, not(target_os = "macos")))]
pub fn named_for_agent(attributes: winit::window::WindowAttributes, agent: bool) -> winit::window::WindowAttributes {
    use winit::platform::{wayland::WindowAttributesExtWayland, x11::WindowAttributesExtX11};
    if !agent {
        return attributes;
    }
    let attributes = WindowAttributesExtWayland::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID);
    WindowAttributesExtX11::with_name(attributes, AGENT_APP_ID, AGENT_APP_ID)
}

#[cfg(not(all(unix, not(target_os = "macos"))))]
pub fn named_for_agent(attributes: winit::window::WindowAttributes, _: bool) -> winit::window::WindowAttributes {
    attributes
}
