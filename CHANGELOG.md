# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist/sdm/compare/0.2.4...HEAD)

### Added

-   Cleanup scheduled goal jobs on Kubernetes [#4](https://github.com/atomist/sdm-core/issues/4)
-   EditorRegistration supports general editorCommand customizations, instead of specifically dryRun. If you were setting `dryRun = true`, set `editorCommandFactory = dryRunEditorCommand` instead.
-   ProjectVersioner function type receives an SdmGoalEvent instead of a Status fragment.

### Changed

-   Remove disposal command from default list of registered commands. [#5](https://github.com/atomist/sdm-core/issues/5)
-   **BREAKING** Removed "dry run" support. See `makeBuildAware` in `sdm`

### Deprecated

-   Rename to GoalInvocation; deprecate status [#2](https://github.com/atomist/sdm-core/issues/2)

### Fixed

-   **BREAKING** EditorRegistration supports general editorCommand customizations, instead of specifically dryRun.

## [0.2.3](https://github.com/atomist/sdm/compare/0.2.2...0.2.3) - 2018-06-18

### Fixed

-   **BREAKING**  SeedDrivenGeneratorSupport allows you to override the seed. This fixes a bug with overriding the seed name,

## Earlier

### Added

-   Can provide tag when publishing NPM package [#404](https://github.com/atomist/sdm/issues/404)

## [0.1.0](https://github.com/atomist/sdm/tree/0.1.0) - 2018-05-16

### Added

-   Everything
