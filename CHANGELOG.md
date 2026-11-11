# Changelog

## 0.1.2

- Repaired E2E plugin identity and added native OB coverage while retaining Evra compatibility tests.
- Updated documentation, licensing attribution, and prerelease guidance.

## 0.1.1

- Established the independent `ouroboros-timelines` plugin identity and native `.ob`/`format: "ob"` timeline format.
- Added separate native OB and legacy Evra readers/writers so each format preserves its own extension and header when saved.
- Added optional Evra compatibility, including legacy `evra` and `throughline` embeds, with safe refusal of unsupported files.
- Added a non-destructive command to create a separate `.ob` copy from an `.evra` timeline.
- Added safe, idempotent migration of legacy Evra plugin settings into the new plugin data store.
- Added format regression coverage and updated metadata, installer paths, documentation, and release versioning.

Maintainer: Fatin Hossain.

## 0.1.0

Initial Ouroboros Timelines baseline.

- Rebranded from the upstream Evra Timelines project.
- Existing Evra `.evra` timeline files remain supported as format version 1.
- The plugin ID remains `evra` for compatibility with existing installations and settings.
- No automatic conversion to a future native OB format is performed.

Maintainer: Fatin Hossain.
