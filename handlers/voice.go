package handlers

import (
	"context"
	"daily-notes/config"
	"daily-notes/pkg/audio"
	"daily-notes/pkg/transcriber"
	"daily-notes/templates/pages"
	"daily-notes/utils"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// VoicePage renderiza la página de speech-to-text
func VoicePage(c *fiber.Ctx) error {
	// Set HTML content type
	c.Set("Content-Type", "text/html; charset=utf-8")

	// Get logger from context or use default
	logger := slog.Default()

	// Get Vite bundle paths from manifest
	mainScript := utils.GetMainScript(logger)
	legacyPolyfills, legacyMain := utils.GetLegacyScripts(logger)

	// Render with Templ
	return pages.VoicePage(
		config.AppConfig.GoogleClientID,
		config.AppConfig.Env,
		mainScript,
		legacyPolyfills,
		legacyMain,
	).Render(c.Context(), c.Response().BodyWriter())
}

// TranscribeAudioRequest estructura para la request de transcripción
type TranscribeAudioRequest struct {
	Language string `json:"language"`
}

// TranscribeAudioResponse estructura para la respuesta de transcripción
type TranscribeAudioResponse struct {
	Text      string  `json:"text"`
	Language  string  `json:"language"`
	Duration  float64 `json:"duration"`
	Success   bool    `json:"success"`
	Message   string  `json:"message,omitempty"`
	ProcessID string  `json:"process_id"`
}

var (
	localTranscriberInstance *transcriber.LocalTranscriber
	transcriberError         error
)

// initLocalTranscriber inicializa el transcriber local una sola vez
func initLocalTranscriber() (*transcriber.LocalTranscriber, error) {
	if localTranscriberInstance != nil {
		return localTranscriberInstance, nil
	}

	if transcriberError != nil {
		return nil, transcriberError
	}

	// Crear transcriber local
	// Use environment variable for Docker compatibility
	whisperURL := os.Getenv("WHISPER_SERVER_URL")
	if whisperURL == "" {
		whisperURL = "http://127.0.0.1:8080" // Default for local development
	}

	transcConfig := transcriber.LocalConfig{
		ServerURL: whisperURL,
		Timeout:   120 * time.Second,
	}

	trans, err := transcriber.NewLocal(transcConfig)
	if err != nil {
		transcriberError = err
		return nil, err
	}

	// Verificar que el servidor esté disponible
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := trans.Health(ctx); err != nil {
		transcriberError = fmt.Errorf("whisper server not available: %w", err)
		return nil, transcriberError
	}

	localTranscriberInstance = trans
	return localTranscriberInstance, nil
}

// TranscribeAudio procesa audio y retorna transcripción
func TranscribeAudio(c *fiber.Ctx) error {
	logger := slog.Default()

	// Obtener idioma del query param o form
	language := c.Query("language", "es")
	if language == "" {
		language = "es"
	}

	logger.Info("Received transcription request", "language", language)

	// Obtener archivo del multipart form
	file, err := c.FormFile("audio")
	if err != nil {
		logger.Error("Failed to get audio file from request", "error", err)
		return c.Status(fiber.StatusBadRequest).JSON(TranscribeAudioResponse{
			Success: false,
			Message: "No audio file provided",
		})
	}

	logger.Info("Audio file received", "filename", file.Filename, "size", file.Size)

	// Generar ID único para este proceso
	processID := uuid.New().String()

	// Crear directorio temporal si no existe
	tmpDir := filepath.Join("data", "tmp", "audio")
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		logger.Error("Failed to create temp directory", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(TranscribeAudioResponse{
			Success: false,
			Message: "Internal server error",
		})
	}

	// Guardar archivo temporalmente
	tmpFilename := fmt.Sprintf("%s_%s", processID, file.Filename)
	tmpPath := filepath.Join(tmpDir, tmpFilename)

	if err := c.SaveFile(file, tmpPath); err != nil {
		logger.Error("Failed to save uploaded file", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(TranscribeAudioResponse{
			Success: false,
			Message: "Failed to save audio file",
		})
	}

	defer func() {
		// Limpiar archivo temporal después de un delay
		go func() {
			time.Sleep(5 * time.Minute)
			os.Remove(tmpPath)
			os.Remove(tmpPath + ".wav")
		}()
	}()

	logger.Info("Audio file saved temporarily", "path", tmpPath)

	// Convertir a WAV si es necesario
	var audioPath string
	ext := filepath.Ext(file.Filename)

	if ext == ".wav" {
		audioPath = tmpPath
	} else {
		// Necesita conversión
		wavPath := tmpPath + ".wav"
		logger.Info("Converting audio to WAV", "from", ext, "to", ".wav")

		if err := audio.ConvertToWAV(tmpPath, wavPath); err != nil {
			logger.Error("Failed to convert audio to WAV", "error", err)
			return c.Status(fiber.StatusInternalServerError).JSON(TranscribeAudioResponse{
				Success: false,
				Message: "Failed to convert audio format. Make sure ffmpeg is installed.",
			})
		}

		audioPath = wavPath
		logger.Info("Audio converted successfully", "path", wavPath)
	}

	// Inicializar transcriber local
	trans, err := initLocalTranscriber()
	if err != nil {
		logger.Error("Failed to initialize transcriber", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(TranscribeAudioResponse{
			Success: false,
			Message: "Whisper server not available. Please ensure the whisper server is running.",
		})
	}

	// Transcribir audio
	ctx, cancel := context.WithTimeout(c.Context(), 90*time.Second)
	defer cancel()

	startTime := time.Now()
	result, err := trans.TranscribeFile(ctx, audioPath, language)
	elapsed := time.Since(startTime)

	if err != nil {
		logger.Error("Transcription failed", "error", err, "elapsed", elapsed)
		return c.Status(fiber.StatusInternalServerError).JSON(TranscribeAudioResponse{
			Success: false,
			Message: fmt.Sprintf("Transcription failed: %v", err),
		})
	}

	logger.Info("Transcription completed successfully",
		"elapsed", elapsed,
		"text_length", len(result.Text),
		"language", result.Language)

	return c.JSON(TranscribeAudioResponse{
		Success:   true,
		Text:      result.Text,
		Language:  result.Language,
		Duration:  result.Duration,
		ProcessID: processID,
	})
}

// TranscribeAudioStream procesa audio en streaming (para futuro)
func TranscribeAudioStream(c *fiber.Ctx) error {
	// TODO: Implementar streaming de audio en tiempo real
	return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
		"success": false,
		"message": "Streaming not yet implemented",
	})
}

// GetTranscriptionStatus obtiene el estado de una transcripción en progreso
func GetTranscriptionStatus(c *fiber.Ctx) error {
	processID := c.Params("id")

	// TODO: Implementar sistema de tracking de procesos
	return c.JSON(fiber.Map{
		"process_id": processID,
		"status":     "unknown",
		"message":    "Status tracking not yet implemented",
	})
}

// UploadAndTranscribe maneja la carga de archivos grandes con progress
func UploadAndTranscribe(c *fiber.Ctx) error {
	logger := slog.Default()

	// Crear reader del body
	reader := c.Context().RequestBodyStream()

	// Crear archivo temporal
	tmpFile, err := os.CreateTemp(filepath.Join("data", "tmp", "audio"), "upload-*.audio")
	if err != nil {
		logger.Error("Failed to create temp file", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"message": "Failed to create temporary file",
		})
	}
	defer tmpFile.Close()

	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	// Copiar datos
	written, err := io.Copy(tmpFile, reader)
	if err != nil {
		logger.Error("Failed to copy uploaded data", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"success": false,
			"message": "Failed to upload file",
		})
	}

	logger.Info("File uploaded", "bytes", written, "path", tmpPath)

	// Continuar con transcripción...
	return c.JSON(fiber.Map{
		"success": true,
		"message": "File uploaded successfully",
		"bytes":   written,
	})
}
