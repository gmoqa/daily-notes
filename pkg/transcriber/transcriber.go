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

// Transcriber proporciona una API de alto nivel para transcripción
type Transcriber struct {
	apiKey  string
	apiURL  string
	client  *http.Client
	timeout time.Duration
}

// Config configuración del transcriber
type Config struct {
	APIKey  string
	APIUrl  string
	Timeout time.Duration
}

// TranscriptionResult resultado de la transcripción
type TranscriptionResult struct {
	Text     string    `json:"text"`
	Language string    `json:"language,omitempty"`
	Duration float64   `json:"duration,omitempty"`
	Segments []Segment `json:"segments,omitempty"`
}

// Segment representa un segmento de texto con timing
type Segment struct {
	ID               int     `json:"id"`
	Seek             int     `json:"seek"`
	Start            float64 `json:"start"`
	End              float64 `json:"end"`
	Text             string  `json:"text"`
	Tokens           []int   `json:"tokens,omitempty"`
	Temperature      float64 `json:"temperature,omitempty"`
	AvgLogprob       float64 `json:"avg_logprob,omitempty"`
	CompressionRatio float64 `json:"compression_ratio,omitempty"`
	NoSpeechProb     float64 `json:"no_speech_prob,omitempty"`
}

// OpenAI API Response
type openAIResponse struct {
	Text string `json:"text"`
}

// New crea un nuevo Transcriber
func New(config Config) (*Transcriber, error) {
	if config.APIKey == "" {
		return nil, fmt.Errorf("API key is required")
	}

	if config.APIUrl == "" {
		config.APIUrl = "https://api.openai.com/v1/audio/transcriptions"
	}

	if config.Timeout == 0 {
		config.Timeout = 60 * time.Second
	}

	return &Transcriber{
		apiKey:  config.APIKey,
		apiURL:  config.APIUrl,
		timeout: config.Timeout,
		client: &http.Client{
			Timeout: config.Timeout,
		},
	}, nil
}

// TranscribeFile transcribe un archivo de audio
func (t *Transcriber) TranscribeFile(ctx context.Context, filePath string, language string) (*TranscriptionResult, error) {
	// Abrir archivo
	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open audio file: %w", err)
	}
	defer file.Close()

	// Obtener información del archivo
	fileInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to get file info: %w", err)
	}

	log.Infof("Transcribing file: %s (%.2f MB)", filepath.Base(filePath), float64(fileInfo.Size())/(1024*1024))

	return t.transcribeWithOpenAI(ctx, file, filepath.Base(filePath), language)
}

// transcribeWithOpenAI transcribe usando la API de OpenAI Whisper
func (t *Transcriber) transcribeWithOpenAI(ctx context.Context, reader io.Reader, filename string, language string) (*TranscriptionResult, error) {
	// Crear multipart form
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Añadir archivo
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, reader); err != nil {
		return nil, fmt.Errorf("failed to copy file data: %w", err)
	}

	// Añadir modelo
	if err := writer.WriteField("model", "whisper-1"); err != nil {
		return nil, fmt.Errorf("failed to write model field: %w", err)
	}

	// Añadir idioma si se especifica
	if language != "" {
		if err := writer.WriteField("language", language); err != nil {
			return nil, fmt.Errorf("failed to write language field: %w", err)
		}
	}

	// Añadir formato de respuesta
	if err := writer.WriteField("response_format", "json"); err != nil {
		return nil, fmt.Errorf("failed to write response format field: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	// Crear request
	req, err := http.NewRequestWithContext(ctx, "POST", t.apiURL, body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+t.apiKey)

	// Ejecutar request
	startTime := time.Now()
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	elapsed := time.Since(startTime)
	log.Infof("Transcription request completed in %.2fs", elapsed.Seconds())

	// Leer respuesta
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	// Parse respuesta
	var openAIResp openAIResponse
	if err := json.Unmarshal(respBody, &openAIResp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	result := &TranscriptionResult{
		Text:     openAIResp.Text,
		Language: language,
	}

	log.Infof("Transcription successful: %d characters", len(result.Text))

	return result, nil
}

// TranscribeBytes transcribe datos de audio desde bytes
func (t *Transcriber) TranscribeBytes(ctx context.Context, data []byte, filename string, language string) (*TranscriptionResult, error) {
	reader := bytes.NewReader(data)
	return t.transcribeWithOpenAI(ctx, reader, filename, language)
}
