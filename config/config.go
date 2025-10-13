package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port           string
	Env            string
	GoogleClientID string
}

var AppConfig *Config

func Load() {
	_ = godotenv.Load()

	AppConfig = &Config{
		Port:           GetEnv("PORT", "3000"),
		Env:            GetEnv("ENV", "development"),
		GoogleClientID: GetEnv("GOOGLE_CLIENT_ID", ""),
	}

	if AppConfig.GoogleClientID == "" {
		log.Fatal("GOOGLE_CLIENT_ID is required")
	}
}

func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
