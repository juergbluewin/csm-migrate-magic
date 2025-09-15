# Docker Setup für Cisco Migration Tool

## Voraussetzungen
- Docker Desktop für Mac installiert
- Terminal/Kommandozeile

## Schnellstart mit Docker Compose (Empfohlen)

1. **Terminal öffnen** und in das Projektverzeichnis wechseln:
```bash
cd /pfad/zu/ihrem/projekt
```

2. **Container bauen und starten**:
```bash
docker-compose up --build
```

3. **Applikation öffnen**:
- Browser öffnen und zu `http://localhost:3000` navigieren

4. **Container stoppen**:
```bash
docker-compose down
```

## Alternative: Manuelle Docker Kommandos

1. **Docker Image bauen**:
```bash
docker build -t cisco-migration-tool .
```

2. **Container starten**:
```bash
docker run -p 3000:3000 --network host cisco-migration-tool
```

## Wichtige Hinweise

- `--network host` ermöglicht Zugriff auf lokale Netzwerkressourcen (Cisco Security Manager)
- Port 3000 wird für die Webapplikation verwendet
- Das Tool ist nach dem Start unter `http://localhost:3000` erreichbar

## Entwicklungsmodus (optional)

Für Entwicklung mit Live-Reload:
```bash
docker run -p 8080:8080 -v $(pwd):/app --network host node:18-alpine sh -c "cd /app && npm install && npm run dev -- --host"
```