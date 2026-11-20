# 🎮 Game-check – Spielebibliothek

**Alle deine PC-Spiele an einem Ort**: Steam, Epic Games, GOG, itch.io, EA app, Ubisoft Connect, Battle.net und mehr.
Dazu für jedes Gerät eine **FPS-Schätzung**, eine **Angebotsübersicht** über alle großen Stores, **Favoriten**, ein **Zufallsspiel-Vorschlag** und **GOG-Downloads direkt in der App**.

> 🇬🇧 *A local Windows desktop app that unifies your game libraries (Steam, Epic, GOG, itch.io, EA, Ubisoft, Battle.net, …), estimates per-device playability/FPS, shows store deals, favorites and a random game picker, and can download & install GOG games without GOG Galaxy. UI is in German.*

> ⚠️ **Inoffizielles Hobby-Projekt.** Nicht mit Valve, Epic Games, GOG, Electronic Arts, Ubisoft, Blizzard, Microsoft, Amazon, Riot Games, Rockstar Games oder itch.io verbunden. Bitte den [Haftungsausschluss](DISCLAIMER.md) lesen.

---

## ✨ Funktionen

| Bereich | Was es kann |
|---|---|
| **Bibliothek** | Cover-Raster oder Liste aller Spiele, gruppiert nach Spielbarkeit; Suche, Store-/Installiert-Filter, Sortierung nach FPS, Metascore, Spielzeit |
| **Geräte** | Beliebig viele Geräte (dieser PC wird automatisch erkannt, Vorlagen für Steam Deck, ROG Ally, Gaming-PC, Laptop). Für jedes Spiel: geschätzte FPS, Grafikstufe, Steam-Deck-Status, ProtonDB-Bewertung |
| **Detailansicht** | Beschreibung, Genres, Systemanforderungen, Screenshots, „Spielen“/„Installieren“, Store-Link |
| **Angebote** | Aktuelle Sales von Steam, GOG und Epic (inkl. Gratis-Spiele) – mit Markierung „Besitzt du schon“ und der Frage „Läuft das auf meinen Geräten?“ |
| **Favoriten** | Spiele merken, die du installieren willst – mit Speicherbedarf und „Alle installieren“ |
| **Überrasch mich!** | Zufälliges Spiel aus deiner Bibliothek, optional nur Spiele, die auf dem gewählten Gerät gut laufen, nach Genre, installiert/nicht installiert |
| **Downloads** | GOG-Spiele (offizielle Offline-Installer) direkt herunterladen, pausieren/fortsetzen und still installieren – ohne GOG Galaxy. Steam/Epic-Spiele werden nacheinander an den Launcher übergeben |

### Unterstützte Stores & Launcher

| Store | Installierte Spiele | Komplette Bibliothek | Starten | Herunterladen |
|---|:---:|:---:|:---:|:---:|
| Steam | ✅ automatisch | ✅ mit Web-API-Schlüssel | ✅ | über Steam |
| Epic Games | ✅ automatisch | ✅ mit Epic-Anmeldung | ✅ | über Epic Launcher |
| GOG | ✅ automatisch | ✅ mit GOG-Anmeldung | ✅ direkt (ohne Galaxy) | ✅ **direkt in der App** |
| itch.io | ✅ (itch-App) | ✅ mit API-Schlüssel | ✅ | – |
| EA app, Ubisoft Connect, Battle.net, Rockstar, Amazon Games, Riot, Xbox/Game Pass | ✅ automatisch | ❌ (keine offene Schnittstelle) | ✅ | – |

---

## 📦 Installation

