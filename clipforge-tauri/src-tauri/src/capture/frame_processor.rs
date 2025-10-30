// Frame processing module for preview and encoding pipelines
//
// This module provides a trait-based architecture for processing captured frames
// with separate implementations for preview (sending to frontend) and encoding
// (sending to FFmpeg)

use std::sync::Arc;
use base64::Engine;

/// Represents a processed frame with JPEG-compressed data and metadata
#[derive(Debug, Clone)]
pub struct ProcessedFrame {
    /// JPEG compressed frame data
    pub jpeg_data: Vec<u8>,
    /// Frame width in pixels
    pub width: usize,
    /// Frame height in pixels
    pub height: usize,
    /// Presentation timestamp in seconds
    pub timestamp: f64,
    /// Frame number for tracking
    pub frame_number: u64,
}

/// Trait for frame processing implementations
///
/// Different implementations handle frames for different purposes:
/// - PreviewFrameProcessor: Converts frames for frontend display
/// - EncodingFrameProcessor: Prepares frames for FFmpeg encoding
pub trait FrameProcessor: Send + Sync {
    /// Processes a single frame
    ///
    /// # Parameters
    /// - `frame`: The processed frame to handle
    ///
    /// # Returns
    /// - `Ok(())` if processing succeeded
    /// - `Err(String)` with error message if processing failed
    fn process_frame(&mut self, frame: &ProcessedFrame) -> Result<(), String>;

    /// Flushes any buffered data
    ///
    /// Called when stopping capture to ensure all data is written
    fn flush(&mut self) -> Result<(), String>;

    /// Gets the processor type name for logging
    fn processor_type(&self) -> &str;
}

/// Frame processor for preview display
///
/// Converts JPEG frames to base64 for efficient frontend transmission
pub struct PreviewFrameProcessor {
    /// Callback for sending frame to frontend
    frame_callback: Option<Arc<dyn Fn(String) + Send + Sync>>,
    /// Counter for processed frames
    processed_count: u64,
}

impl PreviewFrameProcessor {
    /// Creates a new preview frame processor
    pub fn new() -> Self {
        Self {
            frame_callback: None,
            processed_count: 0,
        }
    }

    /// Sets the callback function for sending frames to the frontend
    ///
    /// # Parameters
    /// - `callback`: Function that receives base64-encoded JPEG data
    pub fn set_callback<F>(&mut self, callback: F)
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        self.frame_callback = Some(Arc::new(callback));
    }

    /// Converts JPEG data to base64 for frontend transmission
    fn encode_for_frontend(&self, jpeg_data: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(jpeg_data)
    }
}

impl FrameProcessor for PreviewFrameProcessor {
    fn process_frame(&mut self, frame: &ProcessedFrame) -> Result<(), String> {
        // Encode JPEG data to base64
        let base64_data = self.encode_for_frontend(&frame.jpeg_data);

        // Call frontend callback if set
        if let Some(callback) = &self.frame_callback {
            callback(base64_data);
            self.processed_count += 1;

            // Log occasionally to avoid spam
            if self.processed_count % 30 == 0 {
                println!(
                    "[PreviewProcessor] Processed {} frames, latest: {}x{} @ {:.2}s",
                    self.processed_count, frame.width, frame.height, frame.timestamp
                );
            }

            Ok(())
        } else {
            Err("No callback set for preview processor".to_string())
        }
    }

    fn flush(&mut self) -> Result<(), String> {
        println!(
            "[PreviewProcessor] Flushed - total frames processed: {}",
            self.processed_count
        );
        Ok(())
    }

    fn processor_type(&self) -> &str {
        "Preview"
    }
}

impl Default for PreviewFrameProcessor {
    fn default() -> Self {
        Self::new()
    }
}

/// Frame processor for video encoding
///
/// Prepares frames for FFmpeg encoding pipeline
pub struct EncodingFrameProcessor {
    /// Path to the output video file
    output_path: String,
    /// Counter for processed frames
    processed_count: u64,
    /// Flag indicating if encoder is initialized
    encoder_initialized: bool,
}

impl EncodingFrameProcessor {
    /// Creates a new encoding frame processor
    ///
    /// # Parameters
    /// - `output_path`: Path where the video will be saved
    pub fn new(output_path: String) -> Self {
        Self {
            output_path,
            processed_count: 0,
            encoder_initialized: false,
        }
    }

