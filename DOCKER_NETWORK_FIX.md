# Docker Network Fix für npm Registry Zugriff

## Problem
Docker Container können npm Registry nicht erreichen (EAI_AGAIN Fehler)

## Lösung 1: Mit Google DNS (Empfohlen)
Die docker-compose.yml ist bereits konfiguriert mit Google DNS (8.8.8.8, 8.8.4.4)

```bash
docker-compose up --build
```

## Lösung 2: Lokale Dependencies Build (Fallback)

Wenn DNS-Konfiguration nicht hilft:

1. **Proxy Dependencies lokal installieren:**
```bash
cd proxy
npm install --production
cd ..
```

2. **.dockerignore temporär anpassen:**
Kommentieren Sie `node_modules` in .dockerignore aus, oder erstellen Sie eine .dockerignore-Datei im proxy Ordner ohne node_modules

3. **Docker Build erneut starten:**
```bash
docker-compose up --build
```

## Lösung 3: Docker DNS System-weit konfigurieren

Erstellen Sie `/etc/docker/daemon.json` (macOS: über Docker Desktop Preferences):
```json
{
  "dns": ["8.8.8.8", "8.8.4.4"]
}
```

Dann Docker neu starten:
```bash
docker restart
```

## Lösung 4: Netzwerk-Probleme debuggen

```bash
# DNS Test im Container
docker run --rm node:18-alpine nslookup registry.npmjs.org

# Mit Google DNS
docker run --rm --dns=8.8.8.8 node:18-alpine nslookup registry.npmjs.org
```