**Voraussetzungen:** Windows 10/11, [Node.js](https://nodejs.org/) **22.5 oder neuer**, ein Chromium-Browser (Edge, Chrome oder Brave) für das App-Fenster.

```bash
git clone https://github.com/Miaxxiemuss/Game-check.git
cd Game-check
npm run installieren
```

Danach liegt eine Verknüpfung **„Spielebibliothek“** auf dem Desktop und im Startmenü.

<details>
<summary>Weitere Startmöglichkeiten</summary>

| Befehl | Beschreibung |
|---|---|
| `npm start` | App direkt aus dem Quellcode starten |
| `npm run dev` | Nur den Server starten (ohne Fenster), Adresse wird in der Konsole ausgegeben |
| `npm install` + `npm run exe` | Eine eigenständige `build/Spielebibliothek.exe` bauen (Node.js Single Executable). **Hinweis:** Die exe ist nicht signiert – die Windows-„Intelligente App-Steuerung“ kann sie blockieren. Die Variante `npm run installieren` startet über das signierte `node.exe` und ist davon nicht betroffen. |

</details>

---

## 🔐 Konten & Datenschutz

Installierte Spiele werden **ohne Anmeldung** gefunden. Für die *komplette* Bibliothek kannst du in der App unter **Konten** verbinden:

- **Steam:** kostenloser [Web-API-Schlüssel](https://steamcommunity.com/dev/apikey). Deine SteamID wird lokal aus Steam gelesen. Die Spieldetails deines Profils müssen ggf. auf „Öffentlich“ stehen.
- **Epic Games / GOG:** Anmeldung im Browser auf der **offiziellen Seite** des Anbieters, danach wird ein einmaliger Code in die App kopiert.
- **itch.io:** persönlicher [API-Schlüssel](https://itch.io/user/settings/api-keys).

**Wichtig:**

- Dein **Passwort** wird nie in die App eingegeben oder gespeichert.
- Alle Daten (Tokens, API-Schlüssel, Einstellungen, Cache, Favoriten) liegen **nur lokal** in `%APPDATA%\Spielebibliothek`. **Diesen Ordner niemals weitergeben oder hochladen.**
- Die App läuft als lokaler Server ausschließlich auf `127.0.0.1` und ist mit einem zufälligen Zugangsschlüssel pro Start geschützt.
- Es gibt **keine Telemetrie**. Netzwerkanfragen gehen nur an die unten genannten Datenquellen.

---

## 📊 Wie wird die Spielbarkeit geschätzt?

1. Aus den Systemanforderungen (Steam) wird die **Grafikkarte** gelesen und mit einer Leistungstabelle (≈ 3DMark Time Spy) verglichen.
2. Berücksichtigt werden **RAM**, **Auflösung** und **Bildwiederholrate** des Geräts.
3. Für Steam Deck fließt **Valves offizielle Deck-Bewertung** ein, für Linux die **ProtonDB**-Bewertung.

> Die Werte sind **grobe Schätzungen**. Der Prozessor, Treiber, Optimierung und Spieleinstellungen werden nicht berücksichtigt. Besonders bei sehr alten oder sehr neuen Spielen können die Werte deutlich abweichen.

---

## 🌐 Datenquellen

| Quelle | Wofür |
|---|---|
| Steam Store API, Steam Web API | Spielinfos, Systemanforderungen, Angebote, eigene Bibliothek |
| Steam Deck Compatibility Report | Deck-Bewertung |
| [ProtonDB](https://www.protondb.com/) | Linux-/Proton-Bewertung |
| GOG API & Katalog | Bibliothek, Infos, Angebote, Offline-Installer |
| Epic Games Store | Bibliothek, Gratis-Spiele |
| [CheapShark](https://www.cheapshark.com/) | Epic-Angebote (Preise in US-Dollar) |
| itch.io API | Bibliothek |

---

## 🗂️ Projektstruktur

```
spielebibliothek/
├─ src/
│  ├─ app.js      Server, Bibliotheks-Scanner, FPS-Schätzung, Downloads
│  └─ ui.html     Komplette Oberfläche (HTML/CSS/JS, keine externen Abhängigkeiten)
├─ build.js       Bündeln, Icon erzeugen, Verknüpfungen anlegen, optional exe bauen
├─ package.json
├─ README.md
├─ DISCLAIMER.md
└─ LICENSE
```

Zur Laufzeit wird keine einzige npm-Abhängigkeit benötigt – nur Node.js.

---

## 🛠️ Fehlerbehebung

- **„Steam liefert keine Spiele“** → In Steam: *Profil → Privatsphäre-Einstellungen → Spieldetails: Öffentlich*.
- **Epic/GOG „Anmeldung abgelaufen“** → Unter *Konten* einfach erneut verbinden.
- **Steam bremst Anfragen** → Beim ersten Einlesen großer Bibliotheken normal. Die App pausiert automatisch und macht weiter; danach kommt alles aus dem Cache.
- **Kein App-Fenster** → Es wird ein Chromium-Browser benötigt (Edge, Chrome, Brave, Vivaldi). Sonst öffnet sich die App im Standardbrowser.
- **Protokoll:** `%APPDATA%\Spielebibliothek\log.txt`

---

## 📄 Lizenz

[MIT](LICENSE) © 2026 [Miax](https://github.com/Miaxxiemuss) – Nutzung auf eigene Gefahr, ohne Gewährleistung. Siehe auch den [Haftungsausschluss](DISCLAIMER.md).
