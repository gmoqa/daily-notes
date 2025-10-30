package transcriber

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/gofiber/fiber/v2/log"
)

// LocalTranscriber uses local whisper.cpp server
type LocalTranscriber struct {
	serverURL string
	client    *http.Client
	timeout   time.Duration
}

// LocalConfig configuration for local transcriber
type LocalConfig struct {
	ServerURL string
	Timeout   time.Duration
}

// NewLocal creates a new local transcriber
func NewLocal(config LocalConfig) (*LocalTranscriber, error) {
	if config.ServerURL == "" {
		config.ServerURL = "http://127.0.0.1:8080"
	}

	if config.Timeout == 0 {
		config.Timeout = 120 * time.Second // Local transcription can take longer
	}

	return &LocalTranscriber{
		serverURL: config.ServerURL,
		timeout:   config.Timeout,
		client: &http.Client{
			Timeout: config.Timeout,
		},
	}, nil
}

// TranscribeFile transcribes an audio file using local whisper server
func (t *LocalTranscriber) TranscribeFile(ctx context.Context, filePath string, language string) (*TranscriptionResult, error) {
	// Open file
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open audio file: %w", err)
	}
	defer file.Close()

	// Get file info
	fileInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	log.Infof("Transcribing file: %s (%.2f MB)", filepath.Base(filePath), float64(fileInfo.Size())/(1024*1024))

	return t.transcribeWithLocal(ctx, file, filepath.Base(filePath), language)
}

// transcribeWithLocal transcribes using local whisper server
func (t *LocalTranscriber) transcribeWithLocal(ctx context.Context, reader io.Reader, filename string, language string) (*TranscriptionResult, error) {
	// Create multipart form
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add file
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, reader); err != nil {
		return nil, fmt.Errorf("failed to copy file data: %w", err)
	}

	// Add response format
	if err := writer.WriteField("response-format", "json"); err != nil {
		return nil, fmt.Errorf("failed to write response format field: %w", err)
	}

	// Add language if specified
	if language != "" {
		if err := writer.WriteField("language", language); err != nil {
			return nil, fmt.Errorf("failed to write language field: %w", err)
		}
	}

	// Add temperature (affects transcription quality)
	if err := writer.WriteField("temperature", "0.0"); err != nil {
		return nil, fmt.Errorf("failed to write temperature field: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	// Create request
	inferenceURL := t.serverURL + "/inference"
	req, err := http.NewRequestWithContext(ctx, "POST", inferenceURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())

	// Execute request
	startTime := time.Now()
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	elapsed := time.Since(startTime)
	log.Infof("Transcription request completed in %.2fs", elapsed.Seconds())

	// Read response
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	// Parse response (whisper.cpp server returns JSON)
	var whisperResp struct {
		Text      string `json:"text"`
		Language  string `json:"language"`
		Segments  []Segment `json:"segments"`
	}

	if err := json.Unmarshal(respBody, &whisperResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result := &TranscriptionResult{
		Text:     whisperResp.Text,
		Language: whisperResp.Language,
		Segments: whisperResp.Segments,
		Duration: elapsed.Seconds(),
	}

	log.Infof("Transcription successful: %d characters", len(result.Text))

	return result, nil
}

// TranscribeBytes transcribes audio data from bytes
func (t *LocalTranscriber) TranscribeBytes(ctx context.Context, data []byte, filename string, language string) (*TranscriptionResult, error) {
	reader := bytes.NewReader(data)
	return t.transcribeWithLocal(ctx, reader, filename, language)
}

// Health checks if the whisper server is healthy
func (t *LocalTranscriber) Health(ctx context.Context) error {
	healthURL := t.serverURL + "/health"

	req, err := http.NewRequestWithContext(ctx, "GET", healthURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create health check request: %w", err)
	}

	resp, err := t.client.Do(req)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server unhealthy: status %d", resp.StatusCode)
	}

	return nil
}
