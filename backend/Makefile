.PHONY: deps up down seed run test build reset

up:        ## start Postgres + Redis
	docker compose -f ../docker-compose.yml up -d --wait

down:      ## stop Postgres + Redis (data kept)
	docker compose -f ../docker-compose.yml down

reset:     ## wipe the database volume
	docker compose -f ../docker-compose.yml down -v

seed:      ## migrate + load demo data (+ embeddings if OPENAI_API_KEY is set)
	go run ./cmd/seed

run:       ## start the API on :8080
	go run ./cmd/server

test:
	go test ./...

build:
	go build -o bin/server ./cmd/server && go build -o bin/seed ./cmd/seed
