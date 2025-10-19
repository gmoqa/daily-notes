package main

import (
	"context"
	"daily-notes/config"
	"daily-notes/config/setup"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Load configuration
	config.Load()

	// Setup logger
	logger := setupLogger()
	slog.SetDefault(logger)

	// Initialize database
	dbPath := config.GetEnv("DB_PATH", "./data/daily-notes.db")
	db, err := setup.InitDatabase(dbPath, logger)
	if err != nil {
		logger.Error("failed to initialize database", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	// Initialize application with all dependencies
	application := setup.InitApp(db, logger)

	// Create and configure Fiber server
	fiberApp := setup.NewFiberApp(logger)

	// Apply global middleware
	setup.ApplyMiddleware(fiberApp, logger)

	// Register all routes
	setup.RegisterRoutes(fiberApp, application)

	// Start server
	logger.Info("starting server", "port", config.AppConfig.Port, "env", config.AppConfig.Env)

	go func() {
		if err := fiberApp.Listen(":" + config.AppConfig.Port); err != nil {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server gracefully")

	// Shutdown services
	setup.Shutdown(application.SyncWorker, db, logger)

	// Shutdown Fiber server
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := fiberApp.ShutdownWithContext(ctx); err != nil {
		logger.Error("server forced to shutdown", "error", err)
	}

	logger.Info("server stopped")
}

func setupLogger() *slog.Logger {
	var handler slog.Handler

	opts := &slog.HandlerOptions{
		Level:     getLogLevel(),
		AddSource: config.AppConfig.Env == "development",
	}

	if config.AppConfig.Env == "production" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

func getLogLevel() slog.Level {
	level := config.GetEnv("LOG_LEVEL", "info")
	switch level {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
