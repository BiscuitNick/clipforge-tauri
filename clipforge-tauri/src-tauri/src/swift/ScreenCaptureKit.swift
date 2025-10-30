import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia
import Accelerate

// MARK: - ScreenCaptureKit Bridge Module
// This module provides Swift wrapper for ScreenCaptureKit APIs
// to be called from Rust via FFI

// MARK: - Frame Data Structures

/// Represents a processed frame ready for preview or encoding
@available(macOS 12.3, *)
struct ProcessedFrame {
    /// JPEG compressed frame data
    let jpegData: Data
    /// Frame width in pixels
    let width: Int
    /// Frame height in pixels
    let height: Int
    /// Presentation timestamp in seconds
    let timestamp: Double
    /// Frame number for debugging
    let frameNumber: UInt64
}

/// Represents a processed audio buffer ready for encoding
@available(macOS 12.3, *)
struct ProcessedAudioBuffer {
    /// Raw PCM audio data (s16le format: signed 16-bit little-endian)
    let pcmData: Data
    /// Sample rate in Hz (e.g., 48000)
    let sampleRate: Double
    /// Number of channels (1=mono, 2=stereo)
    let channels: Int
    /// Presentation timestamp in seconds
    let timestamp: Double
    /// Number of frames in this buffer
    let frameCount: Int
}

// MARK: - Content Cache

/// Cache for SCShareableContent to avoid redundant async calls
@available(macOS 12.3, *)
class ContentCache {
    static let shared = ContentCache()

    private var cachedContent: SCShareableContent?
    private var cacheTimestamp: Date?
    private let cacheTTL: TimeInterval = 1.0 // 1 second TTL
    private let lock = NSLock()

    private init() {}

    /// Gets cached content if valid, otherwise fetches fresh content
    func getContent(excludeDesktopWindows: Bool = false) async throws -> SCShareableContent {
        lock.lock()
        defer { lock.unlock() }

        // Check if cache is valid
        if let cached = cachedContent,
           let timestamp = cacheTimestamp,
           Date().timeIntervalSince(timestamp) < cacheTTL {
            print("[ContentCache] Using cached content (age: \(String(format: "%.2f", Date().timeIntervalSince(timestamp)))s)")
            return cached
        }

        // Cache miss or expired, fetch fresh content
        print("[ContentCache] Fetching fresh content...")
        let content = try await SCShareableContent.excludingDesktopWindows(excludeDesktopWindows, onScreenWindowsOnly: true)

        cachedContent = content
        cacheTimestamp = Date()

        print("[ContentCache] Cached \(content.displays.count) displays, \(content.windows.count) windows")
        return content
    }

