all: dev

dev:
	deno run --env -A --watch main.ts
