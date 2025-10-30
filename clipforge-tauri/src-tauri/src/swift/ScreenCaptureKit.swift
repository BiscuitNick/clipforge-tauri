import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

// MARK: - ScreenCaptureKit Bridge Module
// This module provides Swift wrapper for ScreenCaptureKit APIs
// to be called from Rust via FFI

/// Availability check for ScreenCaptureKit (requires macOS 12.3+)
@available(macOS 12.3, *)
class ScreenCaptureKitBridge: NSObject {

    // MARK: - Properties

    /// The active screen capture stream
    private var stream: SCStream?

    /// Configuration for the capture stream
    private var streamConfiguration: SCStreamConfiguration?

    /// Content filter for screen/window selection
    private var contentFilter: SCContentFilter?

    /// Flag to track if capture is active
    private var isCapturing: Bool = false

    /// Callback queue for stream output
    private var outputQueue: DispatchQueue?

    // MARK: - Initialization

    override init() {
        super.init()
        print("[ScreenCaptureKit] Bridge module initialized")
    }

    deinit {
        print("[ScreenCaptureKit] Bridge module deallocated")
        stopCapture()
    }

    // MARK: - Configuration Methods

    /// Configures the stream settings for video capture
    /// - Parameters:
    ///   - width: Desired width in pixels
    ///   - height: Desired height in pixels
    ///   - frameRate: Desired frame rate (frames per second)
    ///   - captureAudio: Whether to capture audio
    func configureStream(width: Int, height: Int, frameRate: Int, captureAudio: Bool = false) {
        let config = SCStreamConfiguration()

        // Video configuration
        config.width = width
        config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(frameRate))

        // Queue depth - number of frames to buffer
        config.queueDepth = 5

        // Pixel format - use BGRA for easier processing
        config.pixelFormat = kCVPixelFormatType_32BGRA

        // Color space
        config.colorSpaceName = CGColorSpace.sRGB

        // Color matrix - BT.709 for HD content
        config.colorMatrix = kCVImageBufferYCbCrMatrix_ITU_R_709_2

        // Capture settings
        config.showsCursor = true
        config.scalesToFit = false
        config.capturesAudio = captureAudio

        // Background color (black with full alpha)
        config.backgroundColor = CGColor(red: 0, green: 0, blue: 0, alpha: 1.0)

        // Store configuration
        self.streamConfiguration = config

