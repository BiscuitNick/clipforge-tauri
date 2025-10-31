import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Custom hook for managing Picture-in-Picture recordings
 * Handles simultaneous screen + webcam recording with metadata sync
 */
export function usePiPRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [error, setError] = useState(null);

  // Recording state refs
  const recordingIdRef = useRef(null);
  const startTimeRef = useRef(null);
  const screenFilePathRef = useRef(null);
  const webcamFilePathRef = useRef(null);
  const timerIntervalRef = useRef(null);

  // MediaRecorder for webcam
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const webcamStreamRef = useRef(null);

  /**
   * Start PiP recording
   * @param {Object} options Recording options
   * @param {Object} options.screenSource Selected screen/window source
   * @param {Object} options.pipConfig PiP configuration
   * @param {MediaStream} options.webcamStream Webcam media stream
   * @param {Object} options.screenRecordingConfig Screen recording config
   * @returns {Promise<string>} Recording ID
   */
  const startRecording = useCallback(async ({
    screenSource,
    pipConfig,
    webcamStream,
    screenRecordingConfig,
    includeSystemAudio = true,
  }) => {
    if (isRecording) {
      throw new Error('Recording already in progress');
    }

    try {
      setError(null);

      // Generate unique recording ID
      const recordingId = `pip_${Date.now()}`;
      recordingIdRef.current = recordingId;

      // Record start time for synchronization
      const startTime = Date.now();
      startTimeRef.current = startTime;

      // Store webcam stream reference
      webcamStreamRef.current = webcamStream;
      // Step 1: Start screen recording via Tauri backend
      const screenRecording = await invoke('start_recording', {
        recordingType: 'screen',
        sourceId: screenSource.id,
        config: screenRecordingConfig,
        includeAudio: includeSystemAudio,
      });

      screenFilePathRef.current = screenRecording.file_path;
      // Step 2: Start webcam recording via MediaRecorder
      await startWebcamRecording(webcamStream);
      // Step 3: Start duration timer
      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);

      setIsRecording(true);

      return {
        recordingId,
        screenRecording,
      };
    } catch (err) {
      setError(err.message || 'Failed to start recording');
      // Cleanup on error
      await cleanup();
      throw err;
    }
  }, [isRecording]);

  /**
   * Start webcam recording using MediaRecorder
   */
  const startWebcamRecording = async (webcamStream) => {
    // Determine supported MIME type
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm;codecs=vp8';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/mp4';
    }

    const options = {
      mimeType,
      videoBitsPerSecond: 2500000, // 2.5 Mbps
    };

    const recorder = new MediaRecorder(webcamStream, options);
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.start(1000); // Collect data every second
    mediaRecorderRef.current = recorder;
  };

  /**
   * Stop PiP recording and save metadata
   * @param {Object} pipConfig PiP configuration used for recording
   * @param {Object} screenDimensions Screen dimensions
   * @param {Object} webcamDimensions Webcam dimensions
   * @returns {Promise<Object>} Recording metadata
   */
  const stopRecording = useCallback(async ({
    pipConfig,
    screenDimensions,
    webcamDimensions
  }) => {
    if (!isRecording) {
      throw new Error('No recording in progress');
    }

    try {
      setError(null);

      // Calculate final duration
      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
      // Step 1: Stop screen recording
      const screenResult = await invoke('stop_recording');
      screenFilePathRef.current = screenResult.file_path;
      // Step 2: Stop webcam recording and save
      const webcamFilePath = await stopWebcamRecording(duration);
      webcamFilePathRef.current = webcamFilePath;
      // Step 3: Create metadata
      const metadata = {
        id: recordingIdRef.current,
        startTime: startTimeRef.current,
        duration,
        screenFilePath: screenFilePathRef.current,
        webcamFilePath: webcamFilePathRef.current,
        pipConfig,
        screenDimensions,
        webcamDimensions,
        recordingType: 'pip',
        createdAt: new Date().toISOString(),
      };

      // Step 4: Save metadata to file
      await saveMetadata(metadata);

      // Step 5: Composite screen + webcam into final output
      let compositedFilePath = null;
      try {
        compositedFilePath = await invoke('composite_pip_recording', {
          screenPath: screenFilePathRef.current,
          webcamPath: webcamFilePathRef.current,
          position: pipConfig.position,
          size: pipConfig.size,
          includeWebcamAudio: pipConfig.includeAudio ?? false,
          screenWidth: screenDimensions.width,
          screenHeight: screenDimensions.height,
          webcamWidth: webcamDimensions.width,
          webcamHeight: webcamDimensions.height,
        });
        metadata.compositedFilePath = compositedFilePath;
      } catch {
        // Failed to composite PiP recording
      }

      const screenPath = screenFilePathRef.current;
      const webcamPath = webcamFilePathRef.current;
      const compositeSucceeded = compositedFilePath !== null;
      const finalCompositePath = compositedFilePath || screenPath;

      // Step 5: Cleanup
      cleanup();

      setIsRecording(false);
      setRecordingDuration(0);
      return {
        metadata,
        screenFilePath: screenPath,
        webcamFilePath: webcamPath,
        compositedFilePath: finalCompositePath,
        compositeSucceeded,
      };
    } catch (err) {
      setError(err.message || 'Failed to stop recording');
      throw err;
    }
  }, [isRecording]);

  /**
   * Stop webcam recording and save the file
   */
  const stopWebcamRecording = async (duration) => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;

      if (!recorder) {
        reject(new Error('No webcam recorder found'));
        return;
      }

      recorder.onstop = async () => {
        try {
          // Create blob from recorded chunks
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });

          // Convert blob to array buffer for Tauri
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          // Save file via Tauri command with duration
          const filePath = await invoke('save_webcam_recording', {
            data: Array.from(uint8Array),
            mimeType: recorder.mimeType,
            duration
          });

          // Reset chunks
          chunksRef.current = [];

          resolve(filePath);
        } catch (err) {
          reject(err);
        }
      };

      recorder.onerror = (event) => {
        reject(new Error(`Webcam recorder error: ${event.error.message}`));
      };

      recorder.stop();
    });
  };

  /**
   * Save PiP recording metadata to a JSON file
   */
  const saveMetadata = async (metadata) => {
    try {
      // Use Tauri command to save metadata file
      await invoke('save_pip_metadata', {
        metadata: JSON.stringify(metadata, null, 2)
      });
    } catch {
      // Don't throw here - metadata save failure shouldn't fail the whole recording
    }
  };

  /**
   * Pause the recording
   */
  const pauseRecording = useCallback(async () => {
    if (!isRecording || isPaused) {
      return;
    }

    try {
      // Pause screen recording (backend)
      await invoke('pause_recording');

      // Pause webcam recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.pause();
      }

      // Pause timer
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      setIsPaused(true);
    } catch (err) {
      console.error('Failed to pause PiP recording:', err);
      setError(err.message || 'Failed to pause recording');
      throw err;
    }
  }, [isRecording, isPaused]);

  /**
   * Resume the recording
   */
  const resumeRecording = useCallback(async () => {
    if (!isRecording || !isPaused) {
      return;
    }

    try {
      // Resume screen recording (backend)
      await invoke('resume_recording');

      // Resume webcam recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
        mediaRecorderRef.current.resume();
      }

      // Resume timer
      const pausedDuration = recordingDuration;
      startTimeRef.current = Date.now() - (pausedDuration * 1000);

      timerIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);

      setIsPaused(false);
    } catch (err) {
      console.error('Failed to resume PiP recording:', err);
      setError(err.message || 'Failed to resume recording');
      throw err;
    }
  }, [isRecording, isPaused, recordingDuration]);

  /**
   * Cleanup recording resources
   */
  const cleanup = () => {
    // Clear timer
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    // Stop webcam stream
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }

    // Reset refs
    recordingIdRef.current = null;
    startTimeRef.current = null;
    screenFilePathRef.current = null;
    webcamFilePathRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  };

  /**
   * Format duration as MM:SS
   */
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    // State
    isRecording,
    isPaused,
    recordingDuration,
    error,

    // Actions
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,

    // Helpers
    formatDuration,
    recordingId: recordingIdRef.current,
  };
}

export default usePiPRecording;
