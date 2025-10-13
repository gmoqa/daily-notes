# Build stage
FROM golang:1.23-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Install templ CLI
RUN go install github.com/a-h/templ/cmd/templ@latest

# Copy source code
COPY . .

# Generate Go files from templ templates
RUN templ generate

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

# Runtime stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /root/

# Copy binary from builder
COPY --from=builder /app/main .
COPY --from=builder /app/static ./static

# Create data directory for SQLite database
RUN mkdir -p ./data

# Expose port
EXPOSE 3000

# Run the application
CMD ["./main"]
