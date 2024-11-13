all: dev

dev:
	deno run --env -A --watch main.ts

empty-commit:
	git commit --allow-empty -m "Trigger rebuild"
