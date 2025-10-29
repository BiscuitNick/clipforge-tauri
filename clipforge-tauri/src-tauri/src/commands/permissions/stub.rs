use crate::commands::recording::{PermissionResult, PermissionStatus, PermissionType};
use super::PermissionHandler;

/// Stub implementation for non-macOS platforms
pub struct PlatformPermissions;

impl PermissionHandler for PlatformPermissions {
    fn check_permission(permission_type: &PermissionType) -> PermissionResult {
        // On non-macOS platforms, assume permissions are granted
        // TODO: Implement Windows and Linux permission checks
        PermissionResult::new(permission_type.clone(), PermissionStatus::Granted)
    }

    fn request_permission(permission_type: &PermissionType) -> PermissionResult {
        // On non-macOS platforms, assume permissions are granted
        // TODO: Implement Windows and Linux permission requests
        PermissionResult::new(permission_type.clone(), PermissionStatus::Granted)
    }
}