    /// Invalidates the cache
    func invalidate() {
        lock.lock()
        defer { lock.unlock() }

        cachedContent = nil
        cacheTimestamp = nil
        print("[ContentCache] Cache invalidated")
    }
}

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

    /// Frame counter for throttling preview frames
    private var frameCounter: UInt64 = 0

    /// Frame throttle divisor (capture_fps / preview_fps)
    /// Default: 60fps / 15fps = 4 (process every 4th frame)
    private var frameThrottleDivisor: UInt64 = 4

    /// JPEG compression quality (0.0 to 1.0)
    /// Default: 0.5 (50% quality, balance between size and quality)
    private var jpegQuality: CGFloat = 0.5

    /// Frame queue for buffering processed frames
    private var frameQueue: [ProcessedFrame] = []

    /// Maximum frame queue size (default: 5 frames)
    private var maxFrameQueueSize: Int = 5

    /// Lock for thread-safe queue access
    private let queueLock = NSLock()

    /// Audio buffer queue for buffering processed audio
    private var audioQueue: [ProcessedAudioBuffer] = []

    /// Maximum audio queue size (default: 10 buffers)
    private var maxAudioQueueSize: Int = 10

    /// Lock for thread-safe audio queue access
    private let audioQueueLock = NSLock()

    /// Audio sample counter for debugging
    private var audioBufferCounter: UInt64 = 0

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

    /// Configures the frame throttling for preview
    /// - Parameters:
    ///   - captureFrameRate: Capture frame rate (e.g., 60fps)
    ///   - previewFrameRate: Desired preview frame rate (e.g., 15fps)
    func configureFrameThrottling(captureFrameRate: Int, previewFrameRate: Int) {
        guard previewFrameRate > 0 && captureFrameRate >= previewFrameRate else {
            print("[ScreenCaptureKit Config] ⚠️ Invalid frame rates: capture=\(captureFrameRate), preview=\(previewFrameRate)")
            return
        }

        frameThrottleDivisor = UInt64(captureFrameRate / previewFrameRate)
        print("[ScreenCaptureKit Config] ✅ Frame throttling configured: \(captureFrameRate)fps -> \(previewFrameRate)fps (divisor: \(frameThrottleDivisor))")
    }

    /// Configures JPEG compression quality for preview frames
    /// - Parameter quality: Quality value from 0.3 to 0.8 (30% to 80%)
    func configureJPEGQuality(quality: CGFloat) {
        let clampedQuality = max(0.3, min(0.8, quality))
        jpegQuality = clampedQuality
        print("[ScreenCaptureKit Config] ✅ JPEG quality configured: \(Int(clampedQuality * 100))%")
    }

    /// Configures the maximum frame queue size
    /// - Parameter size: Maximum number of frames to buffer (1-20)
    func configureFrameQueueSize(size: Int) {
        let clampedSize = max(1, min(20, size))
        queueLock.lock()
        defer { queueLock.unlock() }

        maxFrameQueueSize = clampedSize
        print("[ScreenCaptureKit Config] ✅ Frame queue size configured: \(clampedSize) frames")
    }

    // MARK: - Frame Queue Methods

    /// Enqueues a processed frame with overflow handling
    /// - Parameter frame: The processed frame to enqueue
    private func enqueueFrame(_ frame: ProcessedFrame) {
        queueLock.lock()
        defer { queueLock.unlock() }

        // Check if queue is full
        if frameQueue.count >= maxFrameQueueSize {
            // Drop oldest frame (first in array)
            let droppedFrame = frameQueue.removeFirst()
            #if DEBUG
            print("[ScreenCaptureKit Queue] ⚠️ Queue full, dropped frame #\(droppedFrame.frameNumber) (ts: \(String(format: "%.2f", droppedFrame.timestamp))s)")
            #endif
        }

        // Add new frame to end of queue
        frameQueue.append(frame)

        #if DEBUG
        if frame.frameNumber % 15 == 0 {  // Log occasionally
            print("[ScreenCaptureKit Queue] 📦 Enqueued frame #\(frame.frameNumber), queue size: \(frameQueue.count)/\(maxFrameQueueSize)")
        }
        #endif
    }

    /// Dequeues the oldest frame from the queue
    /// - Returns: The oldest frame, or nil if queue is empty
    func dequeueFrame() -> ProcessedFrame? {
        queueLock.lock()
        defer { queueLock.unlock() }

        guard !frameQueue.isEmpty else {
            return nil
        }

        return frameQueue.removeFirst()
    }

    /// Gets the current queue size
    /// - Returns: Number of frames in the queue
    func getQueueSize() -> Int {
        queueLock.lock()
        defer { queueLock.unlock() }

        return frameQueue.count
    }

    /// Clears all frames from the queue
    func clearQueue() {
        queueLock.lock()
        defer { queueLock.unlock() }

        let clearedCount = frameQueue.count
        frameQueue.removeAll()

        if clearedCount > 0 {
            print("[ScreenCaptureKit Queue] 🗑️ Cleared \(clearedCount) frames from queue")
        }
    }

    // MARK: - Audio Queue Methods

    /// Enqueues a processed audio buffer with overflow handling
    /// - Parameter buffer: The processed audio buffer to enqueue
    private func enqueueAudioBuffer(_ buffer: ProcessedAudioBuffer) {
        audioQueueLock.lock()
        defer { audioQueueLock.unlock() }

        // Check if queue is full
        if audioQueue.count >= maxAudioQueueSize {
            // Drop oldest buffer
            let droppedBuffer = audioQueue.removeFirst()
            #if DEBUG
            print("[ScreenCaptureKit Audio] ⚠️ Audio queue full, dropped buffer (ts: \(String(format: "%.2f", droppedBuffer.timestamp))s)")
            #endif
        }

        // Add new buffer to end of queue
        audioQueue.append(buffer)

        #if DEBUG
        if audioBufferCounter % 30 == 0 {  // Log occasionally
            print("[ScreenCaptureKit Audio] 🔊 Enqueued audio buffer, queue size: \(audioQueue.count)/\(maxAudioQueueSize)")
        }
        #endif
    }

    /// Dequeues the oldest audio buffer from the queue
    /// - Returns: The oldest audio buffer, or nil if queue is empty
    func dequeueAudioBuffer() -> ProcessedAudioBuffer? {
        audioQueueLock.lock()
        defer { audioQueueLock.unlock() }

        guard !audioQueue.isEmpty else {
            return nil
        }

        return audioQueue.removeFirst()
    }

    /// Gets the current audio queue size
    /// - Returns: Number of audio buffers in the queue
    func getAudioQueueSize() -> Int {
        audioQueueLock.lock()
        defer { audioQueueLock.unlock() }

        return audioQueue.count
    }

    /// Clears all audio buffers from the queue
    func clearAudioQueue() {
        audioQueueLock.lock()
        defer { audioQueueLock.unlock() }

        let clearedCount = audioQueue.count
        audioQueue.removeAll()

        if clearedCount > 0 {
            print("[ScreenCaptureKit Audio] 🗑️ Cleared \(clearedCount) audio buffers from queue")
        }
    }

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

        // Background color (black with full alpha) - store in variable for strong reference
        let bgColor = CGColor(red: 0, green: 0, blue: 0, alpha: 1.0)
        config.backgroundColor = bgColor

        // Store configuration
        self.streamConfiguration = config

        print("[ScreenCaptureKit Config] ✅ Stream configured: \(width)x\(height) @ \(frameRate)fps, audio: \(captureAudio)")
    }

    /// Creates a content filter for capturing a specific display
    /// - Parameter displayID: The display ID to capture
    /// - Returns: True if successful, false otherwise
    func configureDisplayFilter(displayID: CGDirectDisplayID) async -> Bool {
        do {
            // Get shareable content (cached)
            let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

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
            // Get shareable content (cached)
            let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

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
            // Reset frame counter for clean start
            frameCounter = 0

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

        // Clear the frame queue
        clearQueue()

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

    /// Compresses RGB pixel data to JPEG format
    /// - Parameters:
    ///   - rgbData: RGB pixel data
    ///   - width: Frame width in pixels
    ///   - height: Frame height in pixels
    /// - Returns: JPEG compressed data, or nil if compression fails
    private func compressRGBtoJPEG(rgbData: Data, width: Int, height: Int) -> Data? {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue)

        // RGB is 3 bytes per pixel
        let bytesPerRow = width * 3

        // Create a data provider from RGB data
        guard let dataProvider = CGDataProvider(data: rgbData as CFData) else {
            print("[ScreenCaptureKit Compression] ⚠️ Failed to create data provider")
            return nil
        }

        // Create CGImage from RGB data
        guard let cgImage = CGImage(
            width: width,
            height: height,
            bitsPerComponent: 8,
            bitsPerPixel: 24,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: bitmapInfo,
            provider: dataProvider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ) else {
            print("[ScreenCaptureKit Compression] ⚠️ Failed to create CGImage")
            return nil
        }

        // Compress to JPEG using ImageIO
        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(mutableData, kUTTypeJPEG, 1, nil) else {
            print("[ScreenCaptureKit Compression] ⚠️ Failed to create image destination")
            return nil
        }

        // Set JPEG compression quality
        let options: [CFString: Any] = [
            kCGImageDestinationLossyCompressionQuality: jpegQuality
        ]

        CGImageDestinationAddImage(destination, cgImage, options as CFDictionary)

        guard CGImageDestinationFinalize(destination) else {
            print("[ScreenCaptureKit Compression] ⚠️ Failed to finalize JPEG compression")
            return nil
        }

        return mutableData as Data
    }

    /// Converts BGRA pixel data to RGB format using Accelerate framework
    /// - Parameters:
    ///   - bgraData: Pointer to BGRA pixel data
    ///   - width: Frame width in pixels
    ///   - height: Frame height in pixels
    ///   - bytesPerRow: Bytes per row (stride)
    /// - Returns: RGB pixel data as Data, or nil if conversion fails
    private func convertBGRAtoRGB(bgraData: UnsafeMutableRawPointer, width: Int, height: Int, bytesPerRow: Int) -> Data? {
        // BGRA is 4 bytes per pixel, RGB is 3 bytes per pixel
        let rgbBytesPerRow = width * 3
        let rgbDataSize = rgbBytesPerRow * height

        // Allocate buffer for RGB data
        guard let rgbData = malloc(rgbDataSize) else {
            print("[ScreenCaptureKit Conversion] ⚠️ Failed to allocate RGB buffer")
            return nil
        }
        defer {
            free(rgbData)
        }

        // Create vImage buffers for source (BGRA) and destination (RGB)
        var srcBuffer = vImage_Buffer(
            data: bgraData,
            height: vImagePixelCount(height),
            width: vImagePixelCount(width),
            rowBytes: bytesPerRow
        )

        var destBuffer = vImage_Buffer(
            data: rgbData,
            height: vImagePixelCount(height),
            width: vImagePixelCount(width),
            rowBytes: rgbBytesPerRow
        )

        // Perform BGRA to RGB conversion
        // vImageConvert_BGRA8888toRGB888 drops the alpha channel and reorders BGR to RGB
        let error = vImageConvert_BGRA8888toRGB888(&srcBuffer, &destBuffer, UInt32(kvImageNoFlags))

        if error != kvImageNoError {
            print("[ScreenCaptureKit Conversion] ⚠️ vImage conversion failed with error: \(error)")
            return nil
        }

        // Copy RGB data to a Data object
        return Data(bytes: rgbData, count: rgbDataSize)
    }

    /// Handles video frame buffers
    /// - Parameter sampleBuffer: The sample buffer containing video frame data
    private func handleVideoFrame(_ sampleBuffer: CMSampleBuffer) {
        // Increment frame counter
        frameCounter += 1

        // Apply frame throttling for preview (reduce from capture rate to preview rate)
        // Only process every Nth frame based on throttle divisor
        let shouldProcessFrame = (frameCounter % frameThrottleDivisor) == 0

        // Extract pixel buffer from sample buffer
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to get pixel buffer from sample")
            return
        }

        // Get presentation timestamp for frame timing
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timeSeconds = CMTimeGetSeconds(presentationTime)

        // Skip this frame if throttling is active and it's not time to process
        if !shouldProcessFrame {
            return
        }

        // Lock pixel buffer for reading
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly)
        }

        // Get frame dimensions
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)

        // Extract pixel data from the pixel buffer
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to get pixel buffer base address")
            return
        }

        // Get bytes per row (stride) - important for proper data alignment
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)

        // Calculate total buffer size
        let dataSize = bytesPerRow * height

        // Get the plane count (planar vs packed formats)
        let planeCount = CVPixelBufferGetPlaneCount(pixelBuffer)

        // Convert BGRA to RGB using Accelerate framework
        guard let rgbData = convertBGRAtoRGB(bgraData: baseAddress, width: width, height: height, bytesPerRow: bytesPerRow) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to convert BGRA to RGB")
            return
        }

        // Compress RGB to JPEG for efficient preview transmission
        guard let jpegData = compressRGBtoJPEG(rgbData: rgbData, width: width, height: height) else {
            print("[ScreenCaptureKit Output] ⚠️ Failed to compress RGB to JPEG")
            return
        }

        // Create processed frame with metadata
        let processedFrame = ProcessedFrame(
            jpegData: jpegData,
            width: width,
            height: height,
            timestamp: timeSeconds,
            frameNumber: frameCounter
        )

        // Enqueue the processed frame
        enqueueFrame(processedFrame)

        #if DEBUG
        // Only log occasionally to avoid spam
        if Int(timeSeconds * 1000) % 1000 < 33 {  // Log roughly every second at 30fps
            let formatString = fourCCToString(pixelFormat)
            let compressionRatio = Double(rgbData.count) / Double(jpegData.count)
            print("[ScreenCaptureKit Output] 📹 Video frame: \(width)x\(height) format:\(formatString)->RGB->JPEG time:\(String(format: "%.2f", timeSeconds))s rgbSize:\(rgbData.count) jpegSize:\(jpegData.count) ratio:\(String(format: "%.1f", compressionRatio))x")
        }
        #endif

        // Successfully processed and queued frame:
        // - Frame is now in the queue ready for retrieval via dequeueFrame()
        // - Contains JPEG data, dimensions, timestamp, and frame number
        // TODO: Expose dequeueFrame() via FFI for Rust to consume frames
    }

    /// Handles audio buffers
    /// - Parameter sampleBuffer: The sample buffer containing audio data
    private func handleAudioBuffer(_ sampleBuffer: CMSampleBuffer) {
        // Increment audio buffer counter
        audioBufferCounter += 1

        // Get audio format description
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
            print("[ScreenCaptureKit Audio] ⚠️ Failed to get audio format description")
            return
        }

        // Get presentation timestamp for A/V sync
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let timeSeconds = CMTimeGetSeconds(presentationTime)

        // Get audio format
        guard let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            print("[ScreenCaptureKit Audio] ⚠️ Failed to get audio stream description")
            return
        }

        let sampleRate = asbd.pointee.mSampleRate
        let channels = Int(asbd.pointee.mChannelsPerFrame)
        let format = asbd.pointee.mFormatID

        #if DEBUG
        // Log audio info occasionally
        if audioBufferCounter % 30 == 0 {
            let formatStr = fourCCToString(format)
            print("[ScreenCaptureKit Audio] 🔊 Audio buffer #\(audioBufferCounter): \(sampleRate)Hz, \(channels)ch, format:\(formatStr), time:\(String(format: "%.2f", timeSeconds))s")
        }
        #endif

        // Extract audio block buffer
        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            print("[ScreenCaptureKit Audio] ⚠️ Failed to get audio data buffer")
            return
        }

        // Get the number of samples (frames) in this buffer
        let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)

        // Get audio data pointer and length
        var lengthAtOffset: Int = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let status = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: &lengthAtOffset,
            totalLengthOut: nil,
            dataPointerOut: &dataPointer
        )

        guard status == noErr, let audioData = dataPointer else {
            print("[ScreenCaptureKit Audio] ⚠️ Failed to get audio data pointer (status: \(status))")
            return
        }

        // Convert audio to PCM s16le format for FFmpeg
        guard let pcmData = convertAudioToPCM(
            sourceData: audioData,
            dataLength: lengthAtOffset,
            sourceFormat: asbd.pointee,
            numSamples: numSamples
        ) else {
            print("[ScreenCaptureKit Audio] ⚠️ Failed to convert audio to PCM")
            return
        }

        // Create processed audio buffer with metadata
        let processedBuffer = ProcessedAudioBuffer(
            pcmData: pcmData,
            sampleRate: sampleRate,
            channels: channels,
            timestamp: timeSeconds,
            frameCount: numSamples
        )

        // Enqueue the processed audio buffer
        enqueueAudioBuffer(processedBuffer)

        #if DEBUG
        if audioBufferCounter % 30 == 0 {
            print("[ScreenCaptureKit Audio] ✅ Processed audio buffer: \(pcmData.count) bytes, \(numSamples) samples")
        }
        #endif
    }

    /// Converts audio data to PCM s16le format (signed 16-bit little-endian)
    /// - Parameters:
    ///   - sourceData: Pointer to source audio data
    ///   - dataLength: Length of source data in bytes
    ///   - sourceFormat: Source audio format description
    ///   - numSamples: Number of audio samples (frames)
    /// - Returns: PCM data, or nil if conversion fails
    private func convertAudioToPCM(
        sourceData: UnsafeMutablePointer<Int8>,
        dataLength: Int,
        sourceFormat: AudioStreamBasicDescription,
        numSamples: Int
    ) -> Data? {
        // ScreenCaptureKit typically provides Float32 PCM audio
        // We need to convert it to Int16 PCM (s16le) for FFmpeg

        let sourceBytesPerFrame = Int(sourceFormat.mBytesPerFrame)
        let sourceChannels = Int(sourceFormat.mChannelsPerFrame)
        let isFloat = sourceFormat.mFormatFlags & kAudioFormatFlagIsFloat != 0
        let isBigEndian = sourceFormat.mFormatFlags & kAudioFormatFlagIsBigEndian != 0

        // Calculate expected output size (2 bytes per sample per channel for s16le)
        let outputSize = numSamples * sourceChannels * 2

        var pcmData = Data(count: outputSize)

        if isFloat && sourceFormat.mBitsPerChannel == 32 {
            // Convert Float32 to Int16
            pcmData.withUnsafeMutableBytes { (outputPtr: UnsafeMutableRawBufferPointer) in
                let outputSamples = outputPtr.bindMemory(to: Int16.self)

                sourceData.withMemoryRebound(to: Float32.self, capacity: numSamples * sourceChannels) { floatPtr in
                    for i in 0..<(numSamples * sourceChannels) {
                        // Clamp float value to [-1.0, 1.0] range
                        let floatSample = max(-1.0, min(1.0, floatPtr[i]))
                        // Convert to Int16 range [-32768, 32767]
                        let intSample = Int16(floatSample * 32767.0)
                        outputSamples[i] = intSample
                    }
                }
            }
        } else if sourceFormat.mBitsPerChannel == 16 {
            // Already Int16, just copy (with potential endian conversion)
            sourceData.withMemoryRebound(to: Int16.self, capacity: numSamples * sourceChannels) { int16Ptr in
                pcmData.withUnsafeMutableBytes { (outputPtr: UnsafeMutableRawBufferPointer) in
                    let outputSamples = outputPtr.bindMemory(to: Int16.self)

                    for i in 0..<(numSamples * sourceChannels) {
                        var sample = int16Ptr[i]
                        // Convert big-endian to little-endian if needed
                        if isBigEndian {
                            sample = sample.byteSwapped
                        }
                        outputSamples[i] = sample
                    }
                }
            }
        } else {
            // Unsupported format
            print("[ScreenCaptureKit Audio] ⚠️ Unsupported audio format: \(sourceFormat.mBitsPerChannel) bits, float: \(isFloat)")
            return nil
        }

        return pcmData
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

// MARK: - Content Enumeration Structures

/// C-compatible display information structure
@available(macOS 12.3, *)
public struct CDisplayInfo {
    public var displayID: UInt32
    public var width: UInt32
    public var height: UInt32
    public var x: Int32
    public var y: Int32
    public var isPrimary: UInt8  // boolean as u8

    public init(displayID: UInt32, width: UInt32, height: UInt32, x: Int32, y: Int32, isPrimary: Bool) {
        self.displayID = displayID
        self.width = width
        self.height = height
        self.x = x
        self.y = y
        self.isPrimary = isPrimary ? 1 : 0
    }
}

/// C-compatible window information structure
@available(macOS 12.3, *)
public struct CWindowInfo {
    public var windowID: UInt32
    public var ownerPID: Int32
    public var width: UInt32
    public var height: UInt32
    public var x: Int32
    public var y: Int32
    public var layer: Int32
    public var isOnScreen: UInt8  // boolean as u8

    public init(windowID: UInt32, ownerPID: Int32, width: UInt32, height: UInt32, x: Int32, y: Int32, layer: Int32, isOnScreen: Bool) {
        self.windowID = windowID
        self.ownerPID = ownerPID
        self.width = width
        self.height = height
        self.x = x
        self.y = y
        self.layer = layer
        self.isOnScreen = isOnScreen ? 1 : 0
    }
}

// MARK: - Content Enumeration Functions

/// Enumerates available displays using SCShareableContent
/// - Parameters:
///   - outDisplays: Pointer to array that will be filled with display info
///   - outCount: Pointer to store the number of displays found
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_enumerate_displays")
public func screen_capture_enumerate_displays(
    _ outDisplays: UnsafeMutablePointer<UnsafeMutableRawPointer?>?,
    _ outCount: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let outDisplays = outDisplays, let outCount = outCount else {
        print("[ScreenCaptureKit FFI] ERROR: Null pointers provided for display enumeration")
        return 0
    }

    if #available(macOS 12.3, *) {
        // Use a semaphore to make async call synchronous for FFI
        let semaphore = DispatchSemaphore(value: 0)
        var displays: [CDisplayInfo] = []
        var success = false

        Task {
            do {
                // Get shareable content (cached)
                let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

                // Get main display for primary detection
                let mainDisplayID = CGMainDisplayID()

                // Map SCDisplay to CDisplayInfo
                displays = content.displays.map { display in
                    let isPrimary = display.displayID == mainDisplayID

                    // Get display bounds
                    let frame = display.frame

                    return CDisplayInfo(
                        displayID: display.displayID,
                        width: UInt32(display.width),
                        height: UInt32(display.height),
                        x: Int32(frame.origin.x),
                        y: Int32(frame.origin.y),
                        isPrimary: isPrimary
                    )
                }

                print("[ScreenCaptureKit Enum] Found \(displays.count) displays")
                success = true
            } catch {
                print("[ScreenCaptureKit Enum] ERROR: Failed to get shareable content: \(error.localizedDescription)")
                success = false
            }
            semaphore.signal()
        }

        // Wait for async operation to complete
        semaphore.wait()

        if success && !displays.isEmpty {
            // Allocate memory for display array
            let buffer = UnsafeMutablePointer<CDisplayInfo>.allocate(capacity: displays.count)
            for (index, display) in displays.enumerated() {
                buffer[index] = display
            }

            outDisplays.pointee = UnsafeMutableRawPointer(buffer)
            outCount.pointee = Int32(displays.count)
            return 1
        } else {
            outDisplays.pointee = nil
            outCount.pointee = 0
            return 0
        }
    } else {
        print("[ScreenCaptureKit FFI] ERROR: ScreenCaptureKit requires macOS 12.3 or later")
        outDisplays.pointee = nil
        outCount.pointee = 0
        return 0
    }
}

