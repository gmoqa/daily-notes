// Voice Recorder and Transcription Module

class VoiceRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.audioBlob = null;
    this.audioUrl = null;
    this.isRecording = false;
    this.startTime = null;
    this.timerInterval = null;
    this.stream = null;

    this.initElements();
    this.initEventListeners();
    this.checkMicrophonePermission();
  }

  initElements() {
    // Buttons
    this.recordBtn = document.getElementById('record-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.clearBtn = document.getElementById('clear-btn');
    this.transcribeBtn = document.getElementById('transcribe-btn');
    this.copyBtn = document.getElementById('copy-btn');

    // Sections
    this.audioPreview = document.getElementById('audio-preview');
    this.transcribeSection = document.getElementById('transcribe-section');
    this.audioPlayer = document.getElementById('audio-player');
    this.statusIndicator = document.getElementById('status-indicator');
    this.timer = document.getElementById('timer');

    // Language
    this.languageSelect = document.getElementById('language-select');

    // Result elements
    this.transcriptionPlaceholder = document.getElementById('transcription-placeholder');
    this.transcriptionLoading = document.getElementById('transcription-loading');
    this.transcriptionResult = document.getElementById('transcription-result');
    this.transcriptionMeta = document.getElementById('transcription-meta');
    this.resultActions = document.getElementById('result-actions');

    // Info elements
    this.audioDuration = document.getElementById('audio-duration');
    this.audioSize = document.getElementById('audio-size');
    this.charCount = document.getElementById('char-count');
    this.wordCount = document.getElementById('word-count');
    this.transcriptionTime = document.getElementById('transcription-time');

    // Notification
    this.notification = document.getElementById('notification');
    this.notificationText = document.getElementById('notification-text');
  }

  initEventListeners() {
    this.recordBtn.addEventListener('click', () => this.startRecording());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.clearBtn.addEventListener('click', () => this.clearRecording());
    this.transcribeBtn.addEventListener('click', () => this.transcribeAudio());
    this.copyBtn.addEventListener('click', () => this.copyText());
    this.transcriptionResult.addEventListener('input', () => this.updateTextStats());
  }

  async checkMicrophonePermission() {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' });

      if (result.state === 'denied') {
        this.showNotification('Microphone permission denied. Please enable it in your browser settings.', 'error');
        this.recordBtn.disabled = true;
      }

      result.addEventListener('change', () => {
        if (result.state === 'denied') {
          this.recordBtn.disabled = true;
        } else {
          this.recordBtn.disabled = false;
        }
      });
    } catch (error) {
      console.warn('Permissions API not supported', error);
    }
  }

  async startRecording() {
    try {
      // Request microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      // Reset chunks
      this.audioChunks = [];

      // Create MediaRecorder with best supported format
      // Try to use formats that work better with seekable playback
      let options = {};

      // Try different mimetypes in order of preference
      // Prioritize formats with better duration metadata support
      const mimeTypes = [
        'audio/ogg;codecs=opus',  // Better for Firefox
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        ''
      ];

      for (const mimeType of mimeTypes) {
        if (mimeType === '' || MediaRecorder.isTypeSupported(mimeType)) {
          if (mimeType !== '') {
            options.mimeType = mimeType;
          }
          console.log('Using mime type:', mimeType || 'default');
          break;
        }
      }

      this.mediaRecorder = new MediaRecorder(this.stream, options);
      this.recordingMimeType = options.mimeType || 'audio/webm';

      // Record in smaller chunks to help with seeking
      this.mediaRecorder.start(1000); // Record in 1-second chunks

      // Handle data available
      this.mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      });

      // Handle stop
      this.mediaRecorder.addEventListener('stop', () => {
        this.handleRecordingStop();
      });

      // Note: start() was already called above with timeslice parameter
      this.isRecording = true;
      this.startTime = Date.now();

      // Update UI
      this.updateRecordingUI(true);
      this.startTimer();

      this.showNotification('Recording started', 'success');

    } catch (error) {
      console.error('Error starting recording:', error);

      let message = 'Error starting recording';
      if (error.name === 'NotAllowedError') {
        message = 'Microphone permission denied';
      } else if (error.name === 'NotFoundError') {
        message = 'No microphone found';
      }

      this.showNotification(message, 'error');
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;

      // Stop all tracks
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
      }

      this.stopTimer();
      this.updateRecordingUI(false);
    }
  }

  handleRecordingStop() {
    // Create blob from chunks with the correct mime type
    this.audioBlob = new Blob(this.audioChunks, { type: this.recordingMimeType });
    this.audioUrl = URL.createObjectURL(this.audioBlob);

    // Update audio info with recorded time (most accurate)
    const durationSeconds = (Date.now() - this.startTime) / 1000;
    const sizeKB = (this.audioBlob.size / 1024).toFixed(2);

    this.audioDuration.textContent = `Duration: ${this.formatTime(durationSeconds * 1000)}`;
    this.audioSize.textContent = `Size: ${sizeKB} KB`;

    // Store the recorded duration for reference
    this.recordedDuration = durationSeconds;

    // Set audio player source and preload
    this.audioPlayer.preload = 'auto'; // Changed to 'auto' to load more data
    this.audioPlayer.src = this.audioUrl;
    this.audioPlayer.load(); // Force load the audio

    // Single handler for duration update - using durationchange event
    const handleDurationUpdate = () => {
      const duration = this.audioPlayer.duration;
      console.log('Audio duration update:', duration);

      // Only update if we have a valid, finite duration
      if (duration && isFinite(duration) && duration > 0) {
        this.audioDuration.textContent = `Duration: ${this.formatTime(duration * 1000)}`;
        console.log('Duration updated to:', duration);
      } else {
        // Duration is invalid (Infinity or NaN), keep recorded time
        console.log('Invalid duration, keeping recorded time:', this.recordedDuration);
        this.audioDuration.textContent = `Duration: ${this.formatTime(this.recordedDuration * 1000)}`;
      }
    };

    // Listen for duration change events
    this.audioPlayer.addEventListener('durationchange', handleDurationUpdate, { once: true });
    this.audioPlayer.addEventListener('loadedmetadata', handleDurationUpdate, { once: true });

    // Handle errors
    this.audioPlayer.addEventListener('error', (e) => {
      console.error('Audio player error:', e);
      console.error('Error details:', this.audioPlayer.error);
      this.showNotification('Audio cannot be played, but can be transcribed', 'warning');
    }, { once: true });

    // Show preview and transcribe section
    this.audioPreview.style.display = 'block';
    this.transcribeSection.style.display = 'block';
    this.clearBtn.disabled = false;

    this.showNotification('Recording completed', 'success');
  }

  clearRecording() {
    // Reset everything
    this.audioChunks = [];
    this.audioBlob = null;

    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }

    this.audioPlayer.src = '';
    this.audioPreview.style.display = 'none';
    this.transcribeSection.style.display = 'none';
    this.clearBtn.disabled = true;

    // Clear transcription
    this.clearTranscription();

    // Reset timer
    this.timer.textContent = '00:00';

    this.showNotification('Audio cleared', 'info');
  }

  async transcribeAudio() {
    if (!this.audioBlob) {
      this.showNotification('No audio to transcribe', 'error');
      return;
    }

    // Show loading
    this.transcriptionPlaceholder.style.display = 'none';
    this.transcriptionResult.style.display = 'none';
    this.transcriptionLoading.style.display = 'flex';
    this.transcriptionMeta.style.display = 'none';
    this.resultActions.style.display = 'none';

    // Disable transcribe button
    this.transcribeBtn.disabled = true;
    this.transcribeBtn.innerHTML = '<div class="spinner-small"></div><span class="btn-text">Transcribing...</span>';

    const startTime = Date.now();

    try {
      // Create form data
      const formData = new FormData();
      formData.append('audio', this.audioBlob, 'recording.webm');
      formData.append('language', this.languageSelect.value);

      // Send to API
      const response = await fetch('/api/voice/transcribe?language=' + this.languageSelect.value, {
        method: 'POST',
        body: formData,
        headers: {
          // Session cookie will be sent automatically
        }
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Transcription error');
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

      // Show result
      this.displayTranscription(data.text, elapsed);

      this.showNotification('Transcription completed', 'success');

    } catch (error) {
      console.error('Transcription error:', error);

      // Show error
      this.transcriptionLoading.style.display = 'none';
      this.transcriptionPlaceholder.style.display = 'flex';

      let errorMessage = 'Error transcribing audio';

      if (error.message.includes('not configured')) {
        errorMessage = 'Transcription service not configured. Contact administrator.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      this.showNotification(errorMessage, 'error');

    } finally {
      // Re-enable button
      this.transcribeBtn.disabled = false;
      this.transcribeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
        </svg>
        <span class="btn-text">Transcribe</span>
      `;
    }
  }

  displayTranscription(text, elapsedTime) {
    this.transcriptionLoading.style.display = 'none';
    this.transcriptionResult.style.display = 'block';
    this.transcriptionResult.textContent = text;
    this.transcriptionMeta.style.display = 'flex';
    this.resultActions.style.display = 'flex';

    // Update stats
    this.updateTextStats();

    // Update time
    this.transcriptionTime.textContent = `Processed in ${elapsedTime}s`;
  }

  clearTranscription() {
    this.transcriptionResult.textContent = '';
    this.transcriptionResult.style.display = 'none';
    this.transcriptionLoading.style.display = 'none';
    this.transcriptionPlaceholder.style.display = 'flex';
    this.transcriptionMeta.style.display = 'none';
    this.resultActions.style.display = 'none';
  }

  updateTextStats() {
    const text = this.transcriptionResult.textContent;
    const charCount = text.length;
    const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;

    this.charCount.textContent = `${charCount} characters`;
    this.wordCount.textContent = `${wordCount} words`;
  }

  copyText() {
    const text = this.transcriptionResult.textContent;

    if (!text) {
      this.showNotification('No text to copy', 'error');
      return;
    }

    navigator.clipboard.writeText(text)
      .then(() => {
        this.showNotification('Text copied to clipboard', 'success');
      })
      .catch(error => {
        console.error('Error copying text:', error);
        this.showNotification('Error copying text', 'error');
      });
  }

  updateRecordingUI(isRecording) {
    if (isRecording) {
      this.recordBtn.disabled = true;
      this.stopBtn.disabled = false;
      this.statusIndicator.classList.add('recording');
      this.statusIndicator.querySelector('.status-text').textContent = 'Recording...';
    } else {
      this.recordBtn.disabled = false;
      this.stopBtn.disabled = true;
      this.statusIndicator.classList.remove('recording');
      this.statusIndicator.querySelector('.status-text').textContent = 'Ready to record';
    }
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      this.timer.textContent = this.formatTime(elapsed);
    }, 100);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  showNotification(message, type = 'info') {
    this.notificationText.textContent = message;
    this.notification.className = 'notification ' + type;
    this.notification.style.display = 'block';

    setTimeout(() => {
      this.notification.style.display = 'none';
    }, 4000);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new VoiceRecorder();
  });
} else {
  new VoiceRecorder();
}
