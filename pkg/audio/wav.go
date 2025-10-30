package audio

import (
	"encoding/binary"
	"fmt"
	"io"
	"os"
)

// WAVHeader representa el header de un archivo WAV
type WAVHeader struct {
	// RIFF Header
	ChunkID   [4]byte // "RIFF"
	ChunkSize uint32
	Format    [4]byte // "WAVE"

	// fmt sub-chunk
	Subchunk1ID   [4]byte // "fmt "
	Subchunk1Size uint32  // 16 para PCM
	AudioFormat   uint16  // 1 = PCM
	NumChannels   uint16  // 1 = Mono, 2 = Stereo
	SampleRate    uint32  // 16000, 44100, etc.
	ByteRate      uint32  // SampleRate * NumChannels * BitsPerSample/8
	BlockAlign    uint16  // NumChannels * BitsPerSample/8
	BitsPerSample uint16  // 8, 16, etc.

	// data sub-chunk
	Subchunk2ID   [4]byte // "data"
	Subchunk2Size uint32  // NumSamples * NumChannels * BitsPerSample/8
}

// WAVFile representa un archivo WAV
type WAVFile struct {
	file   *os.File
	Header WAVHeader
	path   string
}

// OpenWAV abre un archivo WAV para lectura
func OpenWAV(path string) (*WAVFile, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open WAV file: %w", err)
	}

	wf := &WAVFile{
		file: file,
		path: path,
	}

	if err := wf.readHeader(); err != nil {
		file.Close()
		return nil, err
	}

	return wf, nil
}

// readHeader lee el header del archivo WAV
func (wf *WAVFile) readHeader() error {
	if err := binary.Read(wf.file, binary.LittleEndian, &wf.Header); err != nil {
		return fmt.Errorf("failed to read WAV header: %w", err)
	}

	// Validar formato
	if string(wf.Header.ChunkID[:]) != "RIFF" {
		return fmt.Errorf("invalid WAV file: missing RIFF header")
	}

	if string(wf.Header.Format[:]) != "WAVE" {
		return fmt.Errorf("invalid WAV file: missing WAVE format")
	}

	if wf.Header.AudioFormat != 1 {
		return fmt.Errorf("unsupported audio format: %d (only PCM is supported)", wf.Header.AudioFormat)
	}

	return nil
}

// Close cierra el archivo WAV
func (wf *WAVFile) Close() error {
	return wf.file.Close()
}

// DataSize retorna el tamaño de los datos de audio
func (wf *WAVFile) DataSize() int64 {
	return int64(wf.Header.Subchunk2Size)
}

// Duration retorna la duración del audio en segundos
func (wf *WAVFile) Duration() float64 {
	numSamples := wf.DataSize() / int64(wf.Header.NumChannels*wf.Header.BitsPerSample/8)
	return float64(numSamples) / float64(wf.Header.SampleRate)
}

// ReadAt lee datos del archivo en una posición específica
func (wf *WAVFile) ReadAt(offset int64, size int) ([]byte, error) {
	buffer := make([]byte, size)

	// Posicionar después del header (44 bytes) + offset
	_, err := wf.file.Seek(44+offset, io.SeekStart)
	if err != nil {
		return nil, fmt.Errorf("failed to seek: %w", err)
	}

	n, err := wf.file.Read(buffer)
	if err != nil && err != io.EOF {
		return nil, fmt.Errorf("failed to read: %w", err)
	}

	return buffer[:n], nil
}

// ReadAll lee todos los datos de audio del archivo
func (wf *WAVFile) ReadAll() ([]byte, error) {
	dataSize := wf.DataSize()
	return wf.ReadAt(0, int(dataSize))
}