    /// Initializes the encoding pipeline
    ///
    /// This would typically set up FFmpeg or another encoder
    fn initialize_encoder(&mut self) -> Result<(), String> {
        println!(
            "[EncodingProcessor] Initializing encoder for output: {}",
            self.output_path
        );

        // TODO: Initialize FFmpeg encoder with frame dimensions and settings
        // This will be implemented when integrating with the actual encoding pipeline

        self.encoder_initialized = true;
        Ok(())
    }

    /// Sends frame data to the encoding pipeline
    ///
    /// In a full implementation, this would decode JPEG and send raw frames to FFmpeg
    fn send_to_encoder(&mut self, frame: &ProcessedFrame) -> Result<(), String> {
        if !self.encoder_initialized {
            self.initialize_encoder()?;
        }

        // TODO: Decode JPEG to raw RGB/YUV and send to FFmpeg
        // For now, just count frames

        self.processed_count += 1;

        // Log occasionally
        if self.processed_count % 30 == 0 {
            println!(
                "[EncodingProcessor] Encoded {} frames, latest: {}x{} @ {:.2}s",
                self.processed_count, frame.width, frame.height, frame.timestamp
            );
        }

        Ok(())
    }
}

impl FrameProcessor for EncodingFrameProcessor {
    fn process_frame(&mut self, frame: &ProcessedFrame) -> Result<(), String> {
        self.send_to_encoder(frame)
    }

    fn flush(&mut self) -> Result<(), String> {
        println!(
            "[EncodingProcessor] Flushing encoder - total frames: {}",
            self.processed_count
        );

        // TODO: Finalize FFmpeg encoding and close output file

        Ok(())
    }

    fn processor_type(&self) -> &str {
        "Encoding"
    }
}

/// Multi-processor that can send frames to multiple processors
///
/// Useful for simultaneously generating preview and encoding
pub struct MultiFrameProcessor {
    processors: Vec<Box<dyn FrameProcessor>>,
}

impl MultiFrameProcessor {
    /// Creates a new multi-processor
    pub fn new() -> Self {
        Self {
            processors: Vec::new(),
        }
    }

    /// Adds a processor to the multi-processor
    pub fn add_processor(&mut self, processor: Box<dyn FrameProcessor>) {
        println!("[MultiProcessor] Added {} processor", processor.processor_type());
        self.processors.push(processor);
    }

    /// Gets the number of registered processors
    pub fn processor_count(&self) -> usize {
        self.processors.len()
    }
}

impl FrameProcessor for MultiFrameProcessor {
    fn process_frame(&mut self, frame: &ProcessedFrame) -> Result<(), String> {
        let mut errors = Vec::new();

        for processor in &mut self.processors {
            if let Err(e) = processor.process_frame(frame) {
                errors.push(format!("{}: {}", processor.processor_type(), e));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("Processing errors: {}", errors.join(", ")))
        }
    }

    fn flush(&mut self) -> Result<(), String> {
        let mut errors = Vec::new();

        for processor in &mut self.processors {
            if let Err(e) = processor.flush() {
                errors.push(format!("{}: {}", processor.processor_type(), e));
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(format!("Flush errors: {}", errors.join(", ")))
        }
    }

    fn processor_type(&self) -> &str {
        "Multi"
    }
}

impl Default for MultiFrameProcessor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_processor_creation() {
        let processor = PreviewFrameProcessor::new();
        assert_eq!(processor.processor_type(), "Preview");
    }

    #[test]
    fn test_encoding_processor_creation() {
        let processor = EncodingFrameProcessor::new("/tmp/output.mp4".to_string());
        assert_eq!(processor.processor_type(), "Encoding");
    }

    #[test]
    fn test_multi_processor() {
        let mut multi = MultiFrameProcessor::new();

        multi.add_processor(Box::new(PreviewFrameProcessor::new()));
        multi.add_processor(Box::new(EncodingFrameProcessor::new("/tmp/test.mp4".to_string())));

        assert_eq!(multi.processor_count(), 2);
        assert_eq!(multi.processor_type(), "Multi");
    }

    #[test]
    fn test_preview_processor_with_callback() {
        let mut processor = PreviewFrameProcessor::new();

        let mut received_data = String::new();
        processor.set_callback(move |data| {
            // This would normally send to frontend
            println!("Received frame data: {} bytes", data.len());
        });

        let frame = ProcessedFrame {
            jpeg_data: vec![0xFF, 0xD8, 0xFF, 0xE0], // JPEG header
            width: 1920,
            height: 1080,
            timestamp: 1.0,
            frame_number: 1,
        };

        // Note: This test will fail without a callback, which is expected
        let result = processor.process_frame(&frame);
        assert!(result.is_ok());
    }
}