/// Enumerates available windows using SCShareableContent
/// - Parameters:
///   - outWindows: Pointer to array that will be filled with window info
///   - outCount: Pointer to store the number of windows found
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_enumerate_windows")
public func screen_capture_enumerate_windows(
    _ outWindows: UnsafeMutablePointer<UnsafeMutableRawPointer?>?,
    _ outCount: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let outWindows = outWindows, let outCount = outCount else {
        print("[ScreenCaptureKit FFI] ERROR: Null pointers provided for window enumeration")
        return 0
    }

    if #available(macOS 12.3, *) {
        // Use a semaphore to make async call synchronous for FFI
        let semaphore = DispatchSemaphore(value: 0)
        var windows: [CWindowInfo] = []
        var success = false

        Task {
            do {
                // Get shareable content (cached)
                let content = try await ContentCache.shared.getContent(excludeDesktopWindows: true)

                // Map SCWindow to CWindowInfo
                windows = content.windows.map { window in
                    let frame = window.frame

                    return CWindowInfo(
                        windowID: window.windowID,
                        ownerPID: Int32(window.owningApplication?.processID ?? -1),
                        width: UInt32(frame.width),
                        height: UInt32(frame.height),
                        x: Int32(frame.origin.x),
                        y: Int32(frame.origin.y),
                        layer: Int32(window.windowLayer),
                        isOnScreen: window.isOnScreen
                    )
                }

                print("[ScreenCaptureKit Enum] Found \(windows.count) windows")
                success = true
            } catch {
                print("[ScreenCaptureKit Enum] ERROR: Failed to get shareable content: \(error.localizedDescription)")
                success = false
            }
            semaphore.signal()
        }

        // Wait for async operation to complete
        semaphore.wait()

        if success && !windows.isEmpty {
            // Allocate memory for window array
            let buffer = UnsafeMutablePointer<CWindowInfo>.allocate(capacity: windows.count)
            for (index, window) in windows.enumerated() {
                buffer[index] = window
            }

            outWindows.pointee = UnsafeMutableRawPointer(buffer)
            outCount.pointee = Int32(windows.count)
            return 1
        } else {
            outWindows.pointee = nil
            outCount.pointee = 0
            return 0
        }
    } else {
        print("[ScreenCaptureKit FFI] ERROR: ScreenCaptureKit requires macOS 12.3 or later")
        outWindows.pointee = nil
        outCount.pointee = 0
        return 0
    }
}