        print("[ScreenCaptureKit Config] ✅ Stream configured: \(width)x\(height) @ \(frameRate)fps, audio: \(captureAudio)")
    }

    /// Creates a content filter for capturing a specific display
    /// - Parameter displayID: The display ID to capture
    /// - Returns: True if successful, false otherwise
    func configureDisplayFilter(displayID: CGDirectDisplayID) async -> Bool {
        do {
            // Get shareable content
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

            // Find the display with matching ID
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                print("[ScreenCaptureKit Filter] ⚠️ Display not found: \(displayID)")
                return false
            }

            // Create filter for the display (no window exclusions)
            let filter = SCContentFilter(display: display, excludingWindows: [])
            self.contentFilter = filter

            print("[ScreenCaptureKit Filter] ✅ Display filter configured for display: \(displayID)")
            return true
        } catch {
            print("[ScreenCaptureKit Filter] ❌ Failed to configure display filter: \(error.localizedDescription)")
            return false
        }
    }

    /// Creates a content filter for capturing a specific window
    /// - Parameter windowID: The window ID to capture
    /// - Returns: True if successful, false otherwise
    func configureWindowFilter(windowID: CGWindowID) async -> Bool {
        do {
            // Get shareable content
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)

            // Find the window with matching ID
            guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
                print("[ScreenCaptureKit Filter] ⚠️ Window not found: \(windowID)")
                return false
            }

            // For window capture, we need the display that contains the window
            // Use the main display or detect which display contains the window
            guard let display = content.displays.first else {
                print("[ScreenCaptureKit Filter] ⚠️ No displays available")
                return false
            }

            // Create filter including only this window
            let filter = SCContentFilter(display: display, including: [window])
            self.contentFilter = filter

            print("[ScreenCaptureKit Filter] ✅ Window filter configured for window: \(windowID)")
            return true
        } catch {
            print("[ScreenCaptureKit Filter] ❌ Failed to configure window filter: \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Stream Control Methods

    /// Starts the screen capture stream
    /// - Returns: true if successful, false otherwise
    @objc func startCapture() -> Bool {
        print("[ScreenCaptureKit] 🚀 startCapture() called")

        // Verify configuration exists
        guard let config = streamConfiguration else {
            print("[ScreenCaptureKit] ❌ Cannot start: stream configuration not set")
            return false
        }

        guard let filter = contentFilter else {
            print("[ScreenCaptureKit] ❌ Cannot start: content filter not set")
            return false
        }

        // Check if already capturing
        if isCapturing {
            print("[ScreenCaptureKit] ⚠️ Already capturing, stopping existing stream first")
            stopCapture()
        }

        do {
            // Create output queue for frame callbacks
            outputQueue = DispatchQueue(label: "com.clipforge.screencapture.output", qos: .userInitiated)

            // Create the stream
            let newStream = SCStream(filter: filter, configuration: config, delegate: self)

            // Add stream output handler for receiving frames
            guard let queue = outputQueue else {
                print("[ScreenCaptureKit] ❌ Failed to create output queue")
                return false
            }

            try newStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)

            // If audio is enabled, add audio output handler
            if config.capturesAudio {
                try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
                print("[ScreenCaptureKit] ✅ Audio output handler added")
            }

            // Start the stream
            // Note: startCapture() is async in Swift, but we're wrapping it for synchronous FFI
            // In a real implementation, this should be handled asynchronously
            Task {
                do {
                    try await newStream.startCapture()
                    print("[ScreenCaptureKit] ✅ Stream started successfully")
                } catch {
                    print("[ScreenCaptureKit] ❌ Failed to start stream: \(error.localizedDescription)")
                    self.isCapturing = false
                    self.stream = nil
                }
            }

            // Store stream reference
            stream = newStream
            isCapturing = true

            print("[ScreenCaptureKit] ✅ startCapture() completed, stream initializing...")
            return true

        } catch {
            print("[ScreenCaptureKit] ❌ Failed to start capture: \(error.localizedDescription)")
            stream = nil
            isCapturing = false
            return false
        }
    }

    /// Stops the screen capture stream
    @objc func stopCapture() {
        print("[ScreenCaptureKit] 🛑 stopCapture() called")

        guard let activeStream = stream else {
            print("[ScreenCaptureKit] ⚠️ No active stream to stop")
            isCapturing = false
            return
        }

        // Stop capture asynchronously
        Task {
            do {
                try await activeStream.stopCapture()
                print("[ScreenCaptureKit] ✅ Stream stopped successfully")
            } catch {
                print("[ScreenCaptureKit] ⚠️ Error stopping stream: \(error.localizedDescription)")
            }
        }

        // Clean up references
        stream = nil
        isCapturing = false
        print("[ScreenCaptureKit] ✅ stopCapture() completed")
    }

    /// Pauses the screen capture stream
    /// Note: ScreenCaptureKit doesn't have a direct pause API, so we stop and restart
    @objc func pauseCapture() {
        print("[ScreenCaptureKit] ⏸️ pauseCapture() called")

        // For now, pause is equivalent to stop
        // To implement true pause/resume, we'd need to:
        // 1. Stop the stream but keep configuration
        // 2. Track pause state
        // 3. Resume by calling startCapture() again

        if isCapturing {
            stopCapture()
            print("[ScreenCaptureKit] ⏸️ Capture paused (stream stopped)")
        } else {
            print("[ScreenCaptureKit] ⚠️ Cannot pause: not currently capturing")
        }
    }
}

// MARK: - SCStreamDelegate Protocol Implementation

@available(macOS 12.3, *)
extension ScreenCaptureKitBridge: SCStreamDelegate {

    /// Called when the stream encounters an error and stops
    /// - Parameters:
    ///   - stream: The stream that stopped
    ///   - error: The error that caused the stream to stop
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("[ScreenCaptureKit Delegate] ⚠️ Stream stopped with error: \(error.localizedDescription)")

        // Update capture state
        isCapturing = false

        // Log detailed error information
        let nsError = error as NSError
        print("[ScreenCaptureKit Delegate] Error domain: \(nsError.domain)")
        print("[ScreenCaptureKit Delegate] Error code: \(nsError.code)")
        print("[ScreenCaptureKit Delegate] Error info: \(nsError.userInfo)")

        // TODO: In future subtask, call Rust callback to notify error state
    }
}

// MARK: - SCStreamOutput Protocol Implementation

@available(macOS 12.3, *)
extension ScreenCaptureKitBridge: SCStreamOutput {

    /// Called when the stream outputs a sample buffer
    /// This is the primary method for receiving video and audio frames
    /// - Parameters:
    ///   - stream: The stream that output the buffer
    ///   - sampleBuffer: The sample buffer containing frame data
    ///   - outputType: The type of output (screen or audio)
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        // Guard to ensure buffer is valid
        guard CMSampleBufferIsValid(sampleBuffer) else {
            print("[ScreenCaptureKit Output] ⚠️ Received invalid sample buffer")
            return
        }

