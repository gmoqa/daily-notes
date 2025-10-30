package whisper

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2/log"
)

// Server manages the whisper.cpp HTTP server process
type Server struct {
	cmd        *exec.Cmd
	host       string
	port       int
	modelPath  string
	serverPath string
	isRunning  bool
	mu         sync.RWMutex
	ctx        context.Context
	cancel     context.CancelFunc
}

// ServerConfig configuration for whisper server
type ServerConfig struct {
	Host       string
	Port       int
	ModelPath  string
	ServerPath string
	Threads    int
}

// NewServer creates a new whisper server manager
func NewServer(config ServerConfig) (*Server, error) {
	// Validate model path
	if _, err := os.Stat(config.ModelPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("model file not found: %s", config.ModelPath)
	}

	// Validate server binary
	if _, err := os.Stat(config.ServerPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("server binary not found: %s", config.ServerPath)
	}

	if config.Host == "" {
		config.Host = "127.0.0.1"
	}

	if config.Port == 0 {
		config.Port = 8080
	}

	if config.Threads == 0 {
		config.Threads = 4
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Server{
		host:       config.Host,
		port:       config.Port,
		modelPath:  config.ModelPath,
		serverPath: config.ServerPath,
		ctx:        ctx,
		cancel:     cancel,
	}, nil
}

// Start starts the whisper server
func (s *Server) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.isRunning {
		return fmt.Errorf("server already running")
	}

	// Check if port is already in use
	if s.isPortInUse() {
		log.Warn("Port already in use, assuming whisper server is already running")
		s.isRunning = true
		return nil
	}

	// Create command
	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	s.cmd = exec.CommandContext(s.ctx, s.serverPath,
		"-m", s.modelPath,
		"--host", s.host,
		"--port", fmt.Sprintf("%d", s.port),
		"-t", "4", // threads
	)

	// Setup stdout/stderr pipes for logging
	stdout, err := s.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	stderr, err := s.cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	// Start the process
	if err := s.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start server: %w", err)
	}

	// Start log readers
	go s.logReader(stdout, "stdout")
	go s.logReader(stderr, "stderr")

	log.Infof("Starting whisper server at %s", addr)

	// Wait for server to be ready
	if err := s.waitForReady(30 * time.Second); err != nil {
		s.cmd.Process.Kill()
		return fmt.Errorf("server failed to start: %w", err)
	}

	s.isRunning = true
	log.Info("Whisper server started successfully")

	// Monitor process in background
	go s.monitorProcess()

	return nil
}

// Stop stops the whisper server
func (s *Server) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.isRunning {
		return nil
	}

	log.Info("Stopping whisper server...")

	s.cancel()

	if s.cmd != nil && s.cmd.Process != nil {
		// Try graceful shutdown first
		s.cmd.Process.Signal(os.Interrupt)

		// Wait up to 5 seconds for graceful shutdown
		done := make(chan error, 1)
		go func() {
			done <- s.cmd.Wait()
		}()

		select {
		case <-time.After(5 * time.Second):
			// Force kill if graceful shutdown fails
			log.Warn("Graceful shutdown timeout, forcing kill")
			s.cmd.Process.Kill()
		case <-done:
			// Graceful shutdown successful
		}
	}

	s.isRunning = false
	log.Info("Whisper server stopped")

	return nil
}

// IsRunning returns true if the server is running
func (s *Server) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.isRunning
}

// GetAddress returns the server address
func (s *Server) GetAddress() string {
	return fmt.Sprintf("http://%s:%d", s.host, s.port)
}

// isPortInUse checks if the port is already in use
func (s *Server) isPortInUse() bool {
	addr := fmt.Sprintf("%s:%d", s.host, s.port)
	conn, err := net.DialTimeout("tcp", addr, 1*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// waitForReady waits for the server to be ready
func (s *Server) waitForReady(timeout time.Duration) error {
	addr := s.GetAddress()
	healthURL := addr + "/health"

	client := &http.Client{
		Timeout: 2 * time.Second,
	}

	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		resp, err := client.Get(healthURL)
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			return nil
		}

		if resp != nil {
			resp.Body.Close()
		}

		time.Sleep(500 * time.Millisecond)
	}

	return fmt.Errorf("server did not become ready within %v", timeout)
}

// logReader reads and logs output from the server process
func (s *Server) logReader(reader io.Reader, prefix string) {
	scanner := bufio.NewScanner(reader)
	for scanner.Scan() {
		line := scanner.Text()
		log.Debugf("[whisper-server:%s] %s", prefix, line)
	}
}

// monitorProcess monitors the server process and restarts if it crashes
func (s *Server) monitorProcess() {
	if s.cmd == nil {
		return
	}

	err := s.cmd.Wait()

	s.mu.Lock()
	wasRunning := s.isRunning
	s.isRunning = false
	s.mu.Unlock()

	if wasRunning && err != nil {
		log.Errorf("Whisper server process exited unexpectedly: %v", err)
		// Could implement auto-restart here if needed
	}
}

// GetDefaultServerPath returns the default path to the whisper server binary
func GetDefaultServerPath() (string, error) {
	// Try to find the server binary
	possiblePaths := []string{
		"lib/whisper/build/bin/whisper-server",
		"lib/whisper/build/bin/server",
		filepath.Join(os.Getenv("HOME"), ".local/bin/whisper-server"),
		"/usr/local/bin/whisper-server",
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("whisper server binary not found in default locations")
}

// GetDefaultModelPath returns the default path to the whisper model
func GetDefaultModelPath(modelName string) (string, error) {
	if modelName == "" {
		modelName = "base"
	}

	possiblePaths := []string{
		fmt.Sprintf("models/ggml-%s.bin", modelName),
		fmt.Sprintf("lib/whisper/models/ggml-%s.bin", modelName),
		filepath.Join(os.Getenv("HOME"), ".whisper", fmt.Sprintf("ggml-%s.bin", modelName)),
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}

	return "", fmt.Errorf("whisper model '%s' not found in default locations", modelName)
}