/// Gets window title and owner name for a specific window ID
/// - Parameters:
///   - windowID: The window ID to query
///   - outTitle: Buffer to store window title (must be at least 256 bytes)
///   - outOwner: Buffer to store owner name (must be at least 256 bytes)
///   - bufferSize: Size of the buffers
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_get_window_metadata")
public func screen_capture_get_window_metadata(
    _ windowID: UInt32,
    _ outTitle: UnsafeMutablePointer<CChar>?,
    _ outOwner: UnsafeMutablePointer<CChar>?,
    _ bufferSize: Int32
) -> Int32 {
    guard let outTitle = outTitle, let outOwner = outOwner else {
        print("[ScreenCaptureKit FFI] ERROR: Null buffers provided")
        return 0
    }

    if #available(macOS 12.3, *) {
        let semaphore = DispatchSemaphore(value: 0)
        var title = ""
        var owner = ""
        var success = false

        Task {
            do {
                // Get shareable content (cached)
                let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

                if let window = content.windows.first(where: { $0.windowID == windowID }) {
                    title = window.title ?? ""
                    owner = window.owningApplication?.applicationName ?? ""
                    success = true
                    print("[ScreenCaptureKit Metadata] Window \(windowID): '\(title)' owned by '\(owner)'")
                }
            } catch {
                print("[ScreenCaptureKit Metadata] ERROR: \(error.localizedDescription)")
            }
            semaphore.signal()
        }

        semaphore.wait()

        if success {
            // Copy strings to output buffers
            let titleBytes = Array(title.utf8CString)
            let ownerBytes = Array(owner.utf8CString)

            let titleLen = min(titleBytes.count, Int(bufferSize))
            let ownerLen = min(ownerBytes.count, Int(bufferSize))

            titleBytes.prefix(titleLen).withUnsafeBufferPointer { ptr in
                outTitle.initialize(from: ptr.baseAddress!, count: titleLen)
            }
            ownerBytes.prefix(ownerLen).withUnsafeBufferPointer { ptr in
                outOwner.initialize(from: ptr.baseAddress!, count: ownerLen)
            }

            return 1
        }
    }

    return 0
}

