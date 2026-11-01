# Production image for the API (for the later Kubernetes/AWS phase).
#   docker build -t seated-api ./backend
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /out/seed /usr/local/bin/
EXPOSE 8080
# Configuration comes from environment variables (never bake .env into the image).
ENTRYPOINT ["/usr/local/bin/server"]
