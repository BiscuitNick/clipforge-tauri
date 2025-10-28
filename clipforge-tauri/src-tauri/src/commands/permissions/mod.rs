// Platform-specific permission implementations
#[cfg(target_os = "macos")]
mod macos;

#[cfg(not(target_os = "macos"))]
mod stub;

// Re-export the platform-specific implementation
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(not(target_os = "macos"))]
pub use stub::*;

use super::recording::{PermissionResult, PermissionType};

/// Trait for platform-specific permission handling
pub trait PermissionHandler {
    /// Check if a permission is granted
    fn check_permission(permission_type: &PermissionType) -> PermissionResult;

    /// Request a permission from the user
    fn request_permission(permission_type: &PermissionType) -> PermissionResult;
}