/// Frees memory allocated by enumerate functions
/// - Parameter ptr: Pointer to free
@_cdecl("screen_capture_free_array")
public func screen_capture_free_array(_ ptr: UnsafeMutableRawPointer?) {
    guard let ptr = ptr else { return }
    ptr.deallocate()
}

/// Invalidates the SCShareableContent cache
/// Call this to force fresh enumeration on next request
@_cdecl("screen_capture_invalidate_cache")
public func screen_capture_invalidate_cache() {
    if #available(macOS 12.3, *) {
        ContentCache.shared.invalidate()
    }
}

// MARK: - Thumbnail Generation Functions

/// Captures a thumbnail of a display using SCScreenshotManager
/// - Parameters:
///   - displayID: The display ID to capture
///   - maxWidth: Maximum width for the thumbnail
///   - outData: Pointer to store the PNG data
///   - outLength: Pointer to store the PNG data length
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_display_thumbnail")
public func screen_capture_display_thumbnail(
    _ displayID: UInt32,
    _ maxWidth: Int32,
    _ outData: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outLength: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let outData = outData, let outLength = outLength else {
        print("[ScreenCaptureKit Thumbnail] ERROR: Null output pointers")
        return 0
    }

    if #available(macOS 12.3, *) {
        let semaphore = DispatchSemaphore(value: 0)
        var pngData: Data?
        var success = false

        Task {
            do {
                // Get shareable content (cached)
                let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

                // Find the display
                guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
                    print("[ScreenCaptureKit Thumbnail] Display \(displayID) not found")
                    semaphore.signal()
                    return
                }

                // Create content filter for the display
                let filter = SCContentFilter(display: display, excludingWindows: [])

                // Configure screenshot settings
                let config = SCStreamConfiguration()

                // Calculate thumbnail dimensions maintaining aspect ratio
                let aspectRatio = CGFloat(display.height) / CGFloat(display.width)
                let thumbWidth = min(Int(maxWidth), display.width)
                let thumbHeight = Int(CGFloat(thumbWidth) * aspectRatio)

                config.width = thumbWidth
                config.height = thumbHeight
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.showsCursor = false

                // Capture the screenshot
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

                // Convert CGImage to PNG data
                if let mutableData = CFDataCreateMutable(nil, 0),
                   let destination = CGImageDestinationCreateWithData(mutableData, "public.png" as CFString, 1, nil) {
                    CGImageDestinationAddImage(destination, image, nil)
                    if CGImageDestinationFinalize(destination) {
                        pngData = mutableData as Data
                        success = true
                        print("[ScreenCaptureKit Thumbnail] Captured display \(displayID) thumbnail: \(pngData?.count ?? 0) bytes")
                    }
                }
            } catch {
                print("[ScreenCaptureKit Thumbnail] ERROR: \(error.localizedDescription)")
            }
            semaphore.signal()
        }

        semaphore.wait()

        if success, let data = pngData {
            // Allocate buffer and copy data
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
            data.copyBytes(to: buffer, count: data.count)

            outData.pointee = buffer
            outLength.pointee = Int32(data.count)
            return 1
        }
    }

    outData.pointee = nil
    outLength.pointee = 0
    return 0
}

