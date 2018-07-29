# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/)
and this project adheres to [Semantic Versioning](http://semver.org/).

## [Unreleased](https://github.com/atomist/sdm/compare/0.2.4...HEAD)

### Added

-   Cleanup scheduled goal jobs on Kubernetes [#4](https://github.com/atomist/sdm-core/issues/4)
-   EditorRegistration supports general editorCommand customizations, instead of specifically dryRun. If you were setting `dryRun = true`, set `editorCommandFactory = dryRunEditorCommand` instead.
-   ProjectVersioner function type receives an SdmGoalEvent instead of a Status fragment.
-   Differentiate between internal and external side-effecting fulfillment. [#9](https://github.com/atomist/sdm-core/issues/9)
-   Add ability to extract and report goal Progress. [#14](https://github.com/atomist/sdm-core/issues/14)
-   Add VoteOnGoalApprovalRequest. [#17](https://github.com/atomist/sdm-core/issues/17)

### Changed

-   Remove disposal command from default list of registered commands. [#5](https://github.com/atomist/sdm-core/issues/5)
-   **BREAKING** Removed "dry run" support. See `makeBuildAware` in `sdm`
-   Allow configuration of status creation for NPM packages. [#10](https://github.com/atomist/sdm-core/issues/10)
-   **BREAKING** Removed Node and `npm` support. Moved to `sdm-pack-node`

### Deprecated

-   Rename to GoalInvocation; deprecate status [#2](https://github.com/atomist/sdm-core/issues/2)

### Fixed

-   **BREAKING** EditorRegistration supports general editorCommand customizations, instead of specifically dryRun.
-   Link is missing on npm publish goal. [#11](https://github.com/atomist/sdm-core/issues/11)
-   Use credentialsResolver consistently. [#18](https://github.com/atomist/sdm-core/issues/18)

## [0.2.3](https://github.com/atomist/sdm/compare/0.2.2...0.2.3) - 2018-06-18

### Fixed

-   **BREAKING**  SeedDrivenGeneratorSupport allows you to override the seed. This fixes a bug with overriding the seed name,

## Earlier

### Added

-   Can provide tag when publishing NPM package [#404](https://github.com/atomist/sdm/issues/404)

## [0.1.0](https://github.com/atomist/sdm/tree/0.1.0) - 2018-05-16

### Added

-   Everything