        switch outputType {
        case .screen:
            handleVideoFrame(sampleBuffer)
        case .audio:
            handleAudioBuffer(sampleBuffer)
        @unknown default:
            print("[ScreenCaptureKit Output] ⚠️ Unknown output type: \(outputType)")
        }
    }

    // MARK: - Private Frame Handlers

    /// Handles video frame buffers
    /// - Parameter sampleBuffer: The sample buffer containing video frame data
    private func handleVideoFrame(_ sampleBuffer: CMSampleBuffer) {
        // Extract pixel buffer from sample buffer
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to get pixel buffer from sample")
            return
        }

        // Get presentation timestamp for frame timing
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timeSeconds = CMTimeGetSeconds(presentationTime)

        // Lock pixel buffer for reading
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
        }

        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)

        // Log frame info (we'll process this data in subtask 13.8)
        // For now, just verify we're receiving frames
        #if DEBUG
        // Only log occasionally to avoid spam
        if Int(timeSeconds * 1000) % 1000 < 33 {  // Log roughly every second at 30fps
            let formatString = fourCCToString(pixelFormat)
            print("[ScreenCaptureKit Output] 📹 Video frame: \(width)x\(height) format:\(formatString) time:\(String(format: "%.2f", timeSeconds))s")
        }
        #endif

        // TODO: In subtask 13.8, we'll extract pixel data and send to Rust callback
        // for preview generation and FFmpeg encoding
    }

    /// Handles audio buffers
    /// - Parameter sampleBuffer: The sample buffer containing audio data
    private func handleAudioBuffer(_ sampleBuffer: CMSampleBuffer) {
        // Get audio format description
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to get audio format description")
            return
        }

        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timeSeconds = CMTimeGetSeconds(presentationTime)

        #if DEBUG
        // Log audio info occasionally
        if Int(timeSeconds * 1000) % 1000 < 33 {
            if let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) {
                print("[ScreenCaptureKit Output] 🔊 Audio buffer: \(asbd.pointee.mSampleRate)Hz time:\(String(format: "%.2f", timeSeconds))s")
            }
        }
        #endif

        // TODO: Audio processing will be implemented in Task 20
    }

    // MARK: - Utility Functions

    /// Converts a FourCC code to a readable string
    /// - Parameter code: The FourCC code
    /// - Returns: String representation of the code
    private func fourCCToString(_ code: OSType) -> String {
        let bytes: [UInt8] = [
            UInt8((code >> 24) & 0xFF),
            UInt8((code >> 16) & 0xFF),
            UInt8((code >> 8) & 0xFF),
            UInt8(code & 0xFF)
        ]
        return String(bytes: bytes, encoding: .ascii) ?? "????"
    }
}

// MARK: - C-Compatible Bridge Functions
// These functions are exposed to Objective-C/C for FFI with Rust

/// Creates a new ScreenCaptureKit bridge instance
/// - Returns: Pointer to the bridge instance
@_cdecl("screen_capture_bridge_create")
public func screen_capture_bridge_create() -> UnsafeMutableRawPointer? {
    if #available(macOS 12.3, *) {
        let bridge = ScreenCaptureKitBridge()
        let pointer = Unmanaged.passRetained(bridge).toOpaque()
        print("[ScreenCaptureKit FFI] Bridge instance created at \(pointer)")
        return pointer
    } else {
        print("[ScreenCaptureKit FFI] ERROR: ScreenCaptureKit requires macOS 12.3 or later")
        return nil
    }
}

/// Destroys a ScreenCaptureKit bridge instance
/// - Parameter bridge: Pointer to the bridge instance
@_cdecl("screen_capture_bridge_destroy")
public func screen_capture_bridge_destroy(_ bridge: UnsafeMutableRawPointer?) {
    guard let bridge = bridge else {
        print("[ScreenCaptureKit FFI] WARNING: Attempted to destroy null bridge")
        return
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge)
        print("[ScreenCaptureKit FFI] Destroying bridge instance at \(bridge)")
        bridgeInstance.release()
    }
}

/// Starts capture on a bridge instance
/// - Parameter bridge: Pointer to the bridge instance
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_bridge_start")
public func screen_capture_bridge_start(_ bridge: UnsafeMutableRawPointer?) -> Int32 {
    guard let bridge = bridge else {
        print("[ScreenCaptureKit FFI] ERROR: Cannot start capture - null bridge")
        return 0
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()
        let success = bridgeInstance.startCapture()
        return success ? 1 : 0
    }
    return 0
}

/// Stops capture on a bridge instance
/// - Parameter bridge: Pointer to the bridge instance
@_cdecl("screen_capture_bridge_stop")
public func screen_capture_bridge_stop(_ bridge: UnsafeMutableRawPointer?) {
    guard let bridge = bridge else {
        print("[ScreenCaptureKit FFI] WARNING: Cannot stop capture - null bridge")
        return
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()
        bridgeInstance.stopCapture()
    }
}

/// Pauses capture on a bridge instance
/// - Parameter bridge: Pointer to the bridge instance
@_cdecl("screen_capture_bridge_pause")
public func screen_capture_bridge_pause(_ bridge: UnsafeMutableRawPointer?) {
    guard let bridge = bridge else {
        print("[ScreenCaptureKit FFI] WARNING: Cannot pause capture - null bridge")
        return
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()
        bridgeInstance.pauseCapture()
    }
}

// MARK: - Version Check Helper

/// Checks if ScreenCaptureKit is available on this system
/// - Returns: 1 if available, 0 otherwise
@_cdecl("screen_capture_is_available")
public func screen_capture_is_available() -> Int32 {
    if #available(macOS 12.3, *) {
        print("[ScreenCaptureKit FFI] ScreenCaptureKit is available")
        return 1
    } else {
        print("[ScreenCaptureKit FFI] ScreenCaptureKit is NOT available (requires macOS 12.3+)")
        return 0
    }
}