/// Captures a thumbnail of a window using SCScreenshotManager
/// - Parameters:
///   - windowID: The window ID to capture
///   - maxWidth: Maximum width for the thumbnail
///   - outData: Pointer to store the PNG data
///   - outLength: Pointer to store the PNG data length
/// - Returns: 1 if successful, 0 otherwise
@_cdecl("screen_capture_window_thumbnail")
public func screen_capture_window_thumbnail(
    _ windowID: UInt32,
    _ maxWidth: Int32,
    _ outData: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outLength: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let outData = outData, let outLength = outLength else {
        print("[ScreenCaptureKit Thumbnail] ERROR: Null output pointers")
        return 0
    }

    if #available(macOS 12.3, *) {
        let semaphore = DispatchSemaphore(value: 0)
        var pngData: Data?
        var success = false

        Task {
            do {
                // Get shareable content (cached)
                let content = try await ContentCache.shared.getContent(excludeDesktopWindows: false)

                // Find the window
                guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
                    print("[ScreenCaptureKit Thumbnail] Window \(windowID) not found")
                    semaphore.signal()
                    return
                }

                // Get a display for the filter (required by SCContentFilter)
                guard let display = content.displays.first else {
                    print("[ScreenCaptureKit Thumbnail] No displays available")
                    semaphore.signal()
                    return
                }

                // Create content filter including only this window
                let filter = SCContentFilter(display: display, including: [window])

                // Configure screenshot settings
                let config = SCStreamConfiguration()

                // Calculate thumbnail dimensions maintaining aspect ratio
                let windowWidth = Int(window.frame.width)
                let windowHeight = Int(window.frame.height)
                let aspectRatio = CGFloat(windowHeight) / CGFloat(windowWidth)
                let thumbWidth = min(Int(maxWidth), windowWidth)
                let thumbHeight = Int(CGFloat(thumbWidth) * aspectRatio)

                config.width = thumbWidth
                config.height = thumbHeight
                config.pixelFormat = kCVPixelFormatType_32BGRA
                config.showsCursor = false

                // Capture the screenshot
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)

                // Convert CGImage to PNG data
                if let mutableData = CFDataCreateMutable(nil, 0),
                   let destination = CGImageDestinationCreateWithData(mutableData, "public.png" as CFString, 1, nil) {
                    CGImageDestinationAddImage(destination, image, nil)
                    if CGImageDestinationFinalize(destination) {
                        pngData = mutableData as Data
                        success = true
                        print("[ScreenCaptureKit Thumbnail] Captured window \(windowID) thumbnail: \(pngData?.count ?? 0) bytes")
                    }
                }
            } catch {
                print("[ScreenCaptureKit Thumbnail] ERROR: \(error.localizedDescription)")
            }
            semaphore.signal()
        }

        semaphore.wait()

        if success, let data = pngData {
            // Allocate buffer and copy data
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: data.count)
            data.copyBytes(to: buffer, count: data.count)

            outData.pointee = buffer
            outLength.pointee = Int32(data.count)
            return 1
        }
    }

    outData.pointee = nil
    outLength.pointee = 0
    return 0
}


