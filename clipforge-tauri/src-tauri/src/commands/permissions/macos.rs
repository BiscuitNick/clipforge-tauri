use crate::commands::recording::{PermissionResult, PermissionStatus, PermissionType};
use super::PermissionHandler;
use objc::{class, msg_send, sel, sel_impl};
use objc::runtime::{BOOL, YES};
use objc_foundation::{INSString, NSString};
use block::ConcreteBlock;

/// macOS-specific permission implementation
pub struct PlatformPermissions;

impl PlatformPermissions {
    /// Check camera permission status
    fn check_camera_permission() -> PermissionStatus {
        unsafe {
            let av_capture_device_class = class!(AVCaptureDevice);

            // Get authorization status for video
            let media_type = NSString::from_str("vide");
            let status: i64 = msg_send![av_capture_device_class, authorizationStatusForMediaType: media_type];

            Self::convert_av_authorization_status(status)
        }
    }

    /// Check microphone permission status
    fn check_microphone_permission() -> PermissionStatus {
        unsafe {
            let av_capture_device_class = class!(AVCaptureDevice);

            // Get authorization status for audio
            let media_type = NSString::from_str("soun");
            let status: i64 = msg_send![av_capture_device_class, authorizationStatusForMediaType: media_type];

            Self::convert_av_authorization_status(status)
        }
    }

    /// Check screen recording permission status
    fn check_screen_permission() -> PermissionStatus {
        // On macOS 10.15+, screen recording requires special permission
        // Unfortunately, there's no direct API to check screen recording permission status
        // The only way to truly verify is to attempt screen capture
        // For now, we'll return NotDetermined to prompt a request
        PermissionStatus::NotDetermined
    }

    /// Request camera permission
    fn request_camera_permission() -> PermissionStatus {
        unsafe {
            let av_capture_device_class = class!(AVCaptureDevice);
            let media_type = NSString::from_str("vide");

            // This is a blocking call that shows the system permission dialog
            let (tx, rx) = std::sync::mpsc::channel();

            let block = ConcreteBlock::new(move |granted: BOOL| {
                let _ = tx.send(granted == YES);
            });
            let block = block.copy();

            let _: () = msg_send![
                av_capture_device_class,
                requestAccessForMediaType: media_type
                completionHandler: &*block
            ];

            // Wait for the response
            match rx.recv_timeout(std::time::Duration::from_secs(60)) {
                Ok(true) => PermissionStatus::Granted,
                Ok(false) => PermissionStatus::Denied,
                Err(_) => PermissionStatus::NotDetermined,
            }
        }
    }

    /// Request microphone permission
    fn request_microphone_permission() -> PermissionStatus {
        unsafe {
            let av_capture_device_class = class!(AVCaptureDevice);
            let media_type = NSString::from_str("soun");

            let (tx, rx) = std::sync::mpsc::channel();

            let block = ConcreteBlock::new(move |granted: BOOL| {
                let _ = tx.send(granted == YES);
            });
            let block = block.copy();

            let _: () = msg_send![
                av_capture_device_class,
                requestAccessForMediaType: media_type
                completionHandler: &*block
            ];

            // Wait for the response
            match rx.recv_timeout(std::time::Duration::from_secs(60)) {
                Ok(true) => PermissionStatus::Granted,
                Ok(false) => PermissionStatus::Denied,
                Err(_) => PermissionStatus::NotDetermined,
            }
        }
    }

    /// Request screen recording permission
    fn request_screen_permission() -> PermissionStatus {
        // For screen recording on macOS 10.15+, permissions are requested automatically
        // when you first attempt to capture the screen. There's no direct API to request
        // permission ahead of time without actually starting a capture session.
        // We return NotDetermined to indicate the app should attempt capture,
        // which will trigger the system permission dialog if needed.
        PermissionStatus::NotDetermined
    }

    /// Convert AVAuthorizationStatus to our PermissionStatus
    fn convert_av_authorization_status(status: i64) -> PermissionStatus {
        match status {
            0 => PermissionStatus::NotDetermined, // AVAuthorizationStatusNotDetermined
            1 => PermissionStatus::Restricted,     // AVAuthorizationStatusRestricted
            2 => PermissionStatus::Denied,         // AVAuthorizationStatusDenied
            3 => PermissionStatus::Granted,        // AVAuthorizationStatusAuthorized
            _ => PermissionStatus::NotDetermined,
        }
    }
}

impl PermissionHandler for PlatformPermissions {
    fn check_permission(permission_type: &PermissionType) -> PermissionResult {
        let status = match permission_type {
            PermissionType::Camera => Self::check_camera_permission(),
            PermissionType::Microphone => Self::check_microphone_permission(),
            PermissionType::Screen => Self::check_screen_permission(),
        };

        PermissionResult::new(permission_type.clone(), status)
    }

    fn request_permission(permission_type: &PermissionType) -> PermissionResult {
        let status = match permission_type {
            PermissionType::Camera => Self::request_camera_permission(),
            PermissionType::Microphone => Self::request_microphone_permission(),
            PermissionType::Screen => Self::request_screen_permission(),
        };

        PermissionResult::new(permission_type.clone(), status)
    }
}
