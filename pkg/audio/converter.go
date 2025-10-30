package audio

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// ConvertToWAV convierte cualquier archivo de audio a WAV usando ffmpeg
func ConvertToWAV(inputPath, outputPath string) error {
	// Verificar si ffmpeg está disponible
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return fmt.Errorf("ffmpeg not found in PATH: %w", err)
	}

	cmd := exec.Command("ffmpeg",
		"-i", inputPath,
		"-ar", "16000", // Sample rate 16kHz
		"-ac", "1", // Mono
		"-c:a", "pcm_s16le", // PCM 16-bit
		"-y", // Overwrite output file
		outputPath,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("ffmpeg conversion failed: %w, stderr: %s", err, stderr.String())
	}

	return nil
}

// ConvertWebMToWAV convierte un archivo WebM a WAV
func ConvertWebMToWAV(inputPath, outputPath string) error {
	return ConvertToWAV(inputPath, outputPath)
}

// SaveBytesToWAV guarda bytes crudos como archivo WAV
func SaveBytesToWAV(data []byte, outputPath string, sampleRate uint32, channels uint16, bitsPerSample uint16) error {
	file, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to create output file: %w", err)
	}
	defer file.Close()

	// Calcular tamaños
	dataSize := uint32(len(data))
	fileSize := 36 + dataSize

	// Escribir header WAV
	header := WAVHeader{
		ChunkID:       [4]byte{'R', 'I', 'F', 'F'},
		ChunkSize:     fileSize,
		Format:        [4]byte{'W', 'A', 'V', 'E'},
		Subchunk1ID:   [4]byte{'f', 'm', 't', ' '},
		Subchunk1Size: 16,
		AudioFormat:   1, // PCM
		NumChannels:   channels,
		SampleRate:    sampleRate,
		ByteRate:      sampleRate * uint32(channels) * uint32(bitsPerSample) / 8,
		BlockAlign:    channels * bitsPerSample / 8,
		BitsPerSample: bitsPerSample,
		Subchunk2ID:   [4]byte{'d', 'a', 't', 'a'},
		Subchunk2Size: dataSize,
	}

	if err := binary.Write(file, binary.LittleEndian, &header); err != nil {
		return fmt.Errorf("failed to write WAV header: %w", err)
	}

	if _, err := file.Write(data); err != nil {
		return fmt.Errorf("failed to write audio data: %w", err)
	}

	return nil
}

// ConvertReaderToWAV convierte un reader de audio a archivo WAV temporal
func ConvertReaderToWAV(reader io.Reader, outputPath string) error {
	// Crear archivo temporal con la data
	tmpFile, err := os.CreateTemp("", "audio-*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	// Copiar datos del reader al archivo temporal
	if _, err := io.Copy(tmpFile, reader); err != nil {
		return fmt.Errorf("failed to copy audio data: %w", err)
	}

	// Convertir usando ffmpeg
	return ConvertToWAV(tmpFile.Name(), outputPath)
}