// MARK: - Audio FFI Functions

/// Dequeues an audio buffer from the bridge instance
/// - Parameters:
///   - bridge: Pointer to the bridge instance
///   - outData: Pointer to store PCM data pointer
///   - outLength: Pointer to store data length
///   - outSampleRate: Pointer to store sample rate
///   - outChannels: Pointer to store channel count
///   - outTimestamp: Pointer to store timestamp
///   - outFrameCount: Pointer to store frame count
/// - Returns: 1 if buffer retrieved, 0 if queue is empty
@_cdecl("screen_capture_bridge_dequeue_audio")
public func screen_capture_bridge_dequeue_audio(
    _ bridge: UnsafeMutableRawPointer?,
    _ outData: UnsafeMutablePointer<UnsafeMutablePointer<UInt8>?>?,
    _ outLength: UnsafeMutablePointer<Int32>?,
    _ outSampleRate: UnsafeMutablePointer<Double>?,
    _ outChannels: UnsafeMutablePointer<Int32>?,
    _ outTimestamp: UnsafeMutablePointer<Double>?,
    _ outFrameCount: UnsafeMutablePointer<Int32>?
) -> Int32 {
    guard let bridge = bridge,
          let outData = outData,
          let outLength = outLength,
          let outSampleRate = outSampleRate,
          let outChannels = outChannels,
          let outTimestamp = outTimestamp,
          let outFrameCount = outFrameCount else {
        print("[ScreenCaptureKit FFI] ERROR: Null pointers provided for audio dequeue")
        return 0
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()

        guard let audioBuffer = bridgeInstance.dequeueAudioBuffer() else {
            // Queue is empty
            return 0
        }

        // Allocate memory for PCM data
        let dataPtr = UnsafeMutablePointer<UInt8>.allocate(capacity: audioBuffer.pcmData.count)
        audioBuffer.pcmData.copyBytes(to: dataPtr, count: audioBuffer.pcmData.count)

        // Set output parameters
        outData.pointee = dataPtr
        outLength.pointee = Int32(audioBuffer.pcmData.count)
        outSampleRate.pointee = audioBuffer.sampleRate
        outChannels.pointee = Int32(audioBuffer.channels)
        outTimestamp.pointee = audioBuffer.timestamp
        outFrameCount.pointee = Int32(audioBuffer.frameCount)

        return 1
    }

    return 0
}

