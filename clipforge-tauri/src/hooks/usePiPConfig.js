import { useState, useEffect, useCallback } from 'react';
import {
  DefaultPiPConfiguration,
  calculatePiPCoordinates,
  validatePiPConfiguration,
} from '../types/recording';

/**
 * Local storage key for PiP configuration
 */
const PIP_CONFIG_STORAGE_KEY = 'clipforge_pip_config';

/**
 * Custom hook for managing Picture-in-Picture configuration
 * Handles state management and local storage persistence
 */
export function usePiPConfig() {
  // Initialize state from local storage or use default
  const [config, setConfig] = useState(() => {
    try {
      const stored = localStorage.getItem(PIP_CONFIG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate stored config
        const error = validatePiPConfiguration(parsed);
        if (!error) {
          return parsed;
        }
        console.warn('[usePiPConfig] Invalid stored config, using default:', error);
      }
    } catch (err) {
      console.error('[usePiPConfig] Failed to load config from storage:', err);
    }
    return DefaultPiPConfiguration;
  });

  // Persist configuration to local storage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(PIP_CONFIG_STORAGE_KEY, JSON.stringify(config));
    } catch (err) {
      console.error('[usePiPConfig] Failed to save config to storage:', err);
    }
  }, [config]);

  /**
   * Update the position of the PiP overlay
   */
  const setPosition = useCallback((position) => {
    setConfig((prev) => ({
      ...prev,
      position,
    }));
  }, []);

  /**
   * Update the size of the PiP overlay
   */
  const setSize = useCallback((size) => {
    setConfig((prev) => ({
      ...prev,
      size,
    }));
  }, []);

  /**
   * Update the selected camera device
   */
  const setCameraId = useCallback((cameraId) => {
    setConfig((prev) => ({
      ...prev,
      cameraId,
    }));
  }, []);

  /**
   * Toggle whether to include audio from webcam
   */
  const setIncludeAudio = useCallback((includeAudio) => {
    setConfig((prev) => ({
      ...prev,
      includeAudio,
    }));
  }, []);

  /**
   * Update the selected audio device for webcam
   */
  const setAudioDeviceId = useCallback((audioDeviceId) => {
    setConfig((prev) => ({
      ...prev,
      audioDeviceId,
    }));
  }, []);

  /**
   * Update the entire configuration at once
   */
  const updateConfig = useCallback((newConfig) => {
    const error = validatePiPConfiguration(newConfig);
    if (error) {
      console.error('[usePiPConfig] Invalid configuration:', error);
      return false;
    }
    setConfig(newConfig);
    return true;
  }, []);

  /**
   * Reset configuration to defaults
   */
  const resetConfig = useCallback(() => {
    setConfig(DefaultPiPConfiguration);
  }, []);

  /**
   * Calculate pixel coordinates for the current configuration
   * @param screenWidth Width of the screen in pixels
   * @param screenHeight Height of the screen in pixels
   * @param webcamAspectRatio Aspect ratio of the webcam (default: 16/9)
   */
  const getCoordinates = useCallback(
    (screenWidth, screenHeight, webcamAspectRatio = 16 / 9) => {
      return calculatePiPCoordinates(config, screenWidth, screenHeight, webcamAspectRatio);
    },
    [config]
  );

  return {
    // Configuration state
    config,

    // Individual setters
    setPosition,
    setSize,
    setCameraId,
    setIncludeAudio,
    setAudioDeviceId,

    // Bulk operations
    updateConfig,
    resetConfig,

    // Helpers
    getCoordinates,
  };
}

export default usePiPConfig;
