package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port               string
	Env                string
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
	OpenAIAPIKey       string
}

var AppConfig *Config

func Load() {
	_ = godotenv.Load()

	AppConfig = &Config{
		Port:               GetEnv("PORT", "3000"),
		Env:                GetEnv("ENV", "development"),
		GoogleClientID:     GetEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret: GetEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:  GetEnv("GOOGLE_REDIRECT_URL", "postmessage"),
		OpenAIAPIKey:       GetEnv("OPENAI_API_KEY", ""),
	}

	if AppConfig.GoogleClientID == "" {
		log.Fatal("GOOGLE_CLIENT_ID is required")
	}
	if AppConfig.GoogleClientSecret == "" {
		log.Fatal("GOOGLE_CLIENT_SECRET is required")
	}
}

func GetEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
