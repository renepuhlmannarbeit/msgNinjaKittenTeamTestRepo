# Ninja Kitten Team Board

Eine frameworkfreie, responsive Webanwendung, um die zwölf
Ninja-Kitten-Teammitglieder zu entdecken und eine kleine Arbeitszelle mit bis
zu vier Personen zusammenzustellen.

## Funktionen

- Zeigt genau zwölf Teammitglieder mit Name, Rolle, Mission und individuellem Profil.
- Durchsucht Name, Rolle, Mission und Profil; die Suche ignoriert Groß-/Kleinschreibung, überflüssige Leerzeichen und Diakritika.
- Filtert nach Fachgebieten: mehrere Fachgebiete gelten als ODER, Suche und Filter zusammen als UND.
- Stellt eine Arbeitszelle mit höchstens vier eindeutigen Mitgliedern zusammen. Suche oder Filter ändern die Auswahl nicht.
- Bietet getrennte Aktionen für das Zurücksetzen von Suche/Filtern und das Leeren der Arbeitszelle.
- Behandelt Lade-, leere Treffer- und Datenfehlerzustände verständlich.

## Architektur

Die Anwendung benötigt weder Framework noch Buildschritt noch externe Abhängigkeiten.

- `index.html` enthält die semantische Seitenstruktur.
- `styles.css` liefert responsives Layout, sichtbaren Tastaturfokus und reduzierte Bewegung.
- `src/app.js` lädt Daten, verwaltet UI-Zustand und rendert mit DOM-APIs.
- `src/domain.js` kapselt Validierung, Suche, Filter und Auswahlregeln als reine Funktionen.
- `data/team.json` ist die einzige Quelle für die zwölf Mitglieder.
- `scripts/server.mjs` ist ein lokaler, dependency-freier Entwicklungsserver.
- `tests/domain.test.js` prüft die Fachregeln mit dem Node-Test-Runner.
- `tests/browser/acceptance.spec.mjs` prüft Tastaturfokus, Live-Status und den
  320px-Viewport mit Chromium in der Required CI.

## Datenvertrag

`data/team.json` enthält exakt zwölf eindeutige Einträge. Jeder Eintrag benötigt:

```json
{
  "id": "architorti",
  "name": "ArchiTorti",
  "role": "Systemarchitektur",
  "expertise": ["Architektur"],
  "mission": "…",
  "profile": "…"
}
```

Die Anwendung validiert Anzahl, Typen, nichtleere getrimmte Texte, mindestens
ein Fachgebiet sowie eindeutige IDs und Namen. Ungültige Daten werden
vollständig abgewiesen und als verständlicher Fehlerzustand angezeigt.

## Voraussetzungen

Node.js 20 oder neuer. Es gibt keine zu installierenden Pakete.

## Lokal starten

```sh
npm start
# oder ohne npm:
node scripts/server.mjs
```

Danach `http://127.0.0.1:4173` öffnen. Ein alternativer Port ist mit
`PORT=4174 node scripts/server.mjs` möglich. Der Server bindet ausschließlich
an Loopback und ist nur für die lokale Entwicklung vorgesehen.

## Prüfen

```sh
npm run check
npm test
npm run test:browser
# oder ohne npm:
node --check src/domain.js
node --check src/app.js
node --check scripts/server.mjs
node --test
```

Die Domain-Suite prüft den echten 12er-Datensatz, Vertragsfehler,
Suchnormalisierung, Mission-/Profilsuche, Filterlogik, getrennte Resets sowie
Auswahlgrenze und Entfernen.

Der Browser-Test startet den lokalen Server selbst. Einmalig wird dafür der
Chromium-Browser von Playwright benötigt: `npx playwright install chromium`.

## Manuelle Abnahme

1. Bei 320 CSS-Pixeln und breiter Ansicht prüfen: kein horizontaler Seitenscroll; Suche, Filter, Karten und Arbeitszelle bleiben erreichbar.
2. Nur mit Tastatur prüfen: Suchfeld → Checkbox per Space → Tab. Der Fokus bleibt auf einem nachvollziehbaren Element.
3. Eine Karte mit Enter oder Space hinzufügen und wieder entfernen. Nach jeder Aktion bleibt der Fokus auf der passenden Folgeaktion.
4. Bei vier gewählten Mitgliedern prüfen: Limitmeldung ist sichtbar und für deaktivierte Hinzufügen-Aktionen programmatisch verknüpft; Entfernen bleibt möglich.
5. Suche, mehrere Filter, Nulltreffer, Discovery-Reset und Auswahl-Reset prüfen. Die Auswahl bleibt beim Discovery-Reset erhalten.
6. Mit Screenreader oder DOM-Inspektion prüfen: Ergebnis-/Statusmeldungen werden knapp angekündigt, das Kartenraster selbst ist keine Live-Region.

## Sicherheitsgrenze

Es gibt keine Laufzeitabhängigkeiten, keine externe API und keine persistierten
Nutzerdaten. Nutz- und Datentexte werden ausschließlich über `textContent`
ausgegeben. Der Entwicklungsserver erlaubt nur feste GET-/HEAD-Routen,
validiert den Port, liefert nur explizit erlaubte Ressourcen aus und setzt CSP
sowie `X-Content-Type-Options: nosniff`.

Der Server ist keine Produktionsbereitstellung: Er bietet weder TLS noch
öffentliche Bindung, Authentifizierung oder Produktionsbetrieb. Eine öffentliche
Bereitstellung braucht eine neue Betriebs- und Sicherheitsprüfung.