/// Gets the current audio queue size
/// - Parameter bridge: Pointer to the bridge instance
/// - Returns: Number of audio buffers in the queue, or -1 on error
@_cdecl("screen_capture_bridge_get_audio_queue_size")
public func screen_capture_bridge_get_audio_queue_size(_ bridge: UnsafeMutableRawPointer?) -> Int32 {
    guard let bridge = bridge else {
        return -1
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()
        return Int32(bridgeInstance.getAudioQueueSize())
    }

    return -1
}

/// Clears the audio queue
/// - Parameter bridge: Pointer to the bridge instance
@_cdecl("screen_capture_bridge_clear_audio_queue")
public func screen_capture_bridge_clear_audio_queue(_ bridge: UnsafeMutableRawPointer?) {
    guard let bridge = bridge else {
        return
    }

    if #available(macOS 12.3, *) {
        let bridgeInstance = Unmanaged<ScreenCaptureKitBridge>.fromOpaque(bridge).takeUnretainedValue()
        bridgeInstance.clearAudioQueue()
    }
}

/// Frees memory allocated for audio buffer PCM data
/// - Parameter pcmData: Pointer to PCM data to free
@_cdecl("screen_capture_free_audio_data")
public func screen_capture_free_audio_data(_ pcmData: UnsafeMutablePointer<UInt8>?) {
    guard let pcmData = pcmData else { return }
    pcmData.deallocate()
}

